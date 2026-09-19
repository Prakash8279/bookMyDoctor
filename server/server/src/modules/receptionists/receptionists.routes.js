/**
 * Route definitions for the receptionists module.
 * Scope: Receptionist account creation/management by doctors and admins.
 * Allowed roles: doctor, admin
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in receptionists.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./receptionists.validation');
const controller = require('./receptionists.controller');

// Every route in this module requires at least a doctor or admin/superadmin — no public or
// receptionist-self access (a receptionist manages their own profile via /me, not here).
router.use(authenticate, authorize('doctor', 'admin', 'superadmin'));

router.post('/', validation.create, validateRequest, controller.create);
router.get('/', validation.list, validateRequest, controller.list);
router.get('/:id', validation.getOne, validateRequest, controller.getOne);
router.patch('/:id', validation.update, validateRequest, controller.update);
router.patch('/:id/status', validation.updateStatus, validateRequest, controller.updateStatus);

// No DELETE — consistent with the soft-disable-not-delete pattern used everywhere else in
// this schema (accounts are never hard-deleted).

module.exports = router;
