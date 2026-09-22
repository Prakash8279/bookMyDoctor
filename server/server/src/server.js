/**
 * Process entry point: starts the HTTP server from app.js, handles graceful shutdown
 * (drain connections, close the Prisma/Redis pools) on SIGTERM/SIGINT.
 * Responsibility: process lifecycle only — the actual app lives in app.js so it can be
 * instantiated multiple times (e.g. for horizontal scaling / tests) without re-binding a port.
 */
const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const prisma = require('./config/db');
const redis = require('./config/redis');

const server = app.listen(env.port, () => {
  logger.info(`[server] BookMyDoctors API listening on port ${env.port} (${env.nodeEnv})`);
});

const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`[server] Received ${signal}, shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    logger.error('[server] Graceful shutdown timed out, forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  server.close(async (err) => {
    if (err) {
      logger.error(`[server] Error while closing HTTP server: ${err.message}`);
    }

    try {
      await prisma.$disconnect();
    } catch (disconnectErr) {
      logger.error(`[server] Error disconnecting Prisma: ${disconnectErr.message}`);
    }

    try {
      redis.disconnect();
    } catch (redisErr) {
      logger.error(`[server] Error disconnecting Redis: ${redisErr.message}`);
    }

    clearTimeout(forceExitTimer);
    logger.info('[server] Shutdown complete.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Safety net: an unhandled rejection or uncaught exception leaves the process in an unknown
// state — log it as fatal and exit rather than limping on with a possibly-corrupted process.
process.on('unhandledRejection', (reason) => {
  logger.error(`[server] Unhandled promise rejection: ${reason && reason.stack ? reason.stack : reason}`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error(`[server] Uncaught exception: ${err.stack || err.message}`);
  process.exit(1);
});

module.exports = server;
