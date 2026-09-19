/**
 * Controllers for the me module.
 * Responsibility: parse req -> call the matching me.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const meService = require('./me.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const getMe = asyncHandler(async (req, res) => {
  const data = await meService.getMe(req.user.id);
  return success(res, data);
});

const updateMe = asyncHandler(async (req, res) => {
  const data = await meService.updateMe(req.user.id, req.user.role, req.body);
  return success(res, data, { message: 'Profile updated' });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await meService.changePassword(req.user.id, req.user.role, { currentPassword, newPassword });
  return success(res, null, { message: 'Password updated. Please log in again on your other devices.' });
});

module.exports = { getMe, updateMe, changePassword };
