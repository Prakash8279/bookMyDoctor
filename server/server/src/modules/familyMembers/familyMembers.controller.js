/**
 * Controllers for the familyMembers module.
 * Responsibility: parse req -> call the matching familyMembers.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const familyMembersService = require('./familyMembers.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const { page, pageSize } = req.query;
  const { rows, pagination } = await familyMembersService.listFamilyMembers(req.user.id, { page, pageSize });
  return success(res, rows, { pagination });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await familyMembersService.getFamilyMemberById(req.params.id, req.user.id);
  return success(res, row);
});

const create = asyncHandler(async (req, res) => {
  const row = await familyMembersService.createFamilyMember(req.user.id, req.body);
  return success(res, row, { statusCode: 201, message: 'Family member added' });
});

const update = asyncHandler(async (req, res) => {
  const row = await familyMembersService.updateFamilyMember(req.params.id, req.user.id, req.body);
  return success(res, row, { message: 'Family member updated' });
});

const remove = asyncHandler(async (req, res) => {
  await familyMembersService.deleteFamilyMember(req.params.id, req.user.id);
  return success(res, null, { message: 'Family member removed' });
});

module.exports = { list, getOne, create, update, remove };
