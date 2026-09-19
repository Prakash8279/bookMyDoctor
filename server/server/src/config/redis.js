/**
 * ioredis client singleton.
 * Responsibility: shared Redis connection used by cacheService (cache-aside reads) and
 * lockService (distributed locks for slot booking). Configure retry/backoff here.
 */
const Redis = require('ioredis');
const env = require('./env');
const logger = require('./logger');

const redis = new Redis(env.redisUrl, {
  // Reconnect with capped exponential backoff instead of giving up.
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  // Let callers (rate-limit-redis, BullMQ) issue commands immediately; ioredis queues them
  // until the connection is ready rather than throwing.
  enableReadyCheck: true,
});

redis.on('connect', () => {
  logger.info('[redis] connected');
});

redis.on('error', (err) => {
  logger.error(`[redis] connection error: ${err.message}`);
});

module.exports = redis;
