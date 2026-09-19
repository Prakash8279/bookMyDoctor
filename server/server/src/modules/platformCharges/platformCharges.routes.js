/**
 * Route definitions for the platformCharges module.
 * Scope: Singleton commission/fee config row consumed by booking fee math + revenue reports.
 * Allowed roles: admin, superadmin (write), any authenticated (read)
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in platformCharges.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./platformCharges.validation');
const controller = require('./platformCharges.controller');

const ALL_ROLES = ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'];

router.get('/', authenticate, authorize(...ALL_ROLES), controller.getCharges);

router.put(
  '/',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.updateCharges,
  validateRequest,
  controller.updateCharges
);

module.exports = router;
