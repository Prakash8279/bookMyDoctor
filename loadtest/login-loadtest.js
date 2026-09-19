/**
 * Phase 1 scalability baseline test.
 *
 * IMPORTANT — what this test can and cannot tell us:
 * It runs on the SAME machine as the server (your PC generates the load AND runs the
 * server). That means at high concurrency you are partly measuring your own PC's
 * networking/CPU limits, not a true 20,000-independent-user scenario (real users would be
 * on 20,000 different machines/networks). What it CAN reliably show is the server's
 * single-process bottleneck (event loop blocking from bcrypt, DB pool exhaustion, etc.) —
 * which is exactly what Phase 1 needs to establish before Phase 2+ fixes are applied and
 * re-measured for comparison.
 *
 * BEFORE RUNNING — the login rate limiter (10 requests / 15 minutes / IP) will make this
 * test meaningless if left as-is (it'll just measure the rate limiter rejecting requests,
 * not real capacity). Temporarily raise it:
 *   1. Open server/.env
 *   2. Set AUTH_RATE_LIMIT_MAX=100000  (was probably 10 or unset)
 *   3. Restart Terminal 1 (npm run dev) so the new value takes effect
 *   4. Run this test
 *   5. Afterwards, set AUTH_RATE_LIMIT_MAX back to its original value (10) and restart
 *      Terminal 1 again — do not leave the login endpoint unprotected.
 *
 * Usage:
 *   cd loadtest
 *   npm install
 *   node login-loadtest.js
 *
 * Optional: LOADTEST_BASE_URL env var to point at a different host (default
 * http://localhost:4000).
 */
const autocannon = require('autocannon');

const BASE_URL = process.env.LOADTEST_BASE_URL || 'http://localhost:4000';

const LOGIN_STAGES = [
  { connections: 20, duration: 10, label: '20 concurrent' },
  { connections: 100, duration: 10, label: '100 concurrent' },
  { connections: 300, duration: 10, label: '300 concurrent' },
  { connections: 600, duration: 10, label: '600 concurrent' },
  { connections: 1000, duration: 10, label: '1000 concurrent' },
];

const LOGIN_BODY = JSON.stringify({
  email: 'patient@connectdoctor.test',
  password: 'Patient#DC2026!Test',
});

function num(v, fallback) {
  return v === undefined || v === null || Number.isNaN(v) ? fallback : v;
}

function summarize(result) {
  const lat = result.latency || {};
  const req = result.requests || {};
  return {
    reqPerSec: num(req.average, '-'),
    avgMs: num(lat.average, '-'),
    p97_5Ms: num(lat.p97_5, '-'),
    p99Ms: num(lat.p99, '-'),
    maxMs: num(lat.max, '-'),
    errors: num(result.errors, 0),
    timeouts: num(result.timeouts, 0),
    non2xx: num(result.non2xx, 0),
  };
}

function runStage(opts) {
  return new Promise((resolve, reject) => {
    autocannon(opts, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Phase 1 baseline: POST /auth/login ===');
  console.log(`Target: ${BASE_URL}/auth/login`);
  console.log('Make sure AUTH_RATE_LIMIT_MAX is temporarily raised and the server was restarted (see comment at top of this file) — otherwise every stage below will just show 429s.\n');

  const loginResults = [];
  for (const stage of LOGIN_STAGES) {
    console.log(`Running stage: ${stage.label} for ${stage.duration}s... (please wait)`);
    let result;
    try {
      result = await runStage({
        url: `${BASE_URL}/auth/login`,
        connections: stage.connections,
        duration: stage.duration,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: LOGIN_BODY,
      });
    } catch (err) {
      console.error(`Stage "${stage.label}" failed to run: ${err.message}`);
      console.error('(Is the server actually running on', BASE_URL, '? Check Terminal 1.)');
      process.exit(1);
    }
    const s = summarize(result);
    console.log(
      `  -> req/sec avg: ${s.reqPerSec} | latency avg: ${s.avgMs}ms | p97.5: ${s.p97_5Ms}ms | p99: ${s.p99Ms}ms | max: ${s.maxMs}ms | errors: ${s.errors} | timeouts: ${s.timeouts} | non-2xx: ${s.non2xx}`
    );
    loginResults.push({ label: stage.label, summary: s, raw: result });
    await sleep(3000); // let the server breathe between stages
  }

  console.log('\n=== SUMMARY: /auth/login ===');
  console.log(
    'Stage'.padEnd(16),
    'Req/sec'.padEnd(10),
    'Avg ms'.padEnd(9),
    'p97.5 ms'.padEnd(10),
    'p99 ms'.padEnd(9),
    'Errors'.padEnd(8),
    'Non-2xx'
  );
  for (const { label, summary } of loginResults) {
    console.log(
      label.padEnd(16),
      String(summary.reqPerSec).padEnd(10),
      String(summary.avgMs).padEnd(9),
      String(summary.p97_5Ms).padEnd(10),
      String(summary.p99Ms).padEnd(9),
      String(summary.errors).padEnd(8),
      String(summary.non2xx)
    );
  }

  console.log('\n=== Comparison: cached read endpoint, GET /geography/cities @ 500 concurrent ===');
  console.log('(This should look dramatically faster/cleaner than login — login is uncacheable by design, this shows the cache layer working.)');
  let cacheResult;
  try {
    cacheResult = await runStage({
      url: `${BASE_URL}/geography/cities`,
      connections: 500,
      duration: 10,
      method: 'GET',
    });
  } catch (err) {
    console.error('Cache comparison stage failed:', err.message);
    console.log('\nDone (login stages completed; cache comparison skipped).');
    return;
  }
  const cs = summarize(cacheResult);
  console.log(
    `  -> req/sec avg: ${cs.reqPerSec} | latency avg: ${cs.avgMs}ms | p97.5: ${cs.p97_5Ms}ms | p99: ${cs.p99Ms}ms | errors: ${cs.errors} | non-2xx: ${cs.non2xx}`
  );

  console.log('\nDone. Copy everything above (from "=== Phase 1 baseline" onward) and send it back for analysis.');
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
