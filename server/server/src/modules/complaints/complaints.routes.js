/**
 * Route definitions for the complaints module.
 * Scope: Patient complaint filing + admin response/status.
 * Allowed roles: patient (create, list-own, view-own), admin/superadmin (manage, list-all, view-any)
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in complaints.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./complaints.validation');
const controller = require('./complaints.controller');

const READ_ROLES = ['patient', 'admin', 'superadmin'];

router.post(
  '/',
  authenticate,
  authorize('patient'),
  validation.createComplaint,
  validateRequest,
  controller.createComplaint
);

router.get('/', authenticate, authorize(...READ_ROLES), validation.listComplaints, validateRequest, controller.listComplaints);

router.get('/:id', authenticate, authorize(...READ_ROLES), validation.getComplaint, validateRequest, controller.getComplaint);

router.patch(
  '/:id',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.updateComplaint,
  validateRequest,
  controller.updateComplaint
);

module.exports = router;
