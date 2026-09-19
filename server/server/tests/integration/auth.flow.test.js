/**
 * Integration test for the auth module: real Express routing (via supertest), real
 * express-validator chains (auth.validation.js), real controllers (auth.controller.js), and real
 * business logic (auth.service.js + services/tokenService.js — real bcrypt hashing/comparison,
 * real JWT signing/verification against the test env's JWT secrets) — a genuine step up from
 * tests/unit/modules/auth.service.test.js, which calls auth.service.js directly and never
 * exercises routing/validation/authenticate at all.
 *
 * ONLY the Postgres/Redis infrastructure boundary is mocked, exactly as documented in this
 * suite's task brief:
 *   - config/db (Prisma) — no real Postgres in this sandbox. Backed by an in-memory fake (see
 *     the `usersByEmail`/`usersById`/`refreshTokensById` maps below) so a real register -> login
 *     -> me flow can actually round-trip through the same "row" the way a real DB would, instead
 *     of each call needing its own hand-tuned mockResolvedValueOnce.
 *   - config/redis — required transitively by middleware/rateLimiter.js (mounted on every route
 *     module, including ones this file never hits) and services/cacheService.js.
 *   - jobs/bookingQueue — required transitively via modules/appointments/appointments.service.js
 *     (itself required by routes/index.js mounting EVERY module's router, appointments included)
 *     -> jobs/bookingQueue.js, which opens a real BullMQ Queue against a real ioredis connection
 *     at module-load time. Mocking config/redis alone isn't enough to stop that (BullMQ's Queue
 *     constructor still tries to talk to whatever connection object it's handed), so the whole
 *     module is mocked instead — see tests/integration/helpers/ for why this can't be avoided by
 *     only touching config/db and config/redis.
 *
 * Requiring `../../src/app` for real, after these three mocks, is what pulls in the REAL
 * routes/index.js -> auth.routes.js -> [authLimiter, auth.validation.js chains, validateRequest,
 * auth.controller.js] -> auth.service.js -> tokenService.js chain end-to-end over real HTTP via
 * supertest, with only the DB/Redis edge faked.
 */
jest.mock('../../src/config/db', () => require('./helpers/mockPrisma')());
jest.mock('../../src/config/redis', () => require('./helpers/mockRedis')());
jest.mock('../../src/jobs/bookingQueue', () => ({
  enqueueBookingJob: jest.fn(),
  getJob: jest.fn(),
  getQueuePosition: jest.fn(),
  bookingQueue: { add: jest.fn() },
  QUEUE_NAME: 'appointment-booking',
}));

const request = require('supertest');
const prisma = require('../../src/config/db');
const app = require('../../src/app');

const PASSWORD = 'Str0ngPassw0rd!';

// The real Prisma client honors a `select: {field: true, ...}` clause by only ever returning
// those columns — that's the actual mechanism auth.service.js relies on to keep passwordHash out
// of register()'s response (there's no explicit JS-side filtering there, unlike login()'s
// destructure-away). This mock stores the FULL fake row internally but projects it down to
// `select`'s keys on the way out, so a test can genuinely catch a regression (e.g. someone
// dropping the `select` from register()'s tx.user.create call) instead of the mock silently
// handing back more than a real Postgres+Prisma round-trip ever would.
function project(record, select) {
  if (!record || !select) return record;
  const out = {};
  for (const [key, wanted] of Object.entries(select)) {
    if (wanted === true) out[key] = record[key];
  }
  return out;
}

describe('Auth flow: POST /auth/register -> POST /auth/login -> GET /auth/me', () => {
  // In-memory fake tables, reset before every test so tests never leak state into each other
  // even though `clearMocks: true` only resets jest.fn() call history, not these closures.
  let usersByEmail;
  let usersById;
  let refreshTokensById;
  let userIdCounter;

  beforeEach(() => {
    usersByEmail = new Map();
    usersById = new Map();
    refreshTokensById = new Map();
    userIdCounter = 0;

    prisma.user.findUnique.mockImplementation(async ({ where, select }) => {
      let record = null;
      if (where.email !== undefined) record = usersByEmail.get(where.email) || null;
      else if (where.id !== undefined) record = usersById.get(where.id) || null;
      return project(record, select);
    });

    // Mimics the real Postgres row auth.service.js#register creates: captures the REAL bcrypt
    // hash register() computed (bcrypt itself is never mocked in this file) so the subsequent
    // login step in the same test exercises a REAL bcrypt.compare against it, not a fixture hash.
    prisma.user.create.mockImplementation(async ({ data, select }) => {
      userIdCounter += 1;
      const record = {
        id: `user-${userIdCounter}`,
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        phone: data.phone ?? null,
        city: data.city ?? null,
        photoUrl: null,
        status: data.status,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        // Stable "DCP<N>" display number (prisma/migrations/
        // 20260919130000_add_patient_doctor_clinic_numbers) — register() draws this from
        // idGenerators.nextPatientNumber(), itself backed by mockPrisma.js's default
        // $queryRaw mock (always resolves nextval() to 1n in this fake).
        patientNumber: data.patientNumber ?? null,
      };
      usersByEmail.set(record.email, record);
      usersById.set(record.id, record);
      return project(record, select);
    });

    prisma.patientProfile.create.mockResolvedValue({});

    prisma.refreshToken.create.mockImplementation(async ({ data }) => {
      const record = { ...data, revokedAt: null };
      refreshTokensById.set(data.id, record);
      return record;
    });
    prisma.refreshToken.findUnique.mockImplementation(async ({ where }) => refreshTokensById.get(where.id) || null);
    prisma.refreshToken.updateMany.mockImplementation(async ({ where, data }) => {
      const stored = refreshTokensById.get(where.id);
      if (!stored || stored.revokedAt !== null) return { count: 0 };
      Object.assign(stored, data);
      return { count: 1 };
    });

    prisma.activityLog.create.mockResolvedValue({});
  });

  test('register -> login -> me round-trips the same real user through real hashing + real JWTs', async () => {
    const registerRes = await request(app).post('/auth/register').send({
      name: 'Asha Rao',
      email: 'asha@example.com',
      password: PASSWORD,
      phone: '9876543210',
      city: 'Pune',
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.success).toBe(true);
    expect(registerRes.body.data.user.email).toBe('asha@example.com');
    expect(registerRes.body.data.user.role).toBe('patient');
    // The stable "DCP<N>" number is drawn from nextval() (mockPrisma.js's $queryRaw default
    // always resolves it to 1n) and round-trips through the real register() response.
    expect(registerRes.body.data.user.patientNumber).toBe(1);
    // Never leak the hash over the wire.
    expect(registerRes.body.data.user.passwordHash).toBeUndefined();
    expect(typeof registerRes.body.data.accessToken).toBe('string');
    expect(typeof registerRes.body.data.refreshToken).toBe('string');

    // The stored record really did get a bcrypt hash, not the plaintext password.
    const stored = usersByEmail.get('asha@example.com');
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);

    const loginRes = await request(app).post('/auth/login').send({
      email: 'asha@example.com',
      password: PASSWORD,
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.id).toBe(registerRes.body.data.user.id);
    expect(loginRes.body.data.user.passwordHash).toBeUndefined();
    const { accessToken } = loginRes.body.data;
    expect(typeof accessToken).toBe('string');

    const meRes = await request(app).get('/auth/me').set('Authorization', `Bearer ${accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data).toMatchObject({
      id: registerRes.body.data.user.id,
      email: 'asha@example.com',
      role: 'patient',
      status: 'active',
    });
  });

  test('login with the wrong password returns 401 INVALID_CREDENTIALS', async () => {
    await request(app).post('/auth/register').send({
      name: 'Ravi Kumar',
      email: 'ravi@example.com',
      password: PASSWORD,
    });

    const res = await request(app).post('/auth/login').send({
      email: 'ravi@example.com',
      password: 'totally-wrong-password',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('registering a duplicate email returns 409 EMAIL_ALREADY_EXISTS', async () => {
    const payload = { name: 'Meera Nair', email: 'meera@example.com', password: PASSWORD };

    const first = await request(app).post('/auth/register').send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post('/auth/register').send(payload);

    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  test('GET /auth/me with no Authorization header returns 401', async () => {
    const res = await request(app).get('/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('GET /auth/me with a garbage bearer token returns 401', async () => {
    const res = await request(app).get('/auth/me').set('Authorization', 'Bearer not-a-real-jwt');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});
