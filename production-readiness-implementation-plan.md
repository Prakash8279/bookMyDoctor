# BookMyDoctor24 — Production Readiness: Implementation Plan

**Based on:** `production-readiness-report.md` (19 Sep 2026 audit) · **Status:** planning only — nothing in this plan has been executed yet.

This plan turns every finding from the audit into a concrete, ordered set of steps. It follows the same working rhythm as the earlier cleanup task: small changes, one area at a time, tests run after every step, nothing merged/delivered until you've reviewed it. Nothing here touches your demo login credentials, your real `.env` file, or any already-delivered manual SQL file — where a schema change is needed, it goes into a **new** numbered file, never an edit to 001–010.

Two things worth flagging before the plan itself:
- This cloud workspace has no network route to your actual Postgres/Redis. Every step that needs to run against your **real** database (running a migration, testing a Redis restart, load-testing) is written below as "**you run locally**" — I'll prepare the exact file/command, you execute it and paste back the result.
- I will never type a password, secret, or API key into any file or field on your behalf, even for steps like wiring Sentry or a real email provider — those steps say clearly where you need to paste your own key.

---

## How the phases are ordered

The order below is deliberately not "Critical first, Low last" in a flat list — some Medium items are grouped with the Critical item they share a file with, so we don't touch the same file twice in unrelated commits. Overall sequencing logic:

1. **Phase 0 — Safety net.** Get CI running first, even in a bare-bones form, before touching anything else. Every later phase becomes safer once this exists.
2. **Phase 1 — Data-loss-shaped risks.** Migration drift and Redis persistence — these are the two that would actually break a production launch or lose real bookings, not just "should be better."
3. **Phase 2 — Security & auth hardening.** Refresh-token tests, password-reset log leak, Razorpay webhook.
4. **Phase 3 — Backend/infra hardening.** Healthchecks, job visibility, error tracking, deploy process, upload rate-limits, resource limits.
5. **Phase 4 — Frontend polish.** Vendor chunking, modal focus trap.
6. **Phase 5 — Mobile.** Platform scaffolding, crash reporting, connectivity handling, permissions — grouped together since they all depend on the platform-scaffolding step happening first.
7. **Phase 6 — Testing depth.** E2E test, mobile widget tests, backend lint, booking-worker tests — deliberately last, since Phase 0's CI is what makes new tests actually matter, and by this point most of the code they'd be testing has just changed anyway.

Each phase is independently shippable — you can stop after any phase and already be meaningfully better off than today.

---

## Phase 0 — Get a CI safety net running (do this first)

**Why first:** every other phase involves touching backend, frontend, or mobile code. Without CI, we're relying purely on "did I remember to run tests" the same way the codebase already does — CI is what makes every later phase's test-after-each-step discipline actually enforced going forward, not just this session.

| Step | What | Files | Effort |
|---|---|---|---|
| 0.1 | Add `.github/workflows/ci.yml` with three jobs: `client-test` (`npm ci && npm test` in `client/`), `server-test` (`npm ci && npm test` in `server/server/`, with Postgres+Redis service containers so integration tests that need them can run), `mobile-test` (`flutter test test/` only — skip `integration_test/` since it needs a real device/emulator, which GitHub-hosted runners don't have without extra setup). | new: `.github/workflows/ci.yml` | Small |
| 0.2 | Add a `docker-build` job that runs `docker build` on `server/server/Dockerfile` and `client/Dockerfile` (no push, just "does it build") — catches Dockerfile breakage before merge. | same file | Small |
| 0.3 | Wire the job to run on every push and pull_request to your main branch. | same file | Trivial |
| 0.4 | **You do:** enable branch protection on GitHub (Settings → Branches) requiring this workflow to pass before merging — I can't do this part, it's a repo-settings change outside file edits. | GitHub settings | 2 min, your side |

**Verification:** push a trivial branch, confirm all jobs go green in the Actions tab; then push a branch with a deliberately broken test, confirm it goes red.
**Risk:** none to running code — this only adds a new file, doesn't touch application logic.
**Note:** this doesn't yet add ESLint to the backend (that's Phase 6, since there's no config to lint with yet) — the `server-test` job will just run the existing Jest suite for now.

---

## Phase 1 — Data-loss-shaped risks

### 1.1 Migration drift (manual_sql vs. formal migrations)

**Goal:** make `prisma migrate deploy` alone sufficient for a fresh database, without ever editing `manual_sql/001-010` (already delivered, already run — off limits per our standing rule).

**Approach — "baseline migration" pattern, the safe way to retrofit Prisma history:**

1. Write **one new** migration folder, e.g. `prisma/migrations/20260919120000_consolidate_manual_sql/migration.sql`, containing idempotent SQL that reproduces everything in `manual_sql/001` (constraints/triggers/sequence/partial index), `007-009` (doctor bank/token columns), and `010` (payment UPI column) — using `IF NOT EXISTS` / `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL END $$` guards throughout, so it's safe to run whether or not those columns/objects already exist.
2. Add the missing Prisma-DSL-expressible pieces (the `doctor_profiles` sort indexes, the `appointments(date,time)` index) as normal `schema.prisma` model changes in the same migration, generated properly via `prisma migrate dev --create-only` **against a local/staging DB you point me to, or that you run yourself** (this step needs a live Postgres connection, which this sandbox doesn't have — see note below).
3. Explicitly resolve the orphaned `prescriptions`/`prescription_medicines` tables: since no `Prescription` model exists in `schema.prisma` and nothing in the app uses them, the cleanest fix is to add a minimal `Prescription`/`PrescriptionMedicine` model to `schema.prisma` that matches the existing table shape (so they're no longer "drift", just an unused-for-now feature table) rather than dropping real tables — dropping is a destructive operation and needs your explicit sign-off first, which I will ask for separately if you'd rather drop them instead.
4. Update `server/server/README.md`'s database-setup section to reference the new consolidated migration instead of listing `manual_sql/001` as the only step — the manual_sql files become historical record, not part of the setup instructions going forward.
5. **You run locally, against your actual dev database:** `npx prisma migrate resolve --applied 20260919120000_consolidate_manual_sql` (marks it as already-applied on your current DB, since the underlying objects already exist there from the manual runs) — this does **not** re-run the SQL, it just tells Prisma's migration history "this one's already done." I will give you this exact command when the migration file is ready; I will not run it myself since it touches your real database.
6. For any **future** fresh database (a new hosting environment, a teammate's machine, disaster recovery), `prisma migrate deploy` from a clean checkout now genuinely produces the full correct schema in one step.

**Verification:** ask you to run `npx prisma migrate status` after step 5 and confirm it reports "up to date" with no drift warning. Separately, if you're willing, spin up a throwaway local Postgres (or a Docker container) and run `prisma migrate deploy` against it fresh, then diff against your real schema — this is the real proof it works, but optional if you trust the resolve-then-verify approach.

**Risk:** low to your running app (this doesn't touch application code, only migration history bookkeeping), but it does touch real database state — I'll walk through the exact commands with you before you run anything, and we do this on a non-production copy first if you have one.

### 1.2 Redis persistence

**Goal:** a Redis restart no longer silently drops queued booking jobs.

**Approach:**
1. Edit `docker-compose.yml`'s `redis` service: add `command: redis-server --appendonly yes` and a named volume `redis_data:/data`.
2. Add `redis_data` to the top-level `volumes:` block alongside the existing `postgres_data`.
3. Update the file's own header comment (it already documents itself as local/staging) to note that a real production deployment needs equivalent persistence configured on whatever managed/self-hosted Redis is actually used there (this compose file itself likely isn't what runs in real production — the fix here is both "fix this file" and "make sure the real prod Redis has this too," and only you know what that real target is).

**Verification (you run locally):** `docker compose up -d redis`, enqueue a test booking, `docker compose restart redis`, confirm the job/queue state survived (`docker compose exec redis redis-cli LRANGE ...` or just re-check the booking's status via the app). I'll give you the exact commands.
**Risk:** low — purely additive compose config, no application code change. Existing data isn't at risk since we're adding persistence, not removing anything.

---

## Phase 2 — Security & auth hardening

### 2.1 Refresh-token rotation/reuse-detection tests

**Goal:** close the biggest test-coverage gap in the codebase.

**Approach:**
1. Add to `server/server/tests/unit/services/tokenService.test.js`: a mocked-Prisma test asserting a valid unused refresh token rotates successfully and returns a new pair; a test asserting presenting the same (now-rotated) token again triggers `REFRESH_TOKEN_REUSED` and calls `revokeAllForUser`; a test for an expired stored token being rejected; a test for a disabled account being rejected post-verification.
2. Add to `server/server/tests/unit/modules/auth.service.test.js`: tests for `refresh()` and `logout()` (currently entirely untested — only `register`/`login` are covered today).
3. Extend `tests/integration/auth.flow.test.js`'s existing mock scaffolding (it already has the `refreshTokensById` fake map built, just never uses it) to actually call `POST /auth/refresh` twice with the same token and assert the second call is rejected and revokes the session.
4. No production code changes needed here — the rotation logic itself was independently verified as correctly written; this phase is pure test-writing.

**Verification:** `npm test` in `server/server`, confirm new tests pass and (as a sanity check that they're real tests, not tautologies) temporarily comment out the reuse-detection branch in `tokenService.js` and confirm the new test fails — then restore it.
**Risk:** none — test-only changes.

### 2.2 Password-reset token logging

**Goal:** stop the reset link's raw token from being written to logs.

**Approach — two options, pick one:**
- **Option A (proper fix, needs a decision from you):** wire a real transactional email provider (e.g. Resend, SendGrid, AWS SES — whichever you prefer) into `emailService.js`, and a real SMS provider (e.g. Twilio, MSG91) into `smsService.js`, alongside the existing `logProvider`. This needs an API key from whichever provider you choose — I'll prepare the integration code and the exact `.env` variable name to add, but **you** paste the actual key into your `.env` file yourself, per our standing rule on secrets.
- **Option B (stopgap, no new account needed):** in `emailService.js`/`smsService.js`'s `logProvider`, strip the `?token=...` query string from the logged body before writing it to the log, so the log line still shows "reset email sent to X" for debugging without the usable token being present. This can ship today with zero external dependency.

I'd suggest B now (ships immediately, zero risk) and A whenever you're ready to pick a real provider — happy to do both, B first.

**Verification:** trigger a password-reset flow locally, confirm the log line no longer contains a usable token; existing tests around `auth.service.js`'s forgot-password flow should still pass unchanged.
**Risk:** low — Option B is a pure string-stripping change in a non-critical logging path.

### 2.3 Razorpay webhook (reconciliation for stuck `pending_payment` bookings)

**Goal:** a payment that succeeded on Razorpay's side but never got a client-side `/verify` call (closed tab, dropped network) eventually gets reconciled instead of staying stuck forever.

**Approach:**
1. Add `POST /payments/razorpay/webhook` to `payments.routes.js`, mounted **before** `express.json()` for this one route (needs the raw body for signature verification) — Express allows a route-specific `express.raw({ type: 'application/json' })` middleware just for this path.
2. Verify Razorpay's `X-Razorpay-Signature` header using HMAC-SHA256 over the raw body with a new `RAZORPAY_WEBHOOK_SECRET` env var (separate from the existing key secret — this is a value Razorpay's dashboard gives you when you register the webhook URL; you'll add it to `.env` yourself).
3. On a verified `payment.captured` event, look up `notes.appointmentId` from the order; if no matching `Payment` row exists yet for that appointment (i.e., the client-side `/verify` never landed), call the same `createPaymentForAppointment` path the existing verify route uses, so the booking gets reconciled automatically.
4. Add `.env.example` entry for `RAZORPAY_WEBHOOK_SECRET` documenting where to get it (Razorpay Dashboard → Webhooks).
5. **You do (outside this codebase):** register the webhook URL in your Razorpay dashboard once this is deployed somewhere with a public URL — a webhook can't be tested against `localhost` without a tunnel (ngrok or similar), which I can help set up if you want to test it before going live.

**Verification:** unit test the signature-verification function with a valid and a tampered payload (mirroring the existing test style in `razorpay.service.test.js`); for a live end-to-end check, use Razorpay's test-mode webhook simulator from their dashboard once the route is deployed.
**Risk:** medium — this is new payment-adjacent code, so it gets extra scrutiny: idempotency check (don't double-record a payment the client already verified) is essential and will be tested explicitly before this ships.

### 2.4 Upload endpoint rate limiting

**Goal:** cap how fast one account can push data into `UPLOAD_DIR`.

**Approach:** add a dedicated `uploadLimiter` in `rateLimiter.js` (same Redis-backed pattern already used for `bookingLimiter`/`paymentLimiter`), apply it to the three routes in `uploads.routes.js`, keyed by `req.user.id`.
**Verification:** existing rate-limiter tests already have a pattern to copy; add one asserting the new limiter kicks in past N requests.
**Risk:** low — purely additive middleware, mirrors an existing pattern exactly.

---

## Phase 3 — Backend / infra hardening

| Item | Approach | Files | Risk |
|---|---|---|---|
| **Dockerfile healthcheck** | Add `HEALTHCHECK` instruction using a Node one-liner hitting `/health` (no curl/wget in the alpine image) | `server/server/Dockerfile` | Low — container-level only, no app code |
| **Compose healthchecks + resource limits** | Add `healthcheck:` blocks to `server`/`worker`/`client` services; add `mem_limit`/`cpus` to all 5 services; change `client`'s `depends_on` to `condition: service_healthy` | `docker-compose.yml` | Low |
| **Failed-job visibility** | Add `GET /admin/jobs/failed` wrapping `bookingQueue.getFailed()`, gated behind existing `authenticate`+`authorize('admin')`; add a `worker.on('failed', ...)` counter that logs a warning after N consecutive failures (simple in-process counter is fine here, this isn't cross-replica state) | `admin.routes.js`, `bookingWorker.js` | Low |
| **Error tracking (Sentry)** | Add `@sentry/node`, initialize in `app.js`/`server.js`, hook into the existing single-choke-point error handler (`errorHandler.js`) and `unhandledRejection`/`uncaughtException` handlers in `server.js`. **You provide the Sentry DSN** (paste into `.env`, not typed by me). | `app.js`, `errorHandler.js`, `.env.example` | Low — additive, wrapped in try/catch so Sentry itself can't crash the app if misconfigured |
| **Split `/health` into liveness/readiness** | Add `/health/live` (trivial 200, no dependency checks) alongside the existing `/health` (rename conceptually to readiness); update Dockerfile healthcheck and any deploy docs to reference the right one for the right purpose | `health.routes.js` | Low |
| **Deploy/migration ordering doc** | Document (in `README.md` and as a comment in `docker-compose.yml`) the correct order: migrate first, then start `server`/`worker`; note this becomes a real CI/CD pipeline "migrate" stage once you have a deploy target beyond your own machine | `README.md` | None — docs only |
| **`.env.example` refresh-limiter vars** | Add the two missing documented vars with their existing code defaults | `.env.example` | None |

---

## Phase 4 — Frontend polish

| Item | Approach | Files | Risk |
|---|---|---|---|
| **Vendor chunk splitting** | Add `build.rollupOptions.output.manualChunks` (or `splitVendorChunkPlugin`) to separate React/Router/axios/zustand into a stable-hash vendor chunk | `client/vite.config.js` | Low — build config only, verify bundle still builds and app loads identically after `npm run build && npm run preview` |
| **PDF preview modal focus trap** | Port the existing `trapFocus` handler from `Modal.jsx` into `PdfPreviewModal.jsx` | `client/src/components/PdfPreviewModal.jsx` | Low |
| **Stale coverage dir cleanup** | Delete `client/coverage/` and add `coverage/` to `.gitignore` | `client/.gitignore` | None |

---

## Phase 5 — Mobile

**These are grouped because 5.1 has to happen before most of the others can be tested for real.**

### 5.1 Native platform scaffolding
1. **You run locally** (needs the Flutter SDK, which this sandbox doesn't have): `flutter create --platforms=android,ios .` at the `mobile/` project root. This only adds the missing `android/`/`ios/` folders — it won't touch `lib/main.dart` or your assets.
2. I'll then prepare the follow-up edits that depend on those folders existing: add `CAMERA`/`READ_MEDIA_IMAGES` permissions to the generated `AndroidManifest.xml`; add `NSCameraUsageDescription`/`NSPhotoLibraryUsageDescription`/`LSApplicationQueriesSchemes` to `Info.plist`; flip `flutter_launcher_icons`'s `ios: false` to `true` in `pubspec.yaml`.
3. **You run locally:** `dart run flutter_launcher_icons` to actually generate the icon files.
4. **You run locally:** `flutter pub get && flutter test integration_test/app_test.dart -d <device>` to confirm the recently-edited routing test actually compiles and passes on a real engine.

### 5.2 Crash reporting
Add `sentry_flutter` to `pubspec.yaml`; wrap `runApp()` in `runZonedGuarded` in `main.dart`; wire `FlutterError.onError` and `PlatformDispatcher.instance.onError`. **You provide the Sentry DSN.** This doesn't depend on 5.1 (Sentry, unlike Crashlytics, doesn't need native platform files to function).

### 5.3 Connectivity awareness
Add `connectivity_plus`; show a persistent offline banner when connectivity drops; consider shortening the current 20s Dio timeout for snappier failure feedback. Files: `lib/core/api_client.dart`, a new small `ConnectivityBanner` widget wired near the app root.

### 5.4 Documentation
Add a "Building a release" section to `mobile/README.md` documenting the real `flutter build --release --dart-define=API_BASE_URL=...` command and a one-line note on the existing `kReleaseMode` fail-fast guard, so a future release isn't confused by the `StateError` if the define is forgotten.

---

## Phase 6 — Testing depth (do last, once Phase 0's CI exists to enforce it)

| Item | Approach | Effort |
|---|---|---|
| **E2E test (register → book → pay)** | Add Playwright, one spec covering the full journey against a docker-compose'd stack, using Razorpay's test-mode order flow; wire as a separate CI job (needs the stack running, so likely its own job with `docker compose up` as a setup step) | Medium-large — most involved item in this whole plan |
| **Backend ESLint** | Add `eslint` + a sensible base config (`eslint:recommended` + a Node plugin) to `server/server`; fix whatever it flags (expect mostly trivial issues given the codebase's existing discipline); wire `npm run lint` into the Phase 0 CI workflow | Medium (depends how much it flags) |
| **`bookingWorker.test.js`** | Mock `appointmentsService.runBookingJob` to throw an `ApiError` and a plain `Error`; assert the former becomes `UnrecoverableError`, the latter propagates for BullMQ's normal retry | Small |
| **Mobile widget tests for the 3 highest-traffic untested screens** | `login_screen.dart`, `book_appointment_screen.dart`, `payment_required_screen.dart` — basic render + key-interaction tests, following the existing pattern in `test/widgets/common_widgets_test.dart` | Medium |
| **`authorize.js` unit test** | Simple fake req/res/next test for the 401/403 factory itself | Small |

---

## What I need from you to start

1. Confirm the phase order above works for you, or tell me to reorder/skip anything (e.g. if mobile app-store submission isn't imminent, Phase 5 can slide later; if you don't have a Razorpay/Sentry/email-provider account picked yet, those specific sub-items pause but the rest of their phase doesn't have to).
2. For Phase 1.1 (migration consolidation) specifically — this is the one that touches real database state — tell me if you have a staging/throwaway Postgres I can prepare a test migration against, or if we should just prepare the file and you apply/verify it directly on your dev DB.
3. Say "start with Phase 0" (or whichever phase) and I'll begin, same as before — one small commit at a time, tests run after each step, nothing delivered to your machine until it's verified here first.
