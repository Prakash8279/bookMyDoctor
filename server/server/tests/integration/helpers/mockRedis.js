/**
 * Shared factory for a fresh mock `config/redis` (ioredis client) module, used by every
 * integration test file that requires the real `../../src/app` — no real Redis exists in this
 * sandbox, and `app.js` -> `routes/index.js` -> every module's `.routes.js` -> `rateLimiter.js`
 * (via `authLimiter`/`defaultLimiter`/etc., mounted on EVERY route module including ones a given
 * test never hits) requires `config/redis` transitively at require-time, same as
 * `services/cacheService.js`.
 *
 * `call(...)` specifically backs `middleware/rateLimiter.js`'s `sendCommand: (...args) =>
 * redisClient.call(...args)`, which `rate-limit-redis`'s RedisStore uses to run two Lua scripts
 * via raw `SCRIPT LOAD` / `EVALSHA` commands (see node_modules/rate-limit-redis/dist/index.cjs):
 *   - `SCRIPT LOAD <lua>` MUST resolve to a string (RedisStore throws "unexpected reply from
 *     redis client" otherwise) — this stands in a fake-but-valid-looking sha.
 *   - `EVALSHA <sha> ...` MUST resolve to a 2-element array `[totalHits, timeToExpireMs]` (see
 *     `parseScriptResponse` in that same file) — this always answers `[1, windowMs]`, i.e. "this
 *     is the first hit in the window", so every request is always allowed regardless of how many
 *     requests a test sends. That is deliberate: these tests exercise real route/validation/
 *     service logic, not express-rate-limit's own counting behavior (which has no dedicated
 *     integration coverage here and doesn't need any — it's a well-tested third-party library).
 *
 * `get`/`set`/`scan`/`unlink` back `services/cacheService.js`'s cache-aside helpers (getOrSet/
 * invalidate) — defaulted to "always a cache miss, and a no-op invalidate" (get resolves null,
 * scan resolves an empty completed cursor) so every cached read in a test falls straight through
 * to the mocked Prisma layer instead of ever needing a realistic cache hit/miss dance.
 */
function createMockRedis() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    unlink: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue(['0', []]),
    on: jest.fn(),
    call: jest.fn((command) => {
      if (command === 'SCRIPT') return Promise.resolve('mock-lua-script-sha1');
      if (command === 'EVALSHA') return Promise.resolve([1, 1000]);
      return Promise.resolve(null);
    }),
  };
}

module.exports = createMockRedis;
