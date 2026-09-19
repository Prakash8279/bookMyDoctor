/**
 * Unit tests for modules/me/me.service.js — the self-service profile edit guardrails, since
 * `userId`/`role` here always come from req.user (never the body) and PATCH /me is the one
 * place every role edits their own row:
 *
 *   - updateMe's per-role field allowlist (PROFILE_EDITABLE_FIELDS): a field not on the calling
 *     role's list is silently dropped, not merely ignored-with-a-warning — receptionist/admin/
 *     superadmin have NO self-editable profile fields this phase.
 *   - the doctor-only business rule "minBookingAdvanceAmount must never exceed the EFFECTIVE
 *     consultationFee" — checked against the value being set in the SAME request when present,
 *     otherwise the doctor's existing saved fee (a real two-branch computation, not a static
 *     compare).
 *   - the doctor `languages` array is deduped and blank-trimmed before being persisted.
 *   - a no-op body (nothing recognized for this role present) never opens a transaction or writes
 *     an audit-log entry.
 *   - changePassword: wrong current password -> 400 (not 401, deliberately, so it doesn't trip an
 *     API client's 401-triggers-refresh interceptor); same current/new password rejected; success
 *     revokes every refresh token the user holds (forced re-login elsewhere).
 *   - the lazy require into doctors.service.js#invalidateDoctorCaches only fires for role:'doctor'.
 *
 * config/db is mocked (no real Postgres in this sandbox); tokenService is mocked (its own
 * behavior is covered by tokenService.test.js — this module only needs to know
 * revokeAllForUser was called); activityLogService is mocked; bcrypt/env are left real
 * (BCRYPT_SALT_ROUNDS=4, seeded by tests/setupEnv.js, so hashing stays fast).
 */
jest.mock('../../../src/config/db', () => {
  const prismaMock = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    specialization: { findUnique: jest.fn() },
    doctorProfile: { findUnique: jest.fn(), upsert: jest.fn() },
    patientProfile: { upsert: jest.fn() },
  };
  prismaMock.$transaction = jest.fn((cb) => cb(prismaMock));
  return prismaMock;
});
jest.mock('../../../src/services/tokenService', () => ({
  signAccessToken: jest.fn(),
  verifyAccessToken: jest.fn(),
  signResetToken: jest.fn(),
  verifyResetToken: jest.fn(),
  issueRefreshToken: jest.fn(),
  issueTokenPair: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeRefreshToken: jest.fn(),
  revokeAllForUser: jest.fn(),
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/modules/doctors/doctors.service', () => ({ invalidateDoctorCaches: jest.fn() }));

const bcrypt = require('bcrypt');
const prisma = require('../../../src/config/db');
const tokenService = require('../../../src/services/tokenService');
const activityLogService = require('../../../src/services/activityLogService');
const doctorsService = require('../../../src/modules/doctors/doctors.service');
const meService = require('../../../src/modules/me/me.service');

function fullUserRow(overrides = {}) {
  return {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    phone: '900',
    city: 'Pune',
    photoUrl: null,
    role: 'patient',
    status: 'active',
    createdAt: new Date(),
    patientProfile: null,
    doctorProfile: null,
    receptionistProfile: null,
    ...overrides,
  };
}

describe('meService.getMe', () => {
  test('401 UNAUTHORIZED when the user row is gone (e.g. deleted between token issue and this call)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(meService.getMe('user-1')).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });
});

describe('meService.updateMe — per-role field allowlist', () => {
  test('a field not on the allowlist for this role is silently dropped, not persisted', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow());

    await meService.updateMe('user-1', 'patient', { name: 'New', consultationFee: 999 });

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { name: 'New' } });
    expect(prisma.patientProfile.upsert).not.toHaveBeenCalled();
  });

  test('receptionist/admin/superadmin have no editable profile fields — only base fields are ever written', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'receptionist' }));

    await meService.updateMe('user-1', 'receptionist', { name: 'New', clinicId: 'clinic-x' });

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { name: 'New' } });
  });

  test('a completely no-op body (nothing recognized) never opens a transaction or logs', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow());

    await meService.updateMe('user-1', 'patient', { unrelatedField: 'x' });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(activityLogService.log).not.toHaveBeenCalled();
  });

  test('400 SPECIALIZATION_NOT_FOUND when a doctor sets an unknown specializationId', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'doctor' }));
    prisma.specialization.findUnique.mockResolvedValue(null);

    await expect(
      meService.updateMe('user-1', 'doctor', { specializationId: 'spec-ghost' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'SPECIALIZATION_NOT_FOUND' });
  });

  test('doctor languages are deduped and blank/whitespace-only entries are dropped', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'doctor' }));

    await meService.updateMe('user-1', 'doctor', { languages: ['English', ' English ', 'Hindi', '   '] });

    expect(prisma.doctorProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { languages: ['English', 'Hindi'] } })
    );
  });

  test('minBookingAdvanceAmount exceeding the fee BEING SET IN THIS SAME REQUEST is rejected', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'doctor' }));

    await expect(
      meService.updateMe('user-1', 'doctor', { consultationFee: 100, minBookingAdvanceAmount: 150 })
    ).rejects.toMatchObject({ statusCode: 400, code: 'MIN_BOOKING_AMOUNT_EXCEEDS_FEE' });
    expect(prisma.doctorProfile.findUnique).not.toHaveBeenCalled(); // effective fee came from the body, no DB lookup needed
  });

  test('minBookingAdvanceAmount is checked against the EXISTING saved fee when none is being set now', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'doctor' }));
    prisma.doctorProfile.findUnique.mockResolvedValue({ consultationFee: 100 });

    await expect(
      meService.updateMe('user-1', 'doctor', { minBookingAdvanceAmount: 150 })
    ).rejects.toMatchObject({ statusCode: 400, code: 'MIN_BOOKING_AMOUNT_EXCEEDS_FEE' });
  });

  test('minBookingAdvanceAmount at or below the effective fee is accepted', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'doctor' }));

    await meService.updateMe('user-1', 'doctor', { consultationFee: 200, minBookingAdvanceAmount: 150 });

    expect(prisma.doctorProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ minBookingAdvanceAmount: 150, consultationFee: 200 }) })
    );
  });

  test('400 when no existing fee is on file at all and minBookingAdvanceAmount is being set', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'doctor' }));
    prisma.doctorProfile.findUnique.mockResolvedValue(null);

    await expect(
      meService.updateMe('user-1', 'doctor', { minBookingAdvanceAmount: 50 })
    ).rejects.toMatchObject({ code: 'MIN_BOOKING_AMOUNT_EXCEEDS_FEE' });
  });

  test('a doctor edit busts the public directory cache via the lazy doctors.service require', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'doctor' }));

    await meService.updateMe('user-1', 'doctor', { bio: 'New bio' });

    expect(doctorsService.invalidateDoctorCaches).toHaveBeenCalledWith('user-1');
  });

  test('a patient edit does NOT touch the doctor-directory cache', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow());

    await meService.updateMe('user-1', 'patient', { city: 'Mumbai' });

    expect(doctorsService.invalidateDoctorCaches).not.toHaveBeenCalled();
  });

  // COMPLETENESS ADD (request: "doctor bank details v only admin and super admin dekh sakta
  // hai add kro") — bank details are self-editable via PATCH /me exactly like any other doctor
  // profile field; their admin/superadmin-only READ-side visibility is doctors.service.js's
  // concern (see doctors.service.test.js), not this module's.
  test('a doctor can set their own bank details via PATCH /me', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'doctor' }));

    await meService.updateMe('user-1', 'doctor', {
      bankAccountHolderName: 'Asha Rao',
      bankAccountNumber: '123456789012',
      bankIfscCode: 'HDFC0001234',
      bankName: 'HDFC Bank',
    });

    expect(prisma.doctorProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          bankAccountHolderName: 'Asha Rao',
          bankAccountNumber: '123456789012',
          bankIfscCode: 'HDFC0001234',
          bankName: 'HDFC Bank',
        },
      })
    );
  });

  test('a patient CANNOT set bank-detail fields — silently dropped like any other out-of-allowlist field', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow());

    await meService.updateMe('user-1', 'patient', { name: 'New', bankAccountNumber: '999999' });

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { name: 'New' } });
    expect(prisma.patientProfile.upsert).not.toHaveBeenCalled();
  });

  // COMPLETENESS ADD (request: "upiid dalne ka v option de do") — bankUpiId is independent of
  // the 4 bank fields above; a doctor can set it alone.
  test('a doctor can set just their UPI ID, independent of the 4 bank fields', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow({ role: 'doctor' }));

    await meService.updateMe('user-1', 'doctor', { bankUpiId: 'asha@okhdfcbank' });

    expect(prisma.doctorProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { bankUpiId: 'asha@okhdfcbank' } })
    );
  });

  test('audit log description never includes field VALUES, only field NAMES', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUserRow());

    await meService.updateMe('user-1', 'patient', { city: 'A Secret City Value' });

    const [[entry]] = activityLogService.log.mock.calls;
    expect(entry.description).not.toContain('A Secret City Value');
    expect(entry.description).toContain('city');
  });
});

describe('meService.changePassword', () => {
  test('401 UNAUTHORIZED when the user row is gone', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      meService.changePassword('user-1', 'patient', { currentPassword: 'a', newPassword: 'b' })
    ).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  test('400 INVALID_CURRENT_PASSWORD (not 401) when the current password does not match', async () => {
    const realHash = await bcrypt.hash('correct-password', 4);
    prisma.user.findUnique.mockResolvedValue({ passwordHash: realHash });

    await expect(
      meService.changePassword('user-1', 'patient', { currentPassword: 'wrong-password', newPassword: 'new-password' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURRENT_PASSWORD' });
  });

  test('400 SAME_PASSWORD when the new password equals the current one', async () => {
    const realHash = await bcrypt.hash('same-password', 4);
    prisma.user.findUnique.mockResolvedValue({ passwordHash: realHash });

    await expect(
      meService.changePassword('user-1', 'patient', { currentPassword: 'same-password', newPassword: 'same-password' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'SAME_PASSWORD' });
  });

  test('success hashes the new password, revokes every refresh token, and logs the change', async () => {
    const realHash = await bcrypt.hash('old-password', 4);
    prisma.user.findUnique.mockResolvedValue({ passwordHash: realHash });

    await meService.changePassword('user-1', 'patient', { currentPassword: 'old-password', newPassword: 'new-password' });

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { passwordHash: expect.any(String) } });
    expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(activityLogService.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'auth.password_change' }));
  });
});
