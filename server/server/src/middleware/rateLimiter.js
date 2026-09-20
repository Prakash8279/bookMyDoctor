/**
 * express-rate-limit configurations.
 * Responsibility: export named limiters — authLimiter (strict, brute-force protection on
 * /auth/login + /auth/register), passwordChangeLimiter (strict, same brute-force class of
 * protection for PATCH /me/password, keyed per-authenticated-user instead of per-IP),
 * bookingLimiter (moderate, protects the booking write path), paymentLimiter (moderate, protects
 * the payment-recording write path — a financial mutation that also consumes the shared
 * payment_receipt_seq sequence), uploadLimiter (generous, protects the multipart file/document
 * upload write paths under /media), defaultLimiter (generous, applied globally). Backed by a
 * Redis store in production so limits are shared across horizontally-scaled instances, not
 * per-process.
 */
const rateLimitModule = require('express-rate-limit');
const rateLimit = rateLimitModule.default || rateLimitModule;
// Newer express-rate-limit versions require IPv6 addresses to be normalized before use in a
// custom keyGenerator and export a helper to do it; older versions don't have it. Fall back to
// a plain identity function so bookingLimiter's custom keyGenerator works either way.
const ipKeyGenerator = rateLimitModule.ipKeyGenerator || ((ip) => ip);
const { RedisStore } = require('rate-limit-redis');
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
// NOTE: unlike the limiters above, this isn't wired through config/env.js's configurable
// rateLimit block (env.js was out of scope for this change) — windowMs/max are fixed constants
// here. Wiring in UPLOAD_RATE_LIMIT_MAX / UPLOAD_RATE_LIMIT_WINDOW_MINUTES env vars, following the
// authMax/bookingMax pattern above, would be a natural follow-up.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => (req.user && req.user.id) || ipKeyGenerator(req.ip),
  store: makeRedisStore('rl:upload:'),
});

// Generous — applied globally in app.js. Keyed by IP.
const defaultLimiter = rateLimit({
  windowMs: env.rateLimit.defaultWindowMinutes * 60 * 1000,
  max: env.rateLimit.defaultMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
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
};
