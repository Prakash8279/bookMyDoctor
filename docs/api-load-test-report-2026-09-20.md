# BookMyDoctor24 — API Inventory & Load-Test Readiness (2026-09-20)

**Scope:** every HTTP endpoint currently mounted in `server/server/src/routes/index.js`, read
directly out of each module's `*.routes.js` file (not inferred or guessed). Produced for a
full "identify every API and load-test it" pass, using the same tool selection and safety
rules an API load-test would normally follow (progressive concurrency, GET-only by default,
never touch production without explicit confirmation, count timeouts as failures).

## Why this is an inventory + a ready-to-run toolkit, not a live results report

Actually executing a load test needs a running instance of this backend, which needs a real
Postgres connection through Prisma's query engine. Two independent things block that inside
this sandbox, both pre-existing, documented environment limits (see `server/server/README.md`'s
own "Known environment limitation" section) — this pass hit the same wall from a different
angle:

- **Prisma's native query engine binary** is not bundled in the `@prisma/client`/`@prisma/engines`
  npm packages — it downloads from `binaries.prisma.sh` on first `prisma generate`/first client
  use. That host is not network-reachable from this sandbox (`403 Forbidden` through the
  sandbox's proxy), and nothing was cached from an earlier run either.
- The alternative — Prisma's **WASM query engine** (`@prisma/client/runtime/query_engine_bg.postgresql.wasm`,
  which *is* already bundled and would avoid the network fetch entirely) needs the
  `driverAdapters` preview feature plus the `@prisma/adapter-pg` and `pg` packages, neither of
  which is installed, and `npm install` itself is also blocked here (no route to
  `registry.npmjs.org`, the same limitation already noted for `npm audit` in the security
  audit).

Both a real Postgres and a real Redis were actually stood up inside this sandbox for this
pass (confirming that part isn't the blocker) — it's specifically the Prisma client that
can't come up without one of those two network calls succeeding. Rather than fake results
from a stubbed database (which would measure nothing real and could be actively misleading
about production capacity), this pass instead produced: a complete, verified endpoint
inventory below, and `loadtest/full-api-sweep.js` — a ready-to-run script for your own
machine, where the real Postgres/Redis and full network access already exist. See
`loadtest/README.md`'s new "Full API sweep" section for exact steps; the short version is
`cd loadtest && node full-api-sweep.js` while your own `npm run dev` is running, then send the
output back here the same way `login-loadtest.js`'s output already gets analyzed.

## Full endpoint inventory

27 route files are mounted; **106 total endpoints** across all methods. GET endpoints (the
ones `full-api-sweep.js` actually load-tests, per the "GET only by default" rule) are marked
✅ below; every write endpoint is listed for completeness but is never load-tested by default.

| Mount | Method | Path | Auth | Notes |
|---|---|---|---|---|
| `/health` | GET ✅ | `/` | none | Readiness — 503 if DB/Redis down |
| `/health` | GET ✅ | `/live` | none | Pure liveness — always 200 |
| `/auth` | POST | `/register` | none (rate-limited) | |
| `/auth` | POST | `/login` | none (rate-limited) | covered in depth by `login-loadtest.js` |
| `/auth` | POST | `/google` | none (rate-limited) | |
| `/auth` | POST | `/forgot-password` | none (rate-limited) | |
| `/auth` | POST | `/reset-password` | none (rate-limited) | |
| `/auth` | POST | `/logout` | any authenticated | |
| `/auth` | POST | `/refresh` | refresh cookie/token (rate-limited) | |
| `/auth` | GET ✅ | `/me` | any authenticated | |
| `/me` | GET ✅ | `/` | any authenticated | |
| `/me` | PATCH | `/` | any authenticated | |
| `/me` | PATCH | `/(sub-path)` | any authenticated | |
| `/media` | POST | `/photo` | authenticated (rate-limited) | |
| `/media` | POST | `/document` | authenticated (rate-limited) | |
| `/media` | POST | `/qr` | authenticated (rate-limited) | |
| `/uploads/documents` | GET | `/:filename` | signed/token access | not load-tested — needs a real filename |
| `/geography` | GET ✅ | `/cities` | none | cached |
| `/geography` | GET ✅ | `/areas` | none | cached |
| `/geography` | GET ✅ | `/specializations` | none | cached |
| `/geography` | POST/DELETE | city/area/specialization CRUD | admin | 6 endpoints |
| `/doctors` | GET ✅ | `/` | optional | cached, public directory |
| `/doctors` | GET | `/:id` | optional | needs a real id, see `DETAIL_ROUTE_IDS` |
| `/doctors` | POST | `/register` | none (rate-limited) | |
| `/doctors` | PATCH/POST | clinic assignment, verification, etc. | doctor/admin | 4 endpoints |
| `/clinics` | GET ✅ | `/` | optional | cached, public directory |
| `/clinics` | GET | `/:id`, `/:id/hours`, `/:id/closures` | optional | needs a real id |
| `/clinics` | POST/PATCH/PUT/DELETE | clinic CRUD, hours, closures, staffing | doctor/admin | 10 endpoints |
| `/family-members` | GET ✅ | `/` | patient (own rows only) | |
| `/family-members` | GET | `/:id` | patient | needs a real id |
| `/family-members` | POST/PATCH/DELETE | CRUD | patient | 3 endpoints |
| `/receptionists` | GET ✅ | `/` | doctor/admin/superadmin | |
| `/receptionists` | GET | `/:id` | doctor/admin/superadmin | needs a real id |
| `/receptionists` | POST/PATCH | create/update/status | doctor/admin/superadmin | 3 endpoints |
| `/appointments` | GET ✅ | `/` | any authenticated (own-scoped) | uncached, hits Postgres — covered by the deep-dive ramp |
| `/appointments` | GET | `/:id`, `/booking-status/:jobId` | any authenticated | needs a real id |
| `/appointments` | POST/PATCH | create, status updates | any authenticated | 3 endpoints |
| `/queue` | GET ✅ | `/` | doctor/receptionist | |
| `/queue` | GET | `/mine/:appointmentId` | patient | needs a real id |
| `/queue` | PATCH | status updates | doctor/receptionist | |
| `/medical-records` | GET ✅ | `/` | any authenticated (role-scoped) | |
| `/medical-records` | GET | `/:id` | any authenticated | needs a real id |
| `/medical-records` | POST | create | doctor | |
| `/payments` | GET ✅ | `/` | any authenticated (own-scoped) | |
| `/payments` | GET | `/:id` | any authenticated | needs a real id |
| `/payments` | POST | create, Razorpay order, verify | any authenticated | 3 endpoints |
| `/payments` | POST | `/webhook/razorpay` | Razorpay HMAC signature (no user auth) | never load-tested — real side effect, signature-gated |
| `/platform-charges` | GET ✅ | `/` | any authenticated | |
| `/platform-charges` | PUT | `/` | admin | |
| `/reviews` | GET ✅ | `/` | optional | cached, public feed |
| `/reviews` | POST/PATCH | create, moderate | patient/admin | 2 endpoints |
| `/notifications` | GET ✅ | `/` | any authenticated | |
| `/notifications` | GET ✅ | `/broadcast` | admin/superadmin | |
| `/notifications` | POST/PATCH | create, mark read | any authenticated/admin | 3 endpoints |
| `/complaints` | GET ✅ | `/` | patient/admin/superadmin | |
| `/complaints` | GET | `/:id` | patient/admin/superadmin | needs a real id |
| `/complaints` | POST/PATCH | create, resolve | patient/admin | 2 endpoints |
| `/contact` | GET ✅ | `/` | admin/superadmin | |
| `/contact` | POST/PATCH | submit, resolve | none/admin | 2 endpoints |
| `/admin` | GET ✅ | `/activity-log`, `/system-settings`, `/booking-rules`, `/dashboard-stats`, `/revenue-trend`, `/patients`, `/jobs/failed` | admin/superadmin | 7 endpoints, all covered |
| `/admin` | PUT/PATCH | settings, booking rules, patient status | admin/superadmin | 3 endpoints |

**Totals**: 27 modules, 106 endpoints, 32 of them `GET` (the ones a default sweep touches), 74
of them state-changing writes (never load-tested by default, per the "GET only by default"
safety rule).

## What running `full-api-sweep.js` on your own machine will actually tell you

- **Step 2 (validation pass)** alone is worth reading even before any load: it hits every
  endpoint above once with a real token per role and prints the real HTTP status. That's an
  independent, live confirmation that every route's `authenticate`/`authorize` gate matches
  what the code says it should (a fast way to catch a route accidentally left public, or a
  role check that's stricter/looser than intended).
- **Step 3 (flat sweep)** at moderate concurrency across every endpoint shows which ones are
  clearly slower than the rest at a glance — worth investigating any endpoint whose avg/p99 is
  a clear outlier versus its neighbors.
- **The two deep-dive ramps** (`GET /doctors`, cache-fronted vs. `GET /appointments`, always
  hits Postgres) should show a real, visible gap between them if `cacheService.js`'s
  cache-aside layer (documented in `server/server/README.md`'s "Caching" section) is working
  as designed — if they look similar instead, that's worth a closer look at whether the cache
  is actually being hit.

## Next step

Run `cd loadtest && npm install && node full-api-sweep.js` (with your server + worker + Redis
running, and both rate limits temporarily raised per `loadtest/README.md`), then send the
full console output back — it'll get analyzed the same way `login-loadtest.js`'s Phase 1
baseline output already was.
