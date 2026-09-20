/**
 * Bounded in-flight concurrency guard — LOGIN RESILIENCE FIX
 * (docs/api-load-test-issues-and-plan-2026-09-20.md, Phase 1 item 2).
 *
 * Problem this solves: POST /auth/login and /auth/register both run a real bcrypt hash/compare,
 * which executes on Node's libuv thread pool (default 4 threads system-wide — see
 * docs/api-load-test-results-2026-09-20.md's root-cause analysis). That pool has a hard, fixed
 * throughput ceiling (~28-32 req/s was measured) no matter how many requests arrive at once.
 * Today, every request beyond that ceiling just queues silently until the CLIENT's own timeout
 * fires — the load test proved this degrades catastrophically rather than gracefully: at 600
 * concurrent, 480 of the requests timed out; at 1000 concurrent, EVERY login timed out (0
 * successes, 525 timeouts). There was no queue-depth cap or circuit breaker anywhere in that path.
 *
 * Fix: track how many of these bcrypt-heavy requests are actually in flight right now (entered
 * this middleware, not yet finished) on THIS process, and reject the excess immediately with a
 * fast, honest 503 + Retry-After instead of letting it silently queue. This turns "everyone times
 * out" into "most people succeed, a clear excess gets told to retry shortly" — a real improvement
 * on its own, independent of (and complementary to) raising UV_THREADPOOL_SIZE (Phase 1 item 1)
 * or eventually giving bcrypt its own dedicated worker pool (Phase 1 item 3).
 *
 * Why an in-memory counter, not a Redis-backed limiter like rateLimiter.js's exports: this isn't
 * "how many requests has this caller made in the last N minutes" (a moving time window per
 * identity) — it's "how much bcrypt work is THIS process's own libuv thread pool doing right
 * now". That's inherently a per-process fact (each horizontally-scaled replica has its own
 * 4-thread pool and its own capacity), and it has to be checked/updated on every single request
 * with zero added latency — a Redis round-trip here would add real latency to the exact hot path
 * this guard exists to protect, for no benefit (a second replica's counter tells you nothing
 * about whether THIS replica's thread pool is saturated).
 *
 * Threshold math (see docs/api-load-test-results-2026-09-20.md): Little's Law on the observed
 * 100-concurrent stage — 31.8 req/s x 2.676s avg latency =~ 85 requests actually in flight/queued
 * at once. The default max of 90 sits just above that (comfortably lets today's normal-latency
 * range through) while still cutting off well before the 600+ concurrent range where the load
 * test observed timeouts and eventual total collapse.
 */
const logger = require('../config/logger');
const { fail } = require('../utils/apiResponse');

/**
 * @param {object} opts
 * @param {number} opts.max - max requests allowed in flight at once before shedding load.
 * @param {number} [opts.retryAfterSeconds=3] - value sent in the Retry-After header on a 503.
 * @param {string} [opts.label='auth'] - short label used in the warn log line, so more than one
 *   guard instance (if this is ever reused elsewhere) is distinguishable in logs.
 * @returns {import('express').RequestHandler}
 */
function createInFlightGuard({ max, retryAfterSeconds = 3, label = 'auth' } = {}) {
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error(`createInFlightGuard: max must be a positive number (got ${max})`);
  }

  let inFlight = 0;

  return function inFlightGuard(req, res, next) {
    if (inFlight >= max) {
      res.set('Retry-After', String(retryAfterSeconds));
      // Deliberately NOT thrown as an ApiError here (compare middleware/rateLimiter.js's
      // rateLimitHandler, which does throw one): errorHandler.js logs every 5xx ApiError at
      // error level and reports it to Sentry, which is the right call for an unexpected bug but
      // the wrong call here — a real traffic burst can legitimately trip this guard hundreds of
      // times in a few seconds, and that's the guard doing exactly its job, not an incident. A
      // single warn-level line is signal enough that capacity was hit, without paging anyone or
      // flooding the error tracker.
      logger.warn(`[${label}] in-flight guard rejected a request (${inFlight}/${max} already in flight)`);
      fail(res, 503, 'SERVICE_BUSY', 'Server is busy right now — please try again in a few seconds.');
      return;
    }

    inFlight += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight -= 1;
    };
    // 'finish' covers the normal case (response fully sent). 'close' also covers a client that
    // disconnects/aborts before the response finishes — without it, an aborted request would
    // leak its slot forever and the guard would eventually block everyone even at low real load.
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}

module.exports = { createInFlightGuard };
