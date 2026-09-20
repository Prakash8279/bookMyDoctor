# BookMyDoctor24 — Load-Test Issues & Implementation Plan (2026-09-20)

Consolidates every issue found across `login-loadtest.js` and `full-api-sweep.js`'s real runs
(see `docs/api-load-test-results-2026-09-20.md` for the raw numbers and initial analysis) into
one prioritized list, now corrected against the actual `.env` values supplied afterward
(`AUTH_RATE_LIMIT_MAX=10000`/15min, `DEFAULT_RATE_LIMIT_MAX=10000`/1min) and a direct read of
`src/middleware/rateLimiter.js` to confirm the exact mechanism rather than guess at it.

## Issues found

- **[Critical] `POST /auth/login` has a hard ~28-32 req/s ceiling, independent of offered
  concurrency.** Throughput is flat from 20 to 300 concurrent while latency climbs almost
  linearly (712ms → 2676ms → 5281ms avg) — the signature of every request queueing behind a
  fixed-size worker pool. Root cause: `bcrypt.compare()` runs on Node's libuv thread pool,
  which defaults to just 4 threads system-wide, so only ~4 logins can be actively hashing at
  once no matter how many arrive.
- **[Critical] Login fails completely instead of degrading gracefully at extreme concurrency.**
  At 600 concurrent, 480 of the requests time out; at 1000 concurrent, **zero** logins succeed
  (525 timeouts). There's no queue-depth cap or circuit breaker on this route — every request
  just piles up and hangs until the client gives up, rather than the server shedding load with
  a fast `503`.
- **[High] `defaultLimiter` — the rate limiter applied globally to every route in `app.js` — is
  a single bucket keyed by IP alone** (confirmed by reading `rateLimiter.js`: *"Generous —
  applied globally in app.js. Keyed by IP"*), shared across **every route, authenticated or
  not**, from that IP. This is why `full-api-sweep.js`'s flat-sweep stage looked broken: any
  single stage running at >167 req/s sustained (10000 ÷ 60s) burns through the *entire shared
  budget for every other endpoint too* within that same 1-minute window. The math lines up
  exactly with the observed data — every endpoint that individually produced **fewer** than
  10,000 requests in its own 8-second stage (`/me`, `/notifications`, `/medical-records`,
  `/admin/revenue-trend`, `/admin/jobs/failed` — all under ~500 req/s) shows **zero** `non-2xx`
  responses, while every endpoint at 1,000+ req/s shows thousands. This isn't a bug in those
  fast endpoints — it's the shared IP bucket running out.
- **[High] Because of the above, real throughput ceilings for 26 of the 28 GET endpoints are
  still unknown** — `/appointments`, `/payments`, every `/admin/*` route, etc. all had most of
  their offered load rejected by the limiter before it ever reached real endpoint logic.
- **[Medium] IP-only keying on `defaultLimiter` also means any group of users sharing one public
  IP — office wifi, a hospital's own reception network, a mobile carrier's NAT gateway — share
  a single 10,000/minute budget.** One unusually busy legitimate user (a receptionist's
  dashboard auto-refreshing several widgets, a doctor's app syncing on a slow connection and
  retrying) can rate-limit every other patient/doctor/receptionist behind that same IP for the
  rest of that minute. `bookingLimiter`, `paymentLimiter`, `uploadLimiter`, and
  `passwordChangeLimiter` all already key by authenticated user id first, falling back to IP —
  `defaultLimiter` is the one limiter that doesn't follow that pattern.
- **[Medium] Real congestion (not just rate-limit noise) is visible on `GET /appointments`** —
  avg latency climbs 8ms → 44ms → 132ms → 733ms as concurrency rises 10 → 400, a real trend on
  top of the 429 noise. Prime suspect: `server/server/.env.example`'s `DB_POOL_SIZE=5` — only 5
  concurrent Postgres connections per process — but this can't be confirmed until the rate
  limiter stops confounding the measurement (see Phase 1 below).
- **[Low] `uploadLimiter` has its window/max hardcoded** (`15 * 60 * 1000` / `20`) instead of
  going through `config/env.js`'s configurable `rateLimit` block like every other limiter —
  already flagged as a known follow-up in that file's own code comment, just not done yet.
- **[Low, tooling] `full-api-sweep.js` doesn't account for `defaultLimiter`'s shared-IP-bucket
  behavior** — it should either use a documented test-only override, or space out/scale down
  its own request volume, so a re-run doesn't require guessing an env value large enough by
  trial and error.
- **[Confirmed good — not an issue]** The Redis-backed cache-aside layer performs well under
  real load: `GET /geography/cities` @ 500 concurrent (738.8 req/s, 0 errors) and `GET /doctors`
  @ 10 concurrent (818 req/s, 0 non-2xx) are both clean, trustworthy numbers with no action
  needed.

## Implementation plan

### Phase 0 — Get clean data first (no permanent code changes, ~15 minutes)

1. Temporarily set `DEFAULT_RATE_LIMIT_MAX=1000000` (not `10000` — it needs to comfortably clear
   the ~1,300 req/s some endpoints can produce) in `server/server/.env`, restart the server, and
   confirm it took effect with one manual check:
   `curl -i http://localhost:4000/geography/cities` and look for `RateLimit-Limit: 1000000` in
   the response headers.
2. Re-run `node full-api-sweep.js` — this should now produce real, clean per-endpoint ceilings
   for all 26 previously-confounded endpoints.
3. Separately, start the server with `UV_THREADPOOL_SIZE=16` set (PowerShell:
   `$env:UV_THREADPOOL_SIZE=16; npm run dev`) and re-run `login-loadtest.js`. Compare the new
   20/100/300-concurrent numbers against the baseline in `api-load-test-results-2026-09-20.md`
   — if the ~30 req/s ceiling rises noticeably, that confirms the bcrypt/thread-pool diagnosis
   and justifies making the setting permanent (Phase 1, item 1).
4. **Revert `DEFAULT_RATE_LIMIT_MAX` back to `10000`** afterward — that value is a reasonable
   production default; only the *testing* step above needs it artificially high.
5. Send both new outputs back for a final, confident analysis.

### Phase 1 — Login resilience (backend code changes)

1. **Make `UV_THREADPOOL_SIZE` a permanent part of how the server starts**, once Phase 0 step 3
   confirms it helps. `UV_THREADPOOL_SIZE` must be set in the environment *before* the Node
   process starts (an in-code `process.env.UV_THREADPOOL_SIZE = ...` at the top of
   `src/server.js` is too late — libuv reads it once at process startup). Cleanest options:
   - Add `cross-env` as a dev dependency and change the `dev`/`start` npm scripts to
     `cross-env UV_THREADPOOL_SIZE=16 nodemon src/server.js` (works identically on Windows/macOS/Linux).
   - Or document it in `.env.example` with a note that it must be exported in the shell/host
     process manager (Docker, PM2, systemd) rather than read from `.env` by the app itself.
2. **Add a bounded in-flight guard on `POST /auth/login` (and `/auth/register`, which also
   bcrypt-hashes)** so the server fails fast instead of hanging every request until timeout once
   it's saturated. A small in-memory counter middleware in `src/modules/auth/auth.routes.js`
   (increment on entry, decrement in a `res.on('finish', ...)`/`finally`, reject with `503` +
   `Retry-After` once a calibrated threshold — e.g. 2-3x the measured ~30 req/s ceiling — is
   exceeded) is enough; this doesn't need to be perfect, it needs to convert "everyone times out"
   into "most succeed, a clear excess gets a fast, honest 503."
3. **Consider a dedicated worker pool for bcrypt** (e.g. via `piscina` or Node's own
   `worker_threads`), isolated from the general libuv pool that `dns`, `fs`, `zlib`
   (`compression` middleware), and other crypto calls also share. This is a larger change than
   items 1-2 — worth doing only if Phase 0's `UV_THREADPOOL_SIZE` experiment shows diminishing
   returns (i.e. other libuv-dependent work starts suffering once it's raised).

### Phase 2 — Rate limiter fairness (backend code change)

1. **Change `defaultLimiter`'s `keyGenerator` to prefer the authenticated user's id, falling
   back to IP** — the exact same one-line pattern already used by `bookingLimiter`,
   `paymentLimiter`, `uploadLimiter`, and `passwordChangeLimiter`:
   `keyGenerator: (req) => (req.user && req.user.id) || ipKeyGenerator(req.ip)`. This directly
   fixes the "one busy user exhausts the budget for everyone sharing their IP" problem, since
   `authenticate` already runs before most routes `defaultLimiter` protects.
   - Caveat to think through: `defaultLimiter` is applied *globally*, before route-specific
     `authenticate` middleware runs on many routes, so `req.user` may not be set yet at the
     point `defaultLimiter` executes. If so, this fix needs `defaultLimiter` moved to run
     *after* `authenticate` per-route (more invasive), or a lighter-weight approach: split it
     into two limiters — an IP-keyed one for genuinely public/unauthenticated routes, and a
     user-keyed one applied within each protected router (mirroring how `bookingLimiter`/
     `paymentLimiter` are already mounted inside their own route files, not globally).
2. **Wire `uploadLimiter`'s window/max into `config/env.js`** (`UPLOAD_RATE_LIMIT_MAX` /
   `UPLOAD_RATE_LIMIT_WINDOW_MINUTES`, following the exact pattern `authMax`/`bookingMax`
   already use) — small, low-risk cleanup, already flagged as a to-do in the code itself.

### Phase 3 — Verify everything with a second clean test pass

1. Re-run `full-api-sweep.js` (this time against the Phase 1+2 code, with the rate limit back
   at its real `10000` production value) to confirm: no route accidentally lost its rate
   limiting, real per-endpoint ceilings are now visible without the shared-bucket noise, and
   `defaultLimiter`'s fairness fix didn't break anything.
2. Specifically watch `GET /appointments` and other DB-backed endpoints for the `DB_POOL_SIZE=5`
   suspicion — if latency still climbs sharply well before Postgres itself would plausibly be
   the bottleneck, try temporarily raising `DB_POOL_SIZE` and re-testing to isolate it.
3. Re-run `login-loadtest.js` post-Phase-1 and confirm two things: the ~30 req/s ceiling moved
   (if `UV_THREADPOOL_SIZE` was the real fix), and the 600-1000 concurrent stages now show a
   clean `503`/`Retry-After` pattern instead of the current all-timeout collapse.

### Phase 4 — Documentation

1. Update `loadtest/README.md`'s "Full API sweep" section with the corrected explanation of
   `defaultLimiter`'s shared-IP-bucket behavior and the safe test-only override value, so this
   doesn't need to be rediscovered next time.
2. Fold the final, clean before/after numbers into `docs/api-load-test-results-2026-09-20.md`
   once Phase 3 is done.

## Suggested order of operations

Phase 0 is pure data-gathering (no lasting risk, fully reversible) and should happen first — it
turns three of the "unknowns" above into confirmed facts before any code gets written, so Phase
1/2's design decisions are based on real numbers rather than the current best-guess reasoning.
