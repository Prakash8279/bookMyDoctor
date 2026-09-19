/**
 * Route definitions for the contact module.
 * Scope: Public contact-us form intake + admin response/status.
 * Allowed roles: public (create, no authenticate at all), admin/superadmin (manage, list)
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in contact.service.js.
 *
 * POST / is intentionally public (no authenticate middleware) — it's the anonymous contact-us
 * form. It runs behind the global defaultLimiter already mounted in app.js; no extra per-route
 * limiter is needed.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./contact.validation');
const controller = require('./contact.controller');

router.post('/', validation.createContactRequest, validateRequest, controller.createContactRequest);

router.get(
  '/',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.listContactRequests,
  validateRequest,
  controller.listContactRequests
);

router.patch(
  '/:id',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.updateContactRequest,
  validateRequest,
  controller.updateContactRequest
);

module.exports = router;
