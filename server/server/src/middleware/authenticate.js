/**
 * Verifies the JWT access token on the Authorization header, attaches req.user = {id, role}.
 * Responsibility: reject missing/expired/invalid tokens with 401. Does NOT check role/permissions
 * (that's authorize.js) — this only confirms WHO is calling, not WHAT they're allowed to do.
 *
 * Re-checks id/role/status against Postgres on every request (rather than trusting the JWT's
 * embedded role alone) so a disabled account or a role change takes effect immediately instead
 * of waiting out the access token's lifetime.
 */
const jwt = require('jsonwebtoken');
const tokenService = require('../services/tokenService');
const prisma = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

module.exports = asyncHandler(async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required to access this resource.');
  }

  let payload;
  try {
    payload = tokenService.verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, 'TOKEN_EXPIRED', 'Access token has expired.');
    }
    throw new ApiError(401, 'TOKEN_INVALID', 'Access token is invalid.');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true },
  });

  if (!user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required to access this resource.');
  }

  if (user.status === 'disabled') {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
  }

  req.user = { id: user.id, role: user.role };
  next();
});
