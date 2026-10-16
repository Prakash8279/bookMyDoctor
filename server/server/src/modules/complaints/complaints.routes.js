/**
 * Route definitions for the complaints module.
 * Scope: admin response/status on complaints raised via other channels; patient list-own.
 * Allowed roles: patient (list-own), admin/superadmin (manage, list-all)
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

router.post('/', authenticate, authorize('patient'), validation.createComplaint, validateRequest, controller.createComplaint);
router.get('/', authenticate, authorize(...READ_ROLES), validation.listComplaints, validateRequest, controller.listComplaints);

router.patch(
  '/:id',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.updateComplaint,
  validateRequest,
  controller.updateComplaint
);

module.exports = router;
