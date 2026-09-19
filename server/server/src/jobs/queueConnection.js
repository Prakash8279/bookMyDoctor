/**
 * Shared ioredis connection instance configured for BullMQ (separate from cacheService's/
 * lockService's client in config/redis.js, per BullMQ's own recommendation).
 * Responsibility: one connection config reused by every queue/worker.
 *
 * BullMQ's internal blocking commands (used by both Queue and Worker) require
 * `maxRetriesPerRequest: null` on the connection they're given — see
 * https://docs.bullmq.io/guide/going-to-production#maxretriesperrequest. config/redis.js's
 * shared client intentionally sets `maxRetriesPerRequest: 3` (correct for cacheService's/
 * lockService's/rate-limit-redis's short-lived, non-blocking commands), so BullMQ gets its own
 * dedicated connection here rather than reusing that one.
 */
const Redis = require('ioredis');
const env = require('../config/env');
const logger = require('../config/logger');

const connection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
});

connection.on('connect', () => {
  logger.info('[jobs/queueConnection] BullMQ Redis connection established');
});

connection.on('error', (err) => {
  logger.error(`[jobs/queueConnection] Redis connection error: ${err.message}`);
});

module.exports = connection;
