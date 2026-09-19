/**
 * Route definitions for the reviews module.
 * Scope: Patient review submission + admin moderation (pending/approved/rejected) + public
 * approved-reviews listing.
 * Allowed roles: patient (create), admin/superadmin (moderate), any/anonymous (list — see below)
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in reviews.service.js.
 *
 * GET / uses optionalAuthenticate (not authenticate) — it's a public endpoint (approved reviews
 * feed the doctor profile page) that shows more (all statuses, filterable) to an authenticated
 * admin/superadmin caller. See reviews.service.js#listReviews for the role-scoping.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const optionalAuthenticate = require('../../middleware/optionalAuthenticate');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./reviews.validation');
const controller = require('./reviews.controller');

router.get('/', optionalAuthenticate, validation.listReviews, validateRequest, controller.listReviews);

router.post(
  '/',
  authenticate,
  authorize('patient'),
  validation.createReview,
  validateRequest,
  controller.createReview
);

router.patch(
  '/:id/status',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.updateStatus,
  validateRequest,
  controller.updateReviewStatus
);

module.exports = router;
