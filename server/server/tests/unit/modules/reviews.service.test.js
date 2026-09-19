/**
 * Unit tests for modules/reviews/reviews.service.js — the moderation-bypass and ownership guards:
 *
 *   - createReview: only a completed appointment OWNED by the requesting patient may be
 *     reviewed (404, never 403, on a missing/foreign appointment — enumeration avoidance); status
 *     is ALWAYS created as 'pending' regardless of anything the client might have sent (the
 *     validation layer doesn't even define a `status` field, and this function never reads
 *     body.status); doctorUserId is derived from the appointment, never client-supplied; a
 *     duplicate review (P2002) maps to a clean 409.
 *   - listReviews: non-admin/anonymous callers ALWAYS get status forced to 'approved' no matter
 *     what `status` query param is sent (never trust a client-controlled moderation filter);
 *     admin/superadmin may filter by any status, or see all statuses when omitted.
 *   - invalidateReviewCaches's lazy cross-module call into doctors.service.js#invalidateDoctorCaches
 *     (mocked here — this is the documented reason for the lazy require, avoiding a load-order
 *     cycle with doctors.service.js).
 *
 * config/db is mocked (no real Postgres in this sandbox); activityLogService/cacheService are
 * mocked to isolate this module's own branching; doctors.service is mocked because
 * invalidateReviewCaches lazily requires it purely for its invalidateDoctorCaches side effect.
 */
jest.mock('../../../src/config/db', () => ({
  appointment: { findUnique: jest.fn() },
  review: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttl, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));
jest.mock('../../../src/modules/doctors/doctors.service', () => ({ invalidateDoctorCaches: jest.fn() }));

const prisma = require('../../../src/config/db');
const doctorsService = require('../../../src/modules/doctors/doctors.service');
const reviewsService = require('../../../src/modules/reviews/reviews.service');

const PATIENT = { id: 'patient-1', role: 'patient' };
const OTHER_PATIENT = { id: 'patient-2', role: 'patient' };
const ADMIN = { id: 'admin-1', role: 'admin' };

function reviewRow(overrides = {}) {
  return {
    id: 'review-1',
    doctorUserId: 'doc-1',
    patientUserId: PATIENT.id,
    rating: 5,
    text: 'Great',
    status: 'pending',
    createdAt: new Date(),
    doctor: { id: 'doc-1', name: 'Dr. Rao' },
    patient: { id: PATIENT.id, name: 'Patty' },
    ...overrides,
  };
}

describe('reviewsService.createReview', () => {
  test('404 (not 403) when the appointment does not exist', async () => {
    prisma.appointment.findUnique.mockResolvedValue(null);

    await expect(reviewsService.createReview({ appointmentId: 'x', rating: 5 }, PATIENT)).rejects.toMatchObject({
      statusCode: 404,
      code: 'REVIEW_APPOINTMENT_NOT_FOUND',
    });
  });

  test('404 when the appointment belongs to a DIFFERENT patient', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', patientUserId: OTHER_PATIENT.id, doctorUserId: 'doc-1', status: 'completed' });

    await expect(reviewsService.createReview({ appointmentId: 'appt-1', rating: 5 }, PATIENT)).rejects.toMatchObject({
      code: 'REVIEW_APPOINTMENT_NOT_FOUND',
    });
  });

  test('400 APPOINTMENT_NOT_COMPLETED when the appointment is not yet completed', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', patientUserId: PATIENT.id, doctorUserId: 'doc-1', status: 'confirmed' });

    await expect(reviewsService.createReview({ appointmentId: 'appt-1', rating: 5 }, PATIENT)).rejects.toMatchObject({
      statusCode: 400,
      code: 'APPOINTMENT_NOT_COMPLETED',
    });
  });

  test('status is always created as "pending", even if the (already-stripped) body somehow carried one', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', patientUserId: PATIENT.id, doctorUserId: 'doc-1', status: 'completed' });
    prisma.review.create.mockResolvedValue({ id: 'review-new' });
    prisma.review.findUnique.mockResolvedValue(reviewRow({ id: 'review-new' }));

    await reviewsService.createReview({ appointmentId: 'appt-1', rating: 5, status: 'approved' }, PATIENT);

    expect(prisma.review.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending', doctorUserId: 'doc-1', patientUserId: PATIENT.id }) })
    );
  });

  test('409 REVIEW_ALREADY_EXISTS on a P2002 duplicate-review race', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', patientUserId: PATIENT.id, doctorUserId: 'doc-1', status: 'completed' });
    prisma.review.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

    await expect(reviewsService.createReview({ appointmentId: 'appt-1', rating: 5 }, PATIENT)).rejects.toMatchObject({
      statusCode: 409,
      code: 'REVIEW_ALREADY_EXISTS',
    });
  });

  test('success invalidates the doctor\'s cross-module directory cache via the lazy require', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', patientUserId: PATIENT.id, doctorUserId: 'doc-1', status: 'completed' });
    prisma.review.create.mockResolvedValue({ id: 'review-new' });
    prisma.review.findUnique.mockResolvedValue(reviewRow({ id: 'review-new' }));

    await reviewsService.createReview({ appointmentId: 'appt-1', rating: 5 }, PATIENT);

    expect(doctorsService.invalidateDoctorCaches).toHaveBeenCalledWith('doc-1');
  });
});

describe('reviewsService.updateReviewStatus', () => {
  test('404 when the review does not exist', async () => {
    prisma.review.findUnique.mockResolvedValue(null);
    await expect(reviewsService.updateReviewStatus('x', 'approved', ADMIN)).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' });
  });

  test('free transition between statuses (idempotent re-set is allowed)', async () => {
    prisma.review.findUnique.mockResolvedValueOnce({ id: 'review-1', status: 'approved', doctorUserId: 'doc-1' });
    prisma.review.findUnique.mockResolvedValueOnce(reviewRow({ status: 'approved' }));

    const result = await reviewsService.updateReviewStatus('review-1', 'approved', ADMIN);

    expect(prisma.review.update).toHaveBeenCalledWith({ where: { id: 'review-1' }, data: { status: 'approved' } });
    expect(result.status).toBe('approved');
  });
});

describe('reviewsService.listReviews — moderation-bypass prevention', () => {
  test('a non-admin caller always gets status forced to "approved", ignoring a client-sent status filter', async () => {
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.count.mockResolvedValue(0);

    await reviewsService.listReviews({ status: 'pending' }, PATIENT);

    expect(prisma.review.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'approved' } }));
  });

  test('an anonymous caller (requester undefined) also gets status forced to "approved"', async () => {
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.count.mockResolvedValue(0);

    await reviewsService.listReviews({}, undefined);

    expect(prisma.review.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'approved' } }));
  });

  test('admin can filter by any explicit status', async () => {
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.count.mockResolvedValue(0);

    await reviewsService.listReviews({ status: 'pending' }, ADMIN);

    expect(prisma.review.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'pending' } }));
  });

  test('admin with no status filter sees every status (no where.status key at all)', async () => {
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.count.mockResolvedValue(0);

    await reviewsService.listReviews({}, ADMIN);

    const callArgs = prisma.review.findMany.mock.calls[0][0];
    expect(callArgs.where).not.toHaveProperty('status');
  });
});
