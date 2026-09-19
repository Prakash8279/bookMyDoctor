/**
 * Business logic for the appointments module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules
 * (e.g. double-booking prevention, fee computation, payment masking by role), and all
 * Prisma/DB calls for this module live. Controllers call these functions; these functions
 * never touch req/res directly.
 *
 * Booking write path ("waiting room" pattern): POST /appointments never touches Prisma or the
 * Redis lock on the HTTP request thread — enqueueBooking() only pushes a job onto bookingQueue
 * and returns. The real logic (runBookingJob, below) executes inside the BullMQ worker process
 * (jobs/bookingWorker.js -> jobs/worker.process.js), which is the only caller of runBookingJob.
 * See jobs/bookingWorker.js's header comment for the full concurrency writeup.
 */
const { Prisma } = require('@prisma/client');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const lockService = require('../../services/lockService');
const cacheService = require('../../services/cacheService');
const queueService = require('../queue/queue.service');
const notificationsService = require('../notifications/notifications.service');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const bookingQueue = require('../../jobs/bookingQueue');
const env = require('../../config/env');
const { ADMIN_ROLES, STAFF_ROLES } = require('../../utils/roles');
const { formatDateOnly, todayUTCDateOnly } = require('../../utils/dateOnly');
const { loadCommissionPercent } = require('../../services/commissionLookupService');
const { computeMinBookingAmount } = require('../../utils/minBookingAmount');

// Cache TTL for listAppointments — short relative to directory data (30s) because this is
// live booking state; see cacheService.js header for the general caching contract.
const LIST_CACHE_TTL_SECONDS = 30;

/**
 * Builds the listAppointments cache key. MUST encode the requester's role + owning scope
 * (rule: cache-key scoping must match response scoping — see cacheService.js) because output is
 * both role-masked (fees) and ownership-scoped (rows). Receptionist is keyed by clinicId (not
 * requester.id) so a write on that clinic can invalidate it precisely without knowing which
 * specific receptionist accounts are assigned to it.
 */
function buildListCacheKey(filters, requester, receptionistClinicId) {
  const { page, pageSize, status, date, dateFrom, dateTo, doctorId, clinicId, patientId } = filters;
  const scope =
    requester.role === 'patient'
      ? `patient:${requester.id}`
      : requester.role === 'doctor'
      ? `doctor:${requester.id}`
      : requester.role === 'receptionist'
      ? `receptionist:${receptionistClinicId || 'none'}`
      : `admin`;
  return `cache:appointments:list:${scope}:${status || ''}:${date || ''}:${dateFrom || ''}:${dateTo || ''}:${doctorId || ''}:${clinicId || ''}:${patientId || ''}:${page || ''}:${pageSize || ''}`;
}

/**
 * Busts every cached listAppointments page that could contain the given appointment, across all
 * the scopes it's visible under. Called after any write that changes an appointment's status,
 * payment status, or existence (new booking). Safe/cheap to call even when some ids are unknown.
 */
async function invalidateAppointmentListCaches({ patientUserId, doctorUserId, clinicId }) {
  const patterns = [];
  if (patientUserId) patterns.push(`cache:appointments:list:patient:${patientUserId}:*`);
  if (doctorUserId) patterns.push(`cache:appointments:list:doctor:${doctorUserId}:*`);
  if (clinicId) patterns.push(`cache:appointments:list:receptionist:${clinicId}:*`);
  patterns.push(`cache:appointments:list:admin:*`);
  await Promise.all(patterns.map((p) => cacheService.invalidate(p)));
}

// Valid target statuses PATCH /appointments/:id/status will accept, keyed by the appointment's
// CURRENT status. 'upcoming' never appears as a value — it's the create-time default only.
// Anything not listed as a key (completed/cancelled/no_show) is terminal: no further transition
// is ever allowed from there.
const APPOINTMENT_TRANSITIONS = {
  // Only a cancel is allowed out of pending_payment via this endpoint (abandon before paying) —
  // the OTHER way out (pending_payment -> upcoming) is not a client-requested status change at
  // all, it happens internally in payments.service.js#createPaymentForAppointment on successful
  // payment, so it's deliberately not listed as a reachable target here.
  pending_payment: ['cancelled'],
  upcoming: ['confirmed', 'completed', 'cancelled', 'no_show'],
  confirmed: ['completed', 'cancelled', 'no_show'],
};

// A patient may only ever move their own appointment to 'cancelled' — never confirm/complete/
// no-show it themselves. Doctor/receptionist/admin share the fuller set.
const PATIENT_ALLOWED_TARGETS = ['cancelled'];
const STAFF_ALLOWED_TARGETS = ['confirmed', 'completed', 'cancelled', 'no_show'];

const APPOINTMENT_SELECT = {
  id: true,
  patientUserId: true,
  familyMemberId: true,
  doctorUserId: true,
  clinicId: true,
  appointmentDate: true,
  appointmentTime: true,
  reason: true,
  isEmergency: true,
  status: true,
  source: true,
  tokenNumber: true,
  consultationFee: true,
  convenienceFee: true,
  emergencyFee: true,
  gstAmount: true,
  totalAmount: true,
  paymentStatus: true,
  paymentMethod: true,
  checkedInAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  // Full row always fetched (id/name plus phone + clinical profile fields) — masked down to
  // the right subset per role INSIDE shapePatientRef, the same "fetch full, mask on shape"
  // pattern shapeFees already uses for money fields. Never select() differently per role: two
  // different Prisma selects for the same relation would double the query surface for no gain,
  // since the row is already loaded once per request either way.
  patient: {
    select: {
      id: true,
      name: true,
      phone: true,
      patientProfile: {
        select: { dateOfBirth: true, gender: true, bloodGroup: true, emergencyContact: true, medicalHistory: true },
      },
    },
  },
  familyMember: { select: { id: true, name: true, relation: true } },
  doctor: {
    select: {
      id: true,
      name: true,
      photoUrl: true,
      // minBookingAdvanceAmount added (MIN-BOOKING-AMOUNT FIX) — shapeFees needs the doctor's own
      // configured minimum to compute the patient-facing minBookingAmount figure; see
      // utils/minBookingAmount.js. Never surfaced raw to a non-admin — only the derived total is.
      doctorProfile: { select: { specialization: { select: { id: true, name: true } }, minBookingAdvanceAmount: true } },
    },
  },
  // address/phone added (COMPLETENESS FIX — proper receipt/slip generation needs the clinic's
  // address on the printed document; previously only id/name were selected here).
  clinic: { select: { id: true, name: true, address: true, phone: true } },
  queueToken: { select: { id: true, status: true, tokenNumber: true } },
};

/**
 * Generates "HH:MM" candidate slot start-times from startTime (inclusive) to endTime
 * (exclusive), stepping by slotMinutes. Used only by runBookingJob's auto-assignment path
 * (appointmentTime omitted by the caller) — the patient booking form no longer collects an
 * exact time, since only a token/queue position is meaningful to a patient in this
 * token/queue-based system; see runBookingJob for where this feeds in.
 * @param {string} startTime - "HH:MM"
 * @param {string} endTime - "HH:MM"
 * @param {number} slotMinutes
 * @returns {string[]}
 */
function generateSlotCandidates(startTime, endTime, slotMinutes) {
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const step = slotMinutes > 0 ? slotMinutes : 15;
  const candidates = [];
  for (let t = start; t < end; t += step) candidates.push(toHHMM(t));
  return candidates;
}

/**
 * Payment-amount masking by role (mandatory rule 8) — applied at the end of every service
 * function that returns an appointment, never left to the controller or trusted to the client:
 *  - doctor/receptionist: consultationFee only — every other money field OMITTED from the
 *    response object entirely (not nulled), so no client code can mistake a masked zero for real.
 *  - patient (their own booking): full fee breakdown, no commission/clinicPayout (those are
 *    platform business figures, not the patient's concern) — plus minBookingAmount, the correct
 *    "pay minimum now" figure (see utils/minBookingAmount.js). Computing it needs
 *    commissionPercent as an input, but the raw percent itself is never included in this return
 *    value — only the derived rupee total is (rule 8 blocks the percent, not numbers it feeds).
 *  - admin/superadmin: full breakdown PLUS commission/clinicPayout, derived on read (not stored
 *    columns — schema has none) from consultationFee x platformCharges.commissionPercent%.
 *    `commissionPercent` is now fetched unconditionally by every caller (not just for admin —
 *    the patient branch needs it too, for minBookingAmount) once per list/get call, not once per
 *    row — see listAppointments/getAppointmentById.
 * @param {object} row - a raw Prisma appointment row shaped via APPOINTMENT_SELECT.
 * @param {string} role
 * @param {import('@prisma/client').Prisma.Decimal|null} [commissionPercent]
 */
function shapeFees(row, role, commissionPercent) {
  if (STAFF_ROLES.includes(role)) {
    return { consultationFee: row.consultationFee };
  }

  if (ADMIN_ROLES.includes(role)) {
    let commission = null;
    let clinicPayout = null;
    if (commissionPercent != null) {
      // BUSINESS RULE CHANGE (request: "clinic ko jitna doctor decide kiya hai fee utna jayega
      // baki jo extra hai ye plateform charge me rakho") — the clinic/doctor now keeps the ENTIRE
      // consultation fee they set, never diminished by a platform cut. Platform commission is
      // instead whatever this booking charged ON TOP of that consultation fee — convenience fee +
      // emergency fee + GST, i.e. totalAmount minus consultationFee. `commissionPercent` (Platform
      // Charges' admin-configured %) is kept only as the `!= null` gate for "is this caller
      // admin/superadmin and does the platformCharges row exist" (same role/config check every
      // other branch here relies on) — it no longer drives this arithmetic. See
      // payments.service.js#shapePaymentFees for the identical change on the payment-row side.
      clinicPayout = row.consultationFee.toDecimalPlaces(2);
      commission = row.totalAmount.minus(clinicPayout).toDecimalPlaces(2);
    }
    return {
      consultationFee: row.consultationFee,
      convenienceFee: row.convenienceFee,
      emergencyFee: row.emergencyFee,
      gstAmount: row.gstAmount,
      totalAmount: row.totalAmount,
      commission,
      clinicPayout,
    };
  }

  // patient (their own booking, enforced by the visibility check upstream).
  const minBookingAmount = computeMinBookingAmount({
    totalAmount: row.totalAmount,
    consultationFee: row.consultationFee,
    minBookingAdvanceAmount: row.doctor?.doctorProfile?.minBookingAdvanceAmount ?? null,
    commissionPercent,
  });
  return {
    consultationFee: row.consultationFee,
    convenienceFee: row.convenienceFee,
    emergencyFee: row.emergencyFee,
    gstAmount: row.gstAmount,
    totalAmount: row.totalAmount,
    // MIN-BOOKING-AMOUNT FIX (superadmin request) — the correct "pay minimum now" figure,
    // already including the platform's cut; see utils/minBookingAmount.js for the formula and
    // why this replaced the old bare doctorProfile.minBookingAdvanceAmount display. null when the
    // doctor hasn't configured a minimum, or Platform Charges isn't configured yet.
    minBookingAmount: minBookingAmount != null ? new Prisma.Decimal(minBookingAmount) : null,
  };
}

/**
 * Patient data reaching each role, scoped to what that role actually needs (not a blanket
 * full-profile dump):
 *  - doctor: the treating doctor needs enough to actually consult the patient — phone (to call
 *    if running late/no-show) plus the clinically-relevant patientProfile fields (DOB/gender/
 *    blood group/medical history/emergency contact). Reachable only for a doctor's OWN
 *    appointment — getVisibleAppointmentOrThrow/listAppointments already scope doctorUserId to
 *    requester.id before shapeAppointment ever runs, so this is never a cross-doctor leak.
 *  - admin/superadmin: same full view as doctor (platform oversight — rule from this phase's
 *    brief: "admin/superadmin ko proper data aaye").
 *  - receptionist: front-desk data only — name + phone (to call a patient in for their token /
 *    confirm a booking), never the clinical fields. Mirrors medicalRecords.routes.js's existing
 *    "receptionist is deliberately excluded from clinical data" posture.
 *  - patient (their own booking): just the identity shape used elsewhere in the app already —
 *    they already have their own profile via GET /me, no need to duplicate it here.
 * @param {object|null} patientRow - the `patient` sub-object from APPOINTMENT_SELECT.
 * @param {string} role
 */
function shapePatientRef(patientRow, role) {
  if (!patientRow) return null;

  const base = { id: patientRow.id, name: patientRow.name };

  if (role === 'doctor' || ADMIN_ROLES.includes(role)) {
    const pp = patientRow.patientProfile || {};
    return {
      ...base,
      phone: patientRow.phone,
      dateOfBirth: pp.dateOfBirth ? formatDateOnly(pp.dateOfBirth) : null,
      gender: pp.gender ?? null,
      bloodGroup: pp.bloodGroup ?? null,
      medicalHistory: pp.medicalHistory ?? null,
      emergencyContact: pp.emergencyContact ?? null,
    };
  }

  if (role === 'receptionist') {
    return { ...base, phone: patientRow.phone };
  }

  // patient (own booking) and any other caller — identity only.
  return base;
}

function shapeAppointment(row, role, commissionPercent) {
  return {
    id: row.id,
    patient: shapePatientRef(row.patient, role),
    familyMember: row.familyMember
      ? { id: row.familyMember.id, name: row.familyMember.name, relation: row.familyMember.relation }
      : null,
    doctor: row.doctor
      ? {
          id: row.doctor.id,
          name: row.doctor.name,
          photoUrl: row.doctor.photoUrl,
          specialization:
            row.doctor.doctorProfile && row.doctor.doctorProfile.specialization
              ? row.doctor.doctorProfile.specialization
              : null,
        }
      : null,
    clinic: row.clinic ? { id: row.clinic.id, name: row.clinic.name, address: row.clinic.address, phone: row.clinic.phone } : null,
    appointmentDate: formatDateOnly(row.appointmentDate),
    appointmentTime: row.appointmentTime,
    reason: row.reason,
    isEmergency: row.isEmergency,
    status: row.status,
    source: row.source,
    tokenNumber: row.tokenNumber,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    fees: shapeFees(row, role, commissionPercent),
    notes: row.notes,
    checkedInAt: row.checkedInAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// loadCommissionPercentIfAdmin now lives in services/commissionLookupService.js (was
// byte-identically duplicated here and in payments.service.js — deduplicated 2026-09-05).

/**
 * Fetches an appointment and enforces the shared visibility rule: patient-owner / assigned
 * doctor / same-clinic receptionist / admin can see it; everyone else gets 404 (never 403,
 * matching the "don't confirm existence to a non-owner" posture used throughout this codebase —
 * see clinics.service.js/familyMembers.service.js for the same pattern).
 * @param {string} id
 * @param {{id:string, role:string}} requester
 */
async function getVisibleAppointmentOrThrow(id, requester) {
  const row = await prisma.appointment.findUnique({ where: { id }, select: APPOINTMENT_SELECT });
  if (!row) {
    throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  }

  if (ADMIN_ROLES.includes(requester.role)) return row;
  if (requester.role === 'patient' && row.patientUserId === requester.id) return row;
  if (requester.role === 'doctor' && row.doctorUserId === requester.id) return row;
  if (requester.role === 'receptionist') {
    const rp = await prisma.receptionistProfile.findUnique({
      where: { userId: requester.id },
      select: { clinicId: true },
    });
    if (rp && rp.clinicId && rp.clinicId === row.clinicId) return row;
  }

  throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
}

// ── A. Booking write path (HTTP-facing: enqueue + poll) ────────────────────

/**
 * HTTP-facing entry point for POST /appointments. Never touches Prisma or the Redis lock —
 * that's the whole point of the waiting-room pattern (flat API latency regardless of booking
 * burst size). Derives "whose booking is this" from req.user, NEVER the request body (rule 3):
 * a patient always books for themselves (role='patient' -> source='online', patientUserId is
 * always req.user.id); a receptionist always books on behalf of someone else
 * (role='receptionist' -> source='walk_in', patientUserId comes from the body and is verified
 * to be a real patient inside runBookingJob). familyMemberId is only ever honored for a patient
 * caller — silently dropped for a receptionist caller, matching design decision #4 in the phase
 * plan (family-member booking is patient-only).
 * @param {object} body - already shape-validated by appointments.validation.js#createAppointment
 * @param {{id:string, role:string}} requester
 */
async function enqueueBooking(body, requester) {
  const isPatient = requester.role === 'patient';
  const source = isPatient ? 'online' : 'walk_in';

  const patientUserId = isPatient ? requester.id : body.patientUserId;
  // COMPLETENESS FIX (audit Priority 1 #2 — walk-in registration): a receptionist/admin with no
  // existing patientUserId can supply patientName + patientPhone instead, and
  // runBookingJob#findOrCreateWalkInPatient resolves/creates that account on the worker side
  // (never here — see this function's header comment on why it never touches Prisma). Shape of
  // these three is already validated by appointments.validation.js#createAppointment.
  const hasWalkInDetails = !isPatient && !patientUserId && body.patientName && body.patientPhone;
  if (!isPatient && !patientUserId && !hasWalkInDetails) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'patientUserId is required when booking on behalf of a patient — or supply patientName and patientPhone to register a new walk-in patient.'
    );
  }

  const jobPayload = {
    doctorUserId: body.doctorUserId,
    clinicId: body.clinicId || null,
    appointmentDate: body.appointmentDate,
    appointmentTime: body.appointmentTime,
    reason: body.reason ? String(body.reason).trim() : null,
    isEmergency: body.isEmergency === true,
    familyMemberId: isPatient ? body.familyMemberId || null : null,
    patientUserId: patientUserId || null,
    patientName: hasWalkInDetails ? String(body.patientName).trim() : null,
    patientPhone: hasWalkInDetails ? String(body.patientPhone).trim() : null,
    patientEmail: hasWalkInDetails && body.patientEmail ? String(body.patientEmail).trim() : null,
    paymentMethod: body.paymentMethod || null,
    source,
    requestedByUserId: requester.id,
    requestedByRole: requester.role,
  };

  const job = await bookingQueue.enqueueBookingJob(jobPayload);
  return { jobId: job.id, status: 'queued' };
}

/**
 * HTTP-facing entry point for GET /appointments/booking-status/:jobId. Ownership: only the
 * user who requested the booking (job.data.requestedByUserId) or an admin/superadmin may poll
 * it — an unrelated caller gets 403 (this is a job id, not a resource id load-bearing for
 * enumeration-avoidance, so 403 rather than 404 is appropriate here, unlike appointment/queue
 * lookups elsewhere in this module). On a completed job, the appointment is re-fetched fresh
 * from Postgres and re-shaped via the SAME shapeAppointment used everywhere else — never the
 * raw job return value — so payment masking is always correct for whoever is polling and the
 * data can never be stale relative to a since-changed status.
 * @param {string} jobId
 * @param {{id:string, role:string}} requester
 */
async function getBookingStatus(jobId, requester) {
  const job = await bookingQueue.getJob(jobId);
  if (!job) {
    throw new ApiError(404, 'BOOKING_JOB_NOT_FOUND', 'Booking job not found.');
  }

  const requestedByUserId = job.data && job.data.requestedByUserId;
  const isOwner = requestedByUserId === requester.id;
  if (!isOwner && !ADMIN_ROLES.includes(requester.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view this booking.');
  }

  const state = await job.getState();

  if (state === 'completed') {
    const result = job.returnvalue || {};
    const appointment = await getAppointmentById(result.appointmentId, requester);
    return { jobId, status: 'confirmed', appointment };
  }

  if (state === 'failed') {
    let errorInfo = { code: 'BOOKING_FAILED', message: 'Booking could not be completed. Please try again.' };
    try {
      const parsed = JSON.parse(job.failedReason);
      if (parsed && parsed.code && parsed.message) {
        errorInfo = { code: parsed.code, message: parsed.message };
      }
    } catch (err) {
      // job.failedReason wasn't our JSON-encoded {code,message} (e.g. a plain Error's raw
      // message after BullMQ exhausted all retries on a non-ApiError failure) — fall back to
      // the generic message above rather than leaking an internal error string to the client.
    }
    return { jobId, status: 'failed', error: errorInfo };
  }

  // 'waiting' | 'active' | 'delayed' | 'waiting-children' | 'prioritized' all collapse to one
  // client-facing "processing" state — the poller doesn't need BullMQ's internal vocabulary.
  // Surface a live queue position + rough ETA scoped to this doctor+date (ticket-booking-style
  // "X people ahead of you" display) so the frontend can show a fair, transparent queue instead
  // of a generic spinner. Purely informational — it reads pending jobs to COUNT them, it never
  // touches the advisory lock/Redis lock/unique-index serialization that guarantees correctness.
  const { queuePosition, aheadOfYou, etaSeconds } = await bookingQueue.getQueuePosition(job);
  return { jobId, status: 'processing', queuePosition, aheadOfYou, etaSeconds };
}

// Local copy of the same normalize-email convention already duplicated per-module in this
// codebase (auth.service.js, doctors.service.js, receptionists.service.js) — not shared, so this
// doesn't introduce any new cross-module coupling.
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/**
 * COMPLETENESS FIX (audit Priority 1 #2 — walk-in registration): resolves the patientUserId for
 * a walk-in booking that arrived with no existing patient account, closing the gap the web
 * frontend's WalkIn form used to hit every time ("the API has no endpoint to create a patient
 * account on the spot" — StaffPages.jsx). Looks up an existing patient by phone first, so a
 * receptionist re-registering a returning walk-in never creates a duplicate account just
 * because they didn't have the id handy; creates a brand-new one otherwise, mirroring
 * auth.service.js#register's own user + patientProfile creation shape exactly.
 *
 * Called only from runBookingJob (worker-side) — never from the HTTP-facing enqueueBooking, per
 * that function's own header comment on why it never touches Prisma. There is no hot-path
 * latency concern here the way there would be on the patient's own online-booking path.
 * @param {{name:string, phone:string, email?:string}} details
 * @param {string} requestedByUserId - the receptionist/admin creating this account, for the audit log
 * @param {string} requestedByRole
 * @returns {Promise<string>} the resolved patientUserId
 */
async function findOrCreateWalkInPatient({ name, phone, email }, requestedByUserId, requestedByRole) {
  const normalizedPhone = String(phone).trim();

  // RACE-CONDITION FIX (multi-agent payment audit): this used to do an unlocked find-by-phone
  // then, on a miss, create in a SEPARATE transaction — with no unique DB constraint on
  // User.phone (only email is @unique), two near-simultaneous walk-in registrations for the same
  // real patient (e.g. two receptionists, or a double-submitted booking) that each supply a
  // DIFFERENT email both pass the findFirst check and both inserts succeed, producing two patient
  // accounts for one person, each holding half their appointment/medical history. The existing
  // P2002 retry-by-phone fallback below only ever fires on an EMAIL collision, so it never caught
  // this. Fixed the same way this file already serializes doctor+day booking races (see
  // runBookingJob's pg_advisory_xact_lock a few functions down): take a self-releasing advisory
  // lock keyed on the normalized phone number for the entire find-then-create sequence, so a
  // second concurrent call for the same phone blocks until the first one's transaction commits
  // and then sees its row via the (now-redundant-but-harmless) findFirst below.
  const existing = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'walkin-phone:' + normalizedPhone}))`;
    return tx.user.findFirst({ where: { role: 'patient', phone: normalizedPhone }, select: { id: true } });
  });
  if (existing) return existing.id;

  // A real email was supplied — normalize it like every other registration path. Otherwise
  // synthesize one from the phone number so User.email (NOT NULL + UNIQUE) is always
  // satisfiable — this patient can replace it with a real one later from their own profile once
  // they set a password via "forgot password" (self-service only; this flow never creates or
  // communicates a login credential for them, matching this app's standing rule that credentials
  // are only ever handled by the account owner themselves).
  const normalizedEmail = email
    ? normalizeEmail(email)
    : `walkin.${normalizedPhone.replace(/[^0-9]/g, '')}@walkin.bookmydoctor24.local`;

  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), env.bcryptSaltRounds);

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Re-acquire the same advisory lock inside this transaction too: the one taken above was
      // scoped to (and released at the end of) the previous, separate transaction, so without
      // re-taking it here a second caller could still slip in between that lock's release and
      // this insert. Cheap — Postgres advisory locks are just an in-memory counter keyed by hash.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'walkin-phone:' + normalizedPhone}))`;
      const raceCheck = await tx.user.findFirst({ where: { role: 'patient', phone: normalizedPhone }, select: { id: true } });
      if (raceCheck) return raceCheck;
      const user = await tx.user.create({
        data: {
          name: String(name).trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'patient',
          phone: normalizedPhone,
          status: 'active',
        },
        select: { id: true },
      });
      // Created eagerly (empty row), same as auth.service.js#register — so this account behaves
      // identically to a self-registered one everywhere else in the app (GET /me, etc.).
      await tx.patientProfile.create({ data: { userId: user.id } });
      return user;
    });

    await activityLogService.log({
      actorUserId: requestedByUserId,
      actorRole: requestedByRole,
      actionType: 'appointments.walkInPatientCreated',
      targetEntityType: 'user',
      targetEntityId: created.id,
      description: `Walk-in patient account created for "${name}" during booking`,
    });

    return created.id;
  } catch (err) {
    if (err.code === 'P2002') {
      // Race: the email (real or synthesized) collided with an account created between our
      // findFirst-by-phone above and this insert — most likely two near-simultaneous walk-ins
      // for the same phone from different receptionists/clinics. Re-check by phone once more
      // before giving up, so this only ever surfaces as a real error when it's genuinely someone
      // else's email.
      const retry = await prisma.user.findFirst({ where: { role: 'patient', phone: normalizedPhone }, select: { id: true } });
      if (retry) return retry.id;
      throw new ApiError(
        409,
        'EMAIL_ALREADY_EXISTS',
        'A patient account with this email already exists — search by phone or email instead of registering a new one.'
      );
    }
    throw err;
  }
}

// ── B. Booking logic (worker-facing only — never called from an HTTP route) ─

/**
 * The real booking logic. Runs ONLY inside the BullMQ worker (jobs/bookingWorker.js) — never
 * call this directly from a controller/route. Every business-rule failure throws ApiError; the
 * worker's processor() catches ApiError and converts it to BullMQ's UnrecoverableError so a
 * deterministic failure (slot taken, doctor not found, outside OPD hours, ...) is never
 * pointlessly retried. Anything else (LockAcquisitionError from contention, a transient DB
 * error) propagates as a plain Error and IS retried by BullMQ's own attempts/backoff.
 * @param {object} payload - see enqueueBooking() above for the exact shape enqueued.
 * @returns {Promise<{appointmentId:string, tokenNumber:number}>}
 */
async function runBookingJob(payload) {
  const {
    doctorUserId,
    clinicId: requestedClinicId,
    appointmentDate: dateStr,
    appointmentTime: timeStr,
    reason,
    isEmergency,
    familyMemberId,
    patientUserId: initialPatientUserId,
    patientName,
    patientPhone,
    patientEmail,
    paymentMethod,
    source,
    requestedByUserId,
    requestedByRole,
  } = payload;
  // Reassigned just below when this is a walk-in with no existing account yet — everything after
  // that point in this function is already keyed on `patientUserId`, so this is the only place
  // that needs to know the difference.
  let patientUserId = initialPatientUserId;

  // ── Doctor + profile ────────────────────────────────────────────────
  const doctor = await prisma.user.findUnique({
    where: { id: doctorUserId },
    select: {
      id: true,
      status: true,
      doctorProfile: {
        select: {
          status: true,
          consultationFee: true,
          maxDaysAdvance: true,
          allowRebooking: true,
          maxOnlineBookingsPerDay: true,
          emergencyAvailable: true,
          onlineBookingWindowStart: true,
          onlineBookingWindowEnd: true,
          // Doctor-configured token-numbering rule — see schema.prisma's
          // DoctorProfile.tokenNumberingMode comment and the token-assignment block below for
          // exactly how 'alternate' changes the numbering. onlineTokenParity picks which parity
          // 'alternate' mode gives online bookings (doctor-selectable — see schema.prisma's
          // DoctorProfile.onlineTokenParity comment); ignored while tokenNumberingMode stays
          // 'sequential'.
          tokenNumberingMode: true,
          onlineTokenParity: true,
        },
      },
    },
  });
  if (!doctor || doctor.status !== 'active' || !doctor.doctorProfile || doctor.doctorProfile.status !== 'verified') {
    throw new ApiError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
  }
  const doctorProfile = doctor.doctorProfile;

  // ── Clinic resolution ───────────────────────────────────────────────
  let clinicId = requestedClinicId;
  if (!clinicId) {
    const links = await prisma.doctorClinic.findMany({
      where: { doctorUserId },
      select: { clinicId: true, isPrimary: true, clinic: { select: { approvalStatus: true } } },
    });
    if (links.length === 0) {
      throw new ApiError(404, 'NOT_ASSIGNED_TO_CLINIC', 'This doctor is not assigned to any clinic.');
    }
    // Auto-resolution must only ever consider active clinics — otherwise a doctor whose primary
    // (or sole) clinic has since been suspended/deactivated would auto-resolve to that inactive
    // clinic and immediately hit CLINIC_NOT_ACTIVE below, instead of falling back to another
    // active clinic they're linked to (or getting a clear "no active clinic" error).
    const activeLinks = links.filter((l) => l.clinic && l.clinic.approvalStatus === 'active');
    if (activeLinks.length === 0) {
      throw new ApiError(400, 'CLINIC_NOT_ACTIVE', 'This doctor has no active clinic to book at.');
    }
    const primary = activeLinks.find((l) => l.isPrimary);
    if (primary) {
      clinicId = primary.clinicId;
    } else if (activeLinks.length === 1) {
      clinicId = activeLinks[0].clinicId;
    } else {
      throw new ApiError(400, 'CLINIC_AMBIGUOUS', 'This doctor is linked to multiple active clinics; clinicId is required.');
    }
  }

  const doctorClinicLink = await prisma.doctorClinic.findUnique({
    where: { doctorUserId_clinicId: { doctorUserId, clinicId } },
    select: { onlineBooking: true },
  });
  if (!doctorClinicLink) {
    throw new ApiError(404, 'NOT_ASSIGNED_TO_CLINIC', 'This doctor is not assigned to this clinic.');
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, approvalStatus: true, emergencyAvailable: true },
  });
  if (!clinic) {
    throw new ApiError(404, 'NOT_ASSIGNED_TO_CLINIC', 'This doctor is not assigned to this clinic.');
  }
  if (clinic.approvalStatus !== 'active') {
    throw new ApiError(400, 'CLINIC_NOT_ACTIVE', 'The selected clinic is not active.');
  }

  // Walk-ins bypass this — a receptionist can always book at their own clinic regardless of the
  // doctor's online-booking toggle (that toggle only governs patient self-service).
  if (source === 'online' && !doctorClinicLink.onlineBooking) {
    throw new ApiError(403, 'ONLINE_BOOKING_DISABLED', 'Online booking is disabled for this doctor at this clinic.');
  }

  // Online-booking accessibility window — a DOCTOR-LEVEL override (doctorProfile.
  // onlineBookingWindowStart/End, admin- or doctor-set via doctors.service.js#updateBookingSettings)
  // takes precedence when this doctor has one; otherwise the PLATFORM-WIDE window
  // (admin/superadmin managed, BookingRules singleton — admin.service.js#updateBookingRules)
  // applies. Both levels are opt-in: no override AND no platform-wide window set means no
  // restriction at all, "full time". Fetched only for online bookings — a walk-in never pays for
  // the extra query, same exemption pattern as every check in this function keyed on `source`.
  // `bookingRules` is reused just below for the platform-wide max-advance-days cap too (that cap
  // has no per-doctor override — maxDaysAdvance already IS the per-doctor equivalent).
  let bookingRules = null;
  if (source === 'online') {
    const hasDoctorWindow = doctorProfile.onlineBookingWindowStart && doctorProfile.onlineBookingWindowEnd;
    bookingRules = hasDoctorWindow
      ? null
      : await prisma.bookingRules.findUnique({
          where: { id: 1 },
          select: { onlineBookingWindowStart: true, onlineBookingWindowEnd: true, onlineBookingMaxAdvanceDays: true },
        });
    const effectiveWindow = hasDoctorWindow
      ? { start: doctorProfile.onlineBookingWindowStart, end: doctorProfile.onlineBookingWindowEnd }
      : bookingRules && bookingRules.onlineBookingWindowStart && bookingRules.onlineBookingWindowEnd
      ? { start: bookingRules.onlineBookingWindowStart, end: bookingRules.onlineBookingWindowEnd }
      : null;
    // The max-advance-days cap lives ONLY on the platform-wide row (no per-doctor override for
    // it), so when this doctor HAS their own window override we still need `bookingRules`
    // fetched for that cap check further below — fetch it now rather than skip it entirely.
    if (hasDoctorWindow && bookingRules === null) {
      bookingRules = await prisma.bookingRules.findUnique({
        where: { id: 1 },
        select: { onlineBookingMaxAdvanceDays: true },
      });
    }
    if (effectiveWindow) {
      // Plain HH:MM string comparison against the current UTC clock — the same convention this
      // codebase already uses for OPD-hours matching (see the same-day slot logic further below
      // in this function); zero-padded 24h HH:MM strings compare correctly with plain string
      // operators. Doesn't support a window spanning midnight (e.g. "22:00"-"06:00") — both
      // admin.validation.js#updateBookingRules and doctors.validation.js#patchDoctor require
      // start < end at save time, so that case can never be saved in the first place.
      const nowHHMM = new Date().toISOString().slice(11, 16);
      if (nowHHMM < effectiveWindow.start || nowHHMM > effectiveWindow.end) {
        throw new ApiError(
          403,
          'ONLINE_BOOKING_WINDOW_CLOSED',
          `Online booking is only available between ${effectiveWindow.start} and ${effectiveWindow.end}. Please try again during that window, or contact the clinic directly.`
        );
      }
    }
  }

  // ── Date checks ──────────────────────────────────────────────────────
  // Explicit UTC-midnight construction (not `new Date(dateStr)`) to dodge local-timezone-shift
  // bugs when comparing calendar dates.
  const appointmentDateUTC = new Date(`${dateStr}T00:00:00.000Z`);
  const todayUTC = todayUTCDateOnly();

  if (appointmentDateUTC.getTime() < todayUTC.getTime()) {
    throw new ApiError(400, 'INVALID_DATE', 'appointmentDate cannot be in the past.');
  }

  const maxDaysAdvance = doctorProfile.maxDaysAdvance ?? 30;
  const maxDateUTC = new Date(todayUTC.getTime() + maxDaysAdvance * 24 * 60 * 60 * 1000);
  if (appointmentDateUTC.getTime() > maxDateUTC.getTime()) {
    throw new ApiError(
      400,
      'DATE_TOO_FAR_ADVANCE',
      `Appointments can only be booked up to ${maxDaysAdvance} days in advance.`
    );
  }

  // Platform-wide cap (see above) — checked SEPARATELY from, and after, the doctor's own
  // maxDaysAdvance check, so whichever of the two is STRICTER effectively wins: a doctor allowing
  // 60 days but a platform cap of 7 still only allows 7; a platform cap of 30 never loosens a
  // doctor who only allows 10 (their own check above already caught anything past day 10).
  if (source === 'online' && bookingRules && bookingRules.onlineBookingMaxAdvanceDays != null) {
    const platformMaxDateUTC = new Date(todayUTC.getTime() + bookingRules.onlineBookingMaxAdvanceDays * 24 * 60 * 60 * 1000);
    if (appointmentDateUTC.getTime() > platformMaxDateUTC.getTime()) {
      throw new ApiError(
        400,
        'DATE_TOO_FAR_ADVANCE',
        bookingRules.onlineBookingMaxAdvanceDays === 0
          ? 'Online bookings are currently only accepted for today. Please contact the clinic to book a future date.'
          : `Online bookings can only be made up to ${bookingRules.onlineBookingMaxAdvanceDays} day(s) in advance right now.`
      );
    }
  }

  const isSameDay = appointmentDateUTC.getTime() === todayUTC.getTime();
  if (isSameDay && source === 'online' && doctorProfile.allowRebooking === false) {
    throw new ApiError(400, 'SAME_DAY_BOOKING_DISABLED', 'This doctor does not accept same-day online bookings.');
  }

  // Doctor-set daily cap on online (patient self-service) bookings — off by default (NULL). Only
  // gates a PATIENT's own online booking, same exemption pattern as the online-booking-disabled
  // check above: walk-ins (source === 'walk_in') never count against this cap and are never
  // blocked by it, so a receptionist can still register a walk-in patient at the desk regardless.
  // Counted across ALL of this doctor's clinics for the date (a doctor's daily capacity is
  // per-doctor, not per-clinic), excluding cancelled/no-show appointments — same status filter
  // used for the taken-slot check further down — so a cancelled online booking frees up the cap.
  // NOTE: this is only a fast-fail (unlocked read-then-decide, can race under concurrent worker
  // jobs) — the authoritative re-check that actually prevents the cap being exceeded runs again
  // inside the transaction below, AFTER the per-doctor-day advisory lock is acquired. Kept here
  // too so the common (non-racing) case rejects before doing any OPD-hours/lock work at all.
  if (source === 'online' && doctorProfile.maxOnlineBookingsPerDay != null) {
    const onlineBookingsToday = await prisma.appointment.count({
      where: {
        doctorUserId,
        appointmentDate: appointmentDateUTC,
        source: 'online',
        status: { notIn: ['cancelled', 'no_show'] },
      },
    });
    if (onlineBookingsToday >= doctorProfile.maxOnlineBookingsPerDay) {
      throw new ApiError(
        400,
        'DAILY_ONLINE_LIMIT_REACHED',
        `This doctor has reached the maximum of ${doctorProfile.maxOnlineBookingsPerDay} online bookings for this date. Please try another date, or contact the clinic directly.`
      );
    }
  }

  // ── OPD hours for the selected weekday ───────────────────────────────
  // Fetched here (rather than only when validating an explicit time) because auto-assignment
  // (timeStr falsy — the patient booking form no longer collects an exact time, see
  // enqueueBooking's caller; only a token/queue position matters to a patient) needs this same
  // startTime/endTime/slotMinutes row to generate candidate slots inside the transaction below.
  const weekday = appointmentDateUTC.getUTCDay(); // 0=Sunday..6=Saturday, matches doctor_clinic_hours.weekday
  const hours = await prisma.doctorClinicHours.findUnique({
    where: { doctorUserId_clinicId_weekday: { doctorUserId, clinicId, weekday } },
  });
  if (!hours || hours.status !== 'active') {
    throw new ApiError(400, 'DOCTOR_NOT_AVAILABLE_THAT_DAY', 'This doctor does not have OPD hours on the selected day.');
  }

  // An explicit time (still supported for receptionist/admin walk-in booking) is validated
  // exactly as before. When omitted, the transaction below picks the doctor's next free slot on
  // this date automatically — deferred until then because it needs a DB read (which times are
  // already taken) done under the same advisory lock that guarantees no two bookings can race
  // for the same doctor+day.
  if (timeStr) {
    // Same-day bookings must be for a time still ahead of "now" — the calendar-date check above
    // (appointmentDateUTC < todayUTC) only rejects a past DATE, so without this a same-day slot
    // whose TIME has already gone by would otherwise sail through. Current time compared as the
    // same "HH:MM" UTC string shape as appointmentTime/hours.startTime/hours.endTime above.
    if (isSameDay) {
      const currentTimeUTC = new Date().toISOString().slice(11, 16);
      if (timeStr < currentTimeUTC) {
        throw new ApiError(400, 'TIME_ALREADY_PASSED', 'appointmentTime cannot be in the past for a same-day booking.');
      }
    }
    // "HH:MM" fixed-width strings compare correctly lexicographically.
    if (!(timeStr >= hours.startTime && timeStr < hours.endTime)) {
      throw new ApiError(
        400,
        'TIME_OUTSIDE_OPD_HOURS',
        `Appointment time must be between ${hours.startTime} and ${hours.endTime}.`
      );
    }
  }

  const closure = await prisma.doctorClinicClosure.findFirst({
    where: { doctorUserId, clinicId, closedDate: appointmentDateUTC },
    select: { id: true },
  });
  if (closure) {
    throw new ApiError(400, 'CLINIC_CLOSED_THAT_DATE', 'This doctor is not available at this clinic on the selected date.');
  }

  if (isEmergency && (!doctorProfile.emergencyAvailable || !clinic.emergencyAvailable)) {
    throw new ApiError(400, 'EMERGENCY_NOT_AVAILABLE', 'Emergency booking is not available for this doctor/clinic.');
  }

  // ── Family member (patient-only — the literal fix for the family-member ownership leak) ─
  if (familyMemberId) {
    const fm = await prisma.familyMember.findUnique({ where: { id: familyMemberId }, select: { patientUserId: true } });
    if (!fm || fm.patientUserId !== patientUserId) {
      throw new ApiError(404, 'FAMILY_MEMBER_NOT_FOUND', 'Family member not found.');
    }
  }

  // ── Patient ──────────────────────────────────────────────────────────
  // COMPLETENESS FIX (audit Priority 1 #2 — walk-in registration): no patientUserId means this
  // is a walk-in with inline patient details instead (enqueueBooking already guarantees one or
  // the other is present) — find-or-create that account here, on the worker side, before the
  // rest of this function's patient/receptionist/fee checks (all already keyed on
  // `patientUserId`, so reassigning it here is the only change they need).
  if (!patientUserId && patientName && patientPhone) {
    patientUserId = await findOrCreateWalkInPatient(
      { name: patientName, phone: patientPhone, email: patientEmail },
      requestedByUserId,
      requestedByRole
    );
  }

  const patient = await prisma.user.findUnique({
    where: { id: patientUserId },
    select: { id: true, role: true, status: true },
  });
  if (!patient || patient.role !== 'patient' || patient.status !== 'active') {
    throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
  }

  // ── Receptionist-specific clinic scoping ───────────────────────────
  if (source === 'walk_in') {
    const receptionistProfile = await prisma.receptionistProfile.findUnique({
      where: { userId: requestedByUserId },
      select: { clinicId: true },
    });
    if (!receptionistProfile || !receptionistProfile.clinicId) {
      throw new ApiError(400, 'RECEPTIONIST_NOT_ASSIGNED', 'You are not assigned to a clinic.');
    }
    if (receptionistProfile.clinicId !== clinicId) {
      throw new ApiError(403, 'RECEPTIONIST_CLINIC_MISMATCH', 'You can only book walk-ins at your own clinic.');
    }
  }

  // ── Fee computation (server-side, ALWAYS — rule 7, never trust client math) ─────────────
  // NOTE: doctorProfile.emergencyFee is deliberately NOT used here — both grounding reports
  // confirm the booking formula's `emergencyFee` is platformCharges.emergencyFee (a flat
  // platform surcharge), not the doctor's own emergency consultation rate. doctorProfile
  // .emergencyFee stays a stored/display-only field this phase; flagged in case the product
  // actually wants that swapped later.
  const platformCharges = await prisma.platformCharges.findUnique({ where: { id: 1 } });
  if (!platformCharges) {
    throw new ApiError(500, 'PLATFORM_CHARGES_NOT_CONFIGURED', 'Platform charges are not configured.');
  }

  const consultationFee = doctorProfile.consultationFee;
  // MUTUAL-EXCLUSIVITY FIX (superadmin request): the platform charge and the emergency charge
  // never stack — an emergency booking pays the emergency surcharge INSTEAD OF the platform
  // charge, not both. So platform charge only applies when this is NOT an emergency booking.
  const convenienceFee =
    !isEmergency && platformCharges.applyConvenienceFee ? platformCharges.patientConvenienceFee : new Prisma.Decimal(0);
  const emergencyFeeAmount =
    isEmergency && platformCharges.applyEmergencyFee ? platformCharges.emergencyFee : new Prisma.Decimal(0);
  const subtotal = consultationFee.plus(convenienceFee).plus(emergencyFeeAmount);
  // GST FIX (superadmin request): GST is a tax on the amount actually paid ONLINE through the
  // website/app's payment gateway (Razorpay) — a walk-in booking (source === 'walk_in': a
  // receptionist collecting cash/card/UPI in person at the clinic counter, per the `source`
  // assignment above) never touches that payment flow, so no GST belongs on it. `source ===
  // 'online'` means exactly "a patient booked this themselves through the site/app", and every
  // such booking with a non-zero fee is mandatorily paid online via Razorpay (see
  // requiresPrepayment just below) — so GST applies to its whole subtotal.
  const gstAmount = source === 'online'
    ? subtotal.times(platformCharges.gstPercent).dividedBy(100).toDecimalPlaces(2)
    : new Prisma.Decimal(0);
  const totalAmount = subtotal.plus(gstAmount).toDecimalPlaces(2);

  // Payment-before-token: a PATIENT's own online booking with a non-zero fee is created
  // "pending_payment" / the queue token "on_hold" — see AppointmentStatus's schema comment.
  // Walk-ins (a receptionist collects payment in person) and free (fee = 0) bookings are
  // unaffected, going straight to upcoming/waiting exactly as before this feature existed.
  const requiresPrepayment = source === 'online' && totalAmount.greaterThan(0);

  // ── Locked, transactional booking (concurrency — rule 10) ────────────
  // Auto-assign bookings (timeStr falsy) all share one coarser doctor+day lock key rather than
  // one per (unknown) time slot — harmless, since the pg_advisory_xact_lock taken inside the
  // transaction below already fully serializes every booking attempt (explicit-time or
  // auto-assigned alike) for this doctor+day regardless of which Redis key got them there.
  const lockKey = `booking:${doctorUserId}:${dateStr}:${timeStr || 'auto'}`;

  const result = await lockService.withLock(lockKey, () =>
    prisma.$transaction(async (tx) => {
      // Planner-recommended addition beyond the literal brief (flagged): an advisory lock
      // scoped to doctor+DAY (not doctor+day+time — deliberately coarser than the Redis lock
      // above), closing a residual gap the Redis lock alone doesn't cover. Token numbering is
      // scoped per doctor+day, but `SELECT ... FOR UPDATE` below can't lock rows that don't
      // exist yet — so two different TIME SLOTS for the same doctor/day, each correctly
      // serialized on their OWN Redis lock key, could still both read
      // MAX(token_number)=0 concurrently if both are the first booking of that day. This
      // self-releasing (xact-scoped) advisory lock closes that gap for one extra statement.
      // Does not contradict manual_sql/001 §5, which already frames the Redis lock + row lock
      // as "belt and suspenders" — this is a third, cheap layer in the same spirit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorUserId + dateStr}))`;

      // SECURITY/CORRECTNESS FIX (found in an audit): re-check the doctor's daily online-booking
      // cap HERE, now that the advisory lock above fully serializes every booking attempt for
      // this doctor+day, not just at the top of this function (where it was originally the ONLY
      // check). The earlier check up there still runs first as a cheap fast-fail for the common,
      // non-racing case (rejects an obviously-full day before doing any OPD-hours/lock work at
      // all) — but by itself it was a plain read-then-decide with no lock, so with
      // `workerConcurrency` (config/env.js) > 1, two booking jobs for the same doctor+day (e.g.
      // different requested times) could both read the same pre-cap count and both pass,
      // letting the doctor's configured daily cap be exceeded by however many jobs raced through
      // concurrently. This re-check is the one that's actually authoritative — everything after
      // it (token numbering, the INSERT itself) already relies on this same lock for the exact
      // same reason.
      if (source === 'online' && doctorProfile.maxOnlineBookingsPerDay != null) {
        const onlineBookingsTodayLocked = await tx.appointment.count({
          where: {
            doctorUserId,
            appointmentDate: appointmentDateUTC,
            source: 'online',
            status: { notIn: ['cancelled', 'no_show'] },
          },
        });
        if (onlineBookingsTodayLocked >= doctorProfile.maxOnlineBookingsPerDay) {
          throw new ApiError(
            400,
            'DAILY_ONLINE_LIMIT_REACHED',
            `This doctor has reached the maximum of ${doctorProfile.maxOnlineBookingsPerDay} online bookings for this date. Please try another date, or contact the clinic directly.`
          );
        }
      }

      // ── Auto-assign the next free slot when the caller didn't supply a time ──────────────
      // Safe to compute here (rather than before the transaction) precisely because the
      // advisory lock just above fully serializes every booking attempt for this doctor+day —
      // no concurrent transaction can read appointment rows for this doctor+date until this one
      // commits or rolls back, so "which times are taken" below can't go stale before the
      // INSERT a few lines later.
      let resolvedTimeStr = timeStr;
      if (!resolvedTimeStr) {
        const existingForDay = await tx.appointment.findMany({
          where: { doctorUserId, appointmentDate: appointmentDateUTC, status: { notIn: ['cancelled', 'no_show'] } },
          select: { appointmentTime: true },
        });
        const takenTimes = new Set(existingForDay.map((row) => row.appointmentTime));
        const currentTimeUTC = isSameDay ? new Date().toISOString().slice(11, 16) : null;
        resolvedTimeStr = generateSlotCandidates(hours.startTime, hours.endTime, hours.slotMinutes).find(
          (candidate) => !takenTimes.has(candidate) && (!currentTimeUTC || candidate >= currentTimeUTC)
        );
        if (!resolvedTimeStr) {
          throw new ApiError(
            409,
            'NO_SLOTS_AVAILABLE',
            'No available slots left for this doctor on the selected date. Please choose another date.'
          );
        }
      }

      // NOTE (fix, see verifier finding): PostgreSQL forbids a locking clause
      // (FOR UPDATE/SHARE/...) on a query whose output rows can't be tied to
      // individual table rows — an aggregate like MAX() collapses to a single
      // synthetic row, so `... FOR UPDATE` here is invalid SQL and previously
      // made every booking attempt fail. `FOR UPDATE` is dropped; it was also
      // redundant given the `pg_advisory_xact_lock(hashtext(doctorUserId||dateStr))`
      // taken immediately above on the same (doctorUserId, appointmentDate) key,
      // which already fully serializes every concurrent transaction computing
      // MAX(token_number) for this doctor+day — no other transaction can reach
      // this SELECT (or the subsequent INSERT) until the advisory lock is released
      // at the end of this transaction.
      //
      // FEATURE (request: "doctor ek booking rule do jo booking online wala continues token no
      // jayega ya odd ya even patient ko mile"): doctorProfile.tokenNumberingMode picks between
      // two numbering schemes, both still fully covered by the same advisory lock above so
      // neither branch can race:
      //   'sequential' (default) — one shared MAX(token_number)+1 count, exactly the
      //     pre-existing behavior, unaffected by this feature.
      //   'alternate' — online bookings get their own sequence and walk-in bookings get the
      //     OTHER one, each tracked as MAX(token_number) restricted to that parity, +2 (or the
      //     first number of that parity when none exists yet for the day) — so the two sources
      //     never collide and a queue display can tell them apart from the token number alone.
      //     Which parity (odd/even) online gets is itself doctor-selectable — see
      //     doctorProfile.onlineTokenParity (request: "odd ya even select karne ka option do
      //     doctor jo select kar online ke lie") — 'odd' is the default (online=odd,
      //     walk-in=even), 'even' flips it (online=even, walk-in=odd).
      let tokenNumber;
      if (doctorProfile.tokenNumberingMode === 'alternate') {
        const onlineWantsOdd = doctorProfile.onlineTokenParity !== 'even';
        const wantsOdd = source === 'online' ? onlineWantsOdd : !onlineWantsOdd;
        const parityRow = await tx.$queryRaw`
          SELECT COALESCE(MAX(token_number), 0) AS max FROM appointments
          WHERE doctor_user_id = ${doctorUserId} AND appointment_date = ${appointmentDateUTC}::date
            AND (token_number % 2) = ${wantsOdd ? 1 : 0}
        `;
        const currentMax = Number(parityRow[0].max);
        tokenNumber = currentMax > 0 ? currentMax + 2 : wantsOdd ? 1 : 2;
      } else {
        const maxRow = await tx.$queryRaw`
          SELECT COALESCE(MAX(token_number), 0) AS max FROM appointments
          WHERE doctor_user_id = ${doctorUserId} AND appointment_date = ${appointmentDateUTC}::date
        `;
        tokenNumber = Number(maxRow[0].max) + 1;
      }

      let created;
      try {
        created = await tx.appointment.create({
          data: {
            patientUserId,
            familyMemberId: familyMemberId || null,
            doctorUserId,
            clinicId,
            appointmentDate: appointmentDateUTC,
            appointmentTime: resolvedTimeStr,
            reason: reason || null,
            isEmergency: !!isEmergency,
            status: requiresPrepayment ? 'pending_payment' : 'upcoming',
            source,
            tokenNumber,
            consultationFee,
            convenienceFee,
            emergencyFee: emergencyFeeAmount,
            gstAmount,
            totalAmount,
            paymentStatus: 'pending',
            paymentMethod: paymentMethod || null,
          },
          select: { id: true },
        });
      } catch (err) {
        // The double-booking guard (appointments_doctor_slot_unique) is a PARTIAL unique index
        // — manual_sql/001, not expressible in schema.prisma. Prisma maps the underlying
        // Postgres unique-violation (23505) to error code P2002 the same as any other unique
        // constraint. The `err.meta`/raw-code fallback below is defensive, in case some
        // Prisma/driver version ever surfaces a violation on an index Prisma doesn't know about
        // differently — flagged as needing empirical confirmation against a real Postgres
        // instance, which wasn't available while writing this.
        const isUniqueViolation =
          err.code === 'P2002' || err.code === '23505' || (err.meta && err.meta.code === '23505');
        if (isUniqueViolation) {
          throw new ApiError(
            409,
            'SLOT_ALREADY_BOOKED',
            'This slot was just booked by someone else. Please choose another time.'
          );
        }
        throw err;
      }

      await tx.queueToken.create({
        data: {
          appointmentId: created.id,
          doctorUserId,
          clinicId,
          tokenNumber,
          status: requiresPrepayment ? 'on_hold' : 'waiting',
          queueDate: appointmentDateUTC,
        },
      });

      return { appointmentId: created.id, tokenNumber };
    }, {
      // See config/env.js booking.txTimeoutMs / txMaxWaitMs comment: the default Prisma
      // interactive-transaction timeout (5000ms) is untuned for a transaction that opens with a
      // per-doctor-per-day pg_advisory_xact_lock wait — under real contention (up to
      // workerConcurrency transactions queuing on the same advisory-lock key) it can legitimately
      // need longer than that default, so the bound here is a deliberate, configured choice
      // rather than an accidental fallback into a generic Prisma timeout error.
      timeout: env.booking.txTimeoutMs,
      maxWait: env.booking.txMaxWaitMs,
    })
  );

  // PERF FIX (found in an audit): these five post-commit side effects are all independent of one
  // another (an audit-log write, two cache-bust calls, two best-effort notifications) — they used
  // to run one after another (5 sequential round-trips), needlessly lengthening how long each
  // booking occupies one of the worker's limited concurrency slots (see config/env.js
  // workerConcurrency) per booking. Promise.all-ing them is the same pattern already used
  // elsewhere in this file (e.g. listAppointments' commission/rows/count fetch).
  await Promise.all([
    activityLogService.log({
      actorUserId: requestedByUserId,
      actorRole: requestedByRole,
      actionType: 'appointment.create',
      targetEntityType: 'appointment',
      targetEntityId: result.appointmentId,
      description: `Booked appointment (source=${source}, token=${result.tokenNumber})`,
    }),
    invalidateAppointmentListCaches({ patientUserId, doctorUserId, clinicId }),
    // A new booking also adds a fresh queueToken (created above, in the same transaction) — bust
    // the live queue-list caches for this doctor/clinic so it shows up immediately rather than
    // waiting out the (short, but non-zero) queue-list TTL.
    queueService.invalidateQueueListCaches({ doctorUserId, clinicId }),
    // Real-time in-app alerts — only for a booking that's immediately confirmed (no mandatory
    // prepayment gate). A `requiresPrepayment` booking starts life as pending_payment/on_hold
    // with no real token actually secured yet — notifying "booking confirmed" now would be
    // misleading; that case is notified instead from
    // payments.service.js#createPaymentForAppointment, at the moment payment actually succeeds
    // and the booking really does flip to upcoming/waiting.
    ...(requiresPrepayment
      ? []
      : [
          notificationsService.notifySystemEventSafe(patientUserId, {
            title: 'Booking confirmed',
            body: `Your appointment on ${dateStr} is confirmed. Token number #${result.tokenNumber}.`,
            type: 'appointment',
          }),
          notificationsService.notifySystemEventSafe(doctorUserId, {
            title: 'New booking',
            body: `A new appointment was booked for ${dateStr} — token #${result.tokenNumber}.`,
            type: 'appointment',
          }),
        ]),
  ]);

  return result;
}

// ── C. Read + status endpoints ──────────────────────────────────────────

/**
 * @param {object} query
 * @param {{id:string, role:string}} requester
 */
async function listAppointments(
  { page, pageSize, status, date, dateFrom, dateTo, doctorId, clinicId, patientId },
  requester
) {
  let receptionistClinicId = null;
  if (requester.role === 'receptionist') {
    const rp = await prisma.receptionistProfile.findUnique({
      where: { userId: requester.id },
      select: { clinicId: true },
    });
    receptionistClinicId = rp ? rp.clinicId : null;
  }

  const cacheKey = buildListCacheKey(
    { page, pageSize, status, date, dateFrom, dateTo, doctorId, clinicId, patientId },
    requester,
    receptionistClinicId
  );

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {};
    if (status) where.status = status;
    if (date) {
      where.appointmentDate = new Date(`${date}T00:00:00.000Z`);
    } else if (dateFrom || dateTo) {
      where.appointmentDate = {
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T00:00:00.000Z`) } : {}),
      };
    }

    // Forced role scoping (never the client's choice — rule 3) overrides/ignores any
    // doctorId/clinicId/patientId query params for every role except admin/superadmin.
    if (requester.role === 'patient') {
      where.patientUserId = requester.id;
    } else if (requester.role === 'doctor') {
      where.doctorUserId = requester.id;
    } else if (requester.role === 'receptionist') {
      if (!receptionistClinicId) {
        return { rows: [], pagination: buildPaginationMeta({ page: p, pageSize: ps, total: 0 }) };
      }
      where.clinicId = receptionistClinicId;
    } else if (ADMIN_ROLES.includes(requester.role)) {
      if (doctorId) where.doctorUserId = doctorId;
      if (clinicId) where.clinicId = clinicId;
      if (patientId) where.patientUserId = patientId;
    }

    // The commission lookup doesn't depend on the appointment query below (or vice versa) — run
    // all three concurrently instead of paying for the commission round-trip before even starting
    // the appointment fetch. Fetched unconditionally (not just for admin) — shapeFees' patient
    // branch now also needs it, to compute minBookingAmount (see MIN-BOOKING-AMOUNT FIX above).
    const [commissionPercent, rows, total] = await Promise.all([
      loadCommissionPercent(),
      prisma.appointment.findMany({
        where,
        select: APPOINTMENT_SELECT,
        orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'desc' }],
        skip,
        take,
      }),
      prisma.appointment.count({ where }),
    ]);

    return {
      rows: rows.map((row) => shapeAppointment(row, requester.role, commissionPercent)),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

/**
 * @param {string} id
 * @param {{id:string, role:string}} requester
 */
async function getAppointmentById(id, requester) {
  // Independent lookups (commission doesn't depend on the fetched row) — run concurrently rather
  // than paying for both round-trips back to back. Fetched unconditionally — see listAppointments.
  const [row, commissionPercent] = await Promise.all([
    getVisibleAppointmentOrThrow(id, requester),
    loadCommissionPercent(),
  ]);
  return shapeAppointment(row, requester.role, commissionPercent);
}

/**
 * @param {string} id
 * @param {'confirmed'|'completed'|'cancelled'|'no_show'} targetStatus
 * @param {{id:string, role:string}} actor
 */
async function updateAppointmentStatus(id, targetStatus, actor) {
  const row = await getVisibleAppointmentOrThrow(id, actor);

  // ── Role-scoped allow-list for the TARGET status ─────────────────────
  if (actor.role === 'patient') {
    if (!PATIENT_ALLOWED_TARGETS.includes(targetStatus)) {
      throw new ApiError(403, 'FORBIDDEN', 'Patients can only cancel their own appointments.');
    }
  } else if (actor.role === 'doctor' || actor.role === 'receptionist') {
    if (!STAFF_ALLOWED_TARGETS.includes(targetStatus)) {
      throw new ApiError(400, 'INVALID_STATUS_TRANSITION', `Cannot set status to "${targetStatus}".`);
    }
  } else if (!ADMIN_ROLES.includes(actor.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
  }
  // admin/superadmin: no target-status allow-list beyond what validation.js already enforces
  // (confirmed/completed/cancelled/no_show) — any appointment, any of the four.

  // ── Transition-table check (governs the FROM status, regardless of role) ────────────────
  const allowedNext = APPOINTMENT_TRANSITIONS[row.status];
  if (!allowedNext) {
    throw new ApiError(
      409,
      'APPOINTMENT_ALREADY_FINALIZED',
      `Appointment is already "${row.status}" and cannot be changed.`
    );
  }
  if (!allowedNext.includes(targetStatus)) {
    throw new ApiError(
      409,
      'INVALID_STATUS_TRANSITION',
      `Cannot transition appointment from "${row.status}" to "${targetStatus}".`
    );
  }

  // ── Cancel/no-show-specific rules ─────────────────────────────────────
  if ((targetStatus === 'cancelled' || targetStatus === 'no_show') && row.queueToken) {
    if (['in_consultation', 'completed'].includes(row.queueToken.status)) {
      throw new ApiError(409, 'APPOINTMENT_IN_PROGRESS', 'Cannot cancel a consultation that is already underway.');
    }
  }

  if (targetStatus === 'cancelled' && actor.role === 'patient' && row.status !== 'pending_payment') {
    // Staff/admin cancels bypass this window (operational override, e.g. doctor unavailable).
    // An unpaid pending_payment booking was never actually confirmed to the patient (no token
    // was ever shown to them) — there is nothing to protect by making them wait out a
    // cancellation window on a booking they haven't paid for, so this check is skipped entirely
    // for that status.
    const rules = await prisma.bookingRules.findUnique({ where: { id: 1 }, select: { cancellationWindowHours: true } });
    const windowHours = rules ? rules.cancellationWindowHours : 2;
    const apptDateTime = new Date(`${formatDateOnly(row.appointmentDate)}T${row.appointmentTime}:00.000Z`);
    const hoursUntilAppointment = (apptDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilAppointment < windowHours) {
      throw new ApiError(
        400,
        'CANCELLATION_WINDOW_PASSED',
        `Appointments can only be cancelled at least ${windowHours} hour(s) in advance.`
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id }, data: { status: targetStatus } });

    // Release the token from the live queue — literal fix for the "queue token has no FK back
    // to its appointment and is only kept 'fresh' by a manual sweep" gap. payment_status is
    // deliberately left untouched even if already 'paid': a real refund needs the (out-of-
    // scope) Payments module — flipping it to 'refunded' here without money actually moving
    // would be a misleading DB state.
    if (
      (targetStatus === 'cancelled' || targetStatus === 'no_show') &&
      row.queueToken &&
      ['waiting', 'called'].includes(row.queueToken.status)
    ) {
      await tx.queueToken.delete({ where: { id: row.queueToken.id } });
    }

    // Mirror queue.service.js#updateQueueStatus's own completed cascade (queue -> appointment)
    // in the opposite direction: completing an appointment directly via this PATCH must also
    // finish its linked queueToken (if any), or GET /queue keeps listing an already-finished
    // visit as still active (waiting/called/in_consultation) until a manual sweep catches it.
    if (targetStatus === 'completed' && row.queueToken && row.queueToken.status !== 'completed') {
      await tx.queueToken.update({ where: { id: row.queueToken.id }, data: { status: 'completed' } });
    }
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'appointment.status_update',
    targetEntityType: 'appointment',
    targetEntityId: id,
    description: `Changed appointment status from "${row.status}" to "${targetStatus}"`,
  });

  await invalidateAppointmentListCaches({
    patientUserId: row.patientUserId,
    doctorUserId: row.doctorUserId,
    clinicId: row.clinicId,
  });
  if (
    ((targetStatus === 'cancelled' || targetStatus === 'no_show') || targetStatus === 'completed') &&
    row.queueToken
  ) {
    // The queueToken for this appointment may have just been deleted (cancelled/no_show) or
    // updated to 'completed' above — bust the live queue-list caches so a cancelled patient
    // disappears, or a completed visit stops showing as active, from "who's waiting" immediately.
    await queueService.invalidateQueueListCaches({ doctorUserId: row.doctorUserId, clinicId: row.clinicId });
  }

  // Real-time in-app alert on cancellation — notify whichever side did NOT initiate it, so the
  // other party actually finds out (a patient cancelling shouldn't leave the doctor discovering
  // it by re-checking their queue; a doctor/receptionist/admin cancelling on the patient's behalf
  // shouldn't leave the patient in the dark either). Token number comes from `row` (the
  // pre-transition snapshot fetched above), still accurate since a cancellation never renumbers
  // other tokens.
  if (targetStatus === 'cancelled') {
    if (actor.role === 'patient') {
      await notificationsService.notifySystemEventSafe(row.doctorUserId, {
        title: 'Appointment cancelled',
        body: `The patient cancelled their appointment on ${formatDateOnly(row.appointmentDate)} (token #${row.tokenNumber}).`,
        type: 'appointment',
      });
    } else {
      await notificationsService.notifySystemEventSafe(row.patientUserId, {
        title: 'Appointment cancelled',
        body: `Your appointment on ${formatDateOnly(row.appointmentDate)} (token #${row.tokenNumber}) has been cancelled by the clinic. Please contact the clinic for details.`,
        type: 'appointment',
      });
    }
  }

  return getAppointmentById(id, actor);
}

module.exports = {
  enqueueBooking,
  getBookingStatus,
  runBookingJob,
  listAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  invalidateAppointmentListCaches,
};
