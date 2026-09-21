/**
 * Unit tests for modules/receptionists/receptionists.service.js — the ownership/clinic-scoping
 * guard clauses that gate every mutation in this module, since a receptionist account is always
 * tied to exactly one clinic (receptionistProfile.clinicId) and only that clinic's owning doctor
 * (or an admin) may manage it:
 *
 *   - assertClinicUsableForReceptionist (create + clinic-reassignment path): the clinic must
 *     exist, be 'active', AND the caller must own it — three independent gates, each its own
 *     error code, checked in that order.
 *   - assertOwnsClinic (edit path on an already-assigned clinic): admin bypasses; a non-admin
 *     doctor must hold isOwner:true on doctor_clinics for that exact clinic, not merely be linked
 *     to it.
 *   - the pre-check + P2002-catch double guard against a duplicate receptionist email.
 *   - listReceptionists' doctor-scoping: a doctor only ever sees receptionists at clinics they
 *     are linked to, and a `clinicId` filter outside that allowed set must short-circuit to an
 *     empty page WITHOUT ever reaching prisma.user.findMany.
 *   - getReceptionistById's 404-not-403 enumeration avoidance. (updateReceptionist/
 *     updateReceptionistStatus no longer exist — removed along with PATCH /:id and
 *     PATCH /:id/status, see receptionists.routes.js's comment — so their tests were removed
 *     too, along with GET /:id's own route/controller/validation layer in the later
 *     backend-cleanup audit pass; getReceptionistById itself stays, since createReceptionist
 *     still calls it internally.)
 *
 * config/db is mocked (no real Postgres in this sandbox); activityLogService/cacheService are
 * mocked to isolate this module's own branching from their internals. bcrypt is left real
 * (cheap at BCRYPT_SALT_ROUNDS=4, seeded by tests/setupEnv.js) since createReceptionist's
 * password-hashing is trivial, non-branching logic not worth mocking around.
 */
jest.mock('../../../src/config/db', () => {
  const prismaMock = {
    user: { findUnique: jest.fn(), create: jest.fn(), count: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    clinic: { findUnique: jest.fn() },
    doctorClinic: { findUnique: jest.fn(), findMany: jest.fn() },
    receptionistProfile: { create: jest.fn(), update: jest.fn() },
  };
  prismaMock.$transaction = jest.fn((cb) => cb(prismaMock));
  return prismaMock;
});
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttl, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));

const prisma = require('../../../src/config/db');
const activityLogService = require('../../../src/services/activityLogService');
const receptionistsService = require('../../../src/modules/receptionists/receptionists.service');

const ADMIN = { id: 'admin-1', role: 'admin' };
const OWNER_DOCTOR = { id: 'doc-owner', role: 'doctor' };
const NON_OWNER_DOCTOR = { id: 'doc-other', role: 'doctor' };

function receptionistRow(overrides = {}) {
  return {
    id: 'recep-1',
    role: 'receptionist',
    name: 'Reena',
    email: 'reena@example.com',
    phone: '9000000000',
    status: 'active',
    createdAt: new Date('2026-01-01'),
    receptionistProfile: { clinicId: 'clinic-1', since: new Date('2026-01-01'), clinic: { id: 'clinic-1', name: 'City Clinic' } },
    ...overrides,
  };
}

describe('receptionistsService.createReceptionist — clinic usability + ownership gates', () => {
  test('404 CLINIC_NOT_FOUND when the clinic does not exist', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(
      receptionistsService.createReceptionist({ name: 'A', email: 'a@x.com', password: 'pw', clinicId: 'clinic-x' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 404, code: 'CLINIC_NOT_FOUND' });
  });

  test('400 CLINIC_NOT_ACTIVE when the clinic exists but is not active', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1', name: 'City Clinic', approvalStatus: 'pending' });

    await expect(
      receptionistsService.createReceptionist({ name: 'A', email: 'a@x.com', password: 'pw', clinicId: 'clinic-1' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, code: 'CLINIC_NOT_ACTIVE' });
  });

  test('403 FORBIDDEN when a non-owner doctor tries to create a receptionist at a clinic they do not own', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1', name: 'City Clinic', approvalStatus: 'active' });
    prisma.doctorClinic.findUnique.mockResolvedValue({ isOwner: false });

    await expect(
      receptionistsService.createReceptionist(
        { name: 'A', email: 'a@x.com', password: 'pw', clinicId: 'clinic-1' },
        NON_OWNER_DOCTOR
      )
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  test('403 FORBIDDEN when the doctor has no link to the clinic at all (findUnique -> null)', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1', name: 'City Clinic', approvalStatus: 'active' });
    prisma.doctorClinic.findUnique.mockResolvedValue(null);

    await expect(
      receptionistsService.createReceptionist(
        { name: 'A', email: 'a@x.com', password: 'pw', clinicId: 'clinic-1' },
        NON_OWNER_DOCTOR
      )
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  test('admin bypasses the ownership check entirely (no doctorClinic lookup needed)', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1', name: 'City Clinic', approvalStatus: 'active' });
    prisma.user.findUnique.mockResolvedValueOnce(null); // no existing user with this email
    prisma.user.create.mockResolvedValue({ id: 'recep-new' });
    prisma.user.findUnique.mockResolvedValueOnce(receptionistRow({ id: 'recep-new' })); // getReceptionistById re-fetch

    await receptionistsService.createReceptionist(
      { name: ' A ', email: 'A@X.com', password: 'pw', clinicId: 'clinic-1' },
      ADMIN
    );

    expect(prisma.doctorClinic.findUnique).not.toHaveBeenCalled();
  });

  test('409 EMAIL_ALREADY_EXISTS pre-check blocks creating a user with an existing email (case/whitespace-normalized)', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1', name: 'City Clinic', approvalStatus: 'active' });
    prisma.doctorClinic.findUnique.mockResolvedValue({ isOwner: true });
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      receptionistsService.createReceptionist(
        { name: 'A', email: '  Reena@Example.com  ', password: 'pw', clinicId: 'clinic-1' },
        OWNER_DOCTOR
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_ALREADY_EXISTS' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'reena@example.com' }, select: { id: true } });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('a P2002 unique-constraint race during the transaction is also mapped to 409 EMAIL_ALREADY_EXISTS', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1', name: 'City Clinic', approvalStatus: 'active' });
    prisma.doctorClinic.findUnique.mockResolvedValue({ isOwner: true });
    prisma.user.findUnique.mockResolvedValueOnce(null); // pre-check passes...
    const raceError = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    prisma.user.create.mockRejectedValue(raceError); // ...but the transaction still races and fails

    await expect(
      receptionistsService.createReceptionist(
        { name: 'A', email: 'a@x.com', password: 'pw', clinicId: 'clinic-1' },
        OWNER_DOCTOR
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_ALREADY_EXISTS' });
  });

  test('an unrelated transaction error is rethrown unchanged (not swallowed into a fake 409)', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1', name: 'City Clinic', approvalStatus: 'active' });
    prisma.doctorClinic.findUnique.mockResolvedValue({ isOwner: true });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.create.mockRejectedValue(new Error('boom'));

    await expect(
      receptionistsService.createReceptionist(
        { name: 'A', email: 'a@x.com', password: 'pw', clinicId: 'clinic-1' },
        OWNER_DOCTOR
      )
    ).rejects.toThrow('boom');
  });

  test('success: owning doctor creates the receptionist, logs, invalidates the list cache, and returns the shaped row', async () => {
    const cacheService = require('../../../src/services/cacheService');
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1', name: 'City Clinic', approvalStatus: 'active' });
    prisma.doctorClinic.findUnique.mockResolvedValue({ isOwner: true });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValue({ id: 'recep-new' });
    prisma.user.findUnique.mockResolvedValueOnce(receptionistRow({ id: 'recep-new' }));

    const result = await receptionistsService.createReceptionist(
      { name: '  Reena  ', email: 'reena@example.com', password: 'pw', phone: ' 900 ', clinicId: 'clinic-1' },
      OWNER_DOCTOR
    );

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Reena', role: 'receptionist', status: 'active' }) })
    );
    expect(activityLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'receptionist.create_account', targetEntityId: 'recep-new' })
    );
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:receptionists:list:*');
    expect(result.id).toBe('recep-new');
  });
});

describe('receptionistsService.listReceptionists — doctor clinic-scoping', () => {
  test('a doctor only sees receptionists at clinics they are linked to', async () => {
    prisma.doctorClinic.findMany.mockResolvedValue([{ clinicId: 'clinic-1' }, { clinicId: 'clinic-2' }]);
    prisma.user.findMany.mockResolvedValue([receptionistRow()]);
    prisma.user.count.mockResolvedValue(1);

    await receptionistsService.listReceptionists({}, OWNER_DOCTOR);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'receptionist', receptionistProfile: { clinicId: { in: ['clinic-1', 'clinic-2'] } } },
      })
    );
  });

  test('a clinicId filter outside the doctor\'s allowed set short-circuits to an empty page without querying users', async () => {
    prisma.doctorClinic.findMany.mockResolvedValue([{ clinicId: 'clinic-1' }]);

    const result = await receptionistsService.listReceptionists({ clinicId: 'clinic-OUTSIDE' }, OWNER_DOCTOR);

    expect(result).toEqual({ rows: [], pagination: expect.objectContaining({ total: 0 }) });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  test('admin lists every receptionist platform-wide (no clinic restriction applied)', async () => {
    prisma.user.findMany.mockResolvedValue([receptionistRow()]);
    prisma.user.count.mockResolvedValue(1);

    await receptionistsService.listReceptionists({}, ADMIN);

    expect(prisma.doctorClinic.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: 'receptionist' } }));
  });
});

describe('receptionistsService.getReceptionistById — 404-not-403 visibility', () => {
  test('404 when no such user exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(receptionistsService.getReceptionistById('x', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECEPTIONIST_NOT_FOUND',
    });
  });

  test('404 when the user exists but is not a receptionist', async () => {
    prisma.user.findUnique.mockResolvedValue(receptionistRow({ role: 'patient' }));
    await expect(receptionistsService.getReceptionistById('x', ADMIN)).rejects.toMatchObject({
      code: 'RECEPTIONIST_NOT_FOUND',
    });
  });

  test('404 (not 403) for a doctor unrelated to the receptionist\'s clinic', async () => {
    prisma.user.findUnique.mockResolvedValue(receptionistRow());
    prisma.doctorClinic.findUnique.mockResolvedValue(null);

    await expect(receptionistsService.getReceptionistById('recep-1', NON_OWNER_DOCTOR)).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECEPTIONIST_NOT_FOUND',
    });
  });

  test('a doctor linked to the clinic (even without isOwner) CAN view the receptionist', async () => {
    prisma.user.findUnique.mockResolvedValue(receptionistRow());
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: OWNER_DOCTOR.id });

    const result = await receptionistsService.getReceptionistById('recep-1', OWNER_DOCTOR);
    expect(result.id).toBe('recep-1');
  });

  test('admin sees any receptionist without a doctorClinic lookup', async () => {
    prisma.user.findUnique.mockResolvedValue(receptionistRow());

    const result = await receptionistsService.getReceptionistById('recep-1', ADMIN);
    expect(result.id).toBe('recep-1');
    expect(prisma.doctorClinic.findUnique).not.toHaveBeenCalled();
  });
});

// updateReceptionist/updateReceptionistStatus and their tests removed (mobile parity audit
// round 2 — user request: "backend hai but website me nahi hai to hata do app se backend v oo
// hata do"): both functions (and PATCH /:id, PATCH /:id/status) were already deleted from
// receptionists.service.js/routes.js in that pass — see receptionists.routes.js's comment for
// the full rationale — but these tests were left behind at the time, referencing functions that
// no longer exist. Fixed here (backend-cleanup audit pass) by removing the stale
// 'receptionistsService.updateReceptionist' and 'receptionistsService.updateReceptionistStatus'
// describe blocks along with the code they used to exercise.
