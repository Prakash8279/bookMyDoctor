/**
 * Cache-aside helpers over Redis: getOrSet(key, ttlSeconds, fetchFn), invalidate(keyOrPattern).
 * Responsibility: used by read-heavy list endpoints (doctor search, dashboards) across every
 * panel so most reads never touch Postgres directly. Callers own their own cache keys/TTLs.
 *
 * Design notes (read before adding a new cached endpoint):
 *
 * 1. FAIL-OPEN. Any Redis error (get/set/scan/del) is caught here, logged, and the call falls
 *    through to behaving as a cache miss (getOrSet just calls fetchFn(); invalidate silently
 *    no-ops). A Redis outage must never turn into a 500 for a caller that was only trying to
 *    speed up a read, and must never block a mutation waiting to invalidate a key that doesn't
 *    matter anymore anyway.
 *
 * 2. WHAT GETS CACHED. getOrSet caches the fully-shaped, final response value returned by
 *    fetchFn — e.g. the exact `{ rows, pagination }` object a service function would otherwise
 *    return directly — never raw Prisma rows. This is stored as `JSON.stringify(value)` and
 *    restored as `JSON.parse(cached)`. Because res.json() itself calls `.toJSON()` on any
 *    Prisma.Decimal on the way out (turning it into a string) regardless of whether the value
 *    came from a fresh Prisma call or a cache hit, callers see IDENTICAL shapes on hit vs miss
 *    AS LONG AS they cache the already-shaped response (post `shapeX()`/masking step), not
 *    pre-shaped Prisma rows. Caching a raw Decimal and JSON.parse-ing it back would silently
 *    turn it into a plain number, losing precision guarantees — never do that.
 *
 * 3. CACHE-KEY SCOPING MUST MATCH RESPONSE SCOPING. Wherever a wrapped function's output varies
 *    by requester (role-based masking, ownership scoping), the cache key MUST encode role +
 *    requester id (or the narrowest owning scope, e.g. clinicId for a receptionist view) —
 *    otherwise one user's cached, differently-shaped response can leak to another user. Callers
 *    build their own keys via an explicit template literal listing every filter that affects the
 *    output, in a fixed order — no generic hashing here, so keys stay greppable in `redis-cli
 *    KEYS 'cache:*'` during debugging. Suggested convention:
 *      cache:<module>:<endpoint>:<scope-parts>:<explicit-query-params-in-fixed-order>
 *
 * 4. INVALIDATION. `invalidate(key)` on a literal key (no '*') issues a single DEL. A key
 *    containing '*' is treated as a MATCH pattern and walked with SCAN (never KEYS, which
 *    blocks the whole Redis event loop) in small batches, UNLINK-ing each batch (UNLINK frees
 *    memory asynchronously in Redis, unlike DEL, so it doesn't block other clients even for a
 *    large match set).
 */
const redis = require('../config/redis');
const logger = require('../config/logger');

const SCAN_COUNT = 200;

/**
 * Cache-aside read: return the cached value for `key` if present, otherwise call `fetchFn()`,
 * cache its resolved value for `ttlSeconds`, and return it. Never throws on a Redis problem —
 * degrades to always calling fetchFn().
 * @param {string} key - full cache key, see scoping rules above.
 * @param {number} ttlSeconds
 * @param {() => Promise<*>} fetchFn - only called on a miss (or on any cache error).
 * @returns {Promise<*>}
 */
async function getOrSet(key, ttlSeconds, fetchFn) {
  try {
    const cached = await redis.get(key);
    if (cached != null) {
      try {
        return JSON.parse(cached);
      } catch (parseErr) {
        logger.error(`[cacheService] failed to parse cached value for "${key}": ${parseErr.message}`);
        // Fall through to a fresh fetch below rather than propagating a parse error.
      }
    }
  } catch (err) {
    logger.error(`[cacheService] GET "${key}" failed, falling back to source: ${err.message}`);
  }

  const value = await fetchFn();

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    // Caching the result failed (Redis down, value not serializable, etc.) — the caller still
    // gets a correct, fresh value; we just failed to speed up the NEXT call.
    logger.error(`[cacheService] SET "${key}" failed (continuing uncached): ${err.message}`);
  }

  return value;
}

/**
 * Deletes a single literal key.
 * @param {string} key
 */
async function delKey(key) {
  try {
    await redis.unlink(key);
  } catch (err) {
    logger.error(`[cacheService] UNLINK "${key}" failed: ${err.message}`);
  }
}

/**
 * Scans for every key matching `pattern` (containing '*') and UNLINKs them in batches. Never
 * uses KEYS. Best-effort: a scan/unlink error is logged and the function simply stops rather
 * than throwing (leaving some stale keys behind, which their own TTL will still clean up).
 * @param {string} pattern
 */
async function delPattern(pattern) {
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.unlink(...keys);
      }
    } while (cursor !== '0');
  } catch (err) {
    logger.error(`[cacheService] SCAN/UNLINK pattern "${pattern}" failed: ${err.message}`);
  }
}

/**
 * Invalidates one exact key, or every key matching a pattern (if `keyOrPattern` contains '*').
 * Fail-open: swallows all Redis errors (logged only) — a failed invalidation just means some
 * stale reads until the TTL naturally expires, never a broken mutation.
 * @param {string} keyOrPattern
 */
async function invalidate(keyOrPattern) {
  if (!keyOrPattern) return;
  if (keyOrPattern.includes('*')) {
    await delPattern(keyOrPattern);
  } else {
    await delKey(keyOrPattern);
  }
}

module.exports = { getOrSet, invalidate };
