/**
 * morgan HTTP request logging middleware wired to the winston logger stream.
 * Responsibility: log method, path, status, response time, and a request-id for tracing.
 *
 * Exports an array [assignRequestId, morganMiddleware] meant to be spread into app.use(...)
 * so every request gets a stable req.id (echoed back as X-Request-Id) before morgan logs it.
 */
const crypto = require('crypto');
const morgan = require('morgan');
const logger = require('../config/logger');

// Only a safe, bounded id format is ever trusted from the client; anything else
// (unbounded length, unexpected bytes that would throw in res.setHeader, log injection
// via newlines/control chars) falls back to a freshly generated id instead.
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

function assignRequestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

morgan.token('id', (req) => req.id);

// Skip access logging for the health-check route (modules/health/health.routes.js) — a load
// balancer/uptime monitor calls it on a tight interval (every few seconds is common), and at
// that frequency every other line in the access log would be a health-check ping, drowning out
// real request traffic. No other route currently gets this treatment: GET /queue is polled by
// staff UIs too, but it's authenticated/role-gated, per-user traffic rather than an
// infra-level ping, so it stays logged like any other business route.
const morganMiddleware = morgan(
  ':id :method :url :status :res[content-length] - :response-time ms',
  {
    stream: logger.stream,
    skip: (req) => req.path === '/health',
  }
);

module.exports = [assignRequestId, morganMiddleware];
