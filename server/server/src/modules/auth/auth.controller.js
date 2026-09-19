/**
 * Controllers for the auth module.
 * Responsibility: parse req -> call the matching auth.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const authService = require('./auth.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, city } = req.body;
  const result = await authService.register({ name, email, password, phone, city });
  return success(res, result, { statusCode: 201, message: 'Registration successful' });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login({ email, password });
  return success(res, result);
});

const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await authService.logout({ userId: req.user.id, role: req.user.role, refreshToken });
  return success(res, null, { message: 'Logged out' });
});

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refresh({ refreshToken });
  return success(res, result);
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  return success(res, user);
});

// Always 200 with this same generic message, whether or not the email belongs to a real
// (enabled) account — see auth.service.js#forgotPassword for the enumeration-avoidance reasoning.
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  await authService.forgotPassword({ email });
  return success(res, null, { message: 'If an account exists for that email, a password reset link has been sent.' });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  await authService.resetPassword({ token, newPassword });
  return success(res, null, { message: 'Your password has been reset. Please log in with your new password.' });
});

module.exports = { register, login, logout, refresh, me, forgotPassword, resetPassword };
