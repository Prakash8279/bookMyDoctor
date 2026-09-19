/**
 * Business logic for the reviews module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules, and
 * all Prisma/DB calls for this module live. Controllers call these functions; these functions
 * never touch req/res directly.
 *
 * Rating recompute: doctor_profiles.rating/review_count are NEVER written by this module — the
 * manual_sql/001 trigger (`trg_reviews_recompute_rating`, fires AFTER INSERT OR UPDATE OF status
 * OR DELETE) recomputes both automatically from approved rows. A freshly created 'pending' review
 * fires the trigger but contributes 0 (status != 'approved'), which is correct.
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { ADMIN_ROLES } = require('../../utils/roles');

const PUBLIC_LIST_CACHE_TTL_SECONDS = 60;
// Shorter than the public feed — an admin moderation queue should feel current when a new
// review needs action.
const ADMIN_LIST_CACHE_TTL_SECONDS = 30;

/**
 * Busts the public and admin cached review lists for one doctor. Also busts that doctor's
 * cached directory entry (rating/reviewCount, recomputed by the DB trigger, are embedded in
 * the doctor shape) via a lazy require to avoid a load-order cycle with doctors.service.js.
 * @param {string} [doctorUserId]
 */
async function invalidateReviewCaches(doctorUserId) {
  const patterns = [`cache:reviews:list:public:${doctorUserId || ''}:*`, `cache:reviews:list:admin:${doctorUserId || ''}:*`];
  // Also bust the "no doctorId filter" bucket (empty doctorId segment covers this already via
  // the pattern above when doctorUserId is falsy, but a per-doctor write must ALSO invalidate
  // any unfiltered admin/public listing that would have included this doctor's rows).
  patterns.push(`cache:reviews:list:public::*`, `cache:reviews:list:admin::*`);
  await Promise.all(patterns.map((p) => cacheService.invalidate(p)));

  if (doctorUserId) {
    const doctorsService = require('../doctors/doctors.service');
    await doctorsService.invalidateDoctorCaches(doctorUserId);
  }
}

const REVIEW_SELECT = {
  id: true,
  doctorUserId: true,
  patientUserId: true,
  rating: true,
  text: true,
  status: true,
  createdAt: true,
  doctor: { select: { id: true, name: true } },
  patient: { select: { id: true, name: true } },
};

function shapeReview(row) {
  return {
    id: row.id,
    doctor: row.doctor ? { id: row.doctor.id, name: row.doctor.name } : { id: row.doctorUserId, name: null },
    patient: row.patient ? { id: row.patient.id, name: row.patient.name } : { id: row.patientUserId, name: null },
    rating: row.rating,
    text: row.text,
    status: row.status,
    createdAt: row.createdAt,
  };
}

/**
 * @param {{appointmentId:string, rating:number, text?:string}} body - already shape-validated;
 *   note there is NO `status` field here even if the client sent one (rule 3, moderation-bypass
 *   prevention) — reviews.validation.js#createReview doesn't define it, and this function never
 *   reads body.status.
 * @param {{id:string, role:string}} requester - always role 'patient' (route-enforced).
 */
async function createReview(body, requester) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: body.appointmentId },
    select: { id: true, patientUserId: true, doctorUserId: true, status: true },
  });

  // Not found OR not owned by this patient -> 404 (never 403), matching the enumeration-
  // avoidance posture used throughout appointments.service.js.
  if (!appointment || appointment.patientUserId !== requester.id) {
    throw new ApiError(404, 'REVIEW_APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  }

  if (appointment.status !== 'completed') {
    throw new ApiError(400, 'APPOINTMENT_NOT_COMPLETED', 'You can only review a completed appointment.');
  }

  let created;
  try {
    created = await prisma.review.create({
      data: {
        appointmentId: appointment.id,
        doctorUserId: appointment.doctorUserId, // never client-supplied — derived from the appointment
        patientUserId: requester.id,
        rating: body.rating,
        text: body.text ? String(body.text).trim() : null,
        status: 'pending', // explicit, not just relying on the Prisma column default
      },
      select: { id: true },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(409, 'REVIEW_ALREADY_EXISTS', 'You have already reviewed this appointment.');
    }
    throw err;
  }

  await activityLogService.log({
    actorUserId: requester.id,
    actorRole: requester.role,
    actionType: 'review.create',
    targetEntityType: 'review',
    targetEntityId: created.id,
    description: `Submitted a review for appointment ${appointment.id}`,
  });

  await invalidateReviewCaches(appointment.doctorUserId);

  const row = await prisma.review.findUnique({ where: { id: created.id }, select: REVIEW_SELECT });
  return shapeReview(row);
}

/**
 * Free movement between all three statuses (approve/reject/return-to-pending) — no transition
 * state machine, unlike appointments. Idempotent: re-setting the same status is still a 200.
 * @param {string} id
 * @param {'pending'|'approved'|'rejected'} status
 * @param {{id:string, role:string}} actor - always admin/superadmin (route-enforced).
 */
async function updateReviewStatus(id, status, actor) {
  const existing = await prisma.review.findUnique({
    where: { id },
    select: { id: true, status: true, doctorUserId: true },
  });
  if (!existing) {
    throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  }

  const previousStatus = existing.status;
  await prisma.review.update({ where: { id }, data: { status } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'review.status_update',
    targetEntityType: 'review',
    targetEntityId: id,
    description: `Changed review status from "${previousStatus}" to "${status}"`,
  });

  await invalidateReviewCaches(existing.doctorUserId);

  const row = await prisma.review.findUnique({ where: { id }, select: REVIEW_SELECT });
  return shapeReview(row);
}

/**
 * One role-scoped function backs GET / for every role:
 *  - anonymous / patient / doctor / receptionist: the `status` query param is IGNORED — always
 *    forced to 'approved' server-side (rule 3 — never trust a client-controlled filter to leak
 *    pending/rejected content).
 *  - admin/superadmin: `status` honored if present (any of the 3), otherwise all statuses (the
 *    moderation queue needs to see pending rows by default).
 * @param {{doctorId?:string, status?:string, page?:number, pageSize?:number}} query
 * @param {{id:string, role:string}|undefined} requester - undefined for an anonymous caller.
 */
async function listReviews({ doctorId, status, page, pageSize }, requester) {
  const isAdmin = !!requester && ADMIN_ROLES.includes(requester.role);

  // Non-admin output is always status:'approved' and identical for every caller (role-invariant)
  // -> public bucket, keyed by query params only. Admin output varies by `status` and must
  // never look stale on load -> separate bucket, shorter TTL.
  const cacheKey = isAdmin
    ? `cache:reviews:list:admin:${doctorId || ''}:${status || ''}:${page || ''}:${pageSize || ''}`
    : `cache:reviews:list:public:${doctorId || ''}:${page || ''}:${pageSize || ''}`;
  const ttl = isAdmin ? ADMIN_LIST_CACHE_TTL_SECONDS : PUBLIC_LIST_CACHE_TTL_SECONDS;

  return cacheService.getOrSet(cacheKey, ttl, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {};
    if (doctorId) where.doctorUserId = doctorId;

    if (isAdmin) {
      if (status) where.status = status;
    } else {
      where.status = 'approved';
    }

    const [rows, total] = await Promise.all([
      prisma.review.findMany({
        where,
        select: REVIEW_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.review.count({ where }),
    ]);

    return {
      rows: rows.map(shapeReview),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

module.exports = { createReview, updateReviewStatus, listReviews };
