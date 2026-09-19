/**
 * Route definitions for the queue module.
 * Scope: Queue-token status progression (waiting -> called -> in_consultation -> completed),
 * plus a read-only live-queue listing (GET /, recommended addition beyond the literal PATCH-only
 * brief — flagged in the phase plan; a PATCH-only queue module isn't operable since staff need
 * to see who's waiting before they can act on a token).
 * Allowed roles: doctor, receptionist
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in queue.service.js.
 *
 * GET /mine/:appointmentId is the one deliberate exception to "doctor/receptionist only" above —
 * patient-only, read-only, and scoped to exactly one of the caller's own appointments (see
 * queue.service.js#getMyQueueStatus's doc comment for why this exists: the patient-facing "Live
 * queue tracker" page had no data source of its own before this).
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./queue.validation');
const controller = require('./queue.controller');

const QUEUE_ROLES = ['doctor', 'receptionist'];

router.get('/', authenticate, authorize(...QUEUE_ROLES), validation.listQueue, validateRequest, controller.listQueue);

router.get(
  '/mine/:appointmentId',
  authenticate,
  authorize('patient'),
  validation.getMyQueueStatus,
  validateRequest,
  controller.getMyQueueStatus
);

router.patch(
  '/:id/status',
  authenticate,
  authorize(...QUEUE_ROLES),
  validation.updateStatus,
  validateRequest,
  controller.updateQueueStatus
);

module.exports = router;
