/**
 * Route definitions for the familyMembers module.
 * Scope: Patient's family-member CRUD, scoped strictly to the authenticated patient's own id.
 * Allowed roles: patient (owner only)
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in familyMembers.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./familyMembers.validation');
const controller = require('./familyMembers.controller');

// Every route here is "the authenticated patient, acting on their own rows" — patientUserId is
// never read from the request body/params, only from req.user.id (set by authenticate). This
// is the literal, named fix for the global family-member leak (every patient's family-member
// dropdown showing every other patient's family) described in FRONTEND_DATA_MODEL_REPORT.md.
router.use(authenticate, authorize('patient'));

router.get('/', validation.list, validateRequest, controller.list);
router.get('/:id', validation.getOne, validateRequest, controller.getOne);
router.post('/', validation.create, validateRequest, controller.create);
router.patch('/:id', validation.update, validateRequest, controller.update);
router.delete('/:id', validation.remove, validateRequest, controller.remove);

module.exports = router;
