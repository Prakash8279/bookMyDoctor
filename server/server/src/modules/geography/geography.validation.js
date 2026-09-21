/**
 * express-validator chains for every geography endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "city already exists") belongs in the
 * service layer.
 */
const { body, param, query } = require('express-validator');

const PINCODE_RE = /^\d{6}$/;

// search filter removed (backend-cleanup audit — user request: "website frontend me nahi hai but
// backend bna hua hai to backend se hata do"): neither web nor mobile ever sends a `search` param
// to any of the three geography list endpoints — every caller just fetches the full
// city/area/specialization list (paginated) for a dropdown.
const listCities = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const listAreas = [
  query('cityId').optional({ values: 'falsy' }).isUUID().withMessage('cityId must be a valid id.'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const listSpecializations = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const createCity = [
  body('name').trim().notEmpty().withMessage('name is required.').isLength({ max: 150 }),
  body('state').optional({ values: 'falsy' }).trim().isLength({ max: 150 }),
];

const createArea = [
  param('cityId').isUUID().withMessage('cityId must be a valid id.'),
  body('name').trim().notEmpty().withMessage('name is required.').isLength({ max: 150 }),
  body('pincode')
    .optional({ values: 'falsy' })
    .trim()
    .matches(PINCODE_RE)
    .withMessage('pincode must be a 6-digit code.'),
];

const createSpecialization = [
  body('name').trim().notEmpty().withMessage('name is required.').isLength({ max: 150 }),
  body('icon').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
];

const deleteCity = [param('cityId').isUUID().withMessage('cityId must be a valid id.')];

const deleteArea = [
  param('cityId').isUUID().withMessage('cityId must be a valid id.'),
  param('areaId').isUUID().withMessage('areaId must be a valid id.'),
];

const deleteSpecialization = [
  param('specializationId').isUUID().withMessage('specializationId must be a valid id.'),
];

module.exports = {
  listCities,
  listAreas,
  listSpecializations,
  createCity,
  createArea,
  createSpecialization,
  deleteCity,
  deleteArea,
  deleteSpecialization,
};
