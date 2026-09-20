/**
 * Business logic for the queue module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules
 * (strictly-sequential status transitions, the queue->appointment completion cascade,
 * per-doctor-per-day "patients ahead"/ETA computation), and all Prisma/DB calls for this module
 * live. Controllers call these functions; these functions never touch req/res directly.
 *
 * Scoping (matches queue.routes.js's own header comment — doctor/receptionist only, no admin
 * override, kept deliberately faithful to what's already documented rather than broadened):
 *  - doctor   -> only queue tokens where queueToken.doctorUserId === actor.id
 *  - receptionist -> only queue tokens where queueToken.clinicId === receptionistProfile.clinicId
 * A mismatch (wrong doctor, wrong clinic, or a receptionist with no clinic assignment) always
 * resolves to 404 QUEUE_TOKEN_NOT_FOUND / an empty list — never 403 — matching the
 * "don't confirm existence to a non-owner" posture used throughout this codebase (see
 * appointments.service.js, familyMembers.service.js, receptionists.service.js).
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const notificationsService = require('../notifications/notifications.service');
const { formatDateOnly, todayUTCDateOnly } = require('../../utils/dateOnly');
const logger = require('../../config/logger');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

// Deliberately shorter than the 30-60s used for most other cached lists (see cacheService.js
// header + phase README "Caching" section): this view drives a live in-person queue-calling
// workflow, where "who's next" being tens of seconds stale is a real operational problem, not
// just a UX nit.
const LIST_CACHE_TTL_SECONDS = 10;

function buildListCacheKey({ date, status, page, pageSize }, actor, scopeId) {
  const scope = actor.role === 'doctor' ? `doctor:${actor.id}` : `receptionist:${scopeId || 'none'}`;
  return `cache:queue:list:${scope}:${date || ''}:${status || ''}:${page || ''}:${pageSize || ''}`;
}

/**
 * Busts every cached listQueue page that could be affected by a change to one doctor's queue on
 * one date, for both the doctor's own view and the clinic's (receptionist) view. Exported for
 * cross-module use — appointments.service.js#runBookingJob calls this after adding a new queue
 * token via a walk-in/online booking.
 * @param {{doctorUserId:string, clinicId:string, queueDate:Date|string}} params
 */
async function invalidateQueueListCaches({ doctorUserId, clinicId }) {
  const patterns = [];
  if (doctorUserId) patterns.push(`cache:queue:list:doctor:${doctorUserId}:*`);
  if (clinicId) patterns.push(`cache:queue:list:receptionist:${clinicId}:*`);
  await Promise.all(patterns.map((p) => cacheService.invalidate(p)));
}

// Strictly sequential, forward-only vocabulary. 'waiting' is the create-time default only — it
// never appears as a client-requested target status (enforced again in queue.validation.js).
const QUEUE_ORDER = ['waiting', 'called', 'in_consultation', 'completed'];
const TERMINAL_APPOINTMENT_STATUSES = ['completed', 'cancelled', 'no_show'];

// Existing heuristic being deliberately replicated (not "fixed") per the phase plan — the
// grounding reports frame swapping this for doctor_clinic_hours.slotMinutes as a
// possible-but-undone improvement, not a required fix.
const MINUTES_PER_WAITING_PATIENT = 9;

// Interim safety net, NOT the real fix. listQueue fetches the full (doctor/clinic, date) queue
// unbounded and does a JS forward pass to compute patientsAhead, because that count genuinely
// needs the whole ordered queue, not just one page of it — see the findMany call below. An
// unbounded findMany on a query with no LIMIT is still an unbounded-memory/unbounded-latency
// risk if a single day's queue ever grows pathologically large (a stuck integration retry-
// looping walk-in inserts, a data-entry bug, etc.), so cap it defensively.
//
// LOAD-REVIEW FIX (audit finding: "queue list capped at 500, not real pagination" — a busy
// multi-doctor clinic/camp genuinely can cross the old 500 cap in one day, at which point
// patientsAhead silently became wrong for every token past the cutoff with nothing but a log
// line to show for it). Raised to 2000 (4x the original "far beyond any single doctor's real
// day" estimate, now sized for a multi-doctor CLINIC's combined daily total, which is what this
// query actually scopes to for a receptionist — see the `where` clause below) as a stronger
// safety margin, and — more importantly than the number itself — listQueue's return value now
// carries an explicit `truncated: true` flag whenever the cap IS hit, instead of only a log
// line. Callers (queue.controller.js and, eventually, a frontend banner) can act on that
// signal directly rather than silently trusting numbers that may be wrong. The real fix is
// still a windowed SQL query — patientsAhead computed via
// COUNT(*) OVER (PARTITION BY doctor_user_id ORDER BY token_number) directly in Postgres, so
// pagination and the running count both happen in the database instead of in application
// memory — left as a documented follow-up, not attempted here (a live-queue correctness rewrite
// this central deserves real end-to-end testing against a real database before shipping, which
// isn't available in this environment).
const MAX_QUEUE_FETCH = 2000;

const QUEUE_SELECT = {
  id: true,
  appointmentId: true,
  doctorUserId: true,
  clinicId: true,
  tokenNumber: true,
  status: true,
  queueDate: true,
  appointment: {
    select: {
      id: true,
      status: true,
      source: true,
      // Full row fetched (phone + clinical profile) — masked down per-role in
      // shapeQueuePatientRef below, mirroring appointments.service.js#shapePatientRef.
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
    },
  },
};

function shapeQueueToken(row) {
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    tokenNumber: row.tokenNumber,
    status: row.status,
    queueDate: formatDateOnly(row.queueDate),
  };
}

/**
 * Same role-scoped philosophy as appointments.service.js#shapePatientRef: the doctor about to
 * see this patient gets the clinically-relevant fields (DOB/gender/blood group/medical
 * history/emergency contact) alongside phone; the receptionist calling patients in for their
 * token gets name + phone only, never clinical data (queue.routes.js only ever admits
 * doctor/receptionist, so those are the only two roles this ever needs to handle).
 * @param {object|null} patientRow
 * @param {string} role
 */
function shapeQueuePatientRef(patientRow, role) {
  if (!patientRow) return null;
  const base = { id: patientRow.id, name: patientRow.name };
  if (role === 'doctor') {
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
  // receptionist
  return { ...base, phone: patientRow.phone };
}

function shapeQueueListRow(row, patientsAhead, estimatedWaitMinutes, role) {
  const appt = row.appointment;
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    tokenNumber: row.tokenNumber,
    status: row.status,
    patientsAhead,
    estimatedWaitMinutes,
    patient: appt ? shapeQueuePatientRef(appt.patient, role) : null,
    source: appt ? appt.source : null,
  };
}

/**
 * GET /queue/mine/:appointmentId — patient-only "where do I stand in line right now" for ONE of
 * their own appointments. This module's main GET / above is deliberately staff-only (doctor/
 * receptionist — see this file's header comment); a patient has never had ANY way to fetch their
 * own live queue position. This is the literal fix for the "queue tracker" page
 * (client/src/pages/PortalSectionPages.jsx#QueueTracker, mounted at /patient/queue) and every
 * other patient-facing LiveQueueWidget usage (PatientPages.jsx dashboard, PublicPages.jsx's
 * homepage/doctor-detail widgets) — all of them only ever read `data.queueTokens`, which is
 * populated by fetchQueue() (GET /queue), a call the frontend never even makes for a patient
 * (and would get a 403 if it did) — so every one of those widgets rendered its "no active queue"
 * placeholder for every patient, always, regardless of their real queue state.
 * @param {string} appointmentId
 * @param {{id:string, role:string}} requester - always 'patient' (route-enforced).
 */
async function getMyQueueStatus(appointmentId, requester) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, patientUserId: true },
  });
  // 404, not 403 — same enumeration-avoidance posture used throughout this codebase (see
  // appointments.service.js#getVisibleAppointmentOrThrow and this module's own
  // getVisibleQueueTokenOrThrow just below).
  if (!appointment || appointment.patientUserId !== requester.id) {
    throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  }

  const token = await prisma.queueToken.findUnique({
    where: { appointmentId },
    select: { tokenNumber: true, status: true, queueDate: true, doctorUserId: true },
  });

  if (!token) {
    // Either this appointment never reached the queue (pending_payment/on_hold — payment still
    // outstanding) or it was cancelled/no_show before ever being called — either way, nothing to
    // show yet. Not an error: the frontend's "no active queue" placeholder is the right response.
    return { token: null, status: null, nowServing: null, patientsAhead: null, estimatedWaitMinutes: null };
  }

  // Same (doctor, day) scope listQueue uses for its own patientsAhead/nowServing computation,
  // ordered by tokenNumber. `on_hold` tokens are excluded, same reasoning as listQueue: a patient
  // still waiting on their own payment has nothing "ahead" of them in a queue they haven't
  // actually joined yet.
  const dayTokens = await prisma.queueToken.findMany({
    where: { doctorUserId: token.doctorUserId, queueDate: token.queueDate, status: { not: 'on_hold' } },
    select: { tokenNumber: true, status: true },
    orderBy: { tokenNumber: 'asc' },
  });

  const patientsAhead =
    token.status === 'waiting'
      ? dayTokens.filter((t) => t.status === 'waiting' && t.tokenNumber < token.tokenNumber).length
      : 0;
  const nowServingRow = dayTokens.find((t) => t.status === 'called' || t.status === 'in_consultation');

  return {
    token: token.tokenNumber,
    status: token.status,
    nowServing: nowServingRow ? nowServingRow.tokenNumber : null,
    patientsAhead,
    estimatedWaitMinutes: patientsAhead * MINUTES_PER_WAITING_PATIENT,
  };
}

/**
 * Fetches a queue token and enforces the scoping rule described in this file's header comment.
 * 404s (never 403) on any mismatch — same enumeration-avoidance posture used throughout.
 * @param {string} id
 * @param {{id:string, role:string}} actor
 */
async function getVisibleQueueTokenOrThrow(id, actor) {
  const row = await prisma.queueToken.findUnique({ where: { id }, select: QUEUE_SELECT });
  if (!row) {
    throw new ApiError(404, 'QUEUE_TOKEN_NOT_FOUND', 'Queue token not found.');
  }

  if (actor.role === 'doctor' && row.doctorUserId === actor.id) return row;

  if (actor.role === 'receptionist') {
    const rp = await prisma.receptionistProfile.findUnique({
      where: { userId: actor.id },
      select: { clinicId: true },
    });
    if (rp && rp.clinicId && rp.clinicId === row.clinicId) return row;
  }

  throw new ApiError(404, 'QUEUE_TOKEN_NOT_FOUND', 'Queue token not found.');
}

/**
 * GET /queue — recommended addition beyond the literal "PATCH only" instruction in the original
 * skeleton (flagged in the phase plan): a PATCH-only queue module isn't operable, since staff
 * need to see who's waiting before they can call/complete a token. Same scoping rules as the
 * PATCH endpoint.
 *
 * `patientsAhead`/`estimatedWaitMinutes` are computed-on-read, never stored, and are always
 * computed against the TRUE waiting queue for each token's own (doctor, date) group — regardless
 * of any `status` filter applied to the returned page — so an ETA never silently changes meaning
 * just because the caller happened to filter the list down to one status.
 * @param {{date?:string, status?:string, page?:number, pageSize?:number}} query
 * @param {{id:string, role:string}} actor
 */
async function listQueue({ date, status, page, pageSize }, actor) {
  let receptionistClinicId = null;
  if (actor.role === 'receptionist') {
    const rp = await prisma.receptionistProfile.findUnique({
      where: { userId: actor.id },
      select: { clinicId: true },
    });
    receptionistClinicId = rp ? rp.clinicId : null;
  } else if (actor.role !== 'doctor') {
    // Unreachable in practice — authorize('doctor','receptionist') on the route already blocks
    // every other role — kept as defensive-in-depth, matching the pattern used elsewhere.
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view the queue.');
  }

  const cacheKey = buildListCacheKey({ date, status, page, pageSize }, actor, receptionistClinicId);

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const queueDate = date ? new Date(`${date}T00:00:00.000Z`) : todayUTCDateOnly();
    // `on_hold` tokens (an online booking still awaiting mandatory payment — see
    // appointments.service.js#runBookingJob) are deliberately never shown to staff here: the
    // patient hasn't secured their spot yet, so there's nothing for a doctor/receptionist to call
    // or act on. They flip to 'waiting' (and start appearing) the moment payment is recorded — see
    // payments.service.js#createPaymentForAppointment. QUEUE_ORDER above already excludes
    // 'on_hold' so updateQueueStatus can never manually transition one either.
    const where = { queueDate, status: { not: 'on_hold' } };

    if (actor.role === 'doctor') {
      where.doctorUserId = actor.id;
    } else {
      if (!receptionistClinicId) {
        return { rows: [], pagination: buildPaginationMeta({ page: p, pageSize: ps, total: 0 }), truncated: false };
      }
      where.clinicId = receptionistClinicId;
    }

    // Fetch the FULL scoped set for this date (unfiltered by `status`) so patientsAhead/
    // estimatedWaitMinutes are always computed against the true waiting queue, not a
    // status-filtered subset. Grouped by doctor (a receptionist's clinic can have several doctors'
    // queues running the same day) and sorted by tokenNumber ascending within each group so a
    // single forward pass can accumulate each doctor's running "waiting" count.
    //
    // `take: MAX_QUEUE_FETCH` is a defensive cap, not the real fix — see that constant's comment.
    // With the cap in place, a day whose true row count exceeds MAX_QUEUE_FETCH silently gets a
    // truncated `allRows`, and patientsAhead for rows near/after the truncation point is now
    // understated (rows beyond the cap simply never entered the running count below). We can't
    // fix that here without the full windowed-SQL rewrite, so at minimum log it.
    const allRows = await prisma.queueToken.findMany({
      where,
      select: QUEUE_SELECT,
      orderBy: [{ doctorUserId: 'asc' }, { tokenNumber: 'asc' }],
      take: MAX_QUEUE_FETCH,
    });

    const truncated = allRows.length === MAX_QUEUE_FETCH;
    if (truncated) {
      logger.warn('queue.listQueue: row count hit MAX_QUEUE_FETCH cap; patientsAhead may be inaccurate', {
        queueDate: queueDate.toISOString().slice(0, 10),
        doctorUserId: where.doctorUserId,
        clinicId: where.clinicId,
        maxQueueFetch: MAX_QUEUE_FETCH,
      });
    }

    const runningWaitingCount = {};
    const computed = allRows.map((row) => {
      const key = row.doctorUserId;
      const patientsAhead = runningWaitingCount[key] || 0;
      if (row.status === 'waiting') {
        runningWaitingCount[key] = patientsAhead + 1;
      }
      return { row, patientsAhead, estimatedWaitMinutes: patientsAhead * MINUTES_PER_WAITING_PATIENT };
    });

    const filtered = status ? computed.filter((c) => c.row.status === status) : computed;
    const total = filtered.length;
    const pageSlice = filtered.slice(skip, skip + take);

    return {
      rows: pageSlice.map(({ row, patientsAhead, estimatedWaitMinutes }) =>
        shapeQueueListRow(row, patientsAhead, estimatedWaitMinutes, actor.role)
      ),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
      // LOAD-REVIEW FIX — see MAX_QUEUE_FETCH's comment above. true only when this date's true row
      // count hit the defensive cap, meaning patientsAhead/estimatedWaitMinutes for tokens near/
      // after the cutoff may be understated. Callers (queue.controller.js and, eventually, a
      // frontend banner) can surface this directly instead of trusting numbers silently.
      truncated,
    };
  });
}

/**
 * PATCH /queue/:id/status — strictly sequential, forward-only transition
 * (waiting -> called -> in_consultation -> completed). `nextIndex` must equal
 * `currentIndex + 1` exactly: no skipping ahead, no going backward.
 *
 * Cascade: transitioning to 'completed' also sets the linked appointment's status to
 * 'completed' in the same transaction, unless the appointment is already terminal (defensive
 * no-op — shouldn't normally happen, since an appointment whose queue token is still
 * waiting/called/in_consultation should never already be finalized). This is the literal fix for
 * the old app's "queue kept in sync only by a manual sweep" gap.
 * @param {string} id
 * @param {'called'|'in_consultation'|'completed'} targetStatus
 * @param {{id:string, role:string}} actor
 */
async function updateQueueStatus(id, targetStatus, actor) {
  const row = await getVisibleQueueTokenOrThrow(id, actor);

  const currentIndex = QUEUE_ORDER.indexOf(row.status);
  const targetIndex = QUEUE_ORDER.indexOf(targetStatus);
  if (currentIndex === -1 || targetIndex !== currentIndex + 1) {
    throw new ApiError(
      409,
      'QUEUE_INVALID_TRANSITION',
      `Cannot transition queue token from "${row.status}" to "${targetStatus}".`
    );
  }

  // BUG FIX (user report: "koi patient aaj book kiya 2 din bad ka doctor chah kar v aaj complete
  // nahi kar sakta" / "kahi se v conform na ho jab tak same date na ho") — a token for a future
  // date has no OWN transition guard against being walked all the way to 'completed' today; this
  // is a genuinely separate code path from appointments.service.js#updateAppointmentStatus (the
  // Queue Monitor's own Complete button, called -> in_consultation -> completed), which got the
  // matching fix there — so it needed its own copy of the same check. `queueDate` (not the linked
  // appointment's date, though they're always equal) is what this table already carries.
  if (targetStatus === 'completed') {
    const queueDateUTC = new Date(`${formatDateOnly(row.queueDate)}T00:00:00.000Z`);
    if (queueDateUTC.getTime() > todayUTCDateOnly().getTime()) {
      throw new ApiError(
        400,
        'APPOINTMENT_NOT_YET_DUE',
        `This token is for ${formatDateOnly(row.queueDate)} and cannot be marked completed before that date.`
      );
    }
  }

  const appointmentStatus = row.appointment ? row.appointment.status : null;
  const shouldCascadeComplete =
    targetStatus === 'completed' &&
    !!appointmentStatus &&
    !TERMINAL_APPOINTMENT_STATUSES.includes(appointmentStatus);

  await prisma.$transaction(async (tx) => {
    await tx.queueToken.update({ where: { id }, data: { status: targetStatus } });

    if (shouldCascadeComplete) {
      await tx.appointment.update({ where: { id: row.appointmentId }, data: { status: 'completed' } });
    }
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'queue.status_update',
    targetEntityType: 'queue_token',
    targetEntityId: id,
    description:
      `Changed queue token status from "${row.status}" to "${targetStatus}"` +
      (shouldCascadeComplete ? ' (appointment marked completed)' : ''),
  });

  // Rule 11: "change appointment status" is independently a mutating action that requires its
  // own audit-trail entry, regardless of what triggered it. Without this, an admin filtering the
  // activity log by targetEntityType='appointment' would miss this status change entirely — the
  // only record of it would be buried in a queue_token-targeted log entry's description text.
  // This mirrors the exact actionType/description shape appointments.service.js#updateAppointmentStatus
  // uses for every other appointment status change, so the log reads consistently regardless of
  // which code path caused the transition.
  if (shouldCascadeComplete) {
    await activityLogService.log({
      actorUserId: actor.id,
      actorRole: actor.role,
      actionType: 'appointment.status_update',
      targetEntityType: 'appointment',
      targetEntityId: row.appointmentId,
      description: `Changed appointment status from "${appointmentStatus}" to "completed" (via queue token completion)`,
    });
  }

  const updated = await prisma.queueToken.findUnique({ where: { id }, select: QUEUE_SELECT });

  await invalidateQueueListCaches({ doctorUserId: row.doctorUserId, clinicId: row.clinicId });

  if (shouldCascadeComplete) {
    // The cascade above just mutated the linked appointment's status — bust its cached list
    // pages too, the same way appointments.service.js#updateAppointmentStatus does for every
    // other appointment status change, so a receptionist/doctor/patient/admin's cached
    // GET /appointments list doesn't keep showing the pre-completion status for up to
    // LIST_CACHE_TTL_SECONDS. Lazy require: appointments.service.js requires this module at load
    // time (to call invalidateQueueListCaches), so a top-level require here would be a true cycle.
    const appointmentsService = require('../appointments/appointments.service');
    await appointmentsService.invalidateAppointmentListCaches({
      patientUserId: row.appointment && row.appointment.patient ? row.appointment.patient.id : undefined,
      doctorUserId: row.doctorUserId,
      clinicId: row.clinicId,
    });
  }

  // Real-time "your turn" alert — the one queue transition a waiting patient actually needs to
  // be pushed, since they're not expected to keep the live queue screen open and refreshing.
  // `row.appointment.patient.id` (not `row.appointmentId`) is the patient's USER id — the field
  // notifySystemEventSafe needs as its recipient.
  if (targetStatus === 'called' && row.appointment && row.appointment.patient) {
    await notificationsService.notifySystemEventSafe(row.appointment.patient.id, {
      title: 'Your turn — token called',
      body: `Your token #${row.tokenNumber} has been called. Please proceed to the doctor's room.`,
      type: 'queue',
    });
  }

  return shapeQueueToken(updated);
}

module.exports = {
  listQueue,
  updateQueueStatus,
  getMyQueueStatus,
  invalidateQueueListCaches,
  // Exported so tests can build exactly MAX_QUEUE_FETCH rows to hit the cap, instead of a
  // hardcoded row count that silently drifts out of sync with the real constant.
  MAX_QUEUE_FETCH,
};
