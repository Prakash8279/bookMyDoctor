/**
 * Optional backend error tracking (production-readiness plan, Phase 3 — "no visibility into
 * production errors beyond application logs"). Same deliberately-optional pattern as
 * razorpay/google/bankDetailsEncryption in env.js: the app must boot and run completely normally
 * with Sentry absent — no DSN configured, or the `@sentry/node` package not even installed yet
 * (it is added to package.json's dependencies as a text entry only; an operator runs `npm install`
 * themselves — see the standing "never run installs in this sandbox" rule this was written under).
 *
 * Responsibility: a single init() called once at startup (app.js), and a single captureException()
 * called from errorHandler.js for the errors actually worth paging someone about (unexpected
 * exceptions and 5xx ApiErrors) — never for ordinary 4xx client errors (a wrong password, a
 * validation failure), which are expected traffic, not incidents.
 */
const env = require('./env');
const logger = require('./logger');

let sentryModule = null;
let initialized = false;

function loadSentryModule() {
  if (sentryModule !== null) return sentryModule;
  try {
    // eslint-disable-next-line global-require
    sentryModule = require('@sentry/node');
  } catch (requireErr) {
    // Package not installed yet — expected until an operator runs `npm install` after this
    // dependency was added to package.json. Not an error condition for the app itself.
    sentryModule = false;
  }
  return sentryModule;
}

/**
 * Call once, as early as possible in app startup (see app.js). Safe to call even when
 * SENTRY_DSN is unset or @sentry/node isn't installed — becomes a no-op in either case.
 */
function init() {
  if (!env.sentry.dsn) return;

  const Sentry = loadSentryModule();
  if (!Sentry) {
    logger.warn('SENTRY_DSN is set but the @sentry/node package is not installed — run npm install, then restart. Error tracking is disabled for now.');
    return;
  }

  Sentry.init({
    dsn: env.sentry.dsn,
    environment: env.isProduction ? 'production' : 'development',
    // Errors only for now, no performance tracing — keep the footprint small and predictable
    // until there's an actual need for trace-level data.
    tracesSampleRate: 0,
  });
  initialized = true;
}

/**
 * Reports an error to Sentry if configured; always a safe no-op otherwise (unset DSN, package
 * not installed, or init() never called/failed) — errorHandler.js can call this unconditionally
 * without its own "is Sentry on" check.
 * @param {Error} err
 * @param {object} [context] - extra key/value context (e.g. { requestId }).
 */
function captureException(err, context) {
  if (!initialized) return;
  const Sentry = loadSentryModule();
  if (!Sentry) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch (captureErr) {
    // Never let a Sentry reporting failure itself break error handling.
    logger.warn(`Failed to report an error to Sentry: ${captureErr && captureErr.message}`);
  }
}

module.exports = { init, captureException };
