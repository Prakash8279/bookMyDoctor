/**
 * OPTIONAL cluster entry point — forks one worker process per CPU core, each running the full
 * HTTP server from server.js. This is the SINGLE-MACHINE equivalent of the nginx +
 * docker-compose "--scale server=N" setup (see nginx/api.conf and
 * docs/load-balancing-check-2026-09-20.md): instead of spreading traffic across separate
 * containers, Node's own `cluster` module spreads it across separate OS processes on this one
 * machine, so one `node src/cluster.js` uses every CPU core instead of just one.
 *
 * Why this exists: a plain `node src/server.js` (what `npm run dev` / `npm start` run today) is
 * ONE process — JavaScript on it runs on a single CPU core no matter how many concurrent
 * requests hit it. UV_THREADPOOL_SIZE=16 (already set in package.json's dev/start scripts) helps
 * with I/O-bound work like bcrypt hashing, but every request still shares that one core's
 * event loop for its own JS/DB-query/response-building work. Under a big local load test (or a
 * real single-box production deploy that isn't behind the docker-compose/nginx replica setup),
 * that single core is the ceiling. Forking one worker per core removes that ceiling on a
 * machine with more than one core.
 *
 * OPT-IN ONLY — `npm run dev` and `npm start` are COMPLETELY UNCHANGED and keep running one
 * single process, which stays the simplest way to debug locally (one set of logs, one
 * nodemon-restart target). Use this file specifically when load-testing this machine's real
 * multi-core throughput, or when running a real single-box deployment without Docker. A new
 * "start:cluster" npm script runs it (see package.json) — nothing existing was touched.
 *
 * CLUSTER_WORKERS env var overrides the worker count (defaults to every CPU core os.cpus()
 * reports). Each worker is a fully independent process with its own Prisma connection pool
 * (config/db.js) and its own in-memory in-flight-guard counter (middleware/inFlightGuard.js) —
 * exactly like separate docker-compose replicas. The state that has to stay shared ACROSS
 * workers already lives in Redis (middleware/rateLimiter.js, services/lockService.js), so this
 * is safe for the same reason the docker-compose multi-replica setup is safe. One thing to size
 * accordingly if you use this: DB_POOL_SIZE (.env) x number of workers must stay under your
 * Postgres's max_connections — see config/db.js's own header comment on this exact math.
 */
const cluster = require('cluster');
const os = require('os');
const logger = require('./config/logger');

const numWorkers = parseInt(process.env.CLUSTER_WORKERS, 10) || os.cpus().length;

if (cluster.isPrimary) {
  logger.info(`[cluster] Primary pid=${process.pid} starting ${numWorkers} worker process(es) (one per CPU core)...`);

  for (let i = 0; i < numWorkers; i += 1) {
    cluster.fork();
  }

  // A worker dying (uncaught exception, OOM-kill, etc.) should not silently shrink the pool —
  // replace it immediately so total capacity stays at numWorkers. server.js's own
  // uncaughtException/unhandledRejection handlers already exit(1) deliberately rather than
  // limping on with a corrupted process, so a respawn here is the correct complement to that.
  cluster.on('exit', (worker, code, signal) => {
    logger.error(`[cluster] Worker pid=${worker.process.pid} exited (code=${code}, signal=${signal}). Forking a replacement.`);
    cluster.fork();
  });

  // Forward termination to every worker so Ctrl+C / `docker stop` shuts the whole cluster down
  // cleanly instead of leaving orphaned worker processes behind. Each worker runs server.js's
  // own SIGTERM/SIGINT handler independently (graceful HTTP drain, Prisma/Redis disconnect).
  const forwardAndExit = (signal) => {
    logger.info(`[cluster] Primary received ${signal}, forwarding to ${numWorkers} worker(s)...`);
    for (const id in cluster.workers) {
      if (cluster.workers[id]) cluster.workers[id].process.kill(signal);
    }
  };
  process.on('SIGTERM', () => forwardAndExit('SIGTERM'));
  process.on('SIGINT', () => forwardAndExit('SIGINT'));
} else {
  // Worker process: just run the normal, unmodified server entry point. Node's cluster module
  // has the primary own the actual listening socket and distribute incoming connections across
  // workers under the hood — no code change needed in server.js/app.js for this to work, which
  // is exactly what server.js's own header comment anticipated ("so this file can be imported
  // directly... e.g. for horizontal scaling").
  require('./server');
}
