/**
 * Shared helpers for the web-only httpOnly-cookie refresh-token flow (risky-item #2 from
 * docs/risky-fixes-plan-2026-09-20.md — "the refresh token sits in localStorage, so any XSS on
 * the web app can steal a long-lived (30-day) session, not just the short-lived access token").
 *
 * THE FLOW, END TO END:
 *   - The web frontend (client/src/lib/apiClient.js) sends `X-Client-Platform: web` on every
 *     request and `withCredentials: true` so the browser sends/accepts cookies cross-port in dev
 *     and cross-subdomain in a real deployment.
 *   - Every controller that issues or rotates a token pair (auth.controller.js's
 *     register/login/googleAuth/refresh, doctors.controller.js's registerDoctor) calls
 *     applyAuthCookies(req, res, result) here instead of returning `result` directly. For a web
 *     caller, the refresh token is set as an httpOnly cookie and stripped out of the JSON body;
 *     for anything else — the Flutter mobile app, a curl/Postman call, this backend's own test
 *     suite — the response is byte-for-byte what it always was (refreshToken in the body).
 *     MOBILE NEEDS ZERO CHANGES: it simply never sends the header, so it always gets the old
 *     body-based shape, and flutter_secure_storage was already the right place for it anyway.
 *   - auth.controller.js's refresh/logout call resolveIncomingRefreshToken(req) instead of
 *     reading req.body.refreshToken directly, so a web caller's cookie-borne token and a mobile
 *     caller's body-borne token both reach the exact same tokenService functions.
 *   - logout also calls clearAuthCookie(req, res) so the browser drops the cookie immediately
 *     (belt-and-suspenders alongside the server-side revocation that already happens either way).
 *
 * WHY A HEADER, NOT SNIFFING User-Agent: a plain custom header the frontend sets on every axios
 * call is explicit and untamperable-in-a-way-that-matters — a malicious page can't forge this
 * header cross-origin any more than it could forge an Authorization header, and unlike
 * User-Agent sniffing it needs no maintenance as browsers/devices change their UA strings.
 *
 * WHY SameSite=Lax's CSRF STORY IS FINE: the cookie is only ever read on POST /auth/refresh and
 * POST /auth/logout, both idempotent-ish and scoped to the caller's OWN session (worst case for
 * a forged cross-site call: an attacker triggers a token rotation or a logout — annoying, not a
 * data leak, and the attacker can never read the response either way because CORS blocks that).
 * SameSite=Lax cookies are additionally never attached to a cross-SITE POST in the first place
 * (only "safe" top-level navigations), which already blocks a forged form/fetch from a third-party
 * origin from carrying this cookie at all. If a real deployment ever needs the API and the web
 * app on genuinely different registrable domains (not just different ports/subdomains) and sets
 * REFRESH_COOKIE_SAME_SITE=none for that reason, that specific protection is lost — a real
 * CSRF-token scheme would be the correct follow-up at that point, flagged here rather than
 * silently assumed away.
 */
const env = require('../config/env');
const { parseDurationToMs } = require('../services/tokenService');

const REFRESH_COOKIE_NAME = 'refreshToken';
// Scoped to /auth (not the whole API) so this cookie is only ever sent on the two endpoints that
// actually need it (POST /auth/refresh, POST /auth/logout) — smaller request headers on every
// other call, and one less thing an unrelated endpoint could accidentally read.
const REFRESH_COOKIE_PATH = '/auth';

function isWebClient(req) {
  return req.headers['x-client-platform'] === 'web';
}

function refreshCookieOptions() {
  const sameSite = env.refreshCookieSameSite;
  return {
    httpOnly: true,
    // SameSite=None is rejected by every modern browser unless Secure is also set, regardless of
    // environment — so this is `true` whenever that's the configured mode, not just in
    // production. Plain 'lax'/'strict' still requires Secure in production (a real HTTPS
    // deployment) but stays false in local dev over plain http, where Secure would silently drop
    // the cookie entirely.
    secure: env.isProduction || sameSite === 'none',
    sameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: parseDurationToMs(env.jwt.refreshExpiresIn),
  };
}

/**
 * Reads the refresh token a request presented, preferring the request body (mobile's existing
 * flow, and any non-web caller) and falling back to the httpOnly cookie (web). A web client
 * never sends a body refreshToken at all (see apiClient.js), so this is not an either/or choice
 * a caller makes — it's just "whichever one is actually present".
 * @param {import('express').Request} req
 * @returns {string|undefined}
 */
function resolveIncomingRefreshToken(req) {
  if (req.body && req.body.refreshToken) return req.body.refreshToken;
  return req.cookies ? req.cookies[REFRESH_COOKIE_NAME] : undefined;
}

/**
 * Shapes a {user?, accessToken, refreshToken, ...rest} auth result for the response, setting the
 * httpOnly cookie and stripping refreshToken from the body for a web caller, or passing the
 * result through completely unchanged for anyone else (mobile, tests, direct API callers).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{accessToken:string, refreshToken:string, [key:string]: any}} result
 */
function applyAuthCookies(req, res, result) {
  if (!isWebClient(req)) return result;

  const { refreshToken, ...rest } = result;
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  return rest;
}

/**
 * Clears the refresh-token cookie on logout. Safe to call for a non-web caller too (no cookie
 * was ever set, so this just becomes a harmless Set-Cookie with an already-expired value) — but
 * callers only need to bother for a web request in practice.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function clearAuthCookie(req, res) {
  // clearCookie must be called with the SAME path/sameSite/secure attributes the cookie was set
  // with, or the browser treats it as a different cookie and leaves the original in place.
  const { maxAge, ...clearOptions } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
}

module.exports = {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  isWebClient,
  refreshCookieOptions,
  resolveIncomingRefreshToken,
  applyAuthCookies,
  clearAuthCookie,
};
