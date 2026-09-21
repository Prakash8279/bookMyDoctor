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

// COMPLETENESS FIX (mobile parity audit round 2, doctor panel — user request: "backend hai but
// website me nahi hai to hata do app se backend v oo hata do"): PATCH /:id (edit) and
// PATCH /:id/status (enable/disable) used to live here. Confirmed orphaned end to end — neither
// DoctorStaff nor admin's ManageReceptionists ever wires up an edit or status action (both only
// ever create + list), and useAppStore.js's updateReceptionist/updateReceptionistStatus actions
// were themselves dead code, never called from any page. Removed rather than left unreachable,
// per the same "app must match website" rule already applied to the client.
//
// No DELETE either — consistent with the soft-disable-not-delete pattern used everywhere else in
// this schema (accounts are never hard-deleted). NOTE: removing PATCH /:id/status means there is
// now no way at all — website or app — to disable a receptionist's login. If that's ever needed,
// a new admin-facing control would have to be built from scratch.

module.exports = router;
