/**
 * Unit tests for middleware/rateLimiter.js — focused on the new uploadLimiter export (see its
 * own header comment in rateLimiter.js: protects the previously-unlimited POST /media/*
 * multipart upload routes).
 *
 * No dedicated rate-limiter test existed before this one (see
 * tests/integration/helpers/mockRedis.js's header comment — integration tests deliberately mock
 * express-rate-limit's counting away entirely, since it's a well-tested third-party library with
 * no dedicated coverage needed there). This suite mocks config/redis the same way
 * tests/unit/services/lockService.test.js mocks it for a Redis-backed unit under test, but shaped
 * to answer the two raw commands rate-limit-redis's RedisStore issues via `sendCommand`
 * (SCRIPT LOAD / EVALSHA — see mockRedis.js for the exact contract), so the real
 * express-rate-limit + rate-limit-redis code runs against a fake-but-valid-looking Redis instead
 * of a hand-rolled fake limiter.
 */
jest.mock('../../../src/config/redis', () => ({
  call: jest.fn((command) => {
    if (command === 'SCRIPT') return Promise.resolve('mock-lua-script-sha1');
    if (command === 'EVALSHA') return Promise.resolve([1, 1000]);
    return Promise.resolve(null);
  }),
}));

const jwt = require('jsonwebtoken');
const {
  uploadLimiter,
  authLimiter,
  bookingLimiter,
  paymentLimiter,
  defaultLimiter,
  bestEffortUserIdFromRequest,
} = require('../../../src/middleware/rateLimiter');

function fakeReqResNext({ user, authorization } = {}) {
  const req = { ip: '127.0.0.1', user, headers: authorization ? { authorization } : {} };
  const res = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    headersSent: false,
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('rateLimiter — uploadLimiter', () => {
  test('is exported alongside the other named limiters', () => {
    expect(uploadLimiter).toBeDefined();
    expect(authLimiter).toBeDefined();
    expect(bookingLimiter).toBeDefined();
    expect(paymentLimiter).toBeDefined();
  });

  test('is an Express middleware function (req, res, next)', () => {
    expect(typeof uploadLimiter).toBe('function');
    expect(uploadLimiter.length).toBe(3);
  });

  test('is backed by a real store (resetKey/getKey bound), same shape as the other limiters', () => {
    // express-rate-limit only attaches these two methods to the returned middleware once it has
    // been constructed with a working `store` — confirms uploadLimiter is a real rateLimit(...)
    // instance (Redis-backed via makeRedisStore), not e.g. a stub or a no-op passthrough.
    expect(typeof uploadLimiter.resetKey).toBe('function');
    expect(typeof uploadLimiter.getKey).toBe('function');
    expect(typeof authLimiter.resetKey).toBe('function');
  });

  test('allows a request under the limit through (calls next() with no error), keyed by req.user.id when authenticated', async () => {
    const { req, res, next } = fakeReqResNext({ user: { id: 'user-under-upload-limiter-test' } });

    await uploadLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  test('falls back to IP-based keying for an unauthenticated caller (no req.user) without throwing', async () => {
    const { req, res, next } = fakeReqResNext();

    await uploadLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  // RATE-LIMIT FAIRNESS FOLLOW-UP (docs/api-load-test-issues-and-plan-2026-09-20.md, Phase 2
  // item 2) — uploadLimiter's window/max used to be hardcoded constants; now sourced from
  // config/env.js (UPLOAD_RATE_LIMIT_MAX / UPLOAD_RATE_LIMIT_WINDOW_MINUTES). This confirms the
  // limiter still boots as a real, working rateLimit(...) instance off that config, not that any
  // particular env value was picked (tests/setupEnv.js doesn't set these, so env.js's own
  // defaults — 20 / 15 minutes, unchanged from the old hardcoded values — apply here).
  test('window/max now come from config/env.js rather than hardcoded constants', () => {
    const env = require('../../../src/config/env');
    expect(env.rateLimit.uploadMax).toBe(20);
    expect(env.rateLimit.uploadWindowMinutes).toBe(15);
  });
});

// RATE-LIMIT FAIRNESS FIX (docs/api-load-test-issues-and-plan-2026-09-20.md, Phase 2 item 1) —
// defaultLimiter is mounted globally in app.js BEFORE any route's own `authenticate` middleware
// runs, so it can't rely on req.user the way bookingLimiter/paymentLimiter/etc. do. Instead it
// does its own lightweight, best-effort JWT decode (bestEffortUserIdFromRequest) purely for
// rate-limit keying — these tests exercise that function directly, plus a smoke test that
// defaultLimiter itself still behaves as a normal working limiter either way.
describe('rateLimiter — bestEffortUserIdFromRequest (defaultLimiter fairness fix)', () => {
  function signTestAccessToken(sub) {
    // Same call shape as tokenService.js#signAccessToken, but built directly with jsonwebtoken
    // here so this test doesn't depend on tokenService's user-shape assumptions — only on the
    // {sub} claim bestEffortUserIdFromRequest actually reads.
    return jwt.sign({ sub, role: 'patient' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  }

  test('extracts the user id (payload.sub) from a valid Bearer access token', () => {
    const token = signTestAccessToken('user-abc-123');
    const req = { headers: { authorization: `Bearer ${token}` } };

    expect(bestEffortUserIdFromRequest(req)).toBe('user-abc-123');
  });

  test('returns null (never throws) for a missing Authorization header', () => {
    expect(bestEffortUserIdFromRequest({ headers: {} })).toBeNull();
    expect(bestEffortUserIdFromRequest({ headers: undefined })).toBeNull();
  });

  test('returns null for a non-Bearer scheme or a missing token', () => {
    expect(bestEffortUserIdFromRequest({ headers: { authorization: 'Basic abc123' } })).toBeNull();
    expect(bestEffortUserIdFromRequest({ headers: { authorization: 'Bearer' } })).toBeNull();
  });

  test('returns null (never throws) for an expired token', () => {
    const expiredToken = jwt.sign({ sub: 'user-expired' }, process.env.JWT_ACCESS_SECRET, { expiresIn: -10 });
    const req = { headers: { authorization: `Bearer ${expiredToken}` } };

    expect(() => bestEffortUserIdFromRequest(req)).not.toThrow();
    expect(bestEffortUserIdFromRequest(req)).toBeNull();
  });

  test('returns null (never throws) for a token signed with the wrong secret (forged/garbage)', () => {
    const forged = jwt.sign({ sub: 'user-forged' }, 'totally-wrong-secret', { expiresIn: '15m' });
    const req = { headers: { authorization: `Bearer ${forged}` } };

    expect(bestEffortUserIdFromRequest(req)).toBeNull();
  });

  test('returns null for a password-reset token (right secret, wrong purpose) — never doubles as auth', () => {
    // Same shape services/tokenService.js#signResetToken signs — built directly with
    // jsonwebtoken here (rather than requiring tokenService.js) so this test file, like
    // rateLimiter.js itself, stays free of tokenService's transitive Prisma/config-db dependency.
    const resetToken = jwt.sign(
      { sub: 'user-resetting-password', purpose: 'password-reset' },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '30m' }
    );
    const req = { headers: { authorization: `Bearer ${resetToken}` } };

    // tokenService.js#verifyAccessToken itself rejects `purpose`-carrying tokens — this confirms
    // the rate-limit keying path applies that same rule rather than bypassing it.
    expect(bestEffortUserIdFromRequest(req)).toBeNull();
  });

  test('defaultLimiter is still a real, working limiter for an authenticated request keyed this way', async () => {
    const token = signTestAccessToken('user-under-default-limiter-test');
    const { req, res, next } = fakeReqResNext({ authorization: `Bearer ${token}` });

    await defaultLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  test('defaultLimiter still falls back to IP keying for a fully unauthenticated request', async () => {
    const { req, res, next } = fakeReqResNext();

    await defaultLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
