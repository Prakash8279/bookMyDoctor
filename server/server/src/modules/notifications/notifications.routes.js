/**
 * Route definitions for the notifications module.
 * Scope: Per-user notification delivery/read-state, plus admin broadcast-to-audience.
 * Allowed roles: any authenticated (read/mark own), admin/superadmin (broadcast + broadcast table)
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in notifications.service.js.
 *
 * '/broadcast' and '/read-all' are distinct single-segment literals, so there's no routing
 * collision with the two-segment '/:id/read' param route regardless of declaration order — but
 * literal-before-param is followed anyway for readability.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./notifications.validation');
const controller = require('./notifications.controller');

const ALL_ROLES = ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'];

router.post(
  '/broadcast',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.broadcast,
  validateRequest,
  controller.broadcastNotification
);

router.get(
  '/broadcast',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.listBroadcasts,
  validateRequest,
  controller.listBroadcasts
);

router.get('/', authenticate, authorize(...ALL_ROLES), validation.listMyNotifications, validateRequest, controller.listMyNotifications);

router.patch('/read-all', authenticate, authorize(...ALL_ROLES), controller.markAllNotificationsRead);

router.patch(
  '/:id/read',
  authenticate,
  authorize(...ALL_ROLES),
  validation.markRead,
  validateRequest,
  controller.markNotificationRead
);

module.exports = router;
