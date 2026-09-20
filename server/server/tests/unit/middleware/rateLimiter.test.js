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

const { uploadLimiter, authLimiter, bookingLimiter, paymentLimiter } = require('../../../src/middleware/rateLimiter');

function fakeReqResNext({ user } = {}) {
  const req = { ip: '127.0.0.1', user, headers: {} };
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
});
