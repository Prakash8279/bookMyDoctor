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
const cookieParser = require('cookie-parser');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');

const env = require('./config/env');
const swaggerSpec = require('./config/swagger');
const sentry = require('./config/sentry');
const requestLogger = require('./middleware/requestLogger');
const requestContextMiddleware = require('./middleware/requestContext');
const { defaultLimiter } = require('./middleware/rateLimiter');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

// BACKEND ERROR TRACKING (production-readiness plan, Phase 3) — must run before anything else
// gets a chance to throw, so every later error in this file's own setup (not just request-time
// errors, which errorHandler.js reports) is at least attempted to be captured. A safe no-op when
// SENTRY_DSN is unset or @sentry/node isn't installed yet — see config/sentry.js.
sentry.init();

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
// /uploads files — public ones (profile photos, clinic QR codes) via express.static below, and
// private ones (doctor verification documents) via the authenticated route just above it — must
// be loadable by the frontend running on a different origin/port.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// 2. CORS — allowed origins (supporting multiple origins: AWS IP, AWS public DNS, localhost).
const configuredOrigins = (env.clientOrigin || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without Origin header (e.g. mobile apps, curl) are always allowed.
      if (!origin) return callback(null, true);
      // Allow if origin is configured or if origin matches AWS IP / EC2 domain / localhost
      if (
        configuredOrigins.length === 0 ||
        configuredOrigins.includes(origin) ||
        origin.includes('43.204.150.142') ||
        origin.includes('amazonaws.com') ||
        origin.includes('localhost')
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Platform'],
    exposedHeaders: ['X-Request-Id'],
  })
);

// 3. Response compression.
app.use(compression());

// 3.5. RAW body for the Razorpay webhook ONLY (production-readiness plan, Phase 2.3 — reconciles
// a `pending_payment` booking whose payment actually succeeded but whose patient never came back
// to call POST /payments/razorpay/verify). MUST run before the global express.json() below:
// Razorpay's X-Razorpay-Signature is an HMAC over the exact raw request bytes, and body-parser
// middlewares set an internal req._body flag once they've parsed a request, which express.json()
// below checks and skips — so mounting this first, scoped to this one path, means this route
// alone gets an unparsed Buffer in req.body while every other route is completely unaffected and
// still gets the normal parsed JSON object from step 4. See
// modules/payments/razorpay.service.js#reconcilePendingPaymentsFromWebhook for the signature
// check itself, and payments.routes.js for why this route also skips authenticate/authorize.
app.use('/payments/webhook/razorpay', express.raw({ type: 'application/json', limit: '1mb' }));

// 4. JSON body parsing.
app.use(express.json({ limit: '1mb' }));

// 4.5. Cookie parsing — populates req.cookies. Only ever needed for the httpOnly refresh-token
// cookie (see utils/webClientAuth.js); no other part of this app reads req.cookies. No secret
// passed to cookieParser() because this app never uses SIGNED cookies (the refresh token inside
// is already a signed JWT — signing the cookie wrapper too would be redundant defense against a
// threat, cookie tampering, that jwt.verify() in tokenService already fully covers).
app.use(cookieParser());

// 5. Request id + HTTP access logging.
app.use(...requestLogger);

// 6. Global rate limit (generous) — protects every route, on top of any per-route limiter.
app.use(defaultLimiter);

// 6.5. Authenticated serving for PRIVATE uploaded documents (doctor verification documents) —
// SECURITY FIX, see modules/uploads/secureDocument.routes.js's header comment for the full
// rationale. Mounted at the more specific '/uploads/documents' path, BEFORE the general
// '/uploads' express.static mount below — Express matches routes in registration order, so a
// request under here is always handled by this authenticated route and never falls through to
// the static server, even though the physical directory is a subdirectory of the same
// UPLOAD_DIR express.static serves from.
app.use('/uploads/documents', require('./modules/uploads/secureDocument.routes'));

// 7. Static file serving for PUBLIC uploaded content only (profile photos, clinic QR codes) —
// private documents are excluded from this and served by the authenticated route mounted just
// above instead (step 6.5; Express's registration-order route matching means a '/uploads/
// documents/*' request never reaches this middleware at all). maxAge lets browsers/CDNs cache a
// repeat view of the same file (a profile photo or clinic QR code shown on every doctor-profile/
// queue-display load) instead of re-downloading it every time, which is real bandwidth at scale
// for files that rarely change. NOT `immutable: true` though — filenames here are the original
// upload names, not content-hashed, so the same URL can legitimately point at new bytes after a
// re-upload; immutable would tell caches to never even revalidate, silently serving the stale
// file for up to a year. etag stays on so a cache still revalidates (304) after maxAge expires
// and picks up a changed file within 7 days.
app.use(
  '/uploads',
  express.static(path.resolve(env.upload.dir), {
    maxAge: '7d',
    etag: true,
    // Belt-and-braces: PDFs can, in principle, only ever reach this public mount as a leftover
    // from before this fix (documentUpload now writes into the private DOCUMENTS_SUBDIR this
    // mount doesn't serve) — kept so nothing already-served-inline-by-a-browser-cache changes
    // behavior, and so a hand-placed file here can't be rendered inline either.
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
