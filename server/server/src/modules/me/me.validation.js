/**
 * express-validator chains for every me endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "slot already booked") belongs in the service layer.
 *
 * PATCH /me accepts a superset of fields across all roles here (shape only) — which of them
 * actually get persisted for the calling role's allow-list is decided in me.service.js.
 * `{ values: 'null' }` means "skip this check when the field is absent OR explicitly null"
 * (null is treated as a valid way to clear an optional field), while still validating it
 * when present with any other value, including falsy-but-meaningful ones like 0 or false.
 */
const { body } = require('express-validator');

const OPT_NULLABLE = { values: 'null' };

const patchMe = [
  // Base fields — every role.
  body('name').optional(OPT_NULLABLE).trim().isLength({ min: 1, max: 150 }).withMessage('Name must be between 1 and 150 characters.'),
  body('phone').optional(OPT_NULLABLE).trim().isLength({ max: 20 }).withMessage('Phone must be at most 20 characters.'),
  body('city').optional(OPT_NULLABLE).trim().isLength({ max: 100 }).withMessage('City must be at most 100 characters.'),
  body('photoUrl').optional(OPT_NULLABLE).isString().isLength({ max: 2048 }).withMessage('photoUrl must be at most 2048 characters.')
    .isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('photoUrl must be a valid http(s) URL.'),

  // Patient profile fields.
  body('dateOfBirth').optional(OPT_NULLABLE).isISO8601().withMessage('dateOfBirth must be a valid date (YYYY-MM-DD).').toDate(),
  body('gender').optional(OPT_NULLABLE).isString().isLength({ max: 30 }),
  body('bloodGroup').optional(OPT_NULLABLE).isString().isLength({ max: 10 }),
  body('emergencyContact').optional(OPT_NULLABLE).isString().isLength({ max: 30 }),
  body('address').optional(OPT_NULLABLE).isString().isLength({ max: 500 }),
  body('medicalHistory').optional(OPT_NULLABLE).isString().isLength({ max: 5000 }),
  body('about').optional(OPT_NULLABLE).isString().isLength({ max: 2000 }),

  // Doctor profile fields.
  body('specializationId').optional(OPT_NULLABLE).isUUID().withMessage('specializationId must be a valid id.'),
  body('qualification').optional(OPT_NULLABLE).isString().isLength({ max: 255 }),
  body('registrationNumber').optional(OPT_NULLABLE).isString().isLength({ max: 100 }),
  body('experienceYears').optional(OPT_NULLABLE).isInt({ min: 0, max: 80 }).withMessage('experienceYears must be between 0 and 80.').toInt(),
  body('consultationFee').optional(OPT_NULLABLE).isFloat({ min: 0, max: 99999999.99 }).withMessage('consultationFee must be a number between 0 and 99999999.99.').toFloat(),
  body('emergencyFee').optional(OPT_NULLABLE).isFloat({ min: 0, max: 99999999.99 }).withMessage('emergencyFee must be a number between 0 and 99999999.99.').toFloat(),
  // Doctor-configurable minimum online-advance amount for the "pay minimum now, rest at the
  // clinic" booking option. null clears it (no minimum-payment option offered to patients).
  // Must not exceed consultationFee — enforced in me.service.js#updateMe, since that needs the
  // (possibly-not-being-updated) existing consultationFee value too.
  body('minBookingAdvanceAmount').optional(OPT_NULLABLE).isFloat({ min: 0, max: 99999999.99 }).withMessage('minBookingAdvanceAmount must be a number between 0 and 99999999.99.').toFloat(),
  body('languages').optional(OPT_NULLABLE).isArray().withMessage('languages must be an array of strings.'),
  body('languages.*').optional().isString().isLength({ max: 50 }).withMessage('Each language must be a string of at most 50 characters.'),
  body('bio').optional(OPT_NULLABLE).isString().isLength({ max: 2000 }),
  body('emergencyAvailable').optional(OPT_NULLABLE).isBoolean().withMessage('emergencyAvailable must be a boolean.').toBoolean(),
  // Doctor bank details for payouts (request: "doctor bank details v only admin and super admin
  // dekh sakta hai add kro") — self-editable, but readable back only by the doctor themselves or
  // an admin/superadmin (doctors.service.js#shapeDoctor's includeContact gate). ifscCode's
  // pattern matches the standard Indian IFSC shape (4 letters, a literal 0, 6 alphanumeric).
  body('bankAccountHolderName').optional(OPT_NULLABLE).trim().isLength({ max: 150 }).withMessage('bankAccountHolderName must be at most 150 characters.'),
  body('bankAccountNumber').optional(OPT_NULLABLE).trim().isLength({ max: 30 }).withMessage('bankAccountNumber must be at most 30 characters.').matches(/^[A-Za-z0-9]+$/).withMessage('bankAccountNumber must contain only letters and digits.'),
  body('bankIfscCode').optional(OPT_NULLABLE).trim().matches(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/).withMessage('bankIfscCode must be a valid 11-character IFSC code (e.g. HDFC0001234).'),
  body('bankName').optional(OPT_NULLABLE).trim().isLength({ max: 150 }).withMessage('bankName must be at most 150 characters.'),
  // UPI ID as an alternative/additional payout option (request: "upiid dalne ka v option de
  // do") — independent of the 4 bank fields above (a doctor may fill in either, both, or
  // neither). Pattern matches the standard UPI VPA shape: alphanumeric/./-/_ handle, "@", then
  // the bank/PSP handle (letters, e.g. "okhdfcbank", "ybl", "paytm").
  body('bankUpiId').optional(OPT_NULLABLE).trim().isLength({ max: 150 }).matches(/^[A-Za-z0-9.\-_]{2,256}@[A-Za-z]{2,64}$/).withMessage('bankUpiId must be a valid UPI ID (e.g. name@okhdfcbank).'),
];

const patchPassword = [
  body('currentPassword').notEmpty().withMessage('currentPassword is required.'),
  body('newPassword')
    .notEmpty()
    .withMessage('newPassword is required.')
    .isLength({ min: 8, max: 72 })
    .withMessage('newPassword must be between 8 and 72 characters.'),
  body('confirmPassword')
    .notEmpty()
    .withMessage('confirmPassword is required.')
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('confirmPassword must match newPassword.'),
];

module.exports = { patchMe, patchPassword };
