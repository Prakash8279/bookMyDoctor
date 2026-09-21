/**
 * Route definitions for the medicalRecords module.
 * Scope: EMR entries linked to patient/doctor/appointment.
 * Allowed roles: doctor (write), doctor+patient+admin+superadmin (read own/scoped) —
 * receptionist is deliberately excluded from read access: EMR is clinical data, not front-desk
 * data.
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in medicalRecords.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./medicalRecords.validation');
const controller = require('./medicalRecords.controller');

const READ_ROLES = ['doctor', 'patient', 'admin', 'superadmin'];

router.post(
  '/',
  authenticate,
  authorize('doctor'),
  validation.createMedicalRecord,
  validateRequest,
  controller.createMedicalRecord
);

router.get(
  '/',
  authenticate,
  authorize(...READ_ROLES),
  validation.listMedicalRecords,
  validateRequest,
  controller.listMedicalRecords
);

// GET /:id removed (backend-cleanup audit — user request: "website frontend me nahi hai but
// backend bna hua hai to backend se hata do"): neither web nor mobile ever fetches a single
// medical record by id — every screen works off the GET / list.

module.exports = router;
