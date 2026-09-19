/**
 * Optional IP allowlist for the admin API surface (system settings, booking rules, activity
 * log, dashboard stats). Responsibility: if env.adminIpAllowlist is non-empty, reject any
 * request whose req.ip is not an exact match with a 403; if it's empty/unset, pass through
 * unchanged.
 *
 * Deliberately opt-in and no-op by default: this app currently has zero admin IP restriction,
 * and every existing deployment (and anyone who hasn't set ADMIN_IP_ALLOWLIST) must keep
 * working exactly as before. An operator who wants this protection sets ADMIN_IP_ALLOWLIST in
 * their env; nobody else is affected.
 *
 * Exact string match only — no CIDR parsing. req.ip is trustworthy here because app.js sets
 * `trust proxy` from env.trustProxyHops (see config/env.js), so it reflects the real client
 * address rather than the proxy's own address or an attacker-forged X-Forwarded-For entry.
 *
 * Mounted as the very first middleware in admin.routes.js, before authenticate/authorize, so a
 * request from an unlisted IP is rejected with the cheapest possible check instead of paying
 * for a JWT verify + DB lookup first.
 */
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

module.exports = function adminIpAllowlist(req, res, next) {
  if (env.adminIpAllowlist.length === 0) {
    return next();
  }

  if (!env.adminIpAllowlist.includes(req.ip)) {
    return next(new ApiError(403, 'FORBIDDEN', 'Access to the admin API is not allowed from this network location.'));
  }

  next();
};
