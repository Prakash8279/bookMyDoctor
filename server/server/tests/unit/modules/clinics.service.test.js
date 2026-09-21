/**
 * Unit tests for modules/clinics/clinics.service.js — clinic CRUD, the doctor_clinics
 * assignment sub-module (owner/primary invariants), and OPD hours/closures.
 *
 * Three kinds of bug this guards against:
 *
 *   - Visibility-before-ownership ordering: updateClinic/assignDoctorToClinic/
 *     updateDoctorAssignment/removeDoctorAssignment all call getVisibleClinicOrThrow BEFORE
 *     assertIsClinicOwner (and, for the assignment endpoints, before even looking up the specific
 *     assignment row) so that a caller with zero relation to a clinic always gets the same 404 a
 *     plain GET /clinics/:id would give them — never a 403 that would leak "this clinic exists"
 *     to someone who can't even see it. Getting that order backwards turns clinic existence into
 *     an oracle.
 *   - The "a clinic must always have at least one owner" invariant: removeDoctorAssignment
 *     (deleting the last owner's row) must block with CLINIC_MUST_HAVE_OWNER unless an admin is
 *     doing it — an admin can always force it through (e.g. to fix a clinic stuck ownerless after
 *     an account was disabled elsewhere). updateDoctorAssignment used to enforce this same
 *     invariant when isOwner was flipped false->true via PATCH, but isOwner/isPrimary are no
 *     longer settable through that endpoint at all (backend-cleanup audit — see
 *     clinics.validation.js#updateDoctorAssignment's comment), so that guard and its tests were
 *     removed together with the code.
 *   - Defense-in-depth null rejection: pickPresentFields' nonNullableFields guard is exercised
 *     directly through updateClinic/assignDoctorToClinic/updateDoctorAssignment, since an
 *     explicit JSON `null` on a NOT NULL column must 422 here, not crash Prisma with an unhandled
 *     validation error further down.
 *
 * config/db is mocked (no real Postgres in this sandbox — see tests/setupEnv.js's header
 * comment); activityLogService/cacheService are mocked to isolate this module's own branching
 * from their internals. cacheService.getOrSet always runs the fetcher (simulated cache miss),
 * matching doctors.service.test.js's convention, since the real implementation transitively
 * requires config/redis (no real Redis in this sandbox either). doctors.service.js is mocked
 * too: clinics.service.js lazily requires it (see invalidateClinicCaches's comment on why) purely
 * to bust a doctor's own cached detail page/list when their clinic assignment changes — this
 * suite only needs to assert clinics.service.js CALLS that hook, never doctors.service.js's own
 * internals.
 */
jest.mock('../../../src/config/db', () => {
  const prisma = {
    clinic: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    doctorClinic: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    doctorClinicHours: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    doctorClinicClosure: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    city: { findUnique: jest.fn() },
    area: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    // Mimics Prisma's interactive-transaction callback API: every model above is shared between
    // `prisma.x` and the `tx.x` the callback receives, so a test can mock `prisma.clinic.create`
    // etc. directly regardless of whether the source calls it inside or outside $transaction.
    $transaction: jest.fn((cb) => cb(prisma)),
  };
  return prisma;
});
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttlSeconds, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));
jest.mock('../../../src/modules/doctors/doctors.service', () => ({
  invalidateDoctorCaches: jest.fn(),
}));
// createClinic now draws a stable clinicNumber (prisma/migrations/
// 20260919130000_add_patient_doctor_clinic_numbers) via idGenerators.nextClinicNumber(), which
// itself calls the real prisma.$queryRaw('SELECT nextval(...)') — not worth teaching the plain
// object mock above to fake a Postgres sequence's return shape, so the generator itself is
// mocked directly (same approach as auth.service.test.js's nextPatientNumber mock).
jest.mock('../../../src/utils/idGenerators', () => ({
  nextClinicNumber: jest.fn().mockResolvedValue(101),
}));

const prisma = require('../../../src/config/db');
const cacheService = require('../../../src/services/cacheService');
const doctorsService = require('../../../src/modules/doctors/doctors.service');
const idGenerators = require('../../../src/utils/idGenerators');
const clinicsService = require('../../../src/modules/clinics/clinics.service');

const ADMIN = { id: 'admin-1', role: 'admin' };
const DOCTOR = { id: 'doc-owner-1', role: 'doctor' };

function buildClinicDetail(overrides = {}) {
  return {
    id: 'clinic-1',
    name: 'City Clinic',
    phone: '9999999999',
    address: '123 Main St',
    approvalStatus: 'active',
    rejectionReason: null,
    emergencyAvailable: false,
    paymentCashEnabled: true,
    paymentUpiEnabled: false,
    paymentUpiId: null,
    paymentQrUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    clinicNumber: 5,
    city: { id: 'city-1', name: 'Pune', state: 'MH' },
    area: { id: 'area-1', name: 'Kothrud', pincode: '411038' },
    doctorClinics: [],
    ...overrides,
  };
}

// ── A. Clinic CRUD + approval ───────────────────────────────────────────

describe('clinicsService.createClinic', () => {
  test('rejects a falsy cityId with 400 CITY_NOT_FOUND before ever starting a transaction', async () => {
    await expect(clinicsService.createClinic({ name: 'X', cityId: null }, ADMIN)).rejects.toMatchObject({
      statusCode: 400,
      code: 'CITY_NOT_FOUND',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('404s AREA_CITY_MISMATCH... actually CITY_NOT_FOUND when the city does not exist', async () => {
    prisma.city.findUnique.mockResolvedValue(null);

    await expect(clinicsService.createClinic({ name: 'X', cityId: 'city-missing' }, ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CITY_NOT_FOUND',
    });
  });

  test('400s AREA_CITY_MISMATCH when the area belongs to a different city', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1' });
    prisma.area.findUnique.mockResolvedValue({ cityId: 'city-OTHER' });

    await expect(
      clinicsService.createClinic({ name: 'X', cityId: 'city-1', areaId: 'area-1' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, code: 'AREA_CITY_MISMATCH' });
  });

  test('an admin-created clinic goes straight to active and creates no doctor_clinics row', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1' });
    prisma.clinic.create.mockResolvedValue({ id: 'clinic-1' });
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail({ approvalStatus: 'active' }));

    await clinicsService.createClinic({ name: '  City Clinic  ', cityId: 'city-1' }, ADMIN);

    expect(prisma.clinic.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'City Clinic', approvalStatus: 'active' }) })
    );
    expect(prisma.doctorClinic.create).not.toHaveBeenCalled();
    // Stable "DCC<N>" display number — drawn from idGenerators.nextClinicNumber() (mocked above
    // to return 101) and stored directly on the new clinic row, never recomputed later.
    expect(prisma.clinic.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clinicNumber: 101 }) })
    );
    expect(idGenerators.nextClinicNumber).toHaveBeenCalledTimes(1);
  });

  // FROM-SCRATCH FIX documented in createClinic's own comment: a doctor-created clinic used to go
  // straight to active with no review path — this locks down the fixed behavior.
  test('a doctor-created clinic starts pending and auto-assigns the creator as owner+primary', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1' });
    prisma.clinic.create.mockResolvedValue({ id: 'clinic-1' });
    prisma.doctorClinic.count.mockResolvedValue(0); // this is the doctor's first clinic
    // The final getVisibleClinicOrThrow(clinic.id, actor) fetch must see the doctor's own
    // just-created assignment row, or a pending clinic would 404 even its own creator.
    prisma.clinic.findUnique.mockResolvedValue(
      buildClinicDetail({
        approvalStatus: 'pending',
        doctorClinics: [{ doctorUserId: DOCTOR.id, isOwner: true, isPrimary: true, onlineBooking: true, doctor: { id: DOCTOR.id, name: 'Dr Owner', photoUrl: null } }],
      })
    );

    await clinicsService.createClinic({ name: 'City Clinic', cityId: 'city-1' }, DOCTOR);

    expect(prisma.clinic.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ approvalStatus: 'pending' }) })
    );
    expect(prisma.doctorClinic.create).toHaveBeenCalledWith({
      data: { doctorUserId: DOCTOR.id, clinicId: 'clinic-1', isOwner: true, isPrimary: true, onlineBooking: true },
    });
  });

  test('a doctor creating a SECOND clinic is not made primary automatically', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1' });
    prisma.clinic.create.mockResolvedValue({ id: 'clinic-2' });
    prisma.doctorClinic.count.mockResolvedValue(1); // already owns one clinic
    prisma.clinic.findUnique.mockResolvedValue(
      buildClinicDetail({
        id: 'clinic-2',
        approvalStatus: 'pending',
        doctorClinics: [{ doctorUserId: DOCTOR.id, isOwner: true, isPrimary: false, onlineBooking: true, doctor: { id: DOCTOR.id, name: 'Dr Owner', photoUrl: null } }],
      })
    );

    await clinicsService.createClinic({ name: 'Second Clinic', cityId: 'city-1' }, DOCTOR);

    expect(prisma.doctorClinic.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPrimary: false }) })
    );
  });

  test('logs the activity and invalidates the clinics-list + doctor caches after creating', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1' });
    prisma.clinic.create.mockResolvedValue({ id: 'clinic-1' });
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());

    await clinicsService.createClinic({ name: 'City Clinic', cityId: 'city-1' }, ADMIN);

    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:clinics:list:*');
    expect(doctorsService.invalidateDoctorCaches).toHaveBeenCalledWith(undefined);
  });
});

describe('clinicsService.listClinics — scope/status branching', () => {
  beforeEach(() => {
    prisma.clinic.findMany.mockResolvedValue([]);
    prisma.clinic.count.mockResolvedValue(0);
  });

  test('a public/anonymous caller only ever sees active clinics, regardless of an approvalStatus query param', async () => {
    await clinicsService.listClinics({ approvalStatus: 'pending' }, undefined);

    expect(prisma.clinic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ approvalStatus: 'active' }) })
    );
  });

  test('an admin with no approvalStatus filter sees every status', async () => {
    await clinicsService.listClinics({}, ADMIN);

    const where = prisma.clinic.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('approvalStatus');
  });

  test('an admin with an explicit approvalStatus filter gets it applied', async () => {
    await clinicsService.listClinics({ approvalStatus: 'disabled' }, ADMIN);

    expect(prisma.clinic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ approvalStatus: 'disabled' }) })
    );
  });

  test('mine:true for a doctor sees every status, scoped to their own doctor_clinics row', async () => {
    await clinicsService.listClinics({ mine: true }, DOCTOR);

    const where = prisma.clinic.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('approvalStatus');
    expect(where.doctorClinics).toEqual({ some: { doctorUserId: DOCTOR.id } });
  });

  // A patient can't reach the "mine" scope even by sending mine:true — wantsMine also requires
  // requester.role === 'doctor'.
  test('mine:true from a non-doctor requester falls back to the public active-only scope', async () => {
    await clinicsService.listClinics({ mine: true }, { id: 'patient-1', role: 'patient' });

    expect(prisma.clinic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ approvalStatus: 'active' }) })
    );
  });

  // search filter removed (backend-cleanup audit — user request: "website frontend me nahi hai
  // but backend bna hua hai to backend se hata do"): neither web nor mobile ever sent it.
  test('city/area/emergencyAvailable filters are all applied together', async () => {
    await clinicsService.listClinics({ city: 'city-1', area: 'area-1', emergencyAvailable: true }, undefined);

    expect(prisma.clinic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cityId: 'city-1',
          areaId: 'area-1',
          emergencyAvailable: true,
        }),
      })
    );
    // a `search` param supplied anyway has no effect — no `name` filter is built.
    const where = prisma.clinic.findMany.mock.calls[0][0].where;
    expect(where.name).toBeUndefined();
  });
});

describe('clinicsService.getClinicById — public-cacheable vs visibility-gated fetch', () => {
  test('an active clinic is returned from the (simulated) public cache bucket', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail({ approvalStatus: 'active' }));

    const result = await clinicsService.getClinicById('clinic-1', undefined);

    expect(result.id).toBe('clinic-1');
    // Stable "DCC<N>" display number (prisma/migrations/
    // 20260919130000_add_patient_doctor_clinic_numbers) — never derived from list position.
    expect(result.clinicNumber).toBe(5);
    // Only the one lookup inside the cached fetcher — the uncached visibility-gated branch below
    // must NOT also run for an active clinic.
    expect(prisma.clinic.findUnique).toHaveBeenCalledTimes(1);
  });

  test('a pending clinic is never cached as the public shape and 404s an unrelated caller', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail({ approvalStatus: 'pending' }));

    await expect(
      clinicsService.getClinicById('clinic-1', { id: 'someone-else', role: 'patient' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'CLINIC_NOT_FOUND' });
    // Looked up twice: once for the (rejected) public-cache attempt, once for the real
    // visibility-gated fetch.
    expect(prisma.clinic.findUnique).toHaveBeenCalledTimes(2);
  });

  test('a pending clinic IS visible to a doctor assigned to it (even non-owner)', async () => {
    prisma.clinic.findUnique.mockResolvedValue(
      buildClinicDetail({
        approvalStatus: 'pending',
        doctorClinics: [{ doctorUserId: 'doc-1', isOwner: false, isPrimary: false, onlineBooking: true, doctor: { id: 'doc-1', name: 'Dr A', photoUrl: null } }],
      })
    );

    const result = await clinicsService.getClinicById('clinic-1', { id: 'doc-1', role: 'doctor' });

    expect(result.id).toBe('clinic-1');
  });

  test('a pending clinic IS visible to an admin', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail({ approvalStatus: 'pending' }));

    const result = await clinicsService.getClinicById('clinic-1', ADMIN);

    expect(result.id).toBe('clinic-1');
  });

  test('a missing clinic 404s CLINIC_NOT_FOUND', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(clinicsService.getClinicById('clinic-missing', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLINIC_NOT_FOUND',
    });
  });

  test('shapes doctorClinics into a flat doctors[] array', async () => {
    prisma.clinic.findUnique.mockResolvedValue(
      buildClinicDetail({
        doctorClinics: [
          { doctorUserId: 'doc-1', isOwner: true, isPrimary: true, onlineBooking: true, doctor: { id: 'doc-1', name: 'Dr A', photoUrl: 'p.jpg' } },
        ],
      })
    );

    const result = await clinicsService.getClinicById('clinic-1', undefined);

    // specialization is null here because the mock doctor row above has no doctorProfile —
    // see clinics.service.js#shapeClinicDetail's own comment for why this field exists.
    expect(result.doctors).toEqual([
      { doctorUserId: 'doc-1', name: 'Dr A', photoUrl: 'p.jpg', isOwner: true, isPrimary: true, onlineBooking: true, specialization: null },
    ]);
  });
});

describe('clinicsService.updateClinic', () => {
  test('404s when the clinic is not visible to this actor (before any ownership check)', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(clinicsService.updateClinic('clinic-1', { name: 'New' }, DOCTOR)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLINIC_NOT_FOUND',
    });
    expect(prisma.doctorClinic.findUnique).not.toHaveBeenCalled();
  });

  test('403s FORBIDDEN when the actor can see the clinic but is not its owner', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique.mockResolvedValue(null); // not assigned at all

    await expect(clinicsService.updateClinic('clinic-1', { name: 'New' }, DOCTOR)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    expect(prisma.clinic.update).not.toHaveBeenCalled();
  });

  // Defense-in-depth guard: `name` is a NOT NULL column (CLINIC_UPDATE_NON_NULLABLE).
  test('422s when a NOT NULL field like name is explicitly set to null', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());

    await expect(clinicsService.updateClinic('clinic-1', { name: null }, ADMIN)).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.clinic.update).not.toHaveBeenCalled();
  });

  test('approvalStatus/rejectionReason in the body are silently ignored, never forwarded to Prisma', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.clinic.update.mockResolvedValue({});

    await clinicsService.updateClinic('clinic-1', { approvalStatus: 'active', name: 'Renamed' }, ADMIN);

    expect(prisma.clinic.update).toHaveBeenCalledWith({ where: { id: 'clinic-1' }, data: { name: 'Renamed' } });
  });

  test('re-validates city/area when cityId changes, using the NEW cityId', async () => {
    prisma.clinic.findUnique.mockResolvedValueOnce(buildClinicDetail({ city: { id: 'city-1' } }));
    prisma.city.findUnique.mockResolvedValue(null); // new city does not exist

    await expect(
      clinicsService.updateClinic('clinic-1', { cityId: 'city-NEW' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 404, code: 'CITY_NOT_FOUND' });
    expect(prisma.city.findUnique).toHaveBeenCalledWith({ where: { id: 'city-NEW' }, select: { id: true } });
  });

  test('re-validates area against the EXISTING cityId when only areaId changes', async () => {
    prisma.clinic.findUnique.mockResolvedValueOnce(buildClinicDetail({ city: { id: 'city-1' } }));
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1' });
    prisma.area.findUnique.mockResolvedValue({ cityId: 'city-OTHER' });

    await expect(
      clinicsService.updateClinic('clinic-1', { areaId: 'area-mismatched' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, code: 'AREA_CITY_MISMATCH' });
  });

  test('an empty patch (no allowed fields present) skips the Prisma update, log, and cache bust entirely', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());

    await clinicsService.updateClinic('clinic-1', {}, ADMIN);

    expect(prisma.clinic.update).not.toHaveBeenCalled();
    expect(cacheService.invalidate).not.toHaveBeenCalledWith('cache:clinics:list:*');
  });

  test('trims string fields and persists a real update, logging + invalidating caches', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.clinic.update.mockResolvedValue({});

    await clinicsService.updateClinic('clinic-1', { name: '  Renamed Clinic  ', phone: '  123  ' }, ADMIN);

    expect(prisma.clinic.update).toHaveBeenCalledWith({
      where: { id: 'clinic-1' },
      data: { name: 'Renamed Clinic', phone: '123' },
    });
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:clinics:list:*');
    expect(doctorsService.invalidateDoctorCaches).toHaveBeenCalledWith(undefined);
  });
});

describe('clinicsService.approveClinic / rejectClinic', () => {
  test('approveClinic 404s when the clinic does not exist', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(clinicsService.approveClinic('clinic-1', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLINIC_NOT_FOUND',
    });
  });

  test('approveClinic sets status active and clears any rejectionReason (idempotent re-enable path)', async () => {
    prisma.clinic.findUnique.mockResolvedValueOnce({ id: 'clinic-1' }).mockResolvedValue(buildClinicDetail());
    prisma.clinic.update.mockResolvedValue({});

    await clinicsService.approveClinic('clinic-1', ADMIN);

    expect(prisma.clinic.update).toHaveBeenCalledWith({
      where: { id: 'clinic-1' },
      data: { approvalStatus: 'active', rejectionReason: null },
    });
  });

  test('rejectClinic 404s when the clinic does not exist', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(clinicsService.rejectClinic('clinic-1', 'Bad address', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLINIC_NOT_FOUND',
    });
  });

  test('rejectClinic sets status disabled and stores the trimmed reason', async () => {
    prisma.clinic.findUnique.mockResolvedValueOnce({ id: 'clinic-1' }).mockResolvedValue(buildClinicDetail());
    prisma.clinic.update.mockResolvedValue({});

    await clinicsService.rejectClinic('clinic-1', '  Incomplete documents  ', ADMIN);

    expect(prisma.clinic.update).toHaveBeenCalledWith({
      where: { id: 'clinic-1' },
      data: { approvalStatus: 'disabled', rejectionReason: 'Incomplete documents' },
    });
  });
});

// ── B. doctor_clinics assignment ────────────────────────────────────────

describe('clinicsService.assignDoctorToClinic', () => {
  test('404s when the clinic is not visible to this actor', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(
      clinicsService.assignDoctorToClinic('clinic-1', { doctorUserId: 'doc-2' }, DOCTOR)
    ).rejects.toMatchObject({ statusCode: 404, code: 'CLINIC_NOT_FOUND' });
  });

  test('403s when the actor is not an owner of this (visible) clinic', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique.mockResolvedValue(null); // actor has no ownership row

    await expect(
      clinicsService.assignDoctorToClinic('clinic-1', { doctorUserId: 'doc-2' }, DOCTOR)
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  test('404s DOCTOR_NOT_FOUND when the target user does not exist or is not a doctor', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', role: 'patient', doctorProfile: null });

    await expect(
      clinicsService.assignDoctorToClinic('clinic-1', { doctorUserId: 'target-1' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 404, code: 'DOCTOR_NOT_FOUND' });
  });

  test('400s DOCTOR_NOT_VERIFIED when the target doctor has not been verified yet', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', role: 'doctor', doctorProfile: { status: 'pending' } });

    await expect(
      clinicsService.assignDoctorToClinic('clinic-1', { doctorUserId: 'target-1' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, code: 'DOCTOR_NOT_VERIFIED' });
  });

  test('409s ALREADY_ASSIGNED when the doctor already has a row at this clinic', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', role: 'doctor', doctorProfile: { status: 'verified' } });
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: 'target-1' });

    await expect(
      clinicsService.assignDoctorToClinic('clinic-1', { doctorUserId: 'target-1' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_ASSIGNED' });
    expect(prisma.doctorClinic.create).not.toHaveBeenCalled();
  });

  test('defaults isOwner=false, isPrimary=false, onlineBooking=true when the body omits all three', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', role: 'doctor', doctorProfile: { status: 'verified' } });
    prisma.doctorClinic.findUnique.mockResolvedValue(null); // no existing assignment
    prisma.doctorClinic.create.mockResolvedValue({ doctorUserId: 'target-1', clinicId: 'clinic-1', isOwner: false, isPrimary: false, onlineBooking: true });

    await clinicsService.assignDoctorToClinic('clinic-1', { doctorUserId: 'target-1' }, ADMIN);

    expect(prisma.doctorClinic.create).toHaveBeenCalledWith({
      data: { doctorUserId: 'target-1', clinicId: 'clinic-1', isOwner: false, isPrimary: false, onlineBooking: true },
    });
    expect(prisma.doctorClinic.updateMany).not.toHaveBeenCalled();
  });

  test('assigning as isPrimary:true first demotes every other primary at this clinic', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', role: 'doctor', doctorProfile: { status: 'verified' } });
    prisma.doctorClinic.findUnique.mockResolvedValue(null);
    prisma.doctorClinic.create.mockResolvedValue({});

    await clinicsService.assignDoctorToClinic('clinic-1', { doctorUserId: 'target-1', isPrimary: true }, ADMIN);

    expect(prisma.doctorClinic.updateMany).toHaveBeenCalledWith({
      where: { clinicId: 'clinic-1', isPrimary: true },
      data: { isPrimary: false },
    });
  });

  test('422s when isOwner is explicitly sent as null', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());

    await expect(
      clinicsService.assignDoctorToClinic('clinic-1', { doctorUserId: 'target-1', isOwner: null }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('invalidates clinic AND the newly-assigned doctor caches on success', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', role: 'doctor', doctorProfile: { status: 'verified' } });
    prisma.doctorClinic.findUnique.mockResolvedValue(null);
    prisma.doctorClinic.create.mockResolvedValue({ doctorUserId: 'target-1', clinicId: 'clinic-1', isOwner: false, isPrimary: false, onlineBooking: true });

    await clinicsService.assignDoctorToClinic('clinic-1', { doctorUserId: 'target-1' }, ADMIN);

    expect(doctorsService.invalidateDoctorCaches).toHaveBeenCalledWith('target-1');
  });
});

describe('clinicsService.updateDoctorAssignment', () => {
  test('404s when the clinic is not visible to this actor', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(
      clinicsService.updateDoctorAssignment('clinic-1', 'doc-2', { onlineBooking: false }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 404, code: 'CLINIC_NOT_FOUND' });
  });

  test('404s ASSIGNMENT_NOT_FOUND before ever checking ownership, when no such assignment row exists', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique.mockResolvedValue(null); // the "existing" lookup

    await expect(
      clinicsService.updateDoctorAssignment('clinic-1', 'doc-2', { onlineBooking: false }, DOCTOR)
    ).rejects.toMatchObject({ statusCode: 404, code: 'ASSIGNMENT_NOT_FOUND' });
    // Only ONE doctorClinic.findUnique call: the ownership check never even ran.
    expect(prisma.doctorClinic.findUnique).toHaveBeenCalledTimes(1);
  });

  test('403s when the assignment exists but the actor is not the clinic owner', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique
      .mockResolvedValueOnce({ doctorUserId: 'doc-2', clinicId: 'clinic-1', isOwner: false }) // existing assignment
      .mockResolvedValueOnce(null); // actor's own ownership row

    await expect(
      clinicsService.updateDoctorAssignment('clinic-1', 'doc-2', { onlineBooking: false }, DOCTOR)
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  // isOwner/isPrimary settability via PATCH removed (backend-cleanup audit — user request:
  // "website frontend me nahi hai but backend bna hua hai to backend se hata do"): no web/mobile
  // screen ever PATCHes either flag after assignment — only the create-time POST (assignDoctor)
  // sets them, and every PATCH caller only ever toggles onlineBooking. So both the
  // CLINIC_MUST_HAVE_OWNER demote-guard and the isPrimary-demotes-others transaction that used to
  // live in updateDoctorAssignment for those flags are gone from clinics.service.js — the
  // corresponding tests ('409s CLINIC_MUST_HAVE_OWNER when a non-admin tries to demote the last
  // remaining owner', 'an admin CAN demote the last owner (override)', 'setting isPrimary:true
  // demotes every OTHER primary at the clinic') were removed along with that code. The
  // CLINIC_MUST_HAVE_OWNER guard still exists and is still tested, but only on
  // removeDoctorAssignment (see that describe block below) — deleting the last owner's row is
  // still blocked.

  test('422s when onlineBooking is explicitly sent as null', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique.mockResolvedValueOnce({ doctorUserId: 'doc-2', clinicId: 'clinic-1', isOwner: false });

    await expect(
      clinicsService.updateDoctorAssignment('clinic-1', 'doc-2', { onlineBooking: null }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });
});

describe('clinicsService.removeDoctorAssignment', () => {
  test('404s when the clinic is not visible to this actor', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(clinicsService.removeDoctorAssignment('clinic-1', 'doc-2', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLINIC_NOT_FOUND',
    });
  });

  test('404s ASSIGNMENT_NOT_FOUND when no such assignment row exists', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique.mockResolvedValue(null);

    await expect(clinicsService.removeDoctorAssignment('clinic-1', 'doc-2', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ASSIGNMENT_NOT_FOUND',
    });
  });

  test('403s when the assignment exists but the actor is not the clinic owner', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique
      .mockResolvedValueOnce({ doctorUserId: 'doc-2', clinicId: 'clinic-1', isOwner: false })
      .mockResolvedValueOnce(null);

    await expect(clinicsService.removeDoctorAssignment('clinic-1', 'doc-2', DOCTOR)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  test('409s CLINIC_MUST_HAVE_OWNER when a non-admin tries to remove the last remaining owner', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique
      .mockResolvedValueOnce({ doctorUserId: 'doc-2', clinicId: 'clinic-1', isOwner: true })
      .mockResolvedValueOnce({ isOwner: true });
    prisma.doctorClinic.count.mockResolvedValue(0);

    await expect(clinicsService.removeDoctorAssignment('clinic-1', 'doc-2', DOCTOR)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CLINIC_MUST_HAVE_OWNER',
    });
    expect(prisma.doctorClinic.delete).not.toHaveBeenCalled();
  });

  test('an admin CAN remove the last owner (override)', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique.mockResolvedValueOnce({ doctorUserId: 'doc-2', clinicId: 'clinic-1', isOwner: true });
    prisma.doctorClinic.count.mockResolvedValue(0);

    await clinicsService.removeDoctorAssignment('clinic-1', 'doc-2', ADMIN);

    expect(prisma.doctorClinic.delete).toHaveBeenCalledWith({
      where: { doctorUserId_clinicId: { doctorUserId: 'doc-2', clinicId: 'clinic-1' } },
    });
  });

  // No onDelete cascade is wired in the schema for doctor_clinic_hours/closures -> this must be
  // done explicitly, or removing an assignment leaves orphaned schedule rows behind.
  test('cascades: deletes hours and closures for this (doctor, clinic) pair before deleting the assignment', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinic.findUnique.mockResolvedValueOnce({ doctorUserId: 'doc-2', clinicId: 'clinic-1', isOwner: false });

    await clinicsService.removeDoctorAssignment('clinic-1', 'doc-2', ADMIN);

    expect(prisma.doctorClinicHours.deleteMany).toHaveBeenCalledWith({ where: { doctorUserId: 'doc-2', clinicId: 'clinic-1' } });
    expect(prisma.doctorClinicClosure.deleteMany).toHaveBeenCalledWith({ where: { doctorUserId: 'doc-2', clinicId: 'clinic-1' } });
    expect(doctorsService.invalidateDoctorCaches).toHaveBeenCalledWith('doc-2');
  });
});

// ── C. doctor_clinic_hours ──────────────────────────────────────────────

describe('clinicsService.upsertHours', () => {
  test('a doctor actor always writes their OWN hours, ignoring any doctorUserId in the body', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: DOCTOR.id }); // assigned
    prisma.doctorClinicHours.upsert.mockResolvedValue({ id: 'h1', doctorUserId: DOCTOR.id, clinicId: 'clinic-1', weekday: 1, startTime: '09:00', endTime: '17:00', slotMinutes: 15, status: 'active' });

    await clinicsService.upsertHours('clinic-1', { doctorUserId: 'someone-else', weekday: 1, startTime: '09:00', endTime: '17:00' }, DOCTOR);

    expect(prisma.doctorClinicHours.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { doctorUserId_clinicId_weekday: { doctorUserId: DOCTOR.id, clinicId: 'clinic-1', weekday: 1 } } })
    );
  });

  test('400s DOCTOR_USER_ID_REQUIRED for an admin-initiated request that omits doctorUserId', async () => {
    await expect(
      clinicsService.upsertHours('clinic-1', { weekday: 1, startTime: '09:00', endTime: '17:00' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, code: 'DOCTOR_USER_ID_REQUIRED' });
    expect(prisma.doctorClinic.findUnique).not.toHaveBeenCalled();
  });

  test('404s NOT_ASSIGNED_TO_CLINIC when the target doctor has no assignment at this clinic', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue(null);

    await expect(
      clinicsService.upsertHours('clinic-1', { doctorUserId: 'doc-2', weekday: 1, startTime: '09:00', endTime: '17:00' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_ASSIGNED_TO_CLINIC' });
  });

  test('400s INVALID_TIME_RANGE when startTime is not strictly before endTime', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: DOCTOR.id });

    await expect(
      clinicsService.upsertHours('clinic-1', { weekday: 1, startTime: '17:00', endTime: '09:00' }, DOCTOR)
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TIME_RANGE' });
    expect(prisma.doctorClinicHours.upsert).not.toHaveBeenCalled();
  });

  // status is no longer set here at all (mobile parity audit round 2 — see
  // clinics.service.js#upsertHours's own comment): new rows fall back to the schema default
  // ('active'), and an update never touches status, so it can't clobber whatever a row already
  // has.
  test('applies a slotMinutes=15 default when omitted, and never touches status', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: DOCTOR.id });
    prisma.doctorClinicHours.upsert.mockResolvedValue({});

    await clinicsService.upsertHours('clinic-1', { weekday: 2, startTime: '09:00', endTime: '17:00' }, DOCTOR);

    expect(prisma.doctorClinicHours.upsert).toHaveBeenCalledWith({
      where: { doctorUserId_clinicId_weekday: { doctorUserId: DOCTOR.id, clinicId: 'clinic-1', weekday: 2 } },
      update: { startTime: '09:00', endTime: '17:00', slotMinutes: 15 },
      create: { doctorUserId: DOCTOR.id, clinicId: 'clinic-1', weekday: 2, startTime: '09:00', endTime: '17:00', slotMinutes: 15 },
    });
  });

  // Regression test for the fix documented directly in upsertHours's own comment: every OTHER
  // clinic/doctor-clinic write in this file already busts the clinic+doctor caches so a doctor's
  // cached schedule doesn't go stale — this one is called out explicitly as the fix that closed
  // the gap, so it must never regress back to a silent no-op.
  test('invalidates the clinic AND doctor caches after a successful upsert (schedule cache fix)', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: DOCTOR.id });
    prisma.doctorClinicHours.upsert.mockResolvedValue({});

    await clinicsService.upsertHours('clinic-1', { weekday: 1, startTime: '09:00', endTime: '17:00' }, DOCTOR);

    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:clinics:list:*');
    expect(doctorsService.invalidateDoctorCaches).toHaveBeenCalledWith(DOCTOR.id);
  });
});

describe('clinicsService.listHours', () => {
  test('404s when the clinic is not visible to this requester', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(clinicsService.listHours('clinic-1', {}, undefined)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLINIC_NOT_FOUND',
    });
  });

  test('filters by doctorId when provided, otherwise scopes to the whole clinic', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinicHours.findMany.mockResolvedValue([]);
    prisma.doctorClinicHours.count.mockResolvedValue(0);

    await clinicsService.listHours('clinic-1', { doctorId: 'doc-1' }, ADMIN);

    expect(prisma.doctorClinicHours.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: 'clinic-1', doctorUserId: 'doc-1' } })
    );
  });
});

describe('clinicsService.deleteHoursRow', () => {
  test('404s when the row does not exist', async () => {
    prisma.doctorClinicHours.findUnique.mockResolvedValue(null);

    await expect(clinicsService.deleteHoursRow('clinic-1', 'h1', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'HOURS_NOT_FOUND',
    });
  });

  test('404s when the row exists but belongs to a DIFFERENT clinic', async () => {
    prisma.doctorClinicHours.findUnique.mockResolvedValue({ id: 'h1', clinicId: 'clinic-OTHER', doctorUserId: DOCTOR.id });

    await expect(clinicsService.deleteHoursRow('clinic-1', 'h1', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'HOURS_NOT_FOUND',
    });
  });

  test('403s when a doctor tries to delete another doctor\'s hours row', async () => {
    prisma.doctorClinicHours.findUnique.mockResolvedValue({ id: 'h1', clinicId: 'clinic-1', doctorUserId: 'doc-OTHER' });

    await expect(clinicsService.deleteHoursRow('clinic-1', 'h1', DOCTOR)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  test('an admin can delete any doctor\'s hours row, invalidating that doctor\'s caches', async () => {
    prisma.doctorClinicHours.findUnique.mockResolvedValue({ id: 'h1', clinicId: 'clinic-1', doctorUserId: 'doc-OTHER' });

    await clinicsService.deleteHoursRow('clinic-1', 'h1', ADMIN);

    expect(prisma.doctorClinicHours.delete).toHaveBeenCalledWith({ where: { id: 'h1' } });
    expect(doctorsService.invalidateDoctorCaches).toHaveBeenCalledWith('doc-OTHER');
  });
});

// ── D. doctor_clinic_closures ───────────────────────────────────────────

describe('clinicsService.upsertClosure', () => {
  test('404s NOT_ASSIGNED_TO_CLINIC when the target doctor has no assignment at this clinic', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue(null);

    await expect(
      clinicsService.upsertClosure('clinic-1', { closedDate: new Date('2026-03-01'), reason: 'Holiday' }, DOCTOR)
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_ASSIGNED_TO_CLINIC' });
  });

  test('creates a new closure row when no (doctor, clinic, date) match exists yet', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: DOCTOR.id });
    prisma.doctorClinicClosure.findFirst.mockResolvedValue(null);
    prisma.doctorClinicClosure.create.mockResolvedValue({ id: 'c1', doctorUserId: DOCTOR.id, clinicId: 'clinic-1', closedDate: new Date('2026-03-01'), reason: 'Holiday' });

    const result = await clinicsService.upsertClosure('clinic-1', { closedDate: new Date('2026-03-01'), reason: '  Holiday  ' }, DOCTOR);

    expect(prisma.doctorClinicClosure.create).toHaveBeenCalledWith({
      data: { doctorUserId: DOCTOR.id, clinicId: 'clinic-1', closedDate: new Date('2026-03-01'), reason: 'Holiday' },
    });
    expect(prisma.doctorClinicClosure.update).not.toHaveBeenCalled();
    expect(result.id).toBe('c1');
  });

  test('updates the existing row (upsert-by-triple) instead of creating a duplicate when one already exists', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: DOCTOR.id });
    prisma.doctorClinicClosure.findFirst.mockResolvedValue({ id: 'c-existing' });
    prisma.doctorClinicClosure.update.mockResolvedValue({ id: 'c-existing', reason: 'Updated reason' });

    await clinicsService.upsertClosure('clinic-1', { closedDate: new Date('2026-03-01'), reason: 'Updated reason' }, DOCTOR);

    expect(prisma.doctorClinicClosure.update).toHaveBeenCalledWith({
      where: { id: 'c-existing' },
      data: { reason: 'Updated reason' },
    });
    expect(prisma.doctorClinicClosure.create).not.toHaveBeenCalled();
  });

  test('an absent/empty reason is stored as null, not an empty string', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: DOCTOR.id });
    prisma.doctorClinicClosure.findFirst.mockResolvedValue(null);
    prisma.doctorClinicClosure.create.mockResolvedValue({});

    await clinicsService.upsertClosure('clinic-1', { closedDate: new Date('2026-03-01') }, DOCTOR);

    expect(prisma.doctorClinicClosure.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: null }) })
    );
  });
});

describe('clinicsService.listClosures', () => {
  test('404s when the clinic is not visible to this requester', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(clinicsService.listClosures('clinic-1', {}, undefined)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLINIC_NOT_FOUND',
    });
  });

  // from/to date-range filter removed (backend-cleanup audit — user request: "website frontend
  // me nahi hai but backend bna hua hai to backend se hata do"): no web/mobile closures list
  // screen ever sends a date range — every one just lists all of a doctor's/clinic's closures.
  test('applies a doctorId filter, and ignores from/to even if a caller still sends them', async () => {
    prisma.clinic.findUnique.mockResolvedValue(buildClinicDetail());
    prisma.doctorClinicClosure.findMany.mockResolvedValue([]);
    prisma.doctorClinicClosure.count.mockResolvedValue(0);
    const from = new Date('2026-03-01');
    const to = new Date('2026-03-31');

    await clinicsService.listClosures('clinic-1', { doctorId: 'doc-1', from, to }, ADMIN);

    expect(prisma.doctorClinicClosure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clinicId: 'clinic-1', doctorUserId: 'doc-1' },
      })
    );
  });
});

describe('clinicsService.deleteClosureRow', () => {
  test('404s when the row does not exist or belongs to a different clinic', async () => {
    prisma.doctorClinicClosure.findUnique.mockResolvedValue({ id: 'c1', clinicId: 'clinic-OTHER', doctorUserId: DOCTOR.id });

    await expect(clinicsService.deleteClosureRow('clinic-1', 'c1', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLOSURE_NOT_FOUND',
    });
  });

  test('403s when a doctor tries to delete another doctor\'s closure', async () => {
    prisma.doctorClinicClosure.findUnique.mockResolvedValue({ id: 'c1', clinicId: 'clinic-1', doctorUserId: 'doc-OTHER' });

    await expect(clinicsService.deleteClosureRow('clinic-1', 'c1', DOCTOR)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  test('a doctor can delete their OWN closure', async () => {
    prisma.doctorClinicClosure.findUnique.mockResolvedValue({ id: 'c1', clinicId: 'clinic-1', doctorUserId: DOCTOR.id });

    await clinicsService.deleteClosureRow('clinic-1', 'c1', DOCTOR);

    expect(prisma.doctorClinicClosure.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });
});
