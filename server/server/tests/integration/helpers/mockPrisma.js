/**
 * Shared factory for a fresh mock `config/db` (Prisma) module, used by every integration test
 * file that requires the real `../../src/app` (see those files' own header comments for why
 * config/db MUST be mocked in every such file — no real Postgres exists in this sandbox).
 *
 * Returns a plain object shaped like the real Prisma client, with a jest.fn() for every
 * model/method an integration-tested route actually calls. Each test file gets its OWN instance
 * (this factory is invoked once per `jest.mock('../../src/config/db', () => require(...)())`
 * call, i.e. once per test file's module registry) and is responsible for wiring up
 * `mockImplementation`/`mockResolvedValue` on the specific fields it needs in its own
 * beforeEach/test — this file intentionally contains NO business data or behavior, only bare
 * jest.fn() stand-ins plus one small default for `$transaction` (see below).
 *
 * `$transaction` defaults to invoking its callback with THIS SAME mock object as `tx` (real
 * Prisma's interactive-transaction callback receives a transactional client with the same model
 * API as the top-level client) — so a test can configure `prisma.user.create.mockImplementation`
 * once and have it transparently satisfy both a direct call AND a call made through
 * `prisma.$transaction(async (tx) => tx.user.create(...))`, exactly how auth.service.js#register
 * and doctors.service.js#createDoctor use it. A test that needs different behavior inside vs.
 * outside a transaction can still override `prisma.$transaction` itself with a custom
 * mockImplementation.
 */
function createMockPrisma() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    patientProfile: {
      create: jest.fn(),
    },
    doctorProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    specialization: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    activityLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
    },
    notificationRecipient: {
      create: jest.fn().mockResolvedValue({}),
    },
    platformCharges: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    paymentHold: {
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
    },
  };

  prisma.$transaction = jest.fn(async (fnOrArray) => {
    if (Array.isArray(fnOrArray)) {
      return Promise.all(fnOrArray);
    }
    return fnOrArray(prisma);
  });

  // register()/createDoctor()/createClinic() each draw a stable display number via
  // utils/idGenerators.js (nextPatientNumber/nextDoctorNumber/nextClinicNumber — prisma/
  // migrations/20260919130000_add_patient_doctor_clinic_numbers), which calls THIS SAME
  // module-level prisma.$queryRaw as a tagged template (`` prisma.$queryRaw`SELECT nextval(...)`
  // ``). Defaulted here (rather than left unmocked like every other field, which a test wires up
  // itself) because it's plumbing every register/createDoctor/createClinic integration test needs
  // regardless of what that specific test is actually asserting — same reasoning as the
  // `$transaction` default right above. Returns a fresh BigInt-shaped row every call, matching
  // node-postgres's real return shape for `nextval()`.
  prisma.$queryRaw = jest.fn().mockResolvedValue([{ value: 1n }]);
  prisma.$executeRaw = jest.fn().mockResolvedValue(1);

  return prisma;
}

module.exports = createMockPrisma;
