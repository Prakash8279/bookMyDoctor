/**
 * Route definitions for the geography module.
 * Scope: Cities, areas, specializations reference data.
 * Allowed roles: public read, admin write
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in geography.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./geography.validation');
const controller = require('./geography.controller');

// Public reads.
router.get('/cities', validation.listCities, validateRequest, controller.listCities);
router.get('/areas', validation.listAreas, validateRequest, controller.listAreas);
router.get('/specializations', validation.listSpecializations, validateRequest, controller.listSpecializations);

// Admin-only writes.
router.post(
  '/cities',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.createCity,
  validateRequest,
  controller.createCity
);
router.post(
  '/cities/:cityId/areas',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.createArea,
  validateRequest,
  controller.createArea
);
router.post(
  '/specializations',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.createSpecialization,
  validateRequest,
  controller.createSpecialization
);

// Admin-only deletes. Guarded in the service layer against wiping areas/clinics still in use —
// see geography.service.js#deleteCity / #deleteArea.
router.delete(
  '/cities/:cityId',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.deleteCity,
  validateRequest,
  controller.deleteCity
);
router.delete(
  '/cities/:cityId/areas/:areaId',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.deleteArea,
  validateRequest,
  controller.deleteArea
);
router.delete(
  '/specializations/:specializationId',
  authenticate,
  authorize('admin', 'superadmin'),
  validation.deleteSpecialization,
  validateRequest,
  controller.deleteSpecialization
);

module.exports = router;
