/**
 * express-validator chains for every receptionists endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "you don't own this clinic") belongs in
 * the service layer.
 */
const { body, param, query } = require('express-validator');

const OPT_NULLABLE = { values: 'null' };

// `.optional()` with no options only skips a chain when the field is `undefined` — so an
// explicit JSON `null` still reaches `.custom()` below and fails it, producing a clean
// per-field 422 message, and `.bail()` stops the chain there so the type-specific validator
// after it never runs on a `null` value. Used only for fields backed by a NOT NULL column
// (mirrors the identical helper in clinics.validation.js/doctors.validation.js).
function rejectNull(fieldName) {
  return body(fieldName)
    .optional()
    .custom((value) => value !== null)
    .withMessage(`${fieldName} cannot be null.`)
    .bail();
}

const create = [
  body('name').trim().notEmpty().withMessage('name is required.').isLength({ max: 150 }),
  body('email').trim().notEmpty().withMessage('email is required.').isEmail().withMessage('a valid email is required.').isLength({ max: 255 }),
  body('password').notEmpty().withMessage('password is required.').isLength({ min: 8, max: 72 }),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
  // clinicId is required and explicit — the direct fix for "auto-assigned to clinics[0]
  // platform-wide".
  body('clinicId').notEmpty().withMessage('clinicId is required.').isUUID(),
];

const list = [
  query('clinicId').optional({ values: 'falsy' }).isUUID(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const getOne = [param('id').isUUID().withMessage('id must be a valid id.')];

const update = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  // name is a NOT NULL column on users — rejectNull() turns an explicit `null` into a clean 422
  // instead of it silently skipping the trim/isLength chain and reaching the service layer as a
  // raw null (which would otherwise be coerced by `String(null)` into the literal string "null"
  // and persisted).
  rejectNull('name').trim().isLength({ min: 1, max: 150 }),
  body('phone').optional(OPT_NULLABLE).trim().isLength({ max: 20 }),
  // A receptionist is always tied to a specific clinic (module-wide design goal) — there is no
  // "unassign" state, so an explicit `null` here must be rejected with a clean 422, not silently
  // accepted and then dropped by the service layer's truthy check on body.clinicId.
  rejectNull('clinicId').isUUID(),
];

const updateStatus = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  body('status').notEmpty().withMessage('status is required.').isIn(['active', 'disabled']),
];

module.exports = { create, list, getOne, update, updateStatus };
