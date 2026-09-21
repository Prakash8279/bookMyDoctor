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
  // type field removed (backend-cleanup audit — user request: "website frontend me nahi hai but
  // backend bna hua hai to backend se hata do"): neither web's AdminPages.jsx nor mobile's
  // admin_broadcast_screen.dart ever sends a `type` in the broadcast form body — every broadcast
  // now always saves as type='broadcast' (see notifications.service.js#broadcastNotification).
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

// unreadOnly filter removed (backend-cleanup audit — user request: "website frontend me nahi hai
// but backend bna hua hai to backend se hata do"): no web or mobile inbox screen ever sends it —
// every one just lists the full paginated inbox and shows read-state inline per row.
const listMyNotifications = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const markRead = [param('id').isUUID().withMessage('id must be a valid id.')];

const listBroadcasts = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { broadcast, listMyNotifications, markRead, listBroadcasts };
