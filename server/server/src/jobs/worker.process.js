/**
 * Standalone process entry point for the BullMQ booking worker (run via `npm run worker`,
 * separately from the HTTP API process, so it can be scaled independently under load).
 * Responsibility: boot the worker defined in bookingWorker.js and nothing else.
 * Mirrors server.js's graceful-shutdown pattern (close the worker, then the Prisma/Redis pools,
 * on SIGTERM/SIGINT; fatal-exit on an unhandled rejection/uncaught exception).
 */
const worker = require('./bookingWorker');
const { bookingQueue } = require('./bookingQueue');
const queueConnection = require('./queueConnection');
const env = require('../config/env');
const logger = require('../config/logger');
const prisma = require('../config/db');
const redis = require('../config/redis');

logger.info(`[worker.process] Booking worker starting (${env.nodeEnv}, concurrency=${env.booking.workerConcurrency})...`);

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`[worker.process] Received ${signal}, shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    logger.error('[worker.process] Graceful shutdown timed out, forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // Stops pulling new jobs and waits for in-flight ones to finish (BullMQ's own drain).
    await worker.close();
  } catch (err) {
    logger.error(`[worker.process] Error closing worker: ${err.message}`);
  }

  try {
    await bookingQueue.close();
  } catch (err) {
    logger.error(`[worker.process] Error closing queue producer: ${err.message}`);
  }

  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error(`[worker.process] Error disconnecting Prisma: ${err.message}`);
  }

  try {
    redis.disconnect();
  } catch (err) {
    logger.error(`[worker.process] Error disconnecting Redis (shared client): ${err.message}`);
  }

  try {
    queueConnection.disconnect();
  } catch (err) {
    logger.error(`[worker.process] Error disconnecting Redis (BullMQ connection): ${err.message}`);
  }

  clearTimeout(forceExitTimer);
  logger.info('[worker.process] Shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error(`[worker.process] Unhandled promise rejection: ${reason && reason.stack ? reason.stack : reason}`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error(`[worker.process] Uncaught exception: ${err.stack || err.message}`);
  process.exit(1);
});
