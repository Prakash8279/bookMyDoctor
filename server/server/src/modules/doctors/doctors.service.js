/**
 * Business logic for the doctors module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules,
 * and all Prisma/DB calls for this module live. Controllers call these functions; these
 * functions never touch req/res directly.
 */
const bcrypt = require('bcrypt');
const prisma = require('../../config/db');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const notificationsService = require('../notifications/notifications.service');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { pickPresentFields } = require('../../utils/pickPresentFields');
const { ADMIN_ROLES } = require('../../utils/roles');
const idGenerators = require('../../utils/idGenerators');

// Public directory data — output is role-invariant (no masking), so list keys need only the
// query params. TTL 60s: staleness here is low-stakes (a doctor bio/rating going stale for a
// minute is not an operational problem, unlike booking/queue state).
const LIST_CACHE_TTL_SECONDS = 60;
const DETAIL_CACHE_TTL_SECONDS = 60;

/**
 * Invalidates every cached listDoctors page plus the given doctor's cached detail (both the
 * public and self/admin "detail" buckets — see getDoctorById). Exported for cross-module use:
 * clinics.service.js (clinic approval/assignment changes the embedded clinics[] array) and
 * reviews.service.js (moderation changes rating/reviewCount) also call this.
 * @param {string} [doctorId]
 */
async function invalidateDoctorCaches(doctorId) {
  const patterns = [`cache:doctors:list:*`];
  if (doctorId) patterns.push(`cache:doctors:detail:${doctorId}:*`);
  await Promise.all(patterns.map((p) => cacheService.invalidate(p)));
}

// onlineBooking/allowRebooking/maxDaysAdvance are all NOT NULL columns on doctor_profiles — an
// explicit `null` here must be rejected, not forwarded into a Prisma update. The validation
// layer (doctors.validation.js's patchDoctor) already rejects it too; this is the second,
// defense-in-depth layer. tokenNumberingMode/onlineTokenParity join this list for the same
// reason: both are NOT NULL columns with a default ('sequential'/'odd') — unlike
// maxOnlineBookingsPerDay/the window fields below, neither has a "cleared" state to be set to,
// so an explicit null is always a mistake.
const BOOKING_SETTINGS_NON_NULLABLE = ['onlineBooking', 'allowRebooking', 'maxDaysAdvance', 'tokenNumberingMode', 'onlineTokenParity'];
// maxOnlineBookingsPerDay and the two onlineBookingWindow fields are all nullable (NULL = no
// daily cap / no per-doctor window override) — a separate allowlist, not added to
// BOOKING_SETTINGS_NON_NULLABLE above, specifically so a caller CAN send them as null to remove
// a previously-set value without pickPresentFields rejecting the request.
const BOOKING_SETTINGS_FIELDS = [
  ...BOOKING_SETTINGS_NON_NULLABLE,
  'maxOnlineBookingsPerDay',
  'onlineBookingWindowStart',
  'onlineBookingWindowEnd',
];

const SORT_FIELD_MAP = { rating: 'rating', fee: 'consultationFee', experience: 'experienceYears' };

// Shared shape across list + detail, MINUS bio. registrationNumber IS included (public
// medical-credential transparency); email/phone are selected here too but only ever surfaced by
// shapeDoctor when includeContact is true (self or admin/superadmin) — see shapeDoctor below.
//
// `bio` is deliberately NOT in this base select: it's a free-text field only ever shown when
// includeDetail is true (getDoctorById — the single-doctor page), never by listDoctors (the
// public/admin directory search, this app's hottest read path, cached only 60s and paginated up
// to 100 rows/page). Previously every directory page fetched every row's bio just to discard it
// in shapeDoctor. DOCTOR_LIST_SELECT below reuses this base as-is; DOCTOR_DETAIL_SELECT adds bio
// back for the one caller that actually shows it.
const DOCTOR_PROFILE_BASE_SELECT = {
  status: true,
  qualification: true,
  registrationNumber: true,
  experienceYears: true,
  consultationFee: true,
  emergencyFee: true,
  languages: true,
  rating: true,
  reviewCount: true,
  emergencyAvailable: true,
  onlineBooking: true,
  allowRebooking: true,
  maxDaysAdvance: true,
  maxOnlineBookingsPerDay: true,
  // Public, same base level as consultationFee — the booking screen's "pay full or pay minimum"
  // choice buttons need this on every doctor row that can be booked, not just the single-doctor
  // detail page.
  minBookingAdvanceAmount: true,
  specialization: { select: { id: true, name: true, icon: true } },
  // Stable "DCD<N>" display number (see prisma/migrations/
  // 20260919130000_add_patient_doctor_clinic_numbers) — fetched here so both the public listDoctors
  // and the single-doctor detail query have it, but only ever SURFACED by shapeDoctor when
  // includeContact is true (admin doctor-management tables), same gate as verificationDocuments.
  doctorNumber: true,
};

// Pushed down into Prisma (rather than filtered in shapeDoctor afterward) so Postgres only ever
// returns already-active-clinic rows — avoids fetching+discarding pending/disabled clinic links
// on every doctor row, on every page of listDoctors and again in getDoctorById.
const DOCTOR_CLINICS_SELECT = {
  where: { clinic: { approvalStatus: 'active' } },
  select: {
    clinic: {
      select: {
        id: true,
        name: true,
        approvalStatus: true,
        city: { select: { name: true } },
        area: { select: { name: true } },
      },
    },
  },
};

// The doctor's weekly OPD hours (set via StaffPages.jsx's "Patient booking window" form —
// doctors.controller.js doesn't even own that write path, it's PATCH'd elsewhere, but this
// module owns the public read side). Pre-existing gap being fixed here: this was never selected
// at all, so every patient-facing page (home page doctor cards, the public doctor-detail page)
// had no schedule data to show and fell back to hardcoded "Schedule not added" placeholders
// regardless of what a doctor had actually configured. `status: 'active'` excludes any
// soft-disabled hours row (mirrors DOCTOR_CLINICS_SELECT's approvalStatus filter reasoning).
const DOCTOR_CLINIC_HOURS_SELECT = {
  where: { status: 'active' },
  select: { clinicId: true, weekday: true, startTime: true, endTime: true },
  orderBy: { weekday: 'asc' },
};

const DOCTOR_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  photoUrl: true,
  city: true,
  status: true,
  doctorProfile: { select: DOCTOR_PROFILE_BASE_SELECT },
  doctorClinics: DOCTOR_CLINICS_SELECT,
  doctorClinicHours: DOCTOR_CLINIC_HOURS_SELECT,
};

const DOCTOR_DETAIL_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  photoUrl: true,
  city: true,
  status: true,
  doctorProfile: {
    select: {
      ...DOCTOR_PROFILE_BASE_SELECT,
      bio: true,
      // Admin/self-only operational detail, kept out of DOCTOR_PROFILE_BASE_SELECT (and so out
      // of the public directory list) the same way bio is — a per-doctor booking-window override
      // isn't something an unrelated public caller needs to see.
      onlineBookingWindowStart: true,
      onlineBookingWindowEnd: true,
      // COMPLETENESS FIX (doctor panel profile-section audit): verificationDocuments was written
      // by uploads.service.js#saveVerificationDocument (and by admin-created createDoctor) but
      // never selected anywhere a caller could read it back — an admin reviewing a pending
      // doctor had no documents to actually review. Selected here (detail fetch only, not the
      // paginated list — same reasoning as bio) but only ever SURFACED by shapeDoctor when
      // includeContact is true (self or admin/superadmin — see shapeDoctor below), since these
      // are ID/certificate URLs that must never reach an unrelated public/patient caller.
      verificationDocuments: true,
      // Same self-or-admin/superadmin-only gate as verificationDocuments above (see shapeDoctor's
      // includeContact block) — bank details for payouts and the token-numbering rule are both
      // pure self/admin operational data, never shown to a public/patient caller.
      bankAccountHolderName: true,
      bankAccountNumber: true,
      bankIfscCode: true,
      bankName: true,
      bankUpiId: true,
      tokenNumberingMode: true,
      onlineTokenParity: true,
    },
  },
  doctorClinics: DOCTOR_CLINICS_SELECT,
  doctorClinicHours: DOCTOR_CLINIC_HOURS_SELECT,
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Builds the primary clinic's weekly OPD schedule as a compact [{day, hours}] list (already
 * sorted Sun->Sat by the Prisma query's orderBy), plus a one-line summary for card views.
 * @param {Array<{clinicId:string, weekday:number, startTime:string, endTime:string}>} hoursRows
 * @param {string|null} primaryClinicId
 */
function buildSchedule(hoursRows, primaryClinicId) {
  if (!primaryClinicId) return { schedule: [], scheduleSummary: null };
  const schedule = (hoursRows || [])
    .filter((h) => h.clinicId === primaryClinicId)
    .map((h) => ({ day: WEEKDAY_LABELS[h.weekday] || `Day ${h.weekday}`, hours: `${h.startTime}–${h.endTime}` }));

  if (!schedule.length) return { schedule, scheduleSummary: null };

  // Best-effort one-liner for the home-page/directory card. Only collapses into a day RANGE
  // ("Mon–Fri") when every active day shares identical hours AND the set is a genuinely
  // contiguous run of weekdays (checked by index gaps, not just first/last label) — e.g.
  // Sun+Sat alone would otherwise wrongly print as "Sun–Sat" implying every day. Anything else
  // (mixed hours, or a non-contiguous day set) falls back to a plain day count, which is always
  // accurate even if less specific.
  const uniqueHours = new Set(schedule.map((s) => s.hours));
  const weekdays = (hoursRows || []).filter((h) => h.clinicId === primaryClinicId).map((h) => h.weekday);
  const isContiguous = weekdays.every((w, i) => i === 0 || w === weekdays[i - 1] + 1);
  let scheduleSummary;
  if (uniqueHours.size === 1 && isContiguous) {
    const hours = schedule[0].hours;
    scheduleSummary = schedule.length === 7 ? `Every day · ${hours}` : schedule.length === 1 ? `${schedule[0].day} · ${hours}` : `${schedule[0].day}–${schedule[schedule.length - 1].day} · ${hours}`;
  } else {
    scheduleSummary = `${schedule.length} day${schedule.length === 1 ? '' : 's'}/week`;
  }
  return { schedule, scheduleSummary };
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/**
 * Shapes a raw Prisma User+doctorProfile+doctorClinics row into the public directory shape.
 * Never spreads the raw row — explicit field selection defends against schema drift leaking
 * a new sensitive column. `includeDetail` adds the fields only the single-doctor GET returns
 * (bio/allowRebooking/maxDaysAdvance — needed by the public booking-date picker). `includeContact`
 * adds email/phone — gated separately from includeDetail because contact info is
 * privacy-sensitive and must never reach a public/unrelated caller, unlike bio etc.: only the
 * doctor themselves or an admin/superadmin ever gets includeContact:true (see getDoctorById and
 * listDoctors's isAdminCaller branch).
 */
function shapeDoctor(user, { includeDetail = false, includeContact = false } = {}) {
  const dp = user.doctorProfile || {};

  // Clinics are restricted to approvalStatus='active' even on a verified doctor's own page —
  // a pending/disabled clinic link is not yet a real public place to see this doctor. That
  // filter now lives in DOCTOR_CLINICS_SELECT's `where` (pushed into Prisma/Postgres),
  // so every row reaching here already has an active clinic — no JS-side filter needed.
  const clinics = (user.doctorClinics || [])
    .map((dc) => dc.clinic)
    .map((c) => ({ id: c.id, name: c.name, city: c.city ? c.city.name : null, area: c.area ? c.area.name : null }));

  const { schedule, scheduleSummary } = buildSchedule(user.doctorClinicHours, clinics[0]?.id || null);

  const shaped = {
    id: user.id,
    name: user.name,
    photoUrl: user.photoUrl,
    city: user.city,
    // Verification-lifecycle status ('pending'/'verified'/'disabled') — previously omitted here,
    // which meant every consumer of this shape (including the admin doctor-management table) had
    // no way to tell an unverified doctor from a verified one and silently defaulted to showing
    // "verified" for everyone. Harmless to expose publicly too: the public list only ever returns
    // already-verified rows anyway (see listDoctors's where clause), so this is always 'verified'
    // there.
    status: dp.status ?? null,
    specialization: dp.specialization
      ? { id: dp.specialization.id, name: dp.specialization.name, icon: dp.specialization.icon }
      : null,
    qualification: dp.qualification ?? null,
    registrationNumber: dp.registrationNumber ?? null,
    experienceYears: dp.experienceYears ?? null,
    // BUG FIX (found while writing unit tests): every other optional field in this shape
    // defaults with `?? null` when absent from `dp` (the `user.doctorProfile || {}` fallback
    // above) — these two didn't, so they'd silently come back `undefined` (dropped from the JSON
    // response entirely) instead of an explicit `null` like the rest of the shape, for the same
    // not-currently-reachable "doctorProfile missing" case every other field already guards.
    consultationFee: dp.consultationFee ?? null,
    emergencyFee: dp.emergencyFee ?? null,
    minBookingAdvanceAmount: dp.minBookingAdvanceAmount ?? null,
    languages: dp.languages || [],
    rating: dp.rating,
    reviewCount: dp.reviewCount,
    emergencyAvailable: dp.emergencyAvailable,
    onlineBooking: dp.onlineBooking,
    clinics,
    // Weekly OPD hours for the primary (first) clinic — [{day:'Mon', hours:'10:00–18:00'}, ...],
    // sorted Sun->Sat. `scheduleSummary` is a ready-to-render one-liner for card views; both are
    // empty/null when the doctor hasn't set any OPD hours yet.
    schedule,
    scheduleSummary,
  };

  if (includeDetail) {
    shaped.bio = dp.bio ?? null;
    shaped.allowRebooking = dp.allowRebooking;
    shaped.maxDaysAdvance = dp.maxDaysAdvance;
    shaped.maxOnlineBookingsPerDay = dp.maxOnlineBookingsPerDay ?? null;
    shaped.onlineBookingWindowStart = dp.onlineBookingWindowStart ?? null;
    shaped.onlineBookingWindowEnd = dp.onlineBookingWindowEnd ?? null;
  }

  if (includeContact) {
    shaped.email = user.email;
    shaped.phone = user.phone ?? null;
    // COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's login"): account-level
    // enable/disable (users.status), distinct from `status` above (doctor_profiles.status,
    // verification-lifecycle). Gated behind includeContact same as email/phone — an unrelated
    // public caller has no business seeing whether an account is login-disabled.
    shaped.accountStatus = user.status;
    // Only ever populated here — see the doctorProfile select comment above for why this is
    // gated behind includeContact rather than includeDetail (privacy: unlike bio/booking-window,
    // these are direct links to a doctor's uploaded ID/certificate files).
    shaped.verificationDocuments = Array.isArray(dp.verificationDocuments) ? dp.verificationDocuments : [];
    // COMPLETENESS ADD (request: "doctor bank details v only admin and super admin dekh sakta
    // hai"): bank details for payouts, same includeContact-only visibility as
    // verificationDocuments above. Grouped into one object (null when nothing has been entered
    // yet) rather than 5 loose top-level fields, purely for a tidier response shape. upiId
    // (request: "upiid dalne ka v option de do") is independent of the 4 bank fields — a doctor
    // may fill in either, both, or neither — so it alone can also make hasBankDetails true.
    const hasBankDetails =
      dp.bankAccountHolderName || dp.bankAccountNumber || dp.bankIfscCode || dp.bankName || dp.bankUpiId;
    shaped.bankDetails = hasBankDetails
      ? {
          accountHolderName: dp.bankAccountHolderName ?? null,
          accountNumber: dp.bankAccountNumber ?? null,
          ifscCode: dp.bankIfscCode ?? null,
          bankName: dp.bankName ?? null,
          upiId: dp.bankUpiId ?? null,
        }
      : null;
    // Doctor-configured token-numbering rule (see schema.prisma's DoctorProfile.tokenNumberingMode
    // comment) — same includeContact-only visibility as the bank details above; a public/patient
    // caller has no use for this internal queue-numbering setting.
    shaped.tokenNumberingMode = dp.tokenNumberingMode === 'alternate' ? 'alternate' : 'sequential';
    // COMPLETENESS ADD (request: "odd ya even select karne ka option do doctor jo select kar
    // online ke lie") — which parity 'alternate' mode gives online bookings; meaningless/ignored
    // while tokenNumberingMode is 'sequential', still surfaced either way so the client's select
    // can be pre-filled with whatever the doctor last chose.
    shaped.onlineTokenParity = dp.onlineTokenParity === 'even' ? 'even' : 'odd';
    // Stable "DCD<N>" display number — admin-only, same includeContact gate as everything else
    // in this block. null for a legacy doctor row not yet backfilled.
    shaped.doctorNumber = dp.doctorNumber ?? null;
  }

  return shaped;
}

/**
 * Doctor directory search. Public/patient callers (and any non-admin authenticated caller) are
 * always restricted to verified doctors on active accounts, regardless of what `status` they
 * pass in — that param only has any effect for an admin/superadmin `requester`. An admin caller
 * with no `status` sees every doctorProfile status (pending/verified/disabled) so the admin
 * doctor-management page can show its full "registered vs verified" picture in one call; passing
 * a specific `status` narrows to just that lifecycle stage (e.g. the "Pending verification" list).
 * @param {object} params
 * @param {{id:string, role:string}} [params.requester] - undefined/null for public callers
 * @param {'pending'|'verified'|'disabled'} [params.status] - admin-only filter; ignored for
 *   non-admin callers (they're hard-restricted to 'verified' either way)
 */
async function listDoctors({
  specializationId,
  cityId,
  areaId,
  minRating,
  search,
  emergencyAvailable,
  sortBy,
  sortOrder,
  page,
  pageSize,
  requester,
  status,
}) {
  const isAdminCaller = !!requester && ADMIN_ROLES.includes(requester.role);
  // Cache key MUST be scoped by isAdminCaller/effectiveStatus (not the raw `status` query param)
  // — otherwise a public/anonymous call and an admin call that both happen to pass no `status`
  // would collide on the same cache bucket, leaking pending-doctor data to the public (or vice
  // versa, serving an admin the public-only cached page).
  const effectiveStatus = isAdminCaller ? status || 'all' : 'verified';
  const cacheKey = `cache:doctors:list:${isAdminCaller ? 'admin' : 'public'}:${effectiveStatus}:${
    specializationId || ''
  }:${cityId || ''}:${areaId || ''}:${minRating ?? ''}:${search || ''}:${emergencyAvailable ?? ''}:${
    sortBy || ''
  }:${sortOrder || ''}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {
      role: 'doctor',
      ...(isAdminCaller ? {} : { status: 'active' }),
      doctorProfile: {
        ...(isAdminCaller ? (status ? { status } : {}) : { status: 'verified' }),
        ...(specializationId ? { specializationId } : {}),
        ...(typeof minRating === 'number' ? { rating: { gte: minRating } } : {}),
        ...(typeof emergencyAvailable === 'boolean' ? { emergencyAvailable } : {}),
      },
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      // DoctorProfile has no direct city/area FK — "findable by city/area" means "linked to an
      // approved clinic there". User.city stays a display-only field, never a filter join.
      ...(cityId || areaId
        ? {
            doctorClinics: {
              some: {
                clinic: {
                  approvalStatus: 'active',
                  ...(cityId ? { cityId } : {}),
                  ...(areaId ? { areaId } : {}),
                },
              },
            },
          }
        : {}),
    };

    const sortField = SORT_FIELD_MAP[sortBy] || 'rating';
    const order = sortOrder === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: DOCTOR_LIST_SELECT,
        orderBy: { doctorProfile: { [sortField]: order } },
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      // includeContact only for an admin/superadmin caller — see shapeDoctor's doc comment.
      // Lets the admin doctor-management table show email/phone directly, and backs the "View
      // details" action there, without a public/patient list ever leaking contact info.
      rows: rows.map((row) => shapeDoctor(row, { includeContact: isAdminCaller })),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

/**
 * Single doctor profile. A non-verified/disabled doctor is visible only to themselves or an
 * admin — everyone else gets 404 (not 403), so a not-yet-public doctor's existence isn't
 * confirmed to an unrelated caller.
 * @param {string} id
 * @param {{id:string, role:string}|undefined} requester - undefined for anonymous callers
 */
async function getDoctorById(id, requester) {
  const isSelfOrAdmin = !!requester && (requester.id === id || ADMIN_ROLES.includes(requester.role));
  // Self and admin see an identical shape (same includeDetail:true, same bypass of the
  // publicly-visible check) so they safely share one cache bucket, distinct from the public one.
  const bucket = isSelfOrAdmin ? 'detail' : 'public';
  const cacheKey = `cache:doctors:detail:${id}:${bucket}`;

  return cacheService.getOrSet(cacheKey, DETAIL_CACHE_TTL_SECONDS, async () => {
    const user = await prisma.user.findUnique({ where: { id }, select: DOCTOR_DETAIL_SELECT });

    if (!user || !user.doctorProfile) {
      throw new ApiError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
    }

    const isPubliclyVisible = user.status === 'active' && user.doctorProfile.status === 'verified';

    if (!isPubliclyVisible && !isSelfOrAdmin) {
      throw new ApiError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
    }

    // includeContact only when isSelfOrAdmin — the same public single-doctor-profile GET this
    // function backs must never leak email/phone to an unrelated public caller, even though bio
    // etc. (includeDetail) IS shown to everyone for the public booking-date picker.
    return shapeDoctor(user, { includeDetail: true, includeContact: isSelfOrAdmin });
  });
}

/**
 * Updates the booking-policy fields (onlineBooking/allowRebooking/maxDaysAdvance, all required;
 * plus the optional/nullable maxOnlineBookingsPerDay daily cap) that me.service.js explicitly
 * deferred to this module. `requester` is always req.user — never trust the request body for
 * "whose profile is this".
 * @param {string} id
 * @param {object} body - already shape-validated
 * @param {{id:string, role:string}} requester
 */
async function updateBookingSettings(id, body, requester) {
  if (requester.role === 'doctor' && requester.id !== id) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only update your own booking settings.');
  }

  const existing = await prisma.doctorProfile.findUnique({ where: { userId: id }, select: { userId: true } });
  if (!existing) {
    throw new ApiError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
  }

  const updates = pickPresentFields(body, BOOKING_SETTINGS_FIELDS, BOOKING_SETTINGS_NON_NULLABLE);

  if (Object.keys(updates).length === 0) {
    return getDoctorById(id, requester);
  }

  await prisma.doctorProfile.update({ where: { userId: id }, data: updates });

  await activityLogService.log({
    actorUserId: requester.id,
    actorRole: requester.role,
    actionType: 'doctor.booking_settings_update',
    targetEntityType: 'doctor',
    targetEntityId: id,
    description: `Updated booking settings: ${Object.keys(updates).join(', ')}`,
  });

  await invalidateDoctorCaches(id);

  return getDoctorById(id, requester);
}

/**
 * Provisions a new doctor account (User + DoctorProfile in one transaction). Used by two
 * callers: an admin/superadmin creating a doctor directly (actor = req.user, `verifyImmediately`
 * respected), and public self-registration (actor = null — see doctors.controller.js#registerDoctor,
 * which never reads/forwards `verifyImmediately` from the public request body, so a
 * self-registered doctor can never skip the pending-verification queue). `verifyImmediately` is
 * read ONLY to compute the initial DoctorProfile.status — it is never written to any column (the
 * literal fix for the frontend bug where this UI-only checkbox leaked into the persisted doctor
 * row via spread).
 * @param {object} input
 * @param {{id:string, role:string}|null} [actor] - null for public self-registration
 */
async function createDoctor(input, actor = null) {
  const {
    name,
    email,
    password,
    phone,
    city,
    specializationId,
    qualification,
    registrationNumber,
    experienceYears,
    consultationFee,
    emergencyFee,
    languages,
    bio,
    verificationDocuments,
    verifyImmediately,
  } = input;

  const normalizedEmail = normalizeEmail(email);

  // Email-uniqueness check, specialization-existence check, and password hashing are all
  // independent of one another — run concurrently instead of three steps in series. bcrypt's
  // hash runs off the main thread (libuv threadpool), so it overlaps cleanly with the two DB
  // round-trips rather than adding its ~100ms+ cost on top of them.
  const [existingUser, specialization, passwordHash] = await Promise.all([
    prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
    prisma.specialization.findUnique({ where: { id: specializationId }, select: { id: true } }),
    bcrypt.hash(password, env.bcryptSaltRounds),
  ]);
  if (existingUser) {
    throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
  }
  if (!specialization) {
    throw new ApiError(400, 'SPECIALIZATION_NOT_FOUND', 'The selected specialization does not exist.');
  }

  const initialStatus = verifyImmediately === true ? 'verified' : 'pending';

  const dedupedLanguages = Array.isArray(languages)
    ? [...new Set(languages.map((l) => String(l).trim()).filter((l) => l.length > 0))]
    : [];

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'doctor',
          phone: phone ? phone.trim() : null,
          city: city ? city.trim() : null,
          status: 'active',
        },
        select: { id: true },
      });

      // Drawn once, right before the insert that stores it — same posture as
      // auth.service.js#register's nextPatientNumber call (see its comment for the sequence's
      // non-transactional-gap note, which applies identically here).
      const doctorNumber = await idGenerators.nextDoctorNumber();

      await tx.doctorProfile.create({
        data: {
          userId: user.id,
          specializationId,
          qualification: qualification ? qualification.trim() : null,
          registrationNumber: registrationNumber ? registrationNumber.trim() : null,
          experienceYears: experienceYears ?? null,
          consultationFee,
          emergencyFee: emergencyFee ?? 0,
          languages: dedupedLanguages,
          bio: bio ? bio.trim() : null,
          verificationDocuments: verificationDocuments ?? null,
          status: initialStatus,
          doctorNumber,
        },
      });

      return user;
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    throw err;
  }

  // Self-registration has no pre-existing actor to attribute the log entry to — the newly
  // created doctor is its own actor in that case (mirrors auth.service.js#register's
  // 'auth.register' entry, which likewise logs the new user as its own actor).
  const effectiveActor = actor || { id: created.id, role: 'doctor' };

  await activityLogService.log({
    actorUserId: effectiveActor.id,
    actorRole: effectiveActor.role,
    actionType: actor ? 'doctor.create_account' : 'doctor.self_register',
    targetEntityType: 'doctor',
    targetEntityId: created.id,
    description: actor ? `Created doctor account (status=${initialStatus})` : `Doctor self-registered (status=${initialStatus})`,
  });

  await invalidateDoctorCaches(created.id);

  return getDoctorById(created.id, effectiveActor);
}

/**
 * Admin-only: the one atomic verification-lifecycle action (pending/verified/disabled) that
 * replaces the old app's two disconnected mechanisms. Only ever touches
 * doctor_profiles.status — never users.status (account-level enable/disable is a separate,
 * out-of-scope concern for this phase, per DATABASE_SCHEMA.md §2).
 * @param {string} id
 * @param {'pending'|'verified'|'disabled'} status
 * @param {{id:string, role:string}} actor
 */
async function updateDoctorStatus(id, status, actor) {
  const profile = await prisma.doctorProfile.findUnique({
    where: { userId: id },
    select: { userId: true, specializationId: true, consultationFee: true },
  });
  if (!profile) {
    throw new ApiError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
  }

  // Data-integrity nicety (not mandated): refuse to mark a doctor verified while the two
  // fields the public directory depends on are still unset.
  if (status === 'verified' && (!profile.specializationId || Number(profile.consultationFee) <= 0)) {
    throw new ApiError(
      400,
      'DOCTOR_VERIFICATION_INCOMPLETE',
      'Doctor must have a specialization and a consultation fee greater than 0 before verification.'
    );
  }

  await prisma.doctorProfile.update({ where: { userId: id }, data: { status } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'doctor.status_update',
    targetEntityType: 'doctor',
    targetEntityId: id,
    description: `Set doctor status to "${status}"`,
  });

  await invalidateDoctorCaches(id);

  // Real-time alert to the doctor themselves — a status change made entirely by an
  // admin/superadmin (this endpoint has no other caller) with real consequences for them
  // (verified = can now actually receive bookings; disabled = the reverse), so they should not
  // have to notice it by chance the next time they log in. 'pending' is deliberately not alerted
  // — it's the pre-verification starting state, never an admin-initiated demotion.
  if (status === 'verified' || status === 'disabled') {
    await notificationsService.notifySystemEventSafe(id, {
      title: status === 'verified' ? 'Account verified' : 'Account disabled',
      body:
        status === 'verified'
          ? 'Your doctor account has been verified. You can now receive bookings.'
          : 'Your doctor account has been disabled. Contact platform support for details.',
      type: 'account',
    });
  }

  return getDoctorById(id, actor);
}

/**
 * COMPLETENESS FIX (audit Priority 4): "No way to disable a doctor's or patient's login (only
 * their profile/verification status)". Writes users.status — deliberately separate from
 * updateDoctorStatus above (doctor_profiles.status, the verification lifecycle) per that
 * function's own doc comment ("account-level enable/disable is a separate, out-of-scope concern
 * for this phase" — now in scope). Mirrors receptionists.service.js#updateReceptionistStatus,
 * the one sibling module that already writes users.status this same way.
 * @param {string} id
 * @param {'active'|'disabled'} status
 * @param {{id:string, role:string}} actor
 */
async function updateDoctorAccountStatus(id, status, actor) {
  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!existing || existing.role !== 'doctor') {
    throw new ApiError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
  }

  await prisma.user.update({ where: { id }, data: { status } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'doctor.account_status_update',
    targetEntityType: 'doctor',
    targetEntityId: id,
    description: `Set doctor account login status to "${status}"`,
  });

  await invalidateDoctorCaches(id);

  // Same real-time-alert reasoning as updateDoctorStatus above: an admin-initiated change with
  // real consequences (disabled = cannot log in at all, regardless of verification state) that
  // the doctor should not have to discover only by a failed login attempt.
  await notificationsService.notifySystemEventSafe(id, {
    title: status === 'disabled' ? 'Account login disabled' : 'Account login re-enabled',
    body:
      status === 'disabled'
        ? 'Your account login has been disabled by an administrator. Contact platform support for details.'
        : 'Your account login has been re-enabled. You can sign in again.',
    type: 'account',
  });

  return getDoctorById(id, actor);
}

module.exports = {
  listDoctors,
  getDoctorById,
  updateBookingSettings,
  createDoctor,
  updateDoctorStatus,
  updateDoctorAccountStatus,
  invalidateDoctorCaches,
};
