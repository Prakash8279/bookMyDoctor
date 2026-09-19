/**
 * Prisma Client singleton (connection pool to PostgreSQL).
 * Responsibility: one shared pooled client for the whole app; configure pool size/timeout here.
 * Do NOT instantiate PrismaClient anywhere else in the codebase.
 */
const { PrismaClient } = require('@prisma/client');
const env = require('./env');
const logger = require('./logger');

/**
 * Append Prisma's connection-pool tuning params (connection_limit, pool_timeout) to
 * DATABASE_URL, but ONLY for params the URL doesn't already set — a user who already tuned
 * their connection string by hand (e.g. a pooled Neon/Supabase URL that sets its own
 * connection_limit) must not have that silently overridden by env.js's defaults.
 *
 * Why this matters: this app is explicitly designed to run multiple API replicas plus a
 * separate worker process (see server.js's own comment on that), and EACH one opens its own
 * Prisma connection pool. Left uncapped, Prisma sizes the pool from the machine's CPU count —
 * so replica count alone, with no increase in real traffic, can exhaust a managed Postgres's
 * connection limit and force an unnecessary DB plan upgrade. Capping + a pool-acquire timeout
 * here means "too many replicas" fails fast and visibly (a Prisma pool-timeout error) instead
 * of quietly eating the DB's entire connection budget.
 */
function buildEffectiveDatabaseUrl() {
  let url;
  try {
    url = new URL(env.databaseUrl);
  } catch (err) {
    // Not a parseable URL — shouldn't happen (env.js requires DATABASE_URL to be set), but
    // fall back to using it verbatim rather than crashing boot over a cosmetic tuning feature.
    return env.databaseUrl;
  }

  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', String(env.dbPoolSize));
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', String(env.dbPoolTimeoutSeconds));
  }
  return url.toString();
}

const prisma = new PrismaClient({
  datasources: { db: { url: buildEffectiveDatabaseUrl() } },
  log: env.isProduction
    ? [{ level: 'error', emit: 'stdout' }, { level: 'warn', emit: 'stdout' }]
    : [
        { level: 'query', emit: 'event' },
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
      ],
});

if (!env.isProduction) {
  // Query-event logging only in dev — noisy and unnecessary in production.
  prisma.$on('query', (e) => {
    logger.debug(`[prisma] ${e.query} (${e.duration}ms)`);
  });
}

module.exports = prisma;
