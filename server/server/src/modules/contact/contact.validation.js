/**
 * express-validator chains for every contact endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation belongs in the service layer.
 *
 * `subject` is kept free-text (matching the contact_requests.subject column, which the schema
 * doesn't enum) rather than restricted with an `isIn` — the grounding report's "5-option select"
 * doesn't specify exact values, so no restriction is invented here.
 */
const { body, param, query } = require('express-validator');

// `.optional()` with no options only skips a chain when the field is `undefined` — so an
// explicit JSON `null` still reaches `.custom()` below and fails it, producing a clean per-field
// 422 message, and `.bail()` stops the chain there so the type-specific validator after it
// (isIn, which would otherwise just silently skip a null under `optional({values:'falsy'})`)
// never runs on a `null` value. Used here because status is a NOT NULL column on
// contact_requests, where null must be a shape error rather than silently accepted.
function rejectNull(fieldName) {
  return body(fieldName)
    .optional()
    .custom((value) => value !== null)
    .withMessage(`${fieldName} cannot be null.`)
    .bail();
}

const createContactRequest = [
  body('name').notEmpty().withMessage('name is required.').isString().trim().isLength({ max: 150 }).withMessage('name must be at most 150 characters.'),
  body('email').trim().notEmpty().withMessage('email is required.').isEmail().withMessage('email must be a valid email address.'),
  body('subject').notEmpty().withMessage('subject is required.').isString().trim().isLength({ max: 200 }).withMessage('subject must be at most 200 characters.'),
  body('message').notEmpty().withMessage('message is required.').isString().trim().isLength({ max: 5000 }).withMessage('message must be at most 5000 characters.'),
];

const updateContactRequest = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  rejectNull('status')
    .isIn(['open', 'responded', 'resolved'])
    .withMessage('status must be one of: open, responded, resolved.'),
  body('response')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('response must be at most 5000 characters.'),
];

const listContactRequests = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['open', 'responded', 'resolved'])
    .withMessage('status must be one of: open, responded, resolved.'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { createContactRequest, updateContactRequest, listContactRequests };
