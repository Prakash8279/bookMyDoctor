/**
 * Express app assembly: security middleware, body parsing, CORS, rate limiting,
 * route mounting, and error handling — in that order. No server.listen() here
 * (that's server.js) so this file can be imported directly by tests later.
 * Responsibility: wire everything together; no business logic.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');

const env = require('./config/env');
const swaggerSpec = require('./config/swagger');
const requestLogger = require('./middleware/requestLogger');
const requestContextMiddleware = require('./middleware/requestContext');
const { defaultLimiter } = require('./middleware/rateLimiter');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();

// 0. Trust the exact number of reverse-proxy hops in front of this process (see
// config/env.js for why this is a fixed integer, not `true`/left unset). This must be set
// before anything reads req.ip — including the rate limiters below and CORS/helmet — so
// IP-keyed limits (authLimiter, defaultLimiter, and the IP-fallback branch of
// passwordChangeLimiter/bookingLimiter) see the real client address instead of either the
// proxy's single address (undefined) or an attacker-forgeable X-Forwarded-For chain (`true`).
app.set('trust proxy', env.trustProxyHops);

// 0.5. Makes req.ip available deep inside services (e.g. activityLogService.js) without
// threading `req` through every function call — see middleware/requestContext.js. Must run
// after trust-proxy is set (above) and before every route/controller (below).
app.use(requestContextMiddleware);

// 0.6. Force HTTPS in production. This app has no TLS of its own — it expects to sit behind a
// TLS-terminating load balancer/CDN that forwards the original scheme via X-Forwarded-Proto.
// `req.secure` reflects that header correctly once `trust proxy` is set to a real hop count
// (done above), which is exactly the case here. A no-op in development, and a no-op for a
// request that already arrived over HTTPS — this only catches a plain-HTTP request slipping
// through in production and redirects it once, permanently, before anything else runs.
if (env.isProduction) {
  app.use((req, res, next) => {
    if (req.secure) return next();
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  });
}

// 1. Security headers. crossOriginResourcePolicy is relaxed to 'cross-origin' because
// /uploads static files (profile photos, doctor documents, clinic QR codes) must be
// loadable by the frontend running on a different origin/port.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// 2. CORS — single allowed origin (the frontend). No cookies are used for auth (tokens are
// body/header based, see D1 in the phase plan), so credentials stays false.
app.use(
  cors({
    origin: env.clientOrigin,
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Request-Id'],
  })
);

// 3. Response compression.
app.use(compression());

// 4. JSON body parsing.
app.use(express.json({ limit: '1mb' }));

// 5. Request id + HTTP access logging.
app.use(...requestLogger);

// 6. Global rate limit (generous) — protects every route, on top of any per-route limiter.
app.use(defaultLimiter);

// 7. Static file serving for uploaded content (profile photos, documents, QR codes).
// maxAge lets browsers/CDNs cache a repeat view of the same file (a profile photo or clinic QR
// code shown on every doctor-profile/queue-display load) instead of re-downloading it every
// time, which is real bandwidth at scale for files that rarely change. NOT `immutable: true`
// though — filenames here are the original upload names, not content-hashed, so the same URL
// can legitimately point at new bytes after a re-upload; immutable would tell caches to never
// even revalidate, silently serving the stale file for up to a year. etag stays on so a cache
// still revalidates (304) after maxAge expires and picks up a changed file within 7 days.
app.use(
  '/uploads',
  express.static(path.resolve(env.upload.dir), {
    maxAge: '7d',
    etag: true,
    // PDFs (doctor verification documents — see fileUploadService.js's DOCUMENT_MIME_EXTENSIONS)
    // default to rendering inline in the browser's built-in PDF viewer. SVG/HTML are already
    // excluded from every upload MIME allowlist so stored-XSS-via-upload isn't reachable, but a
    // malicious PDF rendered inline could still exploit a PDF-viewer bug in some browsers — force
    // it to download instead. Images are left alone (inline is exactly what a profile photo or
    // clinic QR code needs).
    setHeaders: (res, filePath) => {
      if (filePath.toLowerCase().endsWith('.pdf')) {
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  })
);

// 7.5. Interactive API docs (Swagger UI) — generated from `@openapi` JSDoc comments in
// modules/**/*.routes.js (see config/swagger.js). Mounted ONLY outside production: this spec is
// a documentation/dev-convenience tool, not part of the versioned API contract, and exposing an
// explorable map of every documented endpoint (plus a "try it out" request builder) publicly by
// default is unnecessary attack-surface for a healthcare app with no compensating control here
// (no auth in front of /api-docs itself). An operator who genuinely wants it reachable in
// production can still stand up a separate, access-controlled doc host from the same
// config/swagger.js spec — this gate is about the DEFAULT, not a hard prohibition.
if (!env.isProduction) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// 8. API routes.
app.use('/', routes);

// 9. Unmatched route -> standard 404 envelope.
app.use(notFound);

// 10. Centralized error handler — MUST be last.
app.use(errorHandler);

module.exports = app;
