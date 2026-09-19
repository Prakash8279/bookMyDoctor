/**
 * Integration test for the platformCharges module: real Express routing (via supertest), real
 * authenticate + authorize('admin','superadmin') / authorize(...ALL_ROLES) middleware, real
 * express-validator chain (platformCharges.validation.js#updateCharges), real controllers, and
 * real platformCharges.service.js business logic (role-based commissionPercent masking, the
 * singleton upsert-always-targets-id:1 rule) — a genuine step up from
 * tests/unit/modules/platformCharges.service.test.js, which calls the service directly and never
 * exercises routing/authenticate/authorize/validation at all.
 *
 * ONLY the Postgres/Redis infrastructure boundary is mocked — see auth.flow.test.js's header
 * comment for config/db, config/redis and jobs/bookingQueue (pulled in transitively the instant
 * `../../src/app` is required, regardless of which routes a given test hits).
 *
 * ONE EXTRA MOCK beyond that trio, specific to this module: platformCharges.service.js does
 * `const { Prisma } = require('@prisma/client')` directly (independent of config/db) and calls
 * `new Prisma.Decimal(...)` in updatePlatformCharges. `@prisma/client`'s real Decimal only exists
 * after `prisma generate` has downloaded its query-engine binary — this sandbox never ran that
 * (same network restriction tests/unit/modules/platformCharges.service.test.js's own header
 * comment documents), so the real package's `Prisma.Decimal` is `undefined` here and
 * `new Prisma.Decimal(x)` throws `TypeError: Prisma.Decimal is not a constructor` the moment a
 * real PUT request reaches this real service function. This is the same class of sandbox-only
 * infrastructure gap as the missing Postgres/Redis (a generated native artifact this environment
 * cannot produce, not application logic), so it's mocked the same way the unit test already does:
 * a minimal value-wrapper class standing in for the real Decimal (constructor + toString/valueOf
 * only — this module never does Decimal arithmetic, only wraps and stringifies). Every other
 * piece of the request stack (routing, auth, validation, controller, the REAL
 * platformCharges.service.js coercion/masking logic) stays real.
 */
jest.mock('@prisma/client', () => {
  class Decimal {
    constructor(value) {
      this.value = String(value);
    }
    toString() {
      return this.value;
    }
    valueOf() {
      return this.value;
    }
  }
  return { Prisma: { Decimal } };
});
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
const { Prisma } = require('@prisma/client');
const prisma = require('../../src/config/db');
const tokenService = require('../../src/services/tokenService');
const app = require('../../src/app');

const RAW_ROW = {
  id: 1,
  commissionPercent: '10.5',
  patientConvenienceFee: '20',
  emergencyFee: '100',
  gstPercent: '18',
  applyConvenienceFee: true,
  applyEmergencyFee: false,
};

function bearerFor(user) {
  // Real JWT signing (tokenService is never mocked) — authenticate.js's own re-derivation of the
  // caller from Postgres is what prisma.user.findUnique is stubbed for below.
  return `Bearer ${tokenService.signAccessToken(user)}`;
}

describe('GET /platform-charges', () => {
  beforeEach(() => {
    prisma.platformCharges.findUnique.mockResolvedValue(RAW_ROW);
  });

  test('an admin caller sees commissionPercent alongside the other fields', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin', status: 'active' });

    const res = await request(app).get('/platform-charges').set('Authorization', bearerFor({ id: 'admin-1', role: 'admin' }));

    expect(res.status).toBe(200);
    expect(res.body.data.commissionPercent).toBe('10.5');
    expect(res.body.data.patientConvenienceFee).toBe('20');
  });

  test('a patient caller is authorized (route not blocked) but commissionPercent is masked out', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'patient-1', role: 'patient', status: 'active' });

    const res = await request(app).get('/platform-charges').set('Authorization', bearerFor({ id: 'patient-1', role: 'patient' }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(res.body.data, 'commissionPercent')).toBe(false);
    // Still gets the booking-relevant fields — this is masking, not a blocked/empty response.
    expect(res.body.data.patientConvenienceFee).toBe('20');
    expect(res.body.data.gstPercent).toBe('18');
  });

  test('an unauthenticated request (no Authorization header) is rejected with 401', async () => {
    const res = await request(app).get('/platform-charges');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('PUT /platform-charges', () => {
  const VALID_BODY = {
    commissionPercent: 12,
    patientConvenienceFee: 25,
    emergencyFee: 150,
    gstPercent: 18,
    applyConvenienceFee: true,
    applyEmergencyFee: true,
  };

  test('an admin caller can update the singleton row; upsert always targets id:1 with Decimal-wrapped numbers', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin', status: 'active' });
    prisma.platformCharges.upsert.mockResolvedValue({ id: 1, ...VALID_BODY, commissionPercent: new Prisma.Decimal(12) });

    const res = await request(app)
      .put('/platform-charges')
      .set('Authorization', bearerFor({ id: 'admin-1', role: 'admin' }))
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(prisma.platformCharges.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.platformCharges.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: 1 });
    expect(call.create.id).toBe(1);
    expect(call.update.commissionPercent).toBeInstanceOf(Prisma.Decimal);
    expect(call.update.commissionPercent.toString()).toBe('12');
    expect(call.update.applyConvenienceFee).toBe(true);
  });

  test('a patient caller is blocked with 403 before validation/service ever run', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'patient-1', role: 'patient', status: 'active' });

    const res = await request(app)
      .put('/platform-charges')
      .set('Authorization', bearerFor({ id: 'patient-1', role: 'patient' }))
      .send(VALID_BODY);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(prisma.platformCharges.upsert).not.toHaveBeenCalled();
  });

  test('an admin request with an out-of-range field is rejected by the REAL validation chain (422)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin', status: 'active' });

    const res = await request(app)
      .put('/platform-charges')
      .set('Authorization', bearerFor({ id: 'admin-1', role: 'admin' }))
      .send({ ...VALID_BODY, commissionPercent: 150 }); // >100, invalid

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.platformCharges.upsert).not.toHaveBeenCalled();
  });

  test('an unauthenticated request is rejected with 401', async () => {
    const res = await request(app).put('/platform-charges').send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
