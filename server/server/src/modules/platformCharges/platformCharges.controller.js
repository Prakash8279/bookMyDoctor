/**
 * Controllers for the platformCharges module.
 * Responsibility: parse req -> call the matching platformCharges.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const platformChargesService = require('./platformCharges.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const getCharges = asyncHandler(async (req, res) => {
  const data = await platformChargesService.getPlatformCharges(req.user.role);
  return success(res, data);
});

const updateCharges = asyncHandler(async (req, res) => {
  const data = await platformChargesService.updatePlatformCharges(req.body, req.user);
  return success(res, data, { message: 'Platform charges updated.' });
});

module.exports = { getCharges, updateCharges };
