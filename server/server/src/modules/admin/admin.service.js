/**
 * Business logic for the admin module.
 * Responsibility: all Prisma calls for the structured activity log, the system_settings and
 * booking_rules singleton config rows, the real dashboard-stats aggregate, and the
 * revenue-trend chart aggregate. Controllers call these functions; these functions never touch
 * req/res directly.
 *
 * Scope strictly limited to what this phase asks (activity log, system_settings, booking_rules,
 * dashboard-stats, revenue-trend) even though admin.routes.js's original header comment gestures
 * at clinic/doctor approval queues and a full revenue-reporting suite too — those already live in
 * the clinics/doctors/payments modules from earlier phases (or are explicitly deferred, e.g. CSV
 * export / per-doctor revenue breakdowns) and are out of scope here. revenue-trend below is one
 * bounded chart-data endpoint, not that suite.
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const notificationsService = require('../notifications/notifications.service');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { todayUTCDateOnly } = require('../../utils/dateOnly');

const ACTIVITY_LOG_CACHE_TTL_SECONDS = 30;
const DASHBOARD_STATS_CACHE_TTL_SECONDS = 30;
const REVENUE_TREND_CACHE_TTL_SECONDS = 30;
const DEFAULT_REVENUE_TREND_MONTHS = 6;
const MAX_REVENUE_TREND_MONTHS = 24;

// ── Activity log ─────────────────────────────────────────────────────────

/**
 * The structured replacement for the current app's one-pre-formatted-string log
 * (FRONTEND_SCREENS_REPORT.md flags "Entity" mislabeling actor role and "Entity id" duplicating
 * the row id) — response rows expose targetEntityType/targetEntityId distinctly from id, plus
 * the real actor.
 * @param {{actorUserId?:string, actionType?:string, page?:number, pageSize?:number}} query
 */
async function getActivityLog({ actorUserId, actionType, page, pageSize }) {
  // Admin/superadmin-only endpoint, output identical for every admin viewing the same filters
  // (role-invariant) -> key by query params only. No invalidation wiring: this is fed by
  // activityLogService.log() calls scattered across nearly every mutating action in the app —
  // wiring precise invalidation for all of them isn't worth it for a log viewer; TTL-only,
  // documented here and in the README "Caching" section (same reasoning as getDashboardStats).
  const cacheKey = `cache:admin:activity-log:${actorUserId || ''}:${actionType || ''}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, ACTIVITY_LOG_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {};
    if (actorUserId) where.actorUserId = actorUserId;
    if (actionType) where.actionType = actionType;

    const [rows, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        select: {
          id: true,
          actorUserId: true,
          actorRole: true,
          ipAddress: true,
          actionType: true,
          targetEntityType: true,
          targetEntityId: true,
          description: true,
          createdAt: true,
          actor: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.activityLog.count({ where }),
    ]);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        actor: row.actor
          ? { id: row.actor.id, name: row.actor.name, email: row.actor.email }
          : row.actorUserId
          ? { id: row.actorUserId, name: null, email: null }
          : null,
        actorRole: row.actorRole,
        ipAddress: row.ipAddress,
        actionType: row.actionType,
        targetEntityType: row.targetEntityType,
        targetEntityId: row.targetEntityId,
        description: row.description,
        createdAt: row.createdAt,
      })),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

// ── system_settings singleton ───────────────────────────────────────────

async function getSystemSettings() {
  const row = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  if (!row) {
    throw new ApiError(500, 'SYSTEM_SETTINGS_NOT_CONFIGURED', 'System settings are not configured.');
  }
  return row;
}

/**
 * Full-replace upsert of the singleton system_settings row. ALWAYS targets id:1.
 * @param {object} body - already shape-validated by admin.validation.js#updateSystemSettings.
 * @param {{id:string, role:string}} actor
 */
async function updateSystemSettings(body, actor) {
  // `bookingFee` deliberately excluded from this write (product decision: keep only
  // "Platform charges" — platformCharges.service.js — as the pricing-config surface for
  // admin/superadmin). Not included in `data` at all (rather than set to 0) so an existing
  // stored value is left untouched by this upsert; the column itself stays in the schema
  // unmigrated, matching the "manual, hand-written" convention used elsewhere in this codebase
  // for changes made without live DB access.
  const data = {
    platformName: String(body.platformName).trim(),
    supportEmail: body.supportEmail ? String(body.supportEmail).trim() : null,
    supportPhone: body.supportPhone ? String(body.supportPhone).trim() : null,
    maintenanceMode: body.maintenanceMode === true,
  };

  const row = await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'systemSettings.update',
    targetEntityType: 'systemSettings',
    targetEntityId: '1',
    description: 'Updated system settings configuration',
  });

  return row;
}

// ── booking_rules singleton ─────────────────────────────────────────────

async function getBookingRules() {
  const row = await prisma.bookingRules.findUnique({ where: { id: 1 } });
  if (!row) {
    throw new ApiError(500, 'BOOKING_RULES_NOT_CONFIGURED', 'Booking rules are not configured.');
  }
  return row;
}

/**
 * Full-replace upsert of the singleton booking_rules row. ALWAYS targets id:1. Note for
 * implementers: appointments.service.js#updateAppointmentStatus already reads this table
 * directly via Prisma for the cancellation-window check — this endpoint only adds the admin
 * read/write surface, no change needed there.
 * @param {object} body - already shape-validated by admin.validation.js#updateBookingRules.
 * @param {{id:string, role:string}} actor
 */
async function updateBookingRules(body, actor) {
  const data = {
    cancellationWindowHours: body.cancellationWindowHours,
    maxBookingsPerPatient: body.maxBookingsPerPatient,
    defaultSlotMinutes: body.defaultSlotMinutes,
    // Full-replace, like every other field here — a client that omits these keys entirely
    // clears them to null (window off / no advance-days cap), matching this endpoint's existing
    // "every field is required/present on every call" convention (see this file's header
    // comment). null is a legitimate, common value for these two: "no restriction".
    onlineBookingWindowStart: body.onlineBookingWindowStart ?? null,
    onlineBookingWindowEnd: body.onlineBookingWindowEnd ?? null,
    onlineBookingMaxAdvanceDays: body.onlineBookingMaxAdvanceDays ?? null,
  };

  const row = await prisma.bookingRules.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'bookingRules.update',
    targetEntityType: 'bookingRules',
    targetEntityId: '1',
    description: 'Updated booking rules configuration',
  });

  return row;
}

// ── dashboard-stats ─────────────────────────────────────────────────────

/**
 * The literal bug-fix endpoint — real numbers, not the frontend's mislabeled stand-ins
 * (FRONTEND_SCREENS_REPORT.md: "Verified doctors" was actually ALL doctors; "Monthly revenue"
 * was actually the sum of ALL payments ever; today's-bookings used a literal `date === 'Today'`
 * sentinel string). Read-only aggregate — no activityLogService call.
 */
async function getDashboardStats() {
  // Role-invariant (admin and superadmin see the same numbers), no query params -> one fixed
  // key. No invalidation wiring, same reasoning as getActivityLog above: this aggregates across
  // appointments/payments/users touched by dozens of write paths across the whole app —
  // TTL-only, documented in the README "Caching" section.
  return cacheService.getOrSet('cache:admin:dashboard-stats', DASHBOARD_STATS_CACHE_TTL_SECONDS, async () => {
    const todayUTC = todayUTCDateOnly();
    const firstOfMonthUTC = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), 1));
    const firstOfNextMonthUTC = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() + 1, 1));

    const [verifiedDoctorsCount, registeredPatientsCount, todaysBookingsCount, revenueAgg] = await Promise.all([
      prisma.doctorProfile.count({ where: { status: 'verified' } }),
      prisma.user.count({ where: { role: 'patient' } }),
      // 'pending_payment' appointments are excluded too — they're not yet real confirmed
      // bookings (no token issued, may never be paid at all) and would otherwise inflate this
      // stat with bookings still waiting on mandatory online payment.
      prisma.appointment.count({ where: { appointmentDate: todayUTC, status: { notIn: ['cancelled', 'pending_payment'] } } }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'paid', createdAt: { gte: firstOfMonthUTC, lt: firstOfNextMonthUTC } },
      }),
    ]);

    return {
      verifiedDoctorsCount,
      registeredPatientsCount,
      todaysBookingsCount,
      monthlyRevenue: revenueAgg._sum.amount || 0,
    };
  });
}

// ── revenue-trend ────────────────────────────────────────────────────────

/**
 * Monthly revenue + paid-appointment-count series for the admin dashboard's revenue chart,
 * covering the last `months` calendar months (oldest first, current in-progress month last).
 * Read-only aggregate — no activityLogService call, same as getDashboardStats.
 * @param {number|undefined} months - already range-validated by admin.validation.js#getRevenueTrend
 *   (isInt({min:1,max:24})) when present; undefined when the caller omitted the query param.
 */
async function getRevenueTrend(months) {
  // Defensive re-clamp: `months` becomes part of a raw-SQL date-range calculation below, not
  // just a Prisma query-builder arg, so this function re-derives a safe integer itself rather
  // than fully trusting the validator ran (same belt-and-suspenders spirit as elsewhere in this
  // module, e.g. updateBookingRules's own bounds mirroring the validation.js bounds).
  const requestedMonths = Number.isInteger(months) && months >= 1 ? Math.min(months, MAX_REVENUE_TREND_MONTHS) : DEFAULT_REVENUE_TREND_MONTHS;

  // Role-invariant like getDashboardStats, but the output shape depends on `months` -> the cache
  // key must include it (cacheService.js rule #3: cache-key scoping must match response scoping).
  const cacheKey = `cache:admin:revenue-trend:${requestedMonths}`;

  return cacheService.getOrSet(cacheKey, REVENUE_TREND_CACHE_TTL_SECONDS, async () => {
    const todayUTC = todayUTCDateOnly();
    // Window: the 1st of the month (requestedMonths - 1) months back, through the 1st of NEXT
    // month (exclusive), so the series always includes the current, still-in-progress month.
    const startUTC = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() - (requestedMonths - 1), 1));
    const endUTC = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() + 1, 1));

    // Prisma's groupBy can only group by literal column values, not a truncated/derived
    // expression, so there's no way to ask it for "group payments by calendar month" directly.
    // Two ways around that: (a) fetch every matching payment row and bucket them by hand in JS,
    // or (b) push the bucketing into Postgres with date_trunc. Chose (b): a 24-month admin
    // revenue window can plausibly span thousands of payment rows on a platform this size, and
    // date_trunc + GROUP BY is a single indexed range scan on payments.created_at that returns
    // at most 24 rows — cheaper, and no less safe, than dragging all of them into Node first.
    // Parameterized the same way as the other raw queries in this codebase (tagged-template
    // $queryRaw — see appointments.service.js's token-numbering MAX() query and
    // payments.service.js's `FOR UPDATE` row lock): every interpolated value below becomes a
    // bound query parameter, never string-concatenated into the SQL text, so this stays safe
    // even though `months` ultimately traces back to caller-controlled query-string input.
    const rows = await prisma.$queryRaw`
      SELECT
        date_trunc('month', created_at) AS month,
        COALESCE(SUM(amount), 0) AS revenue,
        COUNT(DISTINCT appointment_id) AS appointment_count
      FROM payments
      WHERE status = ${'paid'}::"PaymentStatus"
        AND created_at >= ${startUTC}
        AND created_at < ${endUTC}
      GROUP BY date_trunc('month', created_at)
      ORDER BY date_trunc('month', created_at)
    `;
    // COUNT(DISTINCT appointment_id), NOT COUNT(*) — since the payment-before-token feature, one
    // appointment can legitimately have TWO 'paid' payment rows (the patient's online minimum
    // advance, then the remaining balance collected at the clinic — see
    // payments.service.js#createPaymentForAppointment's partial-payment handling), so "one paid
    // payment row <-> one paid appointment" no longer holds. COUNT(DISTINCT appointment_id) stays
    // correct regardless of how many payment rows an appointment has, and Postgres's DISTINCT
    // COUNT already ignores NULLs, so standalone (non-appointment) payments are correctly
    // excluded from this appointment-count metric just like before.

    // Postgres returns COUNT(*) as bigint and SUM(numeric) as numeric; Prisma's raw-query
    // deserialization surfaces those as a BigInt and a Decimal-like value respectively — neither
    // is valid input to JSON.stringify (BigInt throws; Decimal would round-trip as a string, not
    // the `revenue: number` shape this endpoint promises). Unlike getDashboardStats, this value
    // is JSON.stringify'd directly by cacheService.getOrSet (see cacheService.js's own doc
    // comment on why that's normally safe) before it ever reaches res.json()'s Decimal->string
    // conversion, so both fields MUST already be plain JS numbers by the time they're returned
    // here, not left for the response layer to coerce.
    const byMonthKey = new Map();
    for (const row of rows) {
      const monthKey = row.month.toISOString().slice(0, 7); // "YYYY-MM"
      byMonthKey.set(monthKey, { revenue: Number(row.revenue), appointmentCount: Number(row.appointment_count) });
    }

    // date_trunc/GROUP BY only produces a row for months that actually had a paid payment —
    // fill every month in the requested window (including zero-revenue ones) so the chart
    // always gets a complete, gap-free series instead of silently skipping quiet months.
    const trend = [];
    for (let i = 0; i < requestedMonths; i += 1) {
      const monthDate = new Date(Date.UTC(startUTC.getUTCFullYear(), startUTC.getUTCMonth() + i, 1));
      const monthKey = monthDate.toISOString().slice(0, 7);
      const bucket = byMonthKey.get(monthKey);
      trend.push({
        month: monthKey,
        revenue: bucket ? bucket.revenue : 0,
        appointmentCount: bucket ? bucket.appointmentCount : 0,
      });
    }

    return trend;
  });
}

// ── patients directory ──────────────────────────────────────────────────

const PATIENTS_LIST_CACHE_TTL_SECONDS = 30;

/**
 * Full registered-patient directory (id, contact info, registration date) — the admin-facing
 * equivalent of doctors.service.js#listDoctors, which previously had no counterpart: the only
 * patient view the frontend had was a best-effort list DERIVED from patients seen in already-
 * loaded appointments/payments (see client's ManagePatients comment, plan §6.7), which silently
 * missed any patient who registered but never booked or paid — so "how many patients have
 * registered" was never actually answerable from the UI. This queries the real source of truth
 * (every User row with role='patient') directly.
 * @param {{search?: string, page?: number, pageSize?: number}} params
 */
async function listPatients({ search, page, pageSize }) {
  // Short TTL, no invalidation wiring (same reasoning as getActivityLog/getDashboardStats above):
  // a new patient becomes visible here within PATIENTS_LIST_CACHE_TTL_SECONDS of registering,
  // which is fine for an admin headcount/lookup view — not worth wiring precise invalidation into
  // auth.service.js#register for this one read endpoint.
  const cacheKey = `cache:admin:patients:${search || ''}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, PATIENTS_LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {
      role: 'patient',
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          status: true,
          createdAt: true,
          // Stable "DCP<N>" display number (see prisma/migrations/
          // 20260919130000_add_patient_doctor_clinic_numbers) — never derived from list position,
          // unlike the pre-existing sequenceId() index-based numbering it replaces on this table.
          patientNumber: true,
          patientProfile: { select: { gender: true, dateOfBirth: true, bloodGroup: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        city: row.city,
        status: row.status,
        registeredAt: row.createdAt,
        patientNumber: row.patientNumber ?? null,
        gender: row.patientProfile?.gender ?? null,
        dateOfBirth: row.patientProfile?.dateOfBirth ?? null,
        bloodGroup: row.patientProfile?.bloodGroup ?? null,
      })),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

/**
 * COMPLETENESS FIX (audit Priority 4): "No way to disable a doctor's or patient's login (only
 * their profile/verification status)". Patients have no verification-lifecycle field at all
 * (unlike doctors' doctor_profiles.status) and no dedicated module of their own — this directory
 * (listPatients above) is the natural admin-facing home for it. Writes users.status, same pattern
 * as doctors.service.js#updateDoctorAccountStatus / receptionists.service.js#updateReceptionistStatus.
 * @param {string} id
 * @param {'active'|'disabled'} status
 * @param {{id:string, role:string}} actor
 */
async function updatePatientStatus(id, status, actor) {
  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!existing || existing.role !== 'patient') {
    throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
  }

  await prisma.user.update({ where: { id }, data: { status } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'patient.account_status_update',
    targetEntityType: 'patient',
    targetEntityId: id,
    description: `Set patient account login status to "${status}"`,
  });

  await cacheService.invalidate('cache:admin:patients:*');

  // Same real-time-alert reasoning as the doctor account-status endpoint: a patient whose login
  // is disabled should not have to discover it only via a failed login attempt.
  await notificationsService.notifySystemEventSafe(id, {
    title: status === 'disabled' ? 'Account login disabled' : 'Account login re-enabled',
    body:
      status === 'disabled'
        ? 'Your account login has been disabled by an administrator. Contact platform support for details.'
        : 'Your account login has been re-enabled. You can sign in again.',
    type: 'account',
  });

  return { id, status };
}

module.exports = {
  getActivityLog,
  getSystemSettings,
  updateSystemSettings,
  getBookingRules,
  updateBookingRules,
  getDashboardStats,
  getRevenueTrend,
  listPatients,
  updatePatientStatus,
};
