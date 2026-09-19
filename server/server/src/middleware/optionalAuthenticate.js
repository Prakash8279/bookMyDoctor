/**
 * Like middleware/authenticate.js (same JWT verification + live Postgres status re-check), but
 * NEVER rejects the request. Used on public-but-role-enhanced GET endpoints (doctor directory,
 * clinic directory) that must work for anonymous callers per FRONTEND_SCREENS_REPORT.md
 * ("ClinicSearch, public — feeds the patient booking flow") while still letting the record's
 * own doctor or an admin see more (pending/disabled records) than the public gets.
 *
 * - A valid, non-expired access token for a still-active account -> req.user = {id, role}.
 * - Anything else (no header, malformed header, expired/invalid token, disabled account,
 *   deleted user) -> req.user stays undefined and next() is still called. This route class
 *   must never 401 an anonymous visitor just because they sent a stale/garbage token.
 */
const tokenService = require('../services/tokenService');
const prisma = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

module.exports = asyncHandler(async function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next();
  }

  let payload;
  try {
    payload = tokenService.verifyAccessToken(token);
  } catch (err) {
    return next();
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true },
  });

  if (user && user.status !== 'disabled') {
    req.user = { id: user.id, role: user.role };
  }

  next();
});
