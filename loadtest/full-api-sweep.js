/**
 * Full API sweep — companion to login-loadtest.js (Phase 1 baseline).
 *
 * login-loadtest.js only covers POST /auth/login. This script covers EVERY GET endpoint in
 * the backend's real route table (built by reading src/modules/*\/*.routes.js directly, not
 * guessed), so you get one pass across the whole API surface instead of just one endpoint.
 *
 * WHAT THIS DOES:
 *   1. Logs in once as each of the 5 seeded demo accounts (one request each, not load) to
 *      get a real access token per role.
 *   2. Sends ONE validation request to every GET endpoint, so you can see at a glance which
 *      ones are reachable, which return an unexpected status, and each one's single-request
 *      baseline latency.
 *   3. Runs a moderate-concurrency load stage (default 50 concurrent, 8s) against every GET
 *      endpoint that validated cleanly, using autocannon (same tool login-loadtest.js uses).
 *   4. Runs one deeper progressive ramp (10 -> 50 -> 150 -> 400 concurrent) against ONE
 *      representative uncached, DB-hitting, authenticated endpoint (GET /appointments) and
 *      one representative cached public endpoint (GET /doctors), so you also get a "how does
 *      this scale" curve, not just a single point, for the two endpoint shapes that matter
 *      most (a cache-fronted read vs. an always-hits-Postgres read).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO (same "only test GET by default" rule as any load-test
 * tool should follow — see the api-load-tester skill this was generated for):
 *   - No POST/PATCH/DELETE endpoint is exercised under load. Every write endpoint in this API
 *     has a real side effect (creates a real appointment/payment/complaint row, changes a real
 *     doctor's clinic, etc.) in whatever database this points at. Load-testing those needs a
 *     dedicated, disposable database and a human decision to do it — not a default sweep.
 *   - GET /:id-style routes that need a real, specific record id (GET /doctors/:id,
 *     GET /clinics/:id, GET /payments/:id, GET /appointments/:id, GET /uploads/documents/:filename)
 *     are skipped — there's no generic way to pick a valid id without querying the DB first,
 *     and a wrong id just measures 404 handling, not the real endpoint. Pass a real id via the
 *     DETAIL_ROUTE_IDS env var (see below) if you want these covered too.
 *
 * BEFORE RUNNING (same caveat as login-loadtest.js — read that file's own header too):
 *   - Terminal 1 (`npm run dev` in server/), Terminal 2 (worker), Memurai/Redis must all be
 *     running, pointed at a database you're OK generating read load against.
 *   - Temporarily raise BOTH `AUTH_RATE_LIMIT_MAX` (this script logs in 5 times) and
 *     `DEFAULT_RATE_LIMIT_MAX` (this script's whole point is exceeding the normal read rate)
 *     in server/.env, restart Terminal 1, run this, then put both back and restart again.
 *     Leaving either raised after this run means those endpoints are unprotected.
 *
 * Usage:
 *   cd loadtest
 *   npm install          (only needed once — same autocannon dependency as login-loadtest.js)
 *   node full-api-sweep.js
 *
 * Optional env vars:
 *   LOADTEST_BASE_URL      default http://localhost:4000
 *   SWEEP_CONNECTIONS       concurrency for the flat per-endpoint sweep, default 50
 *   SWEEP_DURATION          seconds per endpoint in the flat sweep, default 8
 *   DETAIL_ROUTE_IDS        JSON, e.g. {"doctorId":"...","clinicId":"...","appointmentId":"..."}
 *                           — fills in the :id-style routes listed above if you have real ones.
 */
const autocannon = require('autocannon');
const http = require('http');
const https = require('https');

const BASE_URL = process.env.LOADTEST_BASE_URL || 'http://localhost:4000';
const SWEEP_CONNECTIONS = Number(process.env.SWEEP_CONNECTIONS || 50);
const SWEEP_DURATION = Number(process.env.SWEEP_DURATION || 8);
let DETAIL_IDS = {};
try {
  DETAIL_IDS = JSON.parse(process.env.DETAIL_ROUTE_IDS || '{}');
} catch (_) {
  DETAIL_IDS = {};
}

// Same 5 seeded demo accounts login-loadtest.js uses (prisma/manual_sql/seed_demo_data.sql).
const DEMO_ACCOUNTS = {
  patient: { email: 'patient@connectdoctor.test', password: 'Patient#DC2026!Test' },
  doctor: { email: 'doctor@connectdoctor.test', password: 'Doctor#DC2026!Test' },
  receptionist: { email: 'receptionist@connectdoctor.test', password: 'Reception#DC2026!Test' },
  admin: { email: 'admin@connectdoctor.test', password: 'Admin#DC2026!Test' },
  superadmin: { email: 'superadmin@connectdoctor.test', password: 'Super#DC2026!Test' },
};

// The full GET route table, read directly out of src/modules/*/*.routes.js — not guessed.
// `roles: null` means public/optional-auth (tested with no Authorization header at all).
// `roles: [...]` means the first role in that list with a live token is used.
const ROUTES = [
  { label: 'GET /health/', path: '/health/', roles: null },
  { label: 'GET /health/live', path: '/health/live', roles: null },
  { label: 'GET /geography/cities', path: '/geography/cities', roles: null },
  { label: 'GET /geography/areas', path: '/geography/areas', roles: null },
  { label: 'GET /geography/specializations', path: '/geography/specializations', roles: null },
  { label: 'GET /doctors', path: '/doctors', roles: null },
  { label: 'GET /clinics', path: '/clinics', roles: null },
  { label: 'GET /reviews', path: '/reviews', roles: null },
  { label: 'GET /me', path: '/me', roles: ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'] },
  { label: 'GET /auth/me', path: '/auth/me', roles: ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'] },
  { label: 'GET /appointments', path: '/appointments', roles: ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'] },
  { label: 'GET /payments', path: '/payments', roles: ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'] },
  { label: 'GET /platform-charges', path: '/platform-charges', roles: ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'] },
  { label: 'GET /queue', path: '/queue', roles: ['doctor', 'receptionist'] },
  { label: 'GET /notifications', path: '/notifications', roles: ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'] },
  { label: 'GET /notifications/broadcast', path: '/notifications/broadcast', roles: ['admin', 'superadmin'] },
  { label: 'GET /complaints', path: '/complaints', roles: ['patient', 'admin', 'superadmin'] },
  { label: 'GET /family-members', path: '/family-members', roles: ['patient'] },
  { label: 'GET /receptionists', path: '/receptionists', roles: ['doctor', 'admin', 'superadmin'] },
  { label: 'GET /contact', path: '/contact', roles: ['admin', 'superadmin'] },
  { label: 'GET /medical-records', path: '/medical-records', roles: ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'] },
  { label: 'GET /admin/dashboard-stats', path: '/admin/dashboard-stats', roles: ['admin', 'superadmin'] },
  { label: 'GET /admin/system-settings', path: '/admin/system-settings', roles: ['admin', 'superadmin'] },
  { label: 'GET /admin/booking-rules', path: '/admin/booking-rules', roles: ['admin', 'superadmin'] },
  { label: 'GET /admin/activity-log', path: '/admin/activity-log', roles: ['admin', 'superadmin'] },
  { label: 'GET /admin/patients', path: '/admin/patients', roles: ['admin', 'superadmin'] },
  { label: 'GET /admin/revenue-trend', path: '/admin/revenue-trend', roles: ['admin', 'superadmin'] },
  { label: 'GET /admin/jobs/failed', path: '/admin/jobs/failed', roles: ['admin', 'superadmin'] },
];

// :id-style routes — only included if you supplied a real id via DETAIL_ROUTE_IDS.
if (DETAIL_IDS.doctorId) {
  ROUTES.push({ label: 'GET /doctors/:id', path: `/doctors/${DETAIL_IDS.doctorId}`, roles: null });
}
if (DETAIL_IDS.clinicId) {
  ROUTES.push({ label: 'GET /clinics/:id', path: `/clinics/${DETAIL_IDS.clinicId}`, roles: null });
  ROUTES.push({ label: 'GET /clinics/:id/hours', path: `/clinics/${DETAIL_IDS.clinicId}/hours`, roles: null });
}
if (DETAIL_IDS.appointmentId) {
  ROUTES.push({
    label: 'GET /appointments/:id',
    path: `/appointments/${DETAIL_IDS.appointmentId}`,
    roles: ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'],
  });
}
if (DETAIL_IDS.paymentId) {
  ROUTES.push({
    label: 'GET /payments/:id',
    path: `/payments/${DETAIL_IDS.paymentId}`,
    roles: ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'],
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonRequest(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request(
      url,
      {
        method,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch (_) {
            // non-JSON response — leave parsed null, caller only needs res.statusCode for those
          }
          resolve({ statusCode: res.statusCode, body: parsed, raw: data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function loginAll() {
  const tokens = {};
  console.log('=== Logging in as each demo account (one request per role, not load) ===');
  for (const [role, creds] of Object.entries(DEMO_ACCOUNTS)) {
    try {
      const res = await jsonRequest('POST', `${BASE_URL}/auth/login`, creds);
      const token = res.body && res.body.data && res.body.data.accessToken;
      if (res.statusCode === 200 && token) {
        tokens[role] = token;
        console.log(`  ${role.padEnd(13)} -> OK (${creds.email})`);
      } else {
        console.log(`  ${role.padEnd(13)} -> FAILED, status ${res.statusCode}: ${res.raw.slice(0, 200)}`);
      }
    } catch (err) {
      console.log(`  ${role.padEnd(13)} -> FAILED to connect: ${err.message}`);
    }
  }
  return tokens;
}

function pickToken(tokens, roles) {
  if (!roles) return null;
  for (const role of roles) {
    if (tokens[role]) return { role, token: tokens[role] };
  }
  return null;
}

async function validateAll(routes, tokens) {
  console.log('\n=== Step 2: one validation request per endpoint ===');
  const validated = [];
  for (const route of routes) {
    const picked = pickToken(tokens, route.roles);
    if (route.roles && !picked) {
      console.log(`  ${route.label.padEnd(34)} -> SKIPPED (no live token for any of: ${route.roles.join(', ')})`);
      continue;
    }
    const headers = picked ? { authorization: `Bearer ${picked.token}` } : {};
    const started = Date.now();
    try {
      const res = await jsonRequest('GET', `${BASE_URL}${route.path}`, null, headers);
      const ms = Date.now() - started;
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      console.log(
        `  ${route.label.padEnd(34)} -> ${res.statusCode}${picked ? ` (as ${picked.role})` : ''} in ${ms}ms${ok ? '' : '  <-- not 2xx, excluded from load stage'}`
      );
      validated.push({ ...route, picked, ok });
    } catch (err) {
      console.log(`  ${route.label.padEnd(34)} -> FAILED to connect: ${err.message}`);
      validated.push({ ...route, picked, ok: false });
    }
  }
  return validated.filter((r) => r.ok);
}

function summarize(result) {
  const lat = result.latency || {};
  const req = result.requests || {};
  return {
    reqPerSec: (req.average ?? '-'),
    avgMs: (lat.average ?? '-'),
    p97_5Ms: (lat.p97_5 ?? '-'),
    p99Ms: (lat.p99 ?? '-'),
    errors: result.errors ?? 0,
    timeouts: result.timeouts ?? 0,
    non2xx: result.non2xx ?? 0,
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

async function flatSweep(validated) {
  console.log(`\n=== Step 3: flat load stage per endpoint (${SWEEP_CONNECTIONS} concurrent, ${SWEEP_DURATION}s each) ===`);
  console.log(`This will take roughly ${Math.ceil((validated.length * (SWEEP_DURATION + 2)) / 60)} minute(s).\n`);
  const results = [];
  for (const route of validated) {
    const headers = route.picked ? { authorization: `Bearer ${route.picked.token}` } : {};
    console.log(`Running: ${route.label}...`);
    let result;
    try {
      result = await runStage({
        url: `${BASE_URL}${route.path}`,
        connections: SWEEP_CONNECTIONS,
        duration: SWEEP_DURATION,
        method: 'GET',
        headers,
      });
    } catch (err) {
      console.log(`  -> stage failed to run: ${err.message}`);
      continue;
    }
    const s = summarize(result);
    console.log(
      `  -> req/sec: ${s.reqPerSec} | avg: ${s.avgMs}ms | p97.5: ${s.p97_5Ms}ms | p99: ${s.p99Ms}ms | errors: ${s.errors} | timeouts: ${s.timeouts} | non-2xx: ${s.non2xx}`
    );
    results.push({ label: route.label, summary: s });
    await sleep(2000);
  }
  return results;
}

async function deepDive(label, path, headers) {
  const STAGES = [
    { connections: 10, duration: 8 },
    { connections: 50, duration: 8 },
    { connections: 150, duration: 8 },
    { connections: 400, duration: 8 },
  ];
  console.log(`\n=== Deep dive: ${label} (progressive ramp) ===`);
  const rows = [];
  for (const stage of STAGES) {
    console.log(`  ${stage.connections} concurrent for ${stage.duration}s...`);
    let result;
    try {
      result = await runStage({ url: `${BASE_URL}${path}`, connections: stage.connections, duration: stage.duration, method: 'GET', headers });
    } catch (err) {
      console.log(`    -> failed: ${err.message}`);
      continue;
    }
    const s = summarize(result);
    console.log(
      `    -> req/sec: ${s.reqPerSec} | avg: ${s.avgMs}ms | p99: ${s.p99Ms}ms | errors: ${s.errors} | non-2xx: ${s.non2xx}`
    );
    rows.push({ connections: stage.connections, summary: s });
    await sleep(2000);
  }
  return rows;
}

function printTable(title, rows) {
  console.log(`\n=== SUMMARY: ${title} ===`);
  console.log('Endpoint/Stage'.padEnd(36), 'Req/sec'.padEnd(10), 'Avg ms'.padEnd(9), 'p99 ms'.padEnd(9), 'Errors'.padEnd(8), 'Non-2xx');
  for (const row of rows) {
    const label = row.label || `${row.connections} concurrent`;
    const s = row.summary;
    console.log(
      String(label).padEnd(36),
      String(s.reqPerSec).padEnd(10),
      String(s.avgMs).padEnd(9),
      String(s.p99Ms).padEnd(9),
      String(s.errors).padEnd(8),
      String(s.non2xx)
    );
  }
}

async function main() {
  console.log('=== Full API sweep ===');
  console.log(`Target: ${BASE_URL}`);
  console.log(`${ROUTES.length} GET routes known. Write endpoints (POST/PATCH/DELETE) are intentionally never load-tested by this script.\n`);

  const tokens = await loginAll();
  const validated = await validateAll(ROUTES, tokens);
  const flatResults = await flatSweep(validated);
  printTable(`flat sweep (${SWEEP_CONNECTIONS} concurrent)`, flatResults);

  const adminOrPatient = tokens.admin
    ? { role: 'admin', token: tokens.admin }
    : tokens.patient
    ? { role: 'patient', token: tokens.patient }
    : null;

  if (adminOrPatient) {
    const appointmentsRows = await deepDive('GET /appointments (uncached, hits Postgres)', '/appointments', {
      authorization: `Bearer ${adminOrPatient.token}`,
    });
    printTable('GET /appointments ramp', appointmentsRows);
  } else {
    console.log('\n(Skipping GET /appointments deep dive — no admin or patient token available.)');
  }

  const doctorsRows = await deepDive('GET /doctors (public, cache-fronted)', '/doctors', {});
  printTable('GET /doctors ramp', doctorsRows);

  console.log('\nDone. Copy everything above (from "=== Full API sweep" onward) and send it back for analysis.');
}

main().catch((err) => {
  console.error('Full API sweep failed:', err);
  process.exit(1);
});
