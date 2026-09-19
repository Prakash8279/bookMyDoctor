/**
 * Health-check route for load balancers / uptime monitors (an ALB target-group check, a
 * status-page pinger, k8s liveness/readiness probes — anything that hits this on a tight
 * interval). Scope: infra-only — no request body, nothing to validate, no auth — so it
 * deliberately skips the controller/service/validation split every business-domain module
 * uses; the two connectivity checks below ARE the whole feature, and splitting them across
 * three files would just add indirection for no benefit.
 * Responsibility: report whether this process, the database, and Redis are all reachable,
 * without ever throwing itself — a DB or Redis outage must downgrade the relevant field
 * instead of taking the health check down with it (that would make the health check useless
 * for exactly the situation it exists to detect).
 *
 * Mounted first in routes/index.js, ahead of every other route. It still passes through
 * app.js's global defaultLimiter (generous, 300 req/min by default) and the request-id
 * middleware — it deliberately does NOT get a stricter per-route limiter, since a load
 * balancer/uptime monitor polling every few seconds must never be locked out — and
 * middleware/requestLogger.js's morgan `skip` option excludes this path so high-frequency
 * polling doesn't spam the access log at scale.
 */
const router = require('express').Router();

const prisma = require('../../config/db');
const redis = require('../../config/redis');
const asyncHandler = require('../../utils/asyncHandler');

// Cheapest possible round-trip that proves the pool can open a connection and Postgres is
// actually answering (as opposed to e.g. the app booting fine against a DB that later died).
// Wrapped in try/catch so a DB outage downgrades the `db` field instead of throwing past this
// route — asyncHandler would otherwise forward it to next(err) and turn a health check into a
// 500 from the generic error handler, losing the redis half of the payload entirely.
async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch (err) {
    return 'error';
  }
}

// PING is the standard Redis liveness check — round-trips through the connection without
// touching any keyspace. Wrapped for the same reason as checkDatabase above.
async function checkRedis() {
  try {
    const reply = await redis.ping();
    return reply === 'PONG' ? 'ok' : 'error';
  } catch (err) {
    return 'error';
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Run both checks concurrently — they're independent, and serializing them would double
    // the worst-case latency of a route whose whole job is to answer fast.
    const [db, redisStatus] = await Promise.all([checkDatabase(), checkRedis()]);
    const healthy = db === 'ok' && redisStatus === 'ok';

    // Deliberately NOT the app's usual {success, data} envelope (utils/apiResponse.js) — load
    // balancers and uptime monitors expect a flat, predictable shape at a fixed path, and this
    // endpoint isn't part of the versioned API contract consumed by the frontend/mobile clients.
    // 503 (not 200) when either dependency is down, so a load balancer actually takes the
    // instance out of rotation instead of reading "200 OK" and continuing to route traffic to it.
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'error',
      db,
      redis: redisStatus,
      uptime: process.uptime(),
    });
  })
);

module.exports = router;
