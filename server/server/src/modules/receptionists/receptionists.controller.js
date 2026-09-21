/**
 * Controllers for the receptionists module.
 * Responsibility: parse req -> call the matching receptionists.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const receptionistsService = require('./receptionists.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const create = asyncHandler(async (req, res) => {
  const row = await receptionistsService.createReceptionist(req.body, req.user);
  return success(res, row, { statusCode: 201, message: 'Receptionist account created' });
});

const list = asyncHandler(async (req, res) => {
  const { clinicId, page, pageSize } = req.query;
  const { rows, pagination } = await receptionistsService.listReceptionists({ clinicId, page, pageSize }, req.user);
  return success(res, rows, { pagination });
});

// getOne handler removed (backend-cleanup audit) — see receptionists.routes.js's comment.

module.exports = { create, list };
