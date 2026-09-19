/**
 * Route definitions for the doctors module.
 * Scope: Doctor directory/search (public+patient), doctor profile CRUD, admin verification/status.
 * Allowed roles: public read, doctor self-write, admin manage
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in doctors.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const optionalAuthenticate = require('../../middleware/optionalAuthenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const { authLimiter } = require('../../middleware/rateLimiter');
const validation = require('./doctors.validation');
const controller = require('./doctors.controller');

// Public search — optionalAuthenticate only sets req.user when a valid token is present;
// it never rejects an anonymous caller.
router.get('/', optionalAuthenticate, validation.listDoctors, validateRequest, controller.listDoctors);

// Public self-registration — no authenticate/authorize, same authLimiter as
// /auth/register|login for brute-force/abuse protection. Placed before the '/:id' routes
// purely for readability; the distinct HTTP method (POST) and literal path segment mean it
// can never actually be shadowed by them.
router.post('/register', authLimiter, validation.registerDoctor, validateRequest, controller.registerDoctor);

router.get('/:id', optionalAuthenticate, validation.getDoctor, validateRequest, controller.getDoctor);

router.patch(
  '/:id',
  authenticate,
  authorize('doctor', 'admin', 'superadmin'),
  validation.patchDoctor,
  validateRequest,
  controller.patchDoctor
);

router.post(
  '/',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.createDoctor,
  validateRequest,
  controller.createDoctor
);

router.patch(
  '/:id/status',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.updateDoctorStatus,
  validateRequest,
  controller.updateDoctorStatus
);

// COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
// account-level login enable/disable (users.status), a distinct concern from the verification
// lifecycle '/:id/status' route above (doctor_profiles.status) — see
// doctors.service.js#updateDoctorAccountStatus's doc comment.
router.patch(
  '/:id/account-status',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.updateDoctorAccountStatus,
  validateRequest,
  controller.updateDoctorAccountStatus
);

module.exports = router;
