/**
 * Integration test for GET /doctors (public directory search) and GET /doctors/:id: real Express
 * routing (via supertest), real optionalAuthenticate + express-validator (doctors.validation.js),
 * real doctors.controller.js, and real doctors.service.js business logic — including the REAL
 * shapeDoctor()/listDoctors() role-based contact masking already unit-tested directly in
 * tests/unit/modules/doctors.service.test.js. This file re-verifies that same contract end-to-end
 * through the actual HTTP response body (real routing + real cacheService.getOrSet cache-aside
 * pass-through), not by calling the service function directly.
 *
 * ONLY the Postgres/Redis infrastructure boundary is mocked — see auth.flow.test.js's header
 * comment for the full rationale (config/db, config/redis, and jobs/bookingQueue all get pulled
 * in transitively the instant `../../src/app` is required, regardless of which routes a given
 * test actually hits).
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

// A single verified, active doctor row shaped exactly like Prisma would return it for
// doctors.service.js's DOCTOR_LIST_SELECT (see that file) — full plumbing (email/phone included
// at the query level; shapeDoctor is what's responsible for stripping them for a public caller).
function buildDoctorRow(overrides = {}) {
  return {
    id: 'doctor-1',
    name: 'Dr. Priya Sharma',
    email: 'priya.sharma@example.com',
    phone: '9998887777',
    photoUrl: null,
    city: 'Pune',
    status: 'active',
    doctorProfile: {
      status: 'verified',
      qualification: 'MBBS, MD',
      registrationNumber: 'REG-12345',
      experienceYears: 10,
      consultationFee: '500',
      emergencyFee: '800',
      languages: ['English', 'Hindi'],
      rating: '4.5',
      reviewCount: 120,
      emergencyAvailable: true,
      onlineBooking: true,
      allowRebooking: true,
      maxDaysAdvance: 30,
      maxOnlineBookingsPerDay: null,
      minBookingAdvanceAmount: '100',
      specialization: { id: 'spec-1', name: 'Cardiology', icon: 'heart' },
    },
    doctorClinics: [],
    doctorClinicHours: [],
    ...overrides,
  };
}

describe('GET /doctors — public directory search', () => {
  beforeEach(() => {
    prisma.user.findMany.mockResolvedValue([buildDoctorRow()]);
    prisma.user.count.mockResolvedValue(1);
  });

  test('returns a shaped list with pagination meta, for an anonymous (no-auth) caller', async () => {
    const res = await request(app).get('/doctors');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);

    // Pagination meta shape, per utils/pagination.js#buildPaginationMeta.
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });

    const doctor = res.body.data[0];
    expect(doctor.id).toBe('doctor-1');
    expect(doctor.name).toBe('Dr. Priya Sharma');
    expect(doctor.specialization).toEqual({ id: 'spec-1', name: 'Cardiology', icon: 'heart' });
  });

  test('never leaks email/phone/accountStatus to an unauthenticated caller (shapeDoctor contract, end-to-end)', async () => {
    const res = await request(app).get('/doctors');

    expect(res.status).toBe(200);
    const doctor = res.body.data[0];
    expect(doctor.email).toBeUndefined();
    expect(doctor.phone).toBeUndefined();
    expect(doctor.accountStatus).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(doctor, 'email')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(doctor, 'phone')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(doctor, 'accountStatus')).toBe(false);
  });

  test('also masks email/phone/accountStatus for a garbage/expired bearer token (optionalAuthenticate falls back to anonymous)', async () => {
    const res = await request(app).get('/doctors').set('Authorization', 'Bearer not-a-real-jwt');

    expect(res.status).toBe(200);
    const doctor = res.body.data[0];
    expect(doctor.email).toBeUndefined();
    expect(doctor.phone).toBeUndefined();
  });

  test('an authenticated admin caller DOES see email/phone/accountStatus (includeContact)', async () => {
    // authenticate/optionalAuthenticate re-derives the caller from Postgres on every request —
    // stub that lookup for the admin's own id.
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin', status: 'active' });
    const tokenService = require('../../src/services/tokenService');
    const adminToken = tokenService.signAccessToken({ id: 'admin-1', role: 'admin' });

    const res = await request(app).get('/doctors').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const doctor = res.body.data[0];
    expect(doctor.email).toBe('priya.sharma@example.com');
    expect(doctor.phone).toBe('9998887777');
    expect(doctor.accountStatus).toBe('active');
  });

  test('rejects an invalid query param via the REAL express-validator chain (422)', async () => {
    const res = await request(app).get('/doctors').query({ sortBy: 'not-a-real-sort-field' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /doctors/:id', () => {
  test('returns 404 DOCTOR_NOT_FOUND for a doctor id that does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/doctors/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DOCTOR_NOT_FOUND');
  });

  test('rejects a non-UUID id via the REAL validation chain (422), never reaching the service', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/doctors/not-a-uuid');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
