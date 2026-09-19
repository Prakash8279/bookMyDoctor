/**
 * Controllers for the geography module.
 * Responsibility: parse req -> call the matching geography.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const geographyService = require('./geography.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const listCities = asyncHandler(async (req, res) => {
  const { search, page, pageSize } = req.query;
  const { rows, pagination } = await geographyService.listCities({ search, page, pageSize });
  return success(res, rows, { pagination });
});

const listAreas = asyncHandler(async (req, res) => {
  const { cityId, search, page, pageSize } = req.query;
  const { rows, pagination } = await geographyService.listAreas({ cityId, search, page, pageSize });
  return success(res, rows, { pagination });
});

const listSpecializations = asyncHandler(async (req, res) => {
  const { search, page, pageSize } = req.query;
  const { rows, pagination } = await geographyService.listSpecializations({ search, page, pageSize });
  return success(res, rows, { pagination });
});

const createCity = asyncHandler(async (req, res) => {
  const city = await geographyService.createCity(req.body, req.user);
  return success(res, city, { statusCode: 201, message: 'City created' });
});

const createArea = asyncHandler(async (req, res) => {
  const area = await geographyService.createArea(req.params.cityId, req.body, req.user);
  return success(res, area, { statusCode: 201, message: 'Area created' });
});

const createSpecialization = asyncHandler(async (req, res) => {
  const specialization = await geographyService.createSpecialization(req.body, req.user);
  return success(res, specialization, { statusCode: 201, message: 'Specialization created' });
});

const deleteCity = asyncHandler(async (req, res) => {
  await geographyService.deleteCity(req.params.cityId, req.user);
  return success(res, null, { message: 'City deleted' });
});

const deleteArea = asyncHandler(async (req, res) => {
  await geographyService.deleteArea(req.params.cityId, req.params.areaId, req.user);
  return success(res, null, { message: 'Area deleted' });
});

const deleteSpecialization = asyncHandler(async (req, res) => {
  await geographyService.deleteSpecialization(req.params.specializationId, req.user);
  return success(res, null, { message: 'Specialization deleted' });
});

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
