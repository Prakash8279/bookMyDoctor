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

// POST / (file a new complaint) and GET /:id (single complaint) removed (backend-cleanup audit —
// user request: "website frontend me nahi hai but backend bna hua hai to backend se hata do"): no
// web or mobile screen, for any role, ever files a complaint (the web store's addComplaint action
// had zero call sites) or fetches a single complaint by id — admin's inbox only lists (GET /) and
// responds (PATCH /:id).
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
