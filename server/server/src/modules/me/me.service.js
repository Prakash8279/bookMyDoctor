/**
 * Business logic for the me module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules
 * (e.g. double-booking prevention, fee computation, payment masking by role), and all
 * Prisma/DB calls for this module live. Controllers call these functions; these functions
 * never touch req/res directly.
 */
const bcrypt = require('bcrypt');
const prisma = require('../../config/db');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const tokenService = require('../../services/tokenService');
const activityLogService = require('../../services/activityLogService');
const { pickPresentFields } = require('../../utils/pickPresentFields');
const { signDocumentUrl } = require('../../services/fileUploadService');

const BASE_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  city: true,
  photoUrl: true,
  role: true,
  status: true,
  createdAt: true,
};

const FULL_SELECT = {
  ...BASE_SELECT,
  patientProfile: true,
  doctorProfile: {
    include: {
      specialization: { select: { id: true, name: true } },
    },
  },
  receptionistProfile: true,
};

// Fields any role may edit on the base `users` row via PATCH /me.
const BASE_EDITABLE_FIELDS = ['name', 'phone', 'city', 'photoUrl'];

// Role-specific profile fields editable via PATCH /me. Deliberately excludes admin/system-owned
// columns (doctor_profiles.status/verificationDocuments/rating/reviewCount) and OPD-schedule
// columns (onlineBooking/allowRebooking/maxDaysAdvance) — those belong to a later module.
// receptionist/admin/superadmin have no self-editable profile fields this phase.
const PROFILE_EDITABLE_FIELDS = {
  patient: ['dateOfBirth', 'gender', 'bloodGroup', 'emergencyContact', 'address', 'medicalHistory', 'about'],
  doctor: [
    'specializationId',
    'qualification',
    'registrationNumber',
    'experienceYears',
    'consultationFee',
    'emergencyFee',
    'languages',
    'bio',
    'emergencyAvailable',
    'minBookingAdvanceAmount',
    // COMPLETENESS ADD (request: "doctor bank details v only admin and super admin dekh sakta
    // hai add kro") — doctor-self-editable, but readable back only by the doctor themselves or
    // an admin/superadmin (doctors.service.js#shapeDoctor's includeContact gate), never by an
    // unrelated public/patient caller.
    'bankAccountHolderName',
    'bankAccountNumber',
    'bankIfscCode',
    'bankName',
    // UPI ID as an alternative/additional payout option (request: "upiid dalne ka v option de
    // do") — independent of the 4 bank fields above, same self-editable/admin-only-visible rule.
    'bankUpiId',
  ],
  receptionist: [],
  admin: [],
  superadmin: [],
};

/**
 * Shapes the role-specific profile sub-object out of a FULL_SELECT user row.
 * Never spreads the raw Prisma row — explicit field selection is the defense against schema
 * drift (a new sensitive column added to a profile table later would otherwise leak silently).
 */
function buildProfile(user) {
  if (user.role === 'patient') {
    if (!user.patientProfile) return null;
    const { userId, ...rest } = user.patientProfile;
    return rest;
  }
  if (user.role === 'doctor') {
    if (!user.doctorProfile) return null;
    const { userId, specializationId, ...rest } = user.doctorProfile;
    // SECURITY FIX (audit finding: "uploaded documents served without authentication") —
    // verificationDocuments stores STABLE, token-less URLs (see fileUploadService.js's
    // buildFileUrl); this is the doctor fetching their OWN profile (no ownership check needed,
    // same reasoning as doctors.service.js#shapeDoctor's includeContact gate — that function
    // signs the same field for an admin/superadmin viewer), so a fresh short-lived token is
    // minted here at response time too, or the "View" link on StaffPages.jsx would 404 the
    // moment the 10-minute token from upload time (if any) expired.
    if (Array.isArray(rest.verificationDocuments)) {
      rest.verificationDocuments = rest.verificationDocuments.map((doc) =>
        doc && typeof doc === 'object' ? { ...doc, url: signDocumentUrl(doc.url) } : doc
      );
    }
    return rest; // `rest.specialization` is the nested {id, name} object from the include.
  }
  if (user.role === 'receptionist') {
    if (!user.receptionistProfile) return null;
    const { userId, ...rest } = user.receptionistProfile;
    return rest;
  }
  return null; // admin / superadmin have no profile table
}

/**
 * Full self-profile: base User columns + the role-specific profile joined in.
 * @param {string} userId
 */
async function getMe(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: FULL_SELECT });
  if (!user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required to access this resource.');
  }

  const { patientProfile, doctorProfile, receptionistProfile, ...base } = user;
  return { ...base, profile: buildProfile(user) };
}

/**
 * Updates the caller's own profile. `userId`/`role` come from req.user (never from the
 * request body) — this is the only source of "whose row" gets written.
 * @param {string} userId
 * @param {string} role
 * @param {object} body - raw request body (already shape-validated by me.validation.js)
 */
async function updateMe(userId, role, body) {
  const baseUpdates = pickPresentFields(body, BASE_EDITABLE_FIELDS);
  const profileUpdates = pickPresentFields(body, PROFILE_EDITABLE_FIELDS[role] || []);

  if ('name' in baseUpdates) baseUpdates.name = String(baseUpdates.name).trim();
  if ('phone' in baseUpdates) baseUpdates.phone = baseUpdates.phone ? String(baseUpdates.phone).trim() : null;
  if ('city' in baseUpdates) baseUpdates.city = baseUpdates.city ? String(baseUpdates.city).trim() : null;

  if (role === 'doctor' && 'specializationId' in profileUpdates && profileUpdates.specializationId) {
    const spec = await prisma.specialization.findUnique({
      where: { id: profileUpdates.specializationId },
      select: { id: true },
    });
    if (!spec) {
      throw new ApiError(400, 'SPECIALIZATION_NOT_FOUND', 'The selected specialization does not exist.');
    }
  }

  if (role === 'doctor' && 'languages' in profileUpdates) {
    const raw = Array.isArray(profileUpdates.languages) ? profileUpdates.languages : [];
    const deduped = [...new Set(raw.map((l) => String(l).trim()).filter((l) => l.length > 0))];
    profileUpdates.languages = deduped;
  }

  // A doctor's minimum online-booking-advance amount must never exceed their consultation fee
  // (charging a "minimum" that's actually more than the full fee makes no sense to a patient).
  // Compare against whatever consultationFee/minBookingAdvanceAmount are IN EFFECT after this
  // update — the value(s) being set in this same request if present, otherwise the doctor's
  // existing saved value(s).
  //
  // VALIDATION-GAP FIX (found via multi-agent audit after "abhi bhi problem hai sab jagah" —
  // superadmin's original request only mentioned minBookingAdvanceAmount, but this check used to
  // fire ONLY when minBookingAdvanceAmount itself was in the request body. A doctor who lowered
  // just their consultationFee (leaving a previously-saved, now-too-high minBookingAdvanceAmount
  // untouched) hit no validation at all, silently leaving minBookingAdvanceAmount > consultationFee
  // stored — which makes utils/minBookingAmount.js#computeMinBookingRemainder clamp the clinic's
  // remainder to ₹0 forever for that doctor (consultationFee - minBookingAdvanceAmount < 0). The
  // check now also fires whenever consultationFee changes, not just when minBookingAdvanceAmount
  // does.
  const touchesMinBookingAmount =
    'minBookingAdvanceAmount' in profileUpdates && profileUpdates.minBookingAdvanceAmount != null;
  const touchesConsultationFee = 'consultationFee' in profileUpdates;
  if (role === 'doctor' && (touchesMinBookingAmount || touchesConsultationFee)) {
    let effectiveConsultationFee = profileUpdates.consultationFee;
    let effectiveMinBookingAdvanceAmount = 'minBookingAdvanceAmount' in profileUpdates
      ? profileUpdates.minBookingAdvanceAmount
      : undefined;
    if (effectiveConsultationFee == null || effectiveMinBookingAdvanceAmount === undefined) {
      const existing = await prisma.doctorProfile.findUnique({
        where: { userId },
        select: { consultationFee: true, minBookingAdvanceAmount: true },
      });
      if (effectiveConsultationFee == null) {
        effectiveConsultationFee = existing ? Number(existing.consultationFee) : null;
      }
      if (effectiveMinBookingAdvanceAmount === undefined) {
        effectiveMinBookingAdvanceAmount =
          existing && existing.minBookingAdvanceAmount != null ? Number(existing.minBookingAdvanceAmount) : null;
      }
    }
    if (
      effectiveMinBookingAdvanceAmount != null &&
      (effectiveConsultationFee == null || Number(effectiveMinBookingAdvanceAmount) > Number(effectiveConsultationFee))
    ) {
      throw new ApiError(
        400,
        'MIN_BOOKING_AMOUNT_EXCEEDS_FEE',
        'Minimum booking amount cannot be more than the consultation fee.'
      );
    }
  }

  const changedFieldNames = [...Object.keys(baseUpdates), ...Object.keys(profileUpdates)];

  if (changedFieldNames.length === 0) {
    // Nothing recognized/allowed for this role was present in the body — no-op, no audit entry.
    return getMe(userId);
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(baseUpdates).length > 0) {
      await tx.user.update({ where: { id: userId }, data: baseUpdates });
    }

    if (Object.keys(profileUpdates).length > 0) {
      if (role === 'patient') {
        await tx.patientProfile.upsert({
          where: { userId },
          update: profileUpdates,
          create: { userId, ...profileUpdates },
        });
      } else if (role === 'doctor') {
        await tx.doctorProfile.upsert({
          where: { userId },
          update: profileUpdates,
          create: { userId, ...profileUpdates },
        });
      }
      // receptionist/admin/superadmin: PROFILE_EDITABLE_FIELDS maps to [], so profileUpdates
      // is always empty for those roles and this branch is unreachable for them.
    }
  });

  // Field NAMES only in the audit trail — never values (avoids leaking medical history,
  // addresses, etc. into activity_log).
  await activityLogService.log({
    actorUserId: userId,
    actorRole: role,
    actionType: 'me.profile_update',
    targetEntityType: 'user',
    targetEntityId: userId,
    description: `Updated own profile: ${changedFieldNames.join(', ')}`,
  });

  if (role === 'doctor') {
    // A doctor editing their own profile here (consultationFee, bio, minBookingAdvanceAmount,
    // even their base name/phone/photo) changes exactly the fields doctors.service.js's public
    // listDoctors/getDoctorById cache — which is what the patient-facing directory and booking
    // screen actually read from. Without busting that cache, a saved change (e.g. a newly-set
    // minimum booking amount) silently would not appear there for up to that cache's TTL. Lazy
    // require: doctors.service.js doesn't require this module, so this isn't a true cycle, but
    // matches the lazy-require style used for cross-module cache invalidation elsewhere in this
    // codebase (e.g. payments/appointments/queue services).
    const doctorsService = require('../doctors/doctors.service');
    await doctorsService.invalidateDoctorCaches(userId);
  }

  return getMe(userId);
}

/**
 * Changes the caller's own password. Revokes every refresh token they hold on success,
 * forcing re-login on other devices/sessions.
 * @param {string} userId
 * @param {string} role
 * @param {{currentPassword:string, newPassword:string}} input
 */
async function changePassword(userId, role, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required to access this resource.');
  }

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) {
    // 400, not 401 — deliberate, so this doesn't collide with an API client's
    // "401 -> try refresh/logout" interceptor logic.
    throw new ApiError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
  }

  if (currentPassword === newPassword) {
    throw new ApiError(400, 'SAME_PASSWORD', 'New password must be different from the current password.');
  }

  const passwordHash = await bcrypt.hash(newPassword, env.bcryptSaltRounds);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  await tokenService.revokeAllForUser(userId);

  await activityLogService.log({
    actorUserId: userId,
    actorRole: role,
    actionType: 'auth.password_change',
    targetEntityType: 'user',
    targetEntityId: userId,
    description: 'Changed own password',
  });
}

module.exports = { getMe, updateMe, changePassword };
