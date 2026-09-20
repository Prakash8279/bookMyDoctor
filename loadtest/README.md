# Phase 1 — Scalability baseline test

Goal: find out how the backend actually behaves under concurrent login load, on a single
Node.js process, with today's config — before any of the Phase 2+ fixes (clustering, pool
tuning, etc.) are applied. This gives us a "before" number to compare every later phase against.

## What this test does NOT prove

It runs on your own PC, generating load against your own PC's server. At high concurrency you're
partly measuring your PC's own networking/CPU limits, not 20,000 independent real users on
20,000 different machines. What it DOES reliably reveal: the server's own single-process
bottlenecks (bcrypt blocking the event loop, DB connection pool exhaustion, etc.) — which is
exactly what needs fixing first, and exactly what Phase 1 is for.

## Steps

1. **Temporarily raise the login rate limit** (otherwise this test just measures the rate
   limiter rejecting requests, not real capacity):
   - Open `server/.env`
   - Find `AUTH_RATE_LIMIT_MAX` (likely `10`) and change it to `100000`
   - Restart **Terminal 1** (`npm run dev` in `server/`) so the change takes effect

2. **Make sure all 3 terminals are running**: Terminal 1 (server), Terminal 2 (worker),
   Terminal 3 (client) — the client isn't strictly needed for this test but keep it running
   anyway. Also make sure Memurai (Redis) is running.

3. **Install and run**, in a NEW terminal (Terminal 4 — doesn't need to stay open after):
   ```
   cd loadtest
   npm install
   node login-loadtest.js
   ```
   This takes about 2-3 minutes total (5 login stages × ~13s each, plus a comparison test).

4. **Copy the full output** (everything from `=== Phase 1 baseline` onward) and send it back —
   that's the data the next phase gets planned from.

5. **Revert the rate limit** — set `AUTH_RATE_LIMIT_MAX` back to `10` in `server/.env` and
   restart Terminal 1 again. Do not leave the login endpoint unprotected after this test.

## What to watch for in your own terminal windows while it runs

- **Terminal 1 (server)**: does it stay responsive, or does it start logging errors / slow
  down / crash partway through a stage?
- **Task Manager**: does `node.exe` (the server process) pin one CPU core at 100% while others
  sit idle? (This is expected — it's the single-process bottleneck Phase 2 fixes.)

---

# Full API sweep (`full-api-sweep.js`)

Companion script that goes wider instead of deeper: `login-loadtest.js` above is a focused,
multi-stage ramp on one endpoint (`/auth/login`); `full-api-sweep.js` covers every `GET` route
in the real route table (read straight out of `src/modules/*/*.routes.js` — see the API
inventory in `docs/api-load-test-report-2026-09-20.md` for the full list with auth
requirements) with one validation request and one load stage each, plus a deeper ramp on two
representative endpoints (a cache-fronted public read and an always-hits-Postgres
authenticated read).

**Why this exists as a separate script, not more stages bolted onto `login-loadtest.js`**:
different endpoints need different auth (or none), and testing 25+ endpoints at
`login-loadtest.js`'s 5-stage depth would take well over an hour; this instead does one
broad, fast pass so you can see at a glance whether anything is obviously slow or broken, and
only goes deep on the two endpoint shapes that matter most (cached vs. uncached reads).

**It intentionally never touches a write endpoint** (no `POST`/`PATCH`/`DELETE` is ever load
tested) — every write in this API has a real side effect in whatever database `LOADTEST_BASE_URL`
points at, and load-testing those needs a disposable database and your own explicit decision to
do it, not a default script.

## Steps

1. Same prerequisite as above, but raise **both** rate limits temporarily in `server/.env`
   (this script logs in 5 times, then deliberately exceeds the normal read rate on every
   endpoint):
   - `AUTH_RATE_LIMIT_MAX=100000`
   - `DEFAULT_RATE_LIMIT_MAX=100000`
   - Restart Terminal 1.
2. Same 3 terminals + Redis running as above.
3. Run it:
   ```
   cd loadtest
   npm install   (skip if you already ran this for login-loadtest.js)
   node full-api-sweep.js
   ```
   Expect roughly 5-7 minutes total (login pass + ~20 endpoint validations + ~20 flat load
   stages at 8s each + two 4-stage ramps).
4. Copy everything from `=== Full API sweep` onward and send it back.
5. **Revert both rate limits** back to their original values (`AUTH_RATE_LIMIT_MAX=10`,
   `DEFAULT_RATE_LIMIT_MAX=300` unless you'd changed those defaults already) and restart
   Terminal 1. Do not leave the API unprotected after this test.

## Endpoints this does NOT cover, and why

- Any `GET /.../:id` route (a specific doctor, clinic, appointment, payment, or a document
  download) — there's no generic way to pick a valid id without querying your database first.
  If you want these covered, pass real ids from your own seeded data:
  ```
  set DETAIL_ROUTE_IDS={"doctorId":"...","clinicId":"...","appointmentId":"...","paymentId":"..."}
  node full-api-sweep.js
  ```
- Every `POST`/`PATCH`/`DELETE` endpoint (registration, booking, payments, admin writes, etc.)
  — deliberately excluded, see above.
