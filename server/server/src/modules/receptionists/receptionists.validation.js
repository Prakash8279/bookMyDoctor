/**
 * express-validator chains for every receptionists endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "you don't own this clinic") belongs in
 * the service layer.
 */
const { body, query } = require('express-validator');

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

// getOne validation removed (backend-cleanup audit) — see receptionists.routes.js's comment.

// update/updateStatus validation chains removed alongside PATCH /:id and PATCH /:id/status — see
// receptionists.routes.js's comment for why.

module.exports = { create, list };
