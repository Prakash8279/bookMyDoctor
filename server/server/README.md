# BookMyDoctor24 — Backend

Node.js + Express + PostgreSQL (Prisma) + Redis backend for the BookMyDoctor24 frontend.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (running locally or reachable via `DATABASE_URL`)
- Redis 6+ (running locally or reachable via `REDIS_URL`)

## First-time setup

```bash
cd server
npm install
cp .env.example .env
# edit .env: set DATABASE_URL, REDIS_URL, and generate real JWT secrets, e.g.:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Database setup

### Fresh database (new environment, new teammate's machine, disaster recovery)

`prisma migrate deploy` (or `migrate dev` while developing) alone is now enough — every
migration under `prisma/migrations/`, including the `..._consolidate_manual_sql_baseline`
one, runs in order and produces the complete schema: tables, the partial unique index that
prevents double-booking, the doctor-rating recompute trigger, singleton-row constraints and
their seed rows, every scalability/search index (including the `pg_trgm` trigram indexes),
and every column added since the initial migration.

```bash
npx prisma migrate deploy   # or: npx prisma migrate dev
npm run seed                # optional: creates the 5 demo accounts + reference data
```

Nothing under `prisma/manual_sql/` needs to be run by hand for a fresh database anymore.

### This project's existing dev database (already had manual_sql run by hand)

If your database already went through the old process — `prisma migrate dev` followed by
hand-running `psql -f prisma/manual_sql/...` — Prisma doesn't know that the new
`..._consolidate_manual_sql_baseline` migration's effects already exist (they do; the
migration is byte-for-byte the same statements manual_sql/001, 005–010 already ran). Tell
Prisma that instead of re-running the SQL:

```bash
npx prisma migrate resolve --applied 20260919120000_consolidate_manual_sql_baseline
npx prisma migrate status   # should report "Database schema is up to date!"
```

`prisma/manual_sql/002_receptionist_clinic_id.sql` and `003_family_member_fk_restrict.sql`
needed no equivalent step — both were already folded into the tracked `..._init` migration
from the start. `004_fix_seed_uuid_ids.sql` was a one-time data fix (renaming three seed
rows' ids), not a schema change, and stays exactly what it always was: something you ran
once, historical record now, never migration history.

> The double-booking constraint and the rating-recompute trigger were tested against a real
> local Postgres instance during development (inserted a conflicting slot and confirmed it's
> rejected; cancelled a booking and confirmed the slot frees up; inserted reviews and
> confirmed the doctor's rating recomputes correctly and excludes non-approved reviews). If
> you ever change that logic, re-verify the same way before trusting it in production.

## Running

```bash
npm run dev       # HTTP API, with reload on file change
npm run worker     # separate process: the booking queue worker (run alongside npm run dev)
```

The API listens on `PORT` from `.env` (default `4000`). Point the frontend's `VITE_API_BASE_URL`
(or equivalent) at `http://localhost:4000`.

## Project layout

```
src/
  config/       env, Prisma client, Redis client, logger — singletons everything else imports
  middleware/   authenticate, authorize (RBAC), validation, rate limiting, error handling
  utils/        response envelope, pagination, ApiError, async wrapper
  services/     cross-cutting: JWT tokens, cache-aside, distributed slot locks, file uploads
  jobs/         BullMQ booking queue + worker (the queue-token / "waiting room" pattern)
  modules/      one folder per domain (auth, appointments, doctors, ...), each with
                routes -> controller -> service (+ validation) — see any module folder's
                files for the responsibility comment at the top of each layer
  routes/       mounts every module's router
prisma/
  schema.prisma              the real schema
  migrations/                tracked migration history — `migrate deploy` alone builds a
                              fresh database completely, no manual SQL needed (see Database
                              setup above)
  manual_sql/                historical record only: how the migrations/ folder's
                              hand-written raw-SQL migrations were first developed and
                              applied, back before this environment could reach a live
                              database. Not part of setting up a new environment anymore.
  seed.js                    dev seed data
```

## Request/response contract

Every endpoint returns one of:
```json
{ "success": true, "data": { ... }, "message": "optional" }
{ "success": true, "data": [ ... ], "pagination": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 } }
{ "success": false, "error": { "code": "DOCTOR_NOT_FOUND", "message": "Doctor not found." } }
```

## Auth

- `POST /auth/login`, `/auth/register`, `/auth/logout`, `/auth/refresh`, `GET /auth/me`
- Access tokens are short-lived JWTs (`Authorization: Bearer <token>`); refresh tokens are
  stored hashed in `refresh_tokens` and rotated on every use.
- Every protected route runs `authenticate` then `authorize('role', ...)` — the frontend's
  route guards are UX only, never trusted as the real access control.

## Caching

Every read-heavy list/detail endpoint (doctor search, clinic search, appointment/queue/payment
lists, review feeds, notification inboxes, admin dashboards, and the rest of the read-mostly
lookups) goes through `src/services/cacheService.js`, a thin cache-aside wrapper (`getOrSet` /
`invalidate`) over the same Redis instance `lockService` uses for booking locks.

- **Fail-open.** Any Redis error (get/set/scan/unlink) is caught, logged, and treated as a cache
  miss — a Redis outage degrades every cached endpoint to "always hits Postgres," never to a
  broken request.
- **What's cached.** Only the fully-shaped, already role-masked response value — never a raw
  Prisma row — so a cache hit and a cache miss are byte-for-byte identical to a client.
- **TTLs.** 60s for mostly-static directory/reference data (doctors, clinics, geography,
  reviews' public feed), 30s for data that changes during normal use (appointment/payment lists,
  notifications, admin moderation queues, activity log, dashboard stats), and a deliberately
  short 10s for the live queue view (`GET /queue`) — "who's waiting right now" drives an
  in-person calling workflow, where even a 30s-stale answer is a real operational problem, not
  just a UX nit.
- **The one rule every cached endpoint follows: cache-key scoping must match response scoping.**
  Wherever a service function's output varies by requester (role-based fee masking, ownership
  scoping), its cache key encodes `role` + the requester's id (or the narrowest owning scope,
  e.g. a receptionist's `clinicId`) — e.g.
  `cache:appointments:list:patient:{patientId}:{status}:{page}:...`. Endpoints whose output is
  the same for everyone (the public doctor/clinic directory, geography reference data, the
  public review feed) are keyed by query params alone. Get this wrong and a cache hit can leak
  one user's differently-masked/differently-scoped response to another user — exactly the class
  of bug the rest of this hardening phase exists to prevent, so a new cached endpoint must follow
  the same rule.
- **Invalidation** is explicit, not TTL-only, on every write path that can make a cached list
  stale before its TTL expires (bookings, status changes, payments, clinic/doctor
  approval/assignment changes, reviews, receptionist changes, etc.), using `SCAN`+`UNLINK`
  pattern deletes (never `KEYS`, which blocks Redis). A few aggregate, cross-cutting views
  (admin dashboard stats, the activity log, a broadcast notification's per-recipient fan-out) are
  deliberately left TTL-only — they're touched by too many unrelated write paths across the app
  for precise invalidation to be worth the complexity — documented inline at each call site.

## Payments reconciliation, error tracking & ops visibility

Added during the production-readiness hardening pass — every one of these is optional and the
app boots and runs exactly the same without it configured, following the same
"blank env var disables just this feature" pattern as Razorpay/Google/bank-detail encryption
above. See `.env.example` for the full setup instructions for each.

- **`POST /payments/webhook/razorpay`** — reconciles a payment that genuinely succeeded on
  Razorpay's side but never got recorded because the patient's browser never came back to call
  `/payments/razorpay/verify` (tab closed, network drop, app crash right after paying). Verifies
  Razorpay's own HMAC signature (`RAZORPAY_WEBHOOK_SECRET`, a separate secret from
  `RAZORPAY_KEY_SECRET`) with `crypto.timingSafeEqual`, and only ever trusts `appointmentId`/
  `patientUserId` from Razorpay's own order `notes` (never from the webhook body's own claims).
  Idempotent — safe to receive the same event more than once, or after the patient's own verify
  call already recorded the same payment. See `src/modules/payments/razorpay.service.js`.
- **Backend error tracking (Sentry)** — set `SENTRY_DSN` to forward unexpected exceptions and
  5xx errors to Sentry for alerting; leave blank to keep using `config/logger.js` alone. Requires
  `npm install` (added to `package.json` but not fetched in the sandbox this was built in) —
  until installed, a set DSN just logs one startup warning and stays disabled, it never crashes
  boot. See `src/config/sentry.js`.
- **`GET /admin/jobs/failed`** — admin/superadmin visibility into failed BullMQ booking-queue
  jobs (same auth gate as every other admin route: `adminIpAllowlist` + `authenticate` +
  `authorize('admin','superadmin')`).
- **`GET /health/live`** — a dependency-free liveness probe (always 200 if the process can
  handle a request at all), separate from `GET /health/` above which legitimately reports 503
  when Postgres/Redis are unreachable. Point a k8s `livenessProbe` at `/health/live` and a
  `readinessProbe` at `/health/`, so a downstream outage takes the instance out of load-balancer
  rotation instead of restarting an otherwise-healthy process.
- **Upload rate limiting** — `POST /uploads/photo`, `/uploads/document`, `/uploads/qr` are now
  rate-limited the same way booking/payment writes already are (`uploadLimiter` in
  `src/middleware/rateLimiter.js`).

## End-to-end tests

A Playwright suite lives at the repo root (`/e2e`, config at `/playwright.config.js`) covering
the full register → book → pay flow against a real running frontend + backend. It's a scaffold
only — it needs a real Postgres/Redis and both dev servers running locally, none of which exist
in the sandbox this was authored in, so it hasn't been executed yet. See `/e2e/README.md` for
how to run it on your own machine.

## Known minor issues — all fixed

Every phase went through Planner → Coder → Verifier → Security-Checker, capped at 3 rounds.
Two phases (Engagement & Admin Ops, Scalability & Security Hardening) came back fully clean
within the build itself. The other four hit the round cap with small, non-blocking items still
open — all of them have since been fixed by hand and verified with `node --check`:

- **Auth**: `PATCH /me`'s `photoUrl` now requires a real `http(s)` URL (`isURL()`). The
  `X-Request-Id` request header is now format-validated (`^[A-Za-z0-9_-]{1,64}$`) before being
  echoed back or logged, falling back to a fresh id otherwise.
- **Directory**: `PATCH /receptionists/:id` with `{"clinicId": null}` now returns a clean 422
  instead of silently no-oping — a receptionist must always be tied to a real clinic, so clearing
  it isn't a valid operation (mirrors the existing `name` field's null-rejection).
- **Booking**: `booking.lockTtlMs` default raised from 8s to 16s, safely above
  `txMaxWaitMs + txTimeoutMs` (5s + 10s), so the Redis lock can no longer expire mid-transaction
  under real contention. Auto-resolving a doctor's clinic (when `clinicId` is omitted) now filters
  to active clinics before picking the primary/sole one, instead of picking a possibly-inactive
  clinic and failing afterward.
- **Clinical & Payments**: the extra "prior treatment relationship" gate on standalone
  medical-record creation (not part of the original plan, and inconsistent with the
  sibling walk-in payment path) has been removed — creating a medical record for
  a patient with no `appointmentId` now only requires the patient to exist and be active, matching
  `payments.service.js`'s walk-in/cash path.

None of these were exploitable authorization bypasses or data-loss bugs (those classes of
issue — the ones that WERE found, like the cache-based auth bypass and the booking-breaking
`FOR UPDATE` + aggregate query — were always caught and fixed within the same build run).

## Known environment limitation this backend was built under

This backend was developed in a sandboxed environment with no network access to npm/apt
registries, so `npm install`, `npx prisma migrate dev`, and a live `npm run dev` boot could
not be executed there — you'll do those on your own machine. To still prove the schema and
its constraints/triggers are correct, the full `schema.prisma` (28 models, 13 enums) was
hand-translated into raw SQL (`prisma/manual_sql/000_base_schema_handwritten.sql` —
**sandbox-only, do NOT run this on your own machine**: it exists solely because the real
Prisma CLI wasn't available here; on your machine `npx prisma migrate dev --name init`
creates the same tables for real from `schema.prisma` directly) and applied against a real
local Postgres 16 instance, followed by `001_constraints_and_triggers.sql`,
`002_receptionist_clinic_id.sql`, `003_*` (if present), and `seed_demo_data.sql`
(a SQL-only stand-in for `npm run seed`, using `pgcrypto`'s `crypt()`/`gen_salt('bf')` to
generate real bcrypt-compatible hashes without the `bcrypt` npm package).

**Two real bugs were found and fixed this way** (both would also have broken a real machine's
setup, not just the sandbox — both are UUID/TEXT type mismatches, since every id in this
schema is Prisma's plain `String @default(uuid())`, which is a TEXT column, never native
`uuid`):
- `002_receptionist_clinic_id.sql` declared `clinic_id UUID REFERENCES clinics(id)` — the FK
  could not even be created (`incompatible types: uuid and text`). Fixed to `TEXT`.
- The `recompute_doctor_rating()` trigger function declared `target_doctor_id UUID` — worked
  by accident with Prisma's UUID-shaped ids, but broke on any non-UUID-formatted id. Fixed to
  `TEXT`.

**Functionally verified against the live database** (not just "applies without error"):
password login (bcrypt hash generated via `pgcrypto`, matches Node's `bcrypt.compare()`
format), the double-booking partial unique index (conflicting slot rejected; same slot
bookable again after cancellation), the doctor-rating recompute trigger (rating/review_count
update correctly on an approved review, and correctly ignore a pending one), and the
family-member delete-restrict (`ON DELETE RESTRICT`, fixed from Prisma's default `SetNull`)
blocking deletion of a family member referenced by an appointment. All 5 demo accounts
(including a `superadmin@connectdoctor.test` added alongside the original 4) were seeded and
are login-ready once the app is running.

Code review (logic + security) was done by static reading, not live HTTP request testing;
give the API a real smoke test after your first `npm install && npm run dev`.
