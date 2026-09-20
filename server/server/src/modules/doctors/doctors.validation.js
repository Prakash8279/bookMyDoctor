/**
 * express-validator chains for every doctors endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "you don't own this doctor profile")
 * belongs in the service layer.
 */
const { body, param, query } = require('express-validator');

// MANDATORY-FIELDS FIX (user request: "create account jo hai ushme jo v data hai oo compalasari
// proper validation varification") — see auth.validation.js's identical constants for the full
// reasoning; used below only in `registerDoctor` (the public "Create account" -> doctor tab
// endpoint), not in `createDoctor` (the admin-only "add a doctor" panel, a different form with its
// own, deliberately looser, rules).
const PHONE_RE = /^[6-9]\d{9}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,149}$/;

const listDoctors = [
  query('specializationId').optional({ values: 'falsy' }).isUUID().withMessage('specializationId must be a valid id.'),
  query('cityId').optional({ values: 'falsy' }).isUUID().withMessage('cityId must be a valid id.'),
  query('areaId').optional({ values: 'falsy' }).isUUID().withMessage('areaId must be a valid id.'),
  query('minRating').optional({ values: 'falsy' }).isFloat({ min: 0, max: 5 }).toFloat(),
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ max: 150 }),
  query('emergencyAvailable').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  query('sortBy').optional({ values: 'falsy' }).isIn(['rating', 'fee', 'experience']),
  query('sortOrder').optional({ values: 'falsy' }).isIn(['asc', 'desc']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
  // Admin/superadmin-only filter (see doctors.service.js#listDoctors) — silently ignored for
  // every other caller, who is hard-restricted to 'verified' regardless of what's passed here.
  query('status').optional({ values: 'falsy' }).isIn(['pending', 'verified', 'disabled']),
];

const getDoctor = [param('id').isUUID().withMessage('id must be a valid id.')];

const patchDoctor = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  // This route is a full-replace of just these 3 booking-policy fields (not a partial patch) —
  // ALL THREE of onlineBooking/allowRebooking/maxDaysAdvance are required on every call, so
  // unlike rejectNull()-style checks elsewhere in this codebase (which only reject an explicit
  // null and let an absent field skip validation via .optional()), exists({checkNull:true})
  // rejects the field when it's missing OR null, and .bail() stops the chain there so the
  // type-specific validator after it (isBoolean/isInt, which can throw on a raw null/undefined
  // rather than fail cleanly) never runs on either.
  body('onlineBooking').exists({ checkNull: true }).withMessage('onlineBooking is required.').bail().isBoolean().withMessage('onlineBooking must be a boolean.').toBoolean(),
  body('allowRebooking').exists({ checkNull: true }).withMessage('allowRebooking is required.').bail().isBoolean().withMessage('allowRebooking must be a boolean.').toBoolean(),
  body('maxDaysAdvance')
    .exists({ checkNull: true })
    .withMessage('maxDaysAdvance is required.')
    .bail()
    .isInt({ min: 1, max: 365 })
    .withMessage('maxDaysAdvance must be between 1 and 365.')
    .toInt(),
  // Unlike the 3 fields above, this one is optional AND nullable — it's a feature toggle
  // (cap off by default), not a required policy value. Omit it, or send null, to leave the
  // daily online-booking cap switched off.
  body('maxOnlineBookingsPerDay')
    .optional({ values: 'null' })
    .isInt({ min: 1, max: 500 })
    .withMessage('maxOnlineBookingsPerDay must be a whole number between 1 and 500, or null to remove the cap.')
    .toInt(),
  // Per-doctor override of the platform-wide online-booking hours window (see
  // appointments.service.js#runBookingJob) — same optional+nullable shape as
  // maxOnlineBookingsPerDay above: omit, or send null, to clear the override and fall back to
  // whatever the platform-wide window (admin.service.js#updateBookingRules) says.
  body('onlineBookingWindowStart')
    .optional({ values: 'null' })
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('onlineBookingWindowStart must be in 24-hour HH:MM format, or null to clear the override.'),
  body('onlineBookingWindowEnd')
    .optional({ values: 'null' })
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('onlineBookingWindowEnd must be in 24-hour HH:MM format, or null to clear the override.'),
  // Doctor-configurable token-numbering rule (see schema.prisma's DoctorProfile.tokenNumberingMode
  // comment) — optional (omit to leave unchanged), but when present must be one of the two
  // values appointments.service.js#runBookingJob actually understands. Not `{values:'null'}`
  // like the nullable fields above — there is no "cleared" state for this column (it's NOT NULL
  // with a default), so an explicit null correctly fails this same isIn check rather than being
  // silently skipped, backed up by pickPresentFields' non-nullable guard in the service layer.
  body('tokenNumberingMode')
    .optional()
    .isIn(['sequential', 'alternate'])
    .withMessage("tokenNumberingMode must be 'sequential' or 'alternate'."),
  // COMPLETENESS ADD (request: "odd ya even select karne ka option do doctor jo select kar
  // online ke lie") — which parity 'alternate' mode gives online bookings. Same optional/non-
  // nullable shape as tokenNumberingMode above; meaningless while tokenNumberingMode stays
  // 'sequential' but still validated the same way regardless, so a stray null/typo is always
  // caught rather than only when the doctor happens to also be in 'alternate' mode.
  body('onlineTokenParity')
    .optional()
    .isIn(['odd', 'even'])
    .withMessage("onlineTokenParity must be 'odd' or 'even'."),
  // Cross-field: both set, or both null — and start must be earlier than end (no midnight-
  // spanning windows), same rule and reasoning as admin.validation.js#updateBookingRules.
  body().custom((value) => {
    const b = value || {};
    const hasStart = b.onlineBookingWindowStart !== undefined && b.onlineBookingWindowStart !== null;
    const hasEnd = b.onlineBookingWindowEnd !== undefined && b.onlineBookingWindowEnd !== null;
    if (hasStart !== hasEnd) {
      throw new Error('onlineBookingWindowStart and onlineBookingWindowEnd must be set together, or both left null.');
    }
    if (hasStart && hasEnd && String(b.onlineBookingWindowStart) >= String(b.onlineBookingWindowEnd)) {
      throw new Error('onlineBookingWindowStart must be earlier than onlineBookingWindowEnd (a window spanning midnight is not supported).');
    }
    return true;
  }),
];

const createDoctor = [
  body('name').trim().notEmpty().withMessage('name is required.').isLength({ max: 150 }),
  body('email').trim().notEmpty().withMessage('email is required.').isEmail().withMessage('a valid email is required.').isLength({ max: 255 }),
  body('password').notEmpty().withMessage('password is required.').isLength({ min: 8, max: 72 }),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('specializationId').notEmpty().withMessage('specializationId is required.').isUUID(),
  body('qualification').optional({ values: 'falsy' }).trim().isLength({ max: 255 }),
  body('registrationNumber').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('experienceYears').optional({ values: 'falsy' }).isInt({ min: 0, max: 80 }).toInt(),
  body('consultationFee').notEmpty().withMessage('consultationFee is required.').isFloat({ min: 0 }).toFloat(),
  body('emergencyFee').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('languages').optional({ values: 'falsy' }).isArray().withMessage('languages must be an array of strings.'),
  body('languages.*').optional().isString().isLength({ max: 50 }),
  body('bio').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }),
  body('verificationDocuments').optional({ values: 'falsy' }).isArray({ max: 10 }).withMessage('verificationDocuments must be an array of at most 10 items.'),
  body('verificationDocuments.*.name').if(body('verificationDocuments').exists()).isString().trim().notEmpty().isLength({ max: 150 }),
  body('verificationDocuments.*.url')
    .if(body('verificationDocuments').exists())
    .isString()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Each verification document url must be a valid http(s) URL.'),
  body('verifyImmediately').optional({ values: 'falsy' }).isBoolean().toBoolean(),
];

// Public self-registration — same shape rules as createDoctor minus the two admin-only fields
// (verifyImmediately, verificationDocuments), which doctors.controller.js#registerDoctor never
// reads from the request body regardless of what's validated here.
//
// MANDATORY-FIELDS FIX (user request: "create account jo hai ushme jo v data hai oo compalasari
// proper validation varification") — every field the web/mobile "Create account" -> doctor tab
// form actually shows (phone, qualification, registration number, years of experience) is now
// required here too, not just visually required on the form; a client that bypassed the form
// (or an older cached build) could previously still register with all four blank.
const registerDoctor = [
  body('name').trim().notEmpty().withMessage('name is required.').matches(NAME_RE).withMessage('name must contain letters only (at least 2 characters).'),
  body('email').trim().notEmpty().withMessage('email is required.').isEmail().withMessage('a valid email is required.').isLength({ max: 255 }),
  body('password')
    .notEmpty()
    .withMessage('password is required.')
    .isLength({ min: 8, max: 72 })
    .matches(PASSWORD_RE)
    .withMessage('password must include at least one letter and one number.'),
  body('phone').trim().notEmpty().withMessage('phone is required.').matches(PHONE_RE).withMessage('enter a valid 10-digit mobile number.'),
  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('specializationId').notEmpty().withMessage('specializationId is required.').isUUID(),
  body('qualification').trim().notEmpty().withMessage('qualification is required.').isLength({ max: 255 }),
  body('registrationNumber').trim().notEmpty().withMessage('registrationNumber is required.').isLength({ max: 100 }),
  body('experienceYears').notEmpty().withMessage('experienceYears is required.').isInt({ min: 0, max: 80 }).toInt(),
  body('consultationFee').notEmpty().withMessage('consultationFee is required.').isFloat({ min: 0 }).toFloat(),
  body('emergencyFee').optional({ values: 'falsy' }).isFloat({ min: 0 }).toFloat(),
  body('languages').optional({ values: 'falsy' }).isArray().withMessage('languages must be an array of strings.'),
  body('languages.*').optional().isString().isLength({ max: 50 }),
  body('bio').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }),
];

const updateDoctorStatus = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  body('status').notEmpty().withMessage('status is required.').isIn(['pending', 'verified', 'disabled']),
];

// COMPLETENESS FIX (audit Priority 4): account-level login enable/disable — a distinct 2-value
// enum (AccountStatus: active|disabled) from updateDoctorStatus's 3-value verification lifecycle
// above; deliberately not merged into that endpoint (see doctors.service.js#updateDoctorAccountStatus's
// doc comment for why they stay separate).
const updateDoctorAccountStatus = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  body('status').notEmpty().withMessage('status is required.').isIn(['active', 'disabled']),
];

module.exports = { listDoctors, getDoctor, patchDoctor, createDoctor, registerDoctor, updateDoctorStatus, updateDoctorAccountStatus };
