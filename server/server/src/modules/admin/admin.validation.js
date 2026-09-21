/**
 * express-validator chains for every admin endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation belongs in the service layer.
 *
 * system-settings and booking-rules PUTs are both full-replace of a singleton config row (not a
 * partial patch) — every field is required on every call, matching platformCharges.validation.js's
 * convention (isFloat/isInt/isBoolean directly, no separate notEmpty(), doubles as the "required"
 * check since an absent field fails the type validator too).
 */
const { query, body, param } = require('express-validator');

// actorUserId/actionType filters removed (backend-cleanup audit — user request: "website
// frontend me nahi hai but backend bna hua hai to backend se hata do"): the admin activity-log
// web page never wired up filter inputs for either one.
const listActivityLog = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const updateSystemSettings = [
  body('platformName')
    .notEmpty()
    .withMessage('platformName is required.')
    .isString()
    .trim()
    .isLength({ max: 200 })
    .withMessage('platformName must be at most 200 characters.'),
  body('supportEmail').trim().optional({ values: 'falsy' }).isEmail().withMessage('supportEmail must be a valid email address.'),
  body('supportPhone')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 30 })
    .withMessage('supportPhone must be at most 30 characters.'),
  // `bookingFee` deliberately removed (product decision): "Platform charges"
  // (see platformCharges.validation.js) is now the single pricing-config
  // surface for admin/superadmin — this field is no longer collected here,
  // though the underlying `system_settings.booking_fee` column is left in
  // place untouched rather than migrated away.
  body('maintenanceMode').isBoolean().withMessage('maintenanceMode is required and must be a boolean.').toBoolean(),
];

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const updateBookingRules = [
  body('cancellationWindowHours')
    .isInt({ min: 0, max: 720 })
    .withMessage('cancellationWindowHours is required and must be an integer between 0 and 720.')
    .toInt(),
  body('maxBookingsPerPatient')
    .isInt({ min: 1, max: 100 })
    .withMessage('maxBookingsPerPatient is required and must be an integer between 1 and 100.')
    .toInt(),
  body('defaultSlotMinutes')
    .isInt({ min: 5, max: 120 })
    .withMessage('defaultSlotMinutes is required and must be an integer between 5 and 120.')
    .toInt(),
  // Nullable (unlike the three fields above): `{ values: 'null' }` skips validation when the
  // field is absent OR explicitly null — null is how the admin UI turns the window "off" (online
  // booking accepted around the clock). Still validated against HH:MM whenever a real value is
  // sent.
  body('onlineBookingWindowStart')
    .optional({ values: 'null' })
    .matches(HHMM_RE)
    .withMessage('onlineBookingWindowStart must be in 24-hour HH:MM format, or null to remove the window.'),
  body('onlineBookingWindowEnd')
    .optional({ values: 'null' })
    .matches(HHMM_RE)
    .withMessage('onlineBookingWindowEnd must be in 24-hour HH:MM format, or null to remove the window.'),
  body('onlineBookingMaxAdvanceDays')
    .optional({ values: 'null' })
    .isInt({ min: 0, max: 365 })
    .withMessage('onlineBookingMaxAdvanceDays must be a whole number between 0 and 365, or null for no platform-wide cap.')
    .toInt(),
  // Cross-field: the two window times are a pair — both set, or both null. A start>=end window
  // (or one that wraps past midnight, e.g. "22:00"-"06:00") is rejected here rather than
  // silently mis-happening at booking time — appointments.service.js's runBookingJob does a
  // plain string comparison that assumes start < end.
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

const listPatients = [
  query('search').optional({ values: 'falsy' }).isString().trim().isLength({ max: 150 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

// COMPLETENESS FIX (audit Priority 4): account-level login enable/disable for a patient — see
// admin.service.js#updatePatientStatus.
const updatePatientStatus = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  body('status').notEmpty().withMessage('status is required.').isIn(['active', 'disabled']),
];

module.exports = { listActivityLog, updateSystemSettings, updateBookingRules, listPatients, updatePatientStatus };
