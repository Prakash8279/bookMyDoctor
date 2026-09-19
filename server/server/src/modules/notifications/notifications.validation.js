/**
 * express-validator chains for every notifications endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "target user doesn't exist", ownership of a
 * notification-recipient row) belongs in notifications.service.js.
 *
 * This file didn't exist before this phase — created fresh, matching the header-comment
 * convention of every other module's *.validation.js.
 */
const { body, param, query } = require('express-validator');

const broadcast = [
  body('audience')
    .notEmpty()
    .withMessage('audience is required.')
    .isIn(['all', 'patients', 'doctors', 'receptionists', 'single_user'])
    .withMessage('audience must be one of: all, patients, doctors, receptionists, single_user.'),
  body('title').notEmpty().withMessage('title is required.').isString().trim().isLength({ max: 200 }).withMessage('title must be at most 200 characters.'),
  body('body').notEmpty().withMessage('body is required.').isString().trim().isLength({ max: 2000 }).withMessage('body must be at most 2000 characters.'),
  body('type')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage('type must be at most 50 characters.'),
  // Conditional-shape check only (still validator-layer, not a DB lookup): targetUserId is
  // required and must be a UUID whenever audience === 'single_user'. Whether that id refers to a
  // real user is a business-rule check that belongs in notifications.service.js.
  body('targetUserId')
    .if(body('audience').equals('single_user'))
    .notEmpty()
    .withMessage('targetUserId is required when audience is single_user.')
    .isUUID()
    .withMessage('targetUserId must be a valid id.'),
];

const listMyNotifications = [
  query('unreadOnly').optional({ values: 'falsy' }).isBoolean().withMessage('unreadOnly must be a boolean.').toBoolean(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const markRead = [param('id').isUUID().withMessage('id must be a valid id.')];

const listBroadcasts = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { broadcast, listMyNotifications, markRead, listBroadcasts };
