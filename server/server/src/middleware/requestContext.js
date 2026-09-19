/**
 * Wraps every request in an AsyncLocalStorage context carrying the client's real IP address
 * (utils/requestContext.js), so activityLogService.js can attach it to audit-log rows without
 * every one of its ~18 call sites needing to accept and forward `req`.
 *
 * Mounted in app.js immediately after `app.set('trust proxy', ...)` — req.ip already reflects
 * the real client address by the time this runs (same req.ip this app's rate limiters and
 * middleware/adminIpAllowlist.js already trust), and must run before any route handler so the
 * whole request lives inside the context.
 */
const requestContext = require('../utils/requestContext');

/**
 * req.ip is normally always populated once `trust proxy` is set (see config/env.js) — Express
 * falls back to the raw socket address when there's no X-Forwarded-For to trust. This extra
 * fallback chain only matters for the rare edge case where req.ip itself comes back empty (e.g.
 * a malformed/unsupported socket family): x-forwarded-for's first hop, then the raw socket
 * address, so a log row only ever has a null IP when literally nothing was available.
 * Also normalizes the IPv6-mapped-IPv4 form ("::ffff:127.0.0.1") down to plain "127.0.0.1" —
 * cosmetic only, same address either way, but far more readable in the admin activity log.
 * A bare "::1"/"127.0.0.1" IS the correct, complete address for a request made from the same
 * machine the server is running on (e.g. testing against localhost) — it is not a bug or a
 * truncated value.
 */
function resolveClientIp(req) {
  const raw =
    req.ip ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    null;
  if (!raw) return null;
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

module.exports = function requestContextMiddleware(req, res, next) {
  requestContext.run({ ip: resolveClientIp(req) }, next);
};
