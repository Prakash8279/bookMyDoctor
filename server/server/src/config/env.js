/**
 * Loads and validates all required environment variables in one place.
 * Every other file should import config from here, never read process.env directly.
 * Responsibility: fail fast at boot if a required env var is missing.
 */
require('dotenv').config();

const REQUIRED_VARS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CLIENT_ORIGIN', 'DATABASE_URL', 'REDIS_URL'];

function missingVars() {
  return REQUIRED_VARS.filter((name) => !process.env[name] || String(process.env[name]).trim() === '');
}

function parseIntWithDefault(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const missing = missingVars();
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `[config/env] Missing required environment variable(s): ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill in real values before starting the server.'
  );
  process.exit(1);
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
// Optional "previous" secrets for rotation without an instant mass-logout: an operator rotates
// a compromised/aging secret by moving the OLD value here and putting a freshly generated value
// in JWT_ACCESS_SECRET/JWT_REFRESH_SECRET, deploys, and every token signed under the old secret
// still verifies (falling through to it in tokenService) for one deploy cycle, then removes the
// _PREVIOUS var once it's confident nothing still relies on it. Signing always uses ONLY the
// current (non-_PREVIOUS) secret — see jwt.accessVerifySecrets/refreshVerifySecrets below.
const jwtAccessSecretPrevious = process.env.JWT_ACCESS_SECRET_PREVIOUS || '';
const jwtRefreshSecretPrevious = process.env.JWT_REFRESH_SECRET_PREVIOUS || '';

if (isProduction) {
  const productionErrors = [];
  const PLACEHOLDER_MARKERS = ['replace_me', 'changeme', 'change_me'];

  const looksLikePlaceholder = (secret) =>
    PLACEHOLDER_MARKERS.some((marker) => secret.toLowerCase().includes(marker));

  if (jwtAccessSecret.length < 32) {
    productionErrors.push('JWT_ACCESS_SECRET must be at least 32 characters in production.');
  }
  if (jwtRefreshSecret.length < 32) {
    productionErrors.push('JWT_REFRESH_SECRET must be at least 32 characters in production.');
  }
  if (jwtAccessSecret === jwtRefreshSecret) {
    productionErrors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must not be equal.');
  }
  if (looksLikePlaceholder(jwtAccessSecret) || looksLikePlaceholder(jwtRefreshSecret)) {
    productionErrors.push('JWT secrets still contain placeholder text from .env.example — generate real random secrets.');
  }

  if (productionErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[config/env] Refusing to boot in production:\n - ${productionErrors.join('\n - ')}`);
    process.exit(1);
  }
}

module.exports = {
  nodeEnv,
  isProduction,
  port: parseIntWithDefault(process.env.PORT, 4000),
  clientOrigin: process.env.CLIENT_ORIGIN,
  // Exact number of reverse-proxy hops (nginx, ALB, etc.) sitting in front of this process,
  // passed straight to Express's `trust proxy` setting so req.ip/req.secure reflect the real
  // client. Deliberately a fixed integer, not `true` — `true` trusts the entire (attacker
  // -controlled) X-Forwarded-For chain, letting a client forge a fresh req.ip on every request
  // and defeat every IP-keyed rate limiter (authLimiter, defaultLimiter). Deliberately not left
  // unset either — with no trust-proxy setting, req.ip is the proxy's own single address for
  // every request behind a real deployment, so all users collapse onto one shared rate-limit
  // bucket. Default of 1 assumes a single reverse proxy/load balancer in front of the app;
  // override to match the real topology (e.g. 2 behind an extra CDN hop).
  trustProxyHops: parseIntWithDefault(process.env.TRUST_PROXY_HOPS, 1),
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,

  // Prisma connection-pool tuning (config/db.js appends these to databaseUrl as
  // connection_limit/pool_timeout query params). This app is explicitly designed to run
  // multiple API replicas (server.js, horizontally scaled) plus a separate BullMQ worker
  // process (jobs/worker.process.js, scaled independently — see its header comment), and EACH
  // one opens its own Prisma pool — left uncapped, Prisma's default pool size scales with the
  // machine's CPU count, so replica count alone (not real load) can exhaust a managed Postgres's
  // connection limit and force an unnecessary DB plan upgrade. Defaults here are deliberately
  // modest for a small-to-mid deployment; override per-environment to match the real Postgres
  // connection budget divided by replica count.
  dbPoolSize: parseIntWithDefault(process.env.DB_POOL_SIZE, 5),
  dbPoolTimeoutSeconds: parseIntWithDefault(process.env.DB_POOL_TIMEOUT_SECONDS, 10),

  // Winston log level. Defaults to the previous hardcoded behavior (info in production, debug
  // elsewhere) when unset, but lets an operator dial verbosity up/down without a code change or
  // redeploy — e.g. bumping to 'debug' in production temporarily while chasing an incident.
  logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),

  jwt: {
    accessSecret: jwtAccessSecret,
    refreshSecret: jwtRefreshSecret,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    // Ordered list of secrets tokenService will accept on verification, current secret first.
    // Only the first entry (accessSecret/refreshSecret) is ever used to SIGN a new token — the
    // _PREVIOUS entry exists purely so tokens already handed out under the old secret keep
    // verifying until they naturally expire, instead of every logged-in user being force-logged-
    // out the instant a secret rotates.
    accessVerifySecrets: [jwtAccessSecret, ...(jwtAccessSecretPrevious ? [jwtAccessSecretPrevious] : [])],
    refreshVerifySecrets: [jwtRefreshSecret, ...(jwtRefreshSecretPrevious ? [jwtRefreshSecretPrevious] : [])],
  },

  bcryptSaltRounds: parseIntWithDefault(process.env.BCRYPT_SALT_ROUNDS, 12),

  // WEB-ONLY httpOnly REFRESH-TOKEN COOKIE (risky-item #2, docs/risky-fixes-plan-2026-09-20.md).
  // See utils/webClientAuth.js for the full flow. 'lax' is correct for the overwhelming majority
  // of real deployments — it still works across different PORTS (localhost:5173 talking to
  // localhost:4000) and different SUBDOMAINS of the same registrable domain (app.example.com
  // talking to api.example.com), which covers this app's own docker-compose setup and any normal
  // single-domain-family deployment. Only override to 'none' if the web frontend and the API
  // genuinely live on two unrelated top-level domains (e.g. a frontend on a Vercel default domain
  // and an API on a Render default domain) — and note that doing so also loses the free
  // cross-site-POST protection 'lax' gives the refresh/logout endpoints (see webClientAuth.js's
  // header comment); 'none' additionally requires a real HTTPS deployment (browsers reject
  // SameSite=None without Secure, which this config always sets together — see
  // webClientAuth.js#refreshCookieOptions).
  refreshCookieSameSite: (() => {
    const value = (process.env.REFRESH_COOKIE_SAME_SITE || 'lax').toLowerCase();
    return ['lax', 'strict', 'none'].includes(value) ? value : 'lax';
  })(),

  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    baseUrl: process.env.UPLOAD_BASE_URL || 'http://localhost:4000/uploads',
  },

  rateLimit: {
    authMax: parseIntWithDefault(process.env.AUTH_RATE_LIMIT_MAX, 10),
    authWindowMinutes: parseIntWithDefault(process.env.AUTH_RATE_LIMIT_WINDOW_MINUTES, 15),
    defaultMax: parseIntWithDefault(process.env.DEFAULT_RATE_LIMIT_MAX, 300),
    defaultWindowMinutes: parseIntWithDefault(process.env.DEFAULT_RATE_LIMIT_WINDOW_MINUTES, 1),
    bookingMax: parseIntWithDefault(process.env.BOOKING_RATE_LIMIT_MAX, 20),
    bookingWindowMinutes: parseIntWithDefault(process.env.BOOKING_RATE_LIMIT_WINDOW_MINUTES, 1),
    paymentMax: parseIntWithDefault(process.env.PAYMENT_RATE_LIMIT_MAX, 20),
    paymentWindowMinutes: parseIntWithDefault(process.env.PAYMENT_RATE_LIMIT_WINDOW_MINUTES, 1),
    // POST /auth/refresh can't sit behind authLimiter (it's unauthenticated by necessity — you
    // call it precisely because your access token expired), but it was previously covered only
    // by the generous global defaultLimiter (300/min), leaving a stolen/guessed refresh token
    // hammerable up to that rate before rotation/reuse-detection kicks in. A dedicated, slightly
    // more generous-than-login limit still allows every legitimate multi-tab/multi-device client
    // to refresh freely while closing that gap.
    refreshMax: parseIntWithDefault(process.env.REFRESH_RATE_LIMIT_MAX, 30),
    refreshWindowMinutes: parseIntWithDefault(process.env.REFRESH_RATE_LIMIT_WINDOW_MINUTES, 15),
  },

  // Optional IP allowlist for the admin API surface (middleware/adminIpAllowlist.js). Empty by
  // default — this app has no admin IP restriction unless an operator explicitly opts in by
  // setting ADMIN_IP_ALLOWLIST, so leaving it unset must not change behavior for anyone.
  // Comma-separated exact IPs (no CIDR support — req.ip is compared with a plain string match).
  adminIpAllowlist: (process.env.ADMIN_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Booking Core phase (services/lockService.js, jobs/bookingWorker.js) — tunables for the
  // Redis distributed lock and the BullMQ booking worker, so these aren't hardcoded magic
  // numbers scattered across jobs/* and appointments.service.js.
  booking: {
    // lockTtlMs MUST stay comfortably above txMaxWaitMs + txTimeoutMs: runBookingJob holds the
    // Redis lock for the full duration of its $transaction call, which is itself allowed to run
    // up to txMaxWaitMs (waiting to open) + txTimeoutMs (executing) = up to 15000ms by default.
    // A shorter lock TTL would silently expire mid-transaction under real lock contention (the
    // exact slow-transaction scenario txTimeoutMs was raised to tolerate), letting a second
    // request acquire the "freed" lock and start its own transaction before the first finishes —
    // the Postgres partial unique index still stops an actual double-booked row, but the Redis
    // lock's whole point (fail fast, bound retries before a DB transaction is even opened) would
    // be defeated for exactly the case it exists to handle. Keep this default >= txMaxWaitMs +
    // txTimeoutMs + a margin if either of those two are ever changed.
    lockTtlMs: parseIntWithDefault(process.env.BOOKING_LOCK_TTL_MS, 16000),
    lockWaitMs: parseIntWithDefault(process.env.BOOKING_LOCK_WAIT_MS, 3000),
    workerConcurrency: parseIntWithDefault(process.env.BOOKING_WORKER_CONCURRENCY, 5),
    // Interactive-transaction options for the runBookingJob $transaction (appointments.service.js).
    // Prisma's own default (maxWait=2000ms, timeout=5000ms) is untuned for this transaction: it
    // opens with `pg_advisory_xact_lock` scoped per doctor+day, so under a real burst of
    // concurrent bookings for the same doctor+day (up to `workerConcurrency` transactions queuing
    // on the same advisory-lock key at once) a transaction can legitimately block waiting for the
    // lock for longer than Prisma's default 5s timeout, failing with a generic Prisma timeout
    // error instead of a clean, intentional state. txTimeoutMs is set comfortably above
    // lockWaitMs (the Redis lock's own bounded wait, which normally resolves contention before a
    // transaction is even opened) so a Prisma-level timeout is a deliberate outer bound, not an
    // accidental default.
    txTimeoutMs: parseIntWithDefault(process.env.BOOKING_TX_TIMEOUT_MS, 10000),
    txMaxWaitMs: parseIntWithDefault(process.env.BOOKING_TX_MAX_WAIT_MS, 5000),
  },

  // Razorpay (patient self-pay "Pay now" right after booking confirmation — see
  // modules/payments/razorpay.service.js). Deliberately NOT in REQUIRED_VARS: the app must still
  // boot with online payments simply disabled (patients fall back to pay-at-clinic) until an
  // operator adds real keys. Get free TEST MODE keys at
  // https://dashboard.razorpay.com/signup -> Settings -> API Keys -> Generate Test Key.
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  },

  // GOOGLE SIGN-IN (user request: "google work nahi kar rah hai fix kro") — "Continue with
  // Google" on the login/register pages (modules/auth/auth.service.js#googleAuth). Same
  // deliberately-optional pattern as razorpay above: leave blank to keep the app booting fine
  // with Google sign-in simply disabled (a clean 503 from the endpoint; email/password auth is
  // completely unaffected) until an operator adds a real Client ID. This is NOT a secret — it's
  // the same public "Client ID" value client/.env's VITE_GOOGLE_CLIENT_ID ships inside the
  // frontend bundle — see .env.example for how to create one.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },

  // BANK-DETAIL ENCRYPTION (risky-item #3, docs/risky-fixes-plan-2026-09-20.md — "doctor bank
  // details are stored plaintext in doctor_profiles"). See services/encryptionService.js for the
  // AES-256-GCM implementation. Deliberately NOT in REQUIRED_VARS, same optional-feature pattern
  // as razorpay/google above: the app must still boot with bank-detail encryption simply
  // unavailable (a doctor trying to save/edit bank details gets a clean 503, everything else is
  // unaffected) until an operator sets a real key — this code never generates or sets that value
  // itself. A 64-character hex string (32 raw bytes), e.g. `openssl rand -hex 32`. Treat it like
  // a password: never commit it, never log it, and rotating it makes every already-encrypted row
  // undecryptable until re-encrypted under the new key (there is no key-rotation migration yet).
  bankDetailsEncryptionKey: process.env.BANK_DETAILS_ENCRYPTION_KEY || '',
};
