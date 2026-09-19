/**
 * express-validator chains for every reviews endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "you don't own this appointment", "appointment
 * not completed yet", "you've already reviewed this appointment") belongs in reviews.service.js.
 *
 * POST / deliberately does NOT define a `status` field at all — moderation-bypass prevention
 * (rule 3): even if a client sends `status:'approved'` in the body, express-validator simply
 * ignores unknown fields and reviews.service.js#createReview never reads body.status, always
 * writing status:'pending' explicitly.
 */
const { body, param, query } = require('express-validator');

const createReview = [
  body('appointmentId').notEmpty().withMessage('appointmentId is required.').isUUID(),
  body('rating')
    .notEmpty()
    .withMessage('rating is required.')
    .isInt({ min: 1, max: 5 })
    .withMessage('rating must be an integer between 1 and 5.')
    .toInt(),
  body('text')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('text must be at most 2000 characters.'),
];

const updateStatus = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  body('status')
    .notEmpty()
    .withMessage('status is required.')
    .isIn(['pending', 'approved', 'rejected'])
    .withMessage('status must be one of: pending, approved, rejected.'),
];

const listReviews = [
  query('doctorId').optional({ values: 'falsy' }).isUUID().withMessage('doctorId must be a valid id.'),
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['pending', 'approved', 'rejected'])
    .withMessage('status must be one of: pending, approved, rejected.'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { createReview, updateStatus, listReviews };
