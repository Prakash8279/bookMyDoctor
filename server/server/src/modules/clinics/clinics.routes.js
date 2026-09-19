/**
 * Route definitions for the clinics module.
 * Scope: Clinic CRUD, doctor-clinic assignment, OPD hours/closures, clinic approval workflow.
 * Allowed roles: doctor (own), admin
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in clinics.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const optionalAuthenticate = require('../../middleware/optionalAuthenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./clinics.validation');
const controller = require('./clinics.controller');

const WRITE_ROLES = ['doctor', 'admin', 'superadmin'];

// ── A. Clinic CRUD + approval ───────────────────────────────────────────

router.post(
  '/',
  authenticate,
  authorize(...WRITE_ROLES),
  validation.createClinic,
  validateRequest,
  controller.createClinic
);

router.get('/', optionalAuthenticate, validation.listClinics, validateRequest, controller.listClinics);
router.get('/:id', optionalAuthenticate, validation.getClinic, validateRequest, controller.getClinic);

router.patch(
  '/:id',
  authenticate,
  authorize(...WRITE_ROLES),
  validation.patchClinic,
  validateRequest,
  controller.updateClinic
);

router.patch(
  '/:id/approve',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.approveClinic,
  validateRequest,
  controller.approveClinic
);

router.patch(
  '/:id/reject',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.rejectClinic,
  validateRequest,
  controller.rejectClinic
);

// ── B. doctor_clinics assignment ────────────────────────────────────────

router.post(
  '/:id/doctors',
  authenticate,
  authorize(...WRITE_ROLES),
  validation.assignDoctor,
  validateRequest,
  controller.assignDoctor
);

router.patch(
  '/:id/doctors/:doctorUserId',
  authenticate,
  authorize(...WRITE_ROLES),
  validation.updateDoctorAssignment,
  validateRequest,
  controller.updateDoctorAssignment
);

router.delete(
  '/:id/doctors/:doctorUserId',
  authenticate,
  authorize(...WRITE_ROLES),
  validation.removeDoctorAssignment,
  validateRequest,
  controller.removeDoctorAssignment
);

// ── C. doctor_clinic_hours ──────────────────────────────────────────────

router.put(
  '/:clinicId/hours',
  authenticate,
  authorize(...WRITE_ROLES),
  validation.putHours,
  validateRequest,
  controller.putHours
);

router.get('/:clinicId/hours', optionalAuthenticate, validation.listHours, validateRequest, controller.listHours);

router.delete(
  '/:clinicId/hours/:hoursId',
  authenticate,
  authorize(...WRITE_ROLES),
  validation.deleteHours,
  validateRequest,
  controller.deleteHours
);

// ── D. doctor_clinic_closures ───────────────────────────────────────────

router.post(
  '/:clinicId/closures',
  authenticate,
  authorize(...WRITE_ROLES),
  validation.createClosure,
  validateRequest,
  controller.createClosure
);

router.get(
  '/:clinicId/closures',
  optionalAuthenticate,
  validation.listClosures,
  validateRequest,
  controller.listClosures
);

router.delete(
  '/:clinicId/closures/:closureId',
  authenticate,
  authorize(...WRITE_ROLES),
  validation.deleteClosure,
  validateRequest,
  controller.deleteClosure
);

module.exports = router;
