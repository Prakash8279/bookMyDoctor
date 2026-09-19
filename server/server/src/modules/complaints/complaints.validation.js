/**
 * express-validator chains for every complaints endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "you don't own this complaint") belongs in
 * the service layer.
 */
const { body, param, query } = require('express-validator');

// `.optional()` with no options only skips a chain when the field is `undefined` — so an
// explicit JSON `null` still reaches `.custom()` below and fails it, producing a clean per-field
// 422 message, and `.bail()` stops the chain there so the type-specific validator after it
// (isIn, which would otherwise just silently skip a null under `optional({values:'falsy'})`)
// never runs on a `null` value. Used here because status is a NOT NULL column on complaints,
// where null must be a shape error rather than silently accepted.
function rejectNull(fieldName) {
  return body(fieldName)
    .optional()
    .custom((value) => value !== null)
    .withMessage(`${fieldName} cannot be null.`)
    .bail();
}

const createComplaint = [
  body('subject').notEmpty().withMessage('subject is required.').isString().trim().isLength({ max: 200 }).withMessage('subject must be at most 200 characters.'),
  body('description')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('description must be at most 5000 characters.'),
];

const updateComplaint = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  rejectNull('status')
    .isIn(['open', 'in_progress', 'resolved', 'closed'])
    .withMessage('status must be one of: open, in_progress, resolved, closed.'),
  body('adminResponse')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('adminResponse must be at most 5000 characters.'),
];

const listComplaints = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['open', 'in_progress', 'resolved', 'closed'])
    .withMessage('status must be one of: open, in_progress, resolved, closed.'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const getComplaint = [param('id').isUUID().withMessage('id must be a valid id.')];

module.exports = { createComplaint, updateComplaint, listComplaints, getComplaint };
