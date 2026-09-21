/**
 * express-validator chains for every familyMembers endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. ownership) belongs in the service layer.
 */
const { body, param, query } = require('express-validator');

const OPT_NULLABLE = { values: 'null' };

// `.optional()` with no options only skips a chain when the field is `undefined` — so an
// explicit JSON `null` still reaches `.custom()` below and fails it, producing a clean
// per-field 422 message, and `.bail()` stops the chain there so the type-specific validator
// after it never runs on a `null` value. Used only for fields backed by a NOT NULL column
// (name/relation), where null must be a shape error rather than treated as "clear it" the way
// OPT_NULLABLE fields elsewhere in this chain (backing nullable columns) legitimately allow.
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
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('dateOfBirth must be a valid date (YYYY-MM-DD).')
    .toDate()
    .custom((value) => value <= new Date())
    .withMessage('dateOfBirth cannot be in the future.'),
  body('gender').optional({ values: 'falsy' }).isString().isLength({ max: 30 }),
  body('bloodGroup').optional({ values: 'falsy' }).isString().isLength({ max: 10 }),
];

const update = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  // name/relation are NOT NULL columns — rejectNull() turns an explicit `null` into a clean
  // 422 instead of it reaching `String(null)` in the service layer and being persisted as the
  // literal 4-character string "null".
  rejectNull('name').trim().isLength({ min: 1, max: 150 }),
  rejectNull('relation').trim().isLength({ min: 1, max: 50 }),
  body('dateOfBirth')
    .optional(OPT_NULLABLE)
    .isISO8601()
    .withMessage('dateOfBirth must be a valid date (YYYY-MM-DD).')
    .toDate()
    .custom((value) => value <= new Date())
    .withMessage('dateOfBirth cannot be in the future.'),
  body('gender').optional(OPT_NULLABLE).isString().isLength({ max: 30 }),
  body('bloodGroup').optional(OPT_NULLABLE).isString().isLength({ max: 10 }),
];

const remove = [param('id').isUUID().withMessage('id must be a valid id.')];

module.exports = { list, create, update, remove };
