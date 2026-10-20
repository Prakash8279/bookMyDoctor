/**
 * express-validator chains for every familyMembers endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. ownership) belongs in the service layer.
 */
const { body, param, query } = require('express-validator');
const { businessDateOnly, formatDateOnly } = require('../../utils/dateOnly');

// `.optional()` with no options only skips a chain when the field is `undefined` — so an
// explicit JSON `null` still reaches `.custom()` below and fails it, producing a clean
// per-field 422 message, and `.bail()` stops the chain there so the type-specific validator
// after it never runs on a `null` value. Existing records may have missing legacy details,
// but updates must never explicitly clear required profile fields.
function rejectNull(fieldName) {
  return body(fieldName)
    .optional()
    .custom((value) => value !== null)
    .withMessage(`${fieldName} cannot be null.`)
    .bail();
}

const list = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

// getOne validation removed (backend-cleanup audit) — see familyMembers.routes.js's comment.

const create = [
  body('name').trim().notEmpty().withMessage('name is required.').isLength({ max: 150 }),
  // Free string — the schema has no closed enum for `relation`, so validation doesn't invent one.
  body('relation').trim().notEmpty().withMessage('relation is required.').isLength({ max: 50 }),
  body('dateOfBirth')
    .notEmpty().withMessage('dateOfBirth is required.').bail()
    .isISO8601({ strict: true })
    .withMessage('dateOfBirth must be a valid date (YYYY-MM-DD).')
    .bail()
    .toDate()
    .custom((value) => formatDateOnly(value) <= businessDateOnly())
    .withMessage('dateOfBirth cannot be in the future.'),
  body('gender').isString().withMessage('gender is required.').bail().trim().notEmpty().withMessage('gender is required.').isLength({ max: 30 }),
  body('bloodGroup').isString().withMessage('bloodGroup is required.').bail().trim().notEmpty().withMessage('bloodGroup is required.').isLength({ max: 10 }),
];

const update = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  // name/relation are NOT NULL columns — rejectNull() turns an explicit `null` into a clean
  // 422 instead of it reaching `String(null)` in the service layer and being persisted as the
  // literal 4-character string "null".
  rejectNull('name').trim().isLength({ min: 1, max: 150 }),
  rejectNull('relation').trim().isLength({ min: 1, max: 50 }),
  body('dateOfBirth')
    .optional()
    .notEmpty().withMessage('dateOfBirth cannot be empty.').bail()
    .isISO8601({ strict: true })
    .withMessage('dateOfBirth must be a valid date (YYYY-MM-DD).')
    .bail()
    .toDate()
    .custom((value) => formatDateOnly(value) <= businessDateOnly())
    .withMessage('dateOfBirth cannot be in the future.'),
  rejectNull('gender').isString().bail().trim().isLength({ min: 1, max: 30 }),
  rejectNull('bloodGroup').isString().bail().trim().isLength({ min: 1, max: 10 }),
];

const remove = [param('id').isUUID().withMessage('id must be a valid id.')];

module.exports = { list, create, update, remove };
