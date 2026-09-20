# BookMyDoctor24 — API Load-Test Results (2026-09-20)

Real results from `loadtest/login-loadtest.js` and `loadtest/full-api-sweep.js`, both run on
your own machine against your own local Postgres/Redis. This is the analysis pass over that
output — see `docs/api-load-test-report-2026-09-20.md` for the underlying endpoint inventory
and tool design.

## Headline finding: `/auth/login` has a hard, low ceiling — and it comes from bcrypt, not the network or the database

```
Concurrency   Req/sec   Avg latency   p97.5      p99        Errors/Timeouts
    20          27.8      712ms        2256ms     2380ms         0
   100          31.8     2676ms        3133ms     3267ms         0
   300          31.1     5281ms        9518ms     9643ms         0
   600          12.0     8145ms        9905ms     9946ms       480
  1000           0.0        -             -          -          525   <- total collapse
```

Throughput (req/sec)
```
 35 |          ***  ***
    |     ***             ***
 30 | ***
    |
 25 |
    |
 20 |
    |
 15 |
    |                                 ***
 10 |
    |
  5 |
    |
  0 |                                             ***
    +----------------------------------------------------
       20      100      300      600      1000   concurrency
```

**Read this as: throughput is flat (~28-32 req/s) from 20 all the way to 300 concurrent, while
latency scales up almost linearly with concurrency (712ms → 2676ms → 5281ms).** That combination
— flat throughput, linearly climbing latency — is the textbook signature of requests queueing
behind a *fixed-size worker pool*, not a network, database, or memory bottleneck. If it were a
database bottleneck, you'd expect throughput to at least rise somewhat with concurrency before
plateauing; here it never rises at all.

**Root cause: `bcrypt.compare()`'s call runs on Node's libuv thread pool, which defaults to 4
threads system-wide**, no matter how many requests arrive. Every login does one bcrypt compare,
and bcrypt is deliberately CPU-expensive (that's what makes it secure against offline cracking).
The math checks out almost exactly:

- Using Little's Law (concurrency ≈ throughput × average latency) on your own numbers: at 100
  concurrent, 31.8 req/s × 2.676s ≈ 85 requests actually in flight/queued at once — i.e. the
  vast majority of the 100 connections you opened were sitting in a queue, not being served.
- A flat ~30 req/s ceiling implies each bcrypt compare is occupying a thread for roughly
  1000ms ÷ 30 × 4 threads ≈ 130ms of real CPU time — a very plausible number for
  `BCRYPT_SALT_ROUNDS=12` (your `.env.example` default) on typical hardware.

**Breaking point: between 300 and 600 concurrent.** At 600, throughput craters to 12 req/s and
480 requests time out; at 1000 concurrent the server produces **zero** successful logins and
525 timeouts — a full collapse, not a graceful slowdown.

### What this means in practice

At today's config, this server can sustain roughly **30 logins/second** before latency starts
climbing past 2-3 seconds, and it falls over entirely somewhere around 500-600 simultaneous
login attempts. For context: 30/s is ~1,800 logins/minute, which is generous for almost any
realistic patient-app usage pattern — the risk isn't everyday traffic, it's a burst (a
marketing push, a clinic reopening announcement, or — worth naming since this is a healthcare
app — an emergency/outbreak-driven surge in signups all landing in the same few minutes).

### Recommendations, cheapest first

1. **Try raising `UV_THREADPOOL_SIZE`** (e.g. start the server with
   `UV_THREADPOOL_SIZE=16 npm run dev` instead of just `npm run dev`, on Windows via
   `set UV_THREADPOOL_SIZE=16 && npm run dev` or in PowerShell
   `$env:UV_THREADPOOL_SIZE=16; npm run dev`) — zero code changes, and if the bcrypt-threadpool
   theory above is right, this should visibly raise the flat ~30 req/s ceiling. Worth
   re-running `login-loadtest.js` right after to confirm before/after.
2. **Give the login route a graceful failure mode instead of an all-or-nothing collapse** — at
   minimum, `authLimiter`'s existing rate limit already protects against sustained abuse, but
   the 600-1000 concurrent numbers show that a genuine traffic spike (not abuse — real users)
   currently degrades to 0% success rather than shedding load predictably. A small connection
   queue with a fast 503 + `Retry-After` once it's full is safer than letting every request hang
   until timeout.
3. This is exactly the kind of finding the existing `loadtest/README.md` Phase 1 note predicted
   ("bcrypt blocking the event loop") — worth treating this run as confirmation and moving that
   item up your backlog rather than a new discovery to re-investigate.

## Cache layer comparison: working as designed

```
GET /geography/cities @ 500 concurrent: 738.8 req/s | avg 667ms | p99 861ms | 0 errors
```

At *higher* concurrency than any clean login stage, this cached, unauthenticated read serves
**~24x more throughput** than login's ceiling, with zero errors. This is a real, clean number —
good evidence `cacheService.js`'s Redis-backed cache-aside layer (documented in
`server/server/README.md`) is genuinely absorbing read load the way it's designed to.

## Full API sweep: validation pass is clean; the load-stage numbers are contaminated by the rate limiter — here's how to tell

**The validation pass (one request per endpoint) is fully trustworthy** — every one of the 28
GET endpoints returned exactly the status its `authorize(...)` role list predicts, at 3-33ms.
That's a real, independent confirmation that no route is accidentally left open or blocked.

**The 50-concurrent flat-sweep numbers, though, are mostly measuring the rate limiter, not the
endpoints.** The giveaway is the `non-2xx` column: `errors: 0` everywhere (no real connection
failures or timeouts), but thousands of `non-2xx` responses on almost every route — that pattern
is a completed HTTP response with a non-2xx status, i.e. **HTTP 429 Too Many Requests**, not an
application failure. The tell that confirms it: the *only* endpoints with `non-2xx: 0` are
exactly the slowest ones (`GET /me` 437 req/s, `/notifications` 485 req/s, `/medical-records`
489 req/s, `/admin/revenue-trend` 489 req/s, `/admin/jobs/failed` 415 req/s) — their higher
per-request cost means fewer total requests fit inside the shared per-identity rate budget
during the 8s window, so they never tripped it, while every fast endpoint (35-45ms, meaning
1,000+ requests in 8s) blew straight through it in well under a second.

This means `DEFAULT_RATE_LIMIT_MAX` almost certainly was **not** actually raised to 100000 for
this run (or was raised but the server wasn't restarted after the `.env` edit — the most common
way this step gets missed). `login-loadtest.js`'s numbers don't have this problem because that
one only exercises `authLimiter`, which the `errors:0`/no-429-signature output confirms *was*
raised correctly.

**One genuinely clean data point survived**, because it was the very first request pattern
against its rate-limit bucket: `GET /doctors` at 10 concurrent — **818 req/s, avg 11.75ms, p99
21ms, 0 non-2xx**. That's consistent with the `/geography/cities` cache number above (same
order of magnitude, same "cache-fronted public read" shape) and is a second real confirmation
the cache layer performs well.

### The two deep-dive ramps, read through this lens

| Concurrency | `/appointments` (auth, hits Postgres) | `/doctors` (public, cached) |
|---|---|---|
| 10  | avg 8ms, p99 13ms, non-2xx 9361 *(already rate-limited from the flat sweep just before it)* | avg 11.75ms, p99 21ms, **non-2xx 0 — clean** |
| 50  | avg 44ms, p99 63ms, non-2xx 8900 | avg 44ms, p99 66ms, non-2xx 7499 |
| 150 | avg 132ms, p99 180ms, non-2xx 8995 | avg 129ms, p99 164ms, non-2xx 9190 |
| 400 | avg 733ms, p99 2265ms, req/s drops to 507, non-2xx 2461 | avg 358ms, p99 411ms, non-2xx 8878 |

Even with the rate-limiter noise, there's a real signal underneath both ramps: latency climbs
stage over stage in both cases (8ms → 733ms for appointments; 12ms → 359ms for doctors), which
is genuine congestion, not just a rate-limiter artifact (a pure rate-limit rejection is *fast*,
not slow — the climbing latency on the *surviving* 2xx requests shows real work is also getting
slower under concurrency). But because most of each stage's traffic is 429s, these numbers
understate the real ceiling for both endpoints — there isn't enough clean 2xx traffic here to
say confidently where either one's true breaking point is.

### To get real ceiling numbers for every non-login endpoint

1. Confirm `DEFAULT_RATE_LIMIT_MAX` actually took effect this time — e.g. run one manual
   `curl -i http://localhost:4000/geography/cities` and check for a `RateLimit-Limit` (or
   `X-RateLimit-Limit`) response header showing the raised value, *before* starting the sweep.
2. Make sure Terminal 1 was actually restarted after editing `.env` (a very easy step to miss —
   Node doesn't hot-reload `.env` changes).
3. Re-run `node full-api-sweep.js` and send the output back the same way — the validation pass
   and the two cache-endpoint numbers above already give confidence the tooling and the app's
   auth gating are correct, so a clean re-run should mostly change the `non-2xx` columns to
   near-zero and reveal each endpoint's real throughput ceiling.

## Bottleneck classification summary

| Endpoint class | Bottleneck | Confidence |
|---|---|---|
| `POST /auth/login` | CPU/thread-pool-bound (bcrypt on libuv's default 4-thread pool) | High — throughput/latency pattern plus Little's-Law math both point the same way |
| Cached public GETs (`/geography/cities`, `/doctors`) | None observed up to tested concurrency — cache layer absorbing load correctly | High, for the concurrency levels actually tested cleanly |
| Authenticated, DB-backed GETs (`/appointments`, etc.) | Real congestion is visible under the rate-limiter noise, but the true ceiling is not yet measured cleanly | Low — needs the re-run above |
| Every other GET endpoint | Not yet measurable — buried under rate-limiter rejections this run | Needs the re-run above |

## Priority action list

1. Try `UV_THREADPOOL_SIZE=16` and re-run `login-loadtest.js` to see if the ~30 req/s login
   ceiling moves — cheapest possible test of the highest-confidence finding here.
2. Fix the login route's failure mode at very high concurrency (graceful 503 instead of a full
   collapse to 0% success).
3. Re-run `full-api-sweep.js` after confirming `DEFAULT_RATE_LIMIT_MAX` genuinely took effect,
   to get real ceiling numbers for the other 27 endpoints.
