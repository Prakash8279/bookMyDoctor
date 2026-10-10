/**
 * Controllers for the auth module.
 * Responsibility: parse req -> call the matching auth.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const authService = require('./auth.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const { applyAuthCookies, clearAuthCookie, resolveIncomingRefreshToken } = require('../../utils/webClientAuth');

const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, city, emailOtp } = req.body;
  await authService.verifyRegistrationEmailOtp({ email, otp: emailOtp });
  const result = await authService.register({ name, email, password, phone, city });
  // WEB-ONLY REFRESH-COOKIE FIX (risky-item #2) — see utils/webClientAuth.js. For a web caller
  // this sets the httpOnly cookie and strips refreshToken out of the body; for anyone else
  // (mobile, tests, a direct API caller) `result` passes through completely unchanged.
  return success(res, applyAuthCookies(req, res, result), { statusCode: 201, message: 'Registration successful' });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login({ email, password });
  return success(res, applyAuthCookies(req, res, result));
});

// GOOGLE SIGN-IN (user request: "google work nahi kar rah hai fix kro"). Handles login,
// account-linking, and self-registration all in one call — see auth.service.js#googleAuth.
const googleAuth = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  const result = await authService.googleAuth({ idToken });
  return success(res, applyAuthCookies(req, res, result));
});

const logout = asyncHandler(async (req, res) => {
  // WEB-ONLY REFRESH-COOKIE FIX — a web caller never sends refreshToken in the body (it lives
  // only in the httpOnly cookie); resolveIncomingRefreshToken reads whichever one is actually
  // present, so mobile's existing body-based flow is untouched.
  const refreshToken = resolveIncomingRefreshToken(req);
  await authService.logout({ userId: req.user.id, role: req.user.role, refreshToken });
  clearAuthCookie(req, res);
  return success(res, null, { message: 'Logged out' });
});

const refresh = asyncHandler(async (req, res) => {
  const refreshToken = resolveIncomingRefreshToken(req);
  const result = await authService.refresh({ refreshToken });
  return success(res, applyAuthCookies(req, res, result));
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

const sendRegistrationEmailOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await authService.sendRegistrationEmailOtp({ email });
  return success(res, result);
});

module.exports = {
  register,
  login,
  googleAuth,
  logout,
  refresh,
  me,
  forgotPassword,
  resetPassword,
  sendRegistrationEmailOtp,
};
