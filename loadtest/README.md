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
