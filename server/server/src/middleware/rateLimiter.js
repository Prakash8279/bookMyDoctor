/**
 * express-rate-limit configurations.
 * Responsibility: export named limiters — authLimiter (strict, brute-force protection on
 * /auth/login + /auth/register), passwordChangeLimiter (strict, same brute-force class of
 * protection for PATCH /me/password, keyed per-authenticated-user instead of per-IP),
 * bookingLimiter (moderate, protects the booking write path), paymentLimiter (moderate, protects
 * the payment-recording write path — a financial mutation that also consumes the shared
 * payment_receipt_seq sequence), uploadLimiter (generous, protects the multipart file/document
 * upload write paths under /media), defaultLimiter (generous, applied globally, keyed by
 * authenticated user id when a valid Bearer token is present via a best-effort JWT decode, else
 * IP — see bestEffortUserIdFromRequest below). Backed by a Redis store in production so limits
 * are shared across horizontally-scaled instances, not per-process.
 */
const rateLimitModule = require('express-rate-limit');
const rateLimit = rateLimitModule.default || rateLimitModule;
// Newer express-rate-limit versions require IPv6 addresses to be normalized before use in a
// custom keyGenerator and export a helper to do it; older versions don't have it. Fall back to
// a plain identity function so bookingLimiter's custom keyGenerator works either way.
const ipKeyGenerator = rateLimitModule.ipKeyGenerator || ((ip) => ip);
const { RedisStore } = require('rate-limit-redis');
const jwt = require('jsonwebtoken');
const redisClient = require('../config/redis');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// Shared handler so every limiter's 429 uses the standard error envelope (via errorHandler.js)
// instead of express-rate-limit's default plaintext body.
function rateLimitHandler(req, res, next) {
  next(new ApiError(429, 'RATE_LIMITED', 'Too many requests, please try again later.'));
}

function makeRedisStore(prefix) {
  return new RedisStore({
    // rate-limit-redis v4's expected call signature for ioredis.
    sendCommand: (...args) => redisClient.call(...args),
    prefix,
  });
}

// Strict — brute-force protection on login/register. Keyed by IP (the default keyGenerator).
const authLimiter = rateLimit({
  windowMs: env.rateLimit.authWindowMinutes * 60 * 1000,
  max: env.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeRedisStore('rl:auth:'),
});

// Strict — brute-force protection on PATCH /me/password. changePassword() runs
// bcrypt.compare(currentPassword, ...), a credential-guessing surface functionally identical to
// login, but the caller already holds a valid access token (authenticate runs before this
// route). Keyed by the authenticated user's id rather than IP: an attacker holding a stolen
// token can't evade the limit by spreading guesses across source IPs the way they could against
// an IP-keyed limiter. Falls back to IP only in the defensive case where req.user is somehow
// unset (should never happen — this limiter is only ever mounted after `authenticate`).
const passwordChangeLimiter = rateLimit({
  windowMs: env.rateLimit.authWindowMinutes * 60 * 1000,
  max: env.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => (req.user && req.user.id) || ipKeyGenerator(req.ip),
  store: makeRedisStore('rl:pwchange:'),
});

// Moderate — protects the appointment/walk-in booking write path. Keyed by authenticated user
// when available (authenticate runs before this in the booking routes), falling back to IP for
// any unauthenticated caller. Exported now; consumed by the appointments module in a later phase.
const bookingLimiter = rateLimit({
  windowMs: env.rateLimit.bookingWindowMinutes * 60 * 1000,
  max: env.rateLimit.bookingMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => (req.user && req.user.id) || ipKeyGenerator(req.ip),
  store: makeRedisStore('rl:booking:'),
});

// Moderate — protects the payment-recording write path (POST /payments), which both moves money
// and consumes the shared payment_receipt_seq sequence. Keyed by authenticated user (authenticate
// runs before this in the payments routes), falling back to IP defensively.
const paymentLimiter = rateLimit({
  windowMs: env.rateLimit.paymentWindowMinutes * 60 * 1000,
  max: env.rateLimit.paymentMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => (req.user && req.user.id) || ipKeyGenerator(req.ip),
  store: makeRedisStore('rl:payment:'),
});

// Moderate — protects POST /auth/refresh specifically (previously only covered by the generous
// global defaultLimiter). Keyed by IP since this route is deliberately unauthenticated (see
// config/env.js's refreshMax/refreshWindowMinutes comment).
const refreshLimiter = rateLimit({
  windowMs: env.rateLimit.refreshWindowMinutes * 60 * 1000,
  max: env.rateLimit.refreshMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeRedisStore('rl:refresh:'),
});

// Generous — protects the multipart file/document upload write paths (POST /media/photo,
// /media/document, /media/qr — see modules/uploads/uploads.routes.js), which previously had no
// dedicated limiter at all despite accepting multipart bodies and writing to disk, unlike every
// other sensitive write path in this app. Keyed by authenticated user when available (authenticate
// runs before every /media route), falling back to IP for any unauthenticated caller — same
// pattern as bookingLimiter/paymentLimiter above. GET/download routes (secureDocument.routes.js,
// the /media list endpoints if any) are deliberately NOT covered by this limiter; only the
// upload-writing POST routes are.
// RATE-LIMIT FAIRNESS FOLLOW-UP (docs/api-load-test-issues-and-plan-2026-09-20.md, Phase 2 item
// 2) — window/max now come from config/env.js's rateLimit.uploadMax/uploadWindowMinutes
// (UPLOAD_RATE_LIMIT_MAX / UPLOAD_RATE_LIMIT_WINDOW_MINUTES), following the exact
// authMax/bookingMax pattern every other limiter here already uses, instead of being hardcoded
// constants only this limiter had. Defaults are unchanged (20 per 15 minutes), so this is a pure
// config-wiring change with no behavior change out of the box.
const uploadLimiter = rateLimit({
  windowMs: env.rateLimit.uploadWindowMinutes * 60 * 1000,
  max: env.rateLimit.uploadMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => (req.user && req.user.id) || ipKeyGenerator(req.ip),
  store: makeRedisStore('rl:upload:'),
});

// Best-effort: pulls an authenticated user id out of the Authorization header for RATE-LIMIT
// KEYING ONLY. Never throws, never enforces authentication — that stays authenticate.js's
// exclusive job further down the middleware chain. This exists only for defaultLimiter below.
//
// RATE-LIMIT FAIRNESS FIX (docs/api-load-test-issues-and-plan-2026-09-20.md, Phase 2 item 1):
// defaultLimiter is mounted globally in app.js's middleware chain BEFORE any route (and
// therefore before any route's own `authenticate` middleware) runs, so req.user is never set yet
// at the point defaultLimiter's keyGenerator executes — simply copying the
// `(req.user && req.user.id) || ipKeyGenerator(req.ip)` pattern the other limiters use would
// always fall through to IP here. A full authenticate()-style DB lookup on every single request
// just to pick a rate-limit bucket would also be far too expensive to run unconditionally, so
// this does a signature-only JWT verify instead (no DB round-trip) — cheap enough to run on every
// request, and it gets the same fairness benefit bookingLimiter/paymentLimiter/uploadLimiter/
// passwordChangeLimiter already have: a busy authenticated user gets their OWN bucket instead of
// sharing one IP-keyed bucket with every other patient/doctor/receptionist behind the same office
// wifi, hospital network, or mobile carrier NAT gateway.
//
// Deliberately does NOT call services/tokenService.js#verifyAccessToken here, even though the
// check is logically the same one — tokenService.js transitively requires config/db (the Prisma
// client) for its OTHER exports (issueRefreshToken, rotateRefreshToken, etc.), and this module is
// loaded by every route in the app at startup purely to compute a rate-limit key. Giving the rate
// limiter itself a hard dependency on the database being reachable, just to borrow one
// DB-independent function, is an avoidable coupling. This inlines the same secret-rotation-aware
// verify (current secret first, then the optional _PREVIOUS one — see config/env.js's
// jwt.accessVerifySecrets) and the same password-reset-token rejection (a reset token carries a
// `purpose` claim a real access token never has — see tokenService.js's own comment on this) with
// no DB dependency at all.
function bestEffortUserIdFromRequest(req) {
  const header = req.headers && req.headers.authorization;
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  for (const secret of env.jwt.accessVerifySecrets) {
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      // A password-reset token is signed with this same secret (see tokenService.js) but must
      // never double as an access token / rate-limit identity.
      if (payload.purpose) return null;
      return payload.sub || null;
    } catch (err) {
      // This candidate secret didn't match (or the token is expired/malformed) — try the next
      // candidate secret; if every one fails, fall through to the `return null` below, exactly
      // like a genuinely unauthenticated caller. Deliberately swallowed: this must never become a
      // second, redundant place that rejects bad tokens (authenticate.js already owns that for
      // the routes that actually require auth).
    }
  }
  return null;
}

// Generous — applied globally in app.js. Keyed by the authenticated user's id when a valid
// Bearer token is present (see bestEffortUserIdFromRequest above), falling back to IP for
// unauthenticated callers — same fairness pattern as bookingLimiter/paymentLimiter/etc.
const defaultLimiter = rateLimit({
  windowMs: env.rateLimit.defaultWindowMinutes * 60 * 1000,
  max: env.rateLimit.defaultMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => bestEffortUserIdFromRequest(req) || ipKeyGenerator(req.ip),
  store: makeRedisStore('rl:default:'),
});

module.exports = {
  authLimiter,
  passwordChangeLimiter,
  bookingLimiter,
  paymentLimiter,
  uploadLimiter,
  refreshLimiter,
  defaultLimiter,
  // Exported for direct unit testing of the Phase 2 item 1 keying fix (see its own header
  // comment above) — not consumed by any other module.
  bestEffortUserIdFromRequest,
};
