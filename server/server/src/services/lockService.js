/**
 * Redis-based distributed lock (SET NX PX pattern) keyed by (doctorId, date, time).
 * Responsibility: serialize concurrent booking attempts on the SAME slot so two patients can't
 * both win it — used by appointments.service.js's runBookingJob() before the DB write/constraint
 * check. This is the first line of defense; the Postgres partial unique index
 * (appointments_doctor_slot_unique, see prisma/manual_sql/001) is the second, and the
 * per-doctor-per-day advisory lock taken inside the booking transaction is a third, narrower
 * layer for token-number assignment specifically — see appointments.service.js#runBookingJob.
 */
const crypto = require('crypto');
const redis = require('../config/redis');
const env = require('../config/env');
const logger = require('../config/logger');

/**
 * Thrown when a lock could not be acquired within its wait timeout. Deliberately a plain Error,
 * NOT an ApiError — a busy lock is a transient, retryable condition (heavy contention on one
 * slot), not a business-rule failure. jobs/bookingWorker.js relies on this distinction: it
 * rethrows a LockAcquisitionError as-is so BullMQ's own attempts/backoff absorbs it, instead of
 * wrapping it in UnrecoverableError the way a real ApiError (slot taken, doctor not found, ...)
 * is wrapped.
 */
class LockAcquisitionError extends Error {
  constructor(key, waitTimeoutMs) {
    super(`Could not acquire lock "${key}" within ${waitTimeoutMs}ms.`);
    this.name = 'LockAcquisitionError';
    this.key = key;
  }
}

// Compare-and-delete: only releases the lock if it still holds the token THIS acquisition set.
// Without this, a lock that outlived its own TTL (e.g. the holder crashed mid-transaction) and
// was subsequently re-acquired by a different caller could be deleted out from under that new
// holder by the original (late-finishing) caller's own release call.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} key - logical lock name, WITHOUT the "lock:" prefix (added here).
 * @param {{ttlMs:number, waitTimeoutMs:number, retryDelayMs:number}} opts
 * @returns {Promise<string>} the random token that owns this acquisition (needed to release it).
 */
async function acquireLock(key, { ttlMs, waitTimeoutMs, retryDelayMs }) {
  const token = crypto.randomBytes(16).toString('hex');
  const redisKey = `lock:${key}`;
  const deadline = Date.now() + waitTimeoutMs;

  // Always attempt at least once, even if waitTimeoutMs is 0 — the loop condition is checked
  // AFTER the first SET NX, not before it.
  for (;;) {
    const result = await redis.set(redisKey, token, 'PX', ttlMs, 'NX');
    if (result === 'OK') {
      return token;
    }
    if (Date.now() >= deadline) {
      throw new LockAcquisitionError(key, waitTimeoutMs);
    }
    // Small jittered delay so many simultaneous waiters on the same key don't all retry in
    // lockstep and thrash Redis.
    await sleep(retryDelayMs + Math.floor(Math.random() * retryDelayMs));
  }
}

async function releaseLock(key, token) {
  const redisKey = `lock:${key}`;
  try {
    await redis.eval(RELEASE_SCRIPT, 1, redisKey, token);
  } catch (err) {
    // A failed release just means the lock lingers until its own TTL expires — never let this
    // failure mask/replace whatever withLock's wrapped function itself returned or threw.
    logger.error(`[lockService] failed to release lock "${redisKey}": ${err.message}`);
  }
}

/**
 * Runs `fn` while holding the named distributed lock, guaranteeing release (even if `fn`
 * throws) via `finally`.
 * @param {string} key - logical lock name, e.g. `booking:{doctorId}:{date}:{time}`.
 * @param {() => Promise<*>} fn
 * @param {{ttlMs?:number, waitTimeoutMs?:number, retryDelayMs?:number}} [options]
 * @returns {Promise<*>} whatever `fn` resolves to.
 */
async function withLock(key, fn, options = {}) {
  const {
    ttlMs = env.booking.lockTtlMs,
    waitTimeoutMs = env.booking.lockWaitMs,
    retryDelayMs = 100,
  } = options;

  const token = await acquireLock(key, { ttlMs, waitTimeoutMs, retryDelayMs });
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}

module.exports = { withLock, LockAcquisitionError };
