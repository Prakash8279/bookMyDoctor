# BookMyDoctor24 — Production Readiness Report

**Prepared:** 19 Sep 2026 · **Scope:** full codebase — `client/` (React/Vite web), `server/server/` (Node/Express/Prisma/PostgreSQL/BullMQ/Redis), `mobile/` (Flutter) · **Method:** 6 independent line-by-line audits (backend security, backend infra/DevOps, database/Prisma, frontend, testing/CI-CD, mobile), each cross-checked against the earlier archived audits in `docs/archive/` so already-fixed issues aren't repeated here. Every finding below cites the exact file and line.

This is a **read-only report**. Nothing has been changed in the codebase. Review it and tell me which items to act on — we'll fix them one at a time, same as the cleanup work, with tests re-run after each change.

---

## How to read this

Findings are grouped by severity, most urgent first. **Critical** = would break the app or lose money/data in production. **High** = a real production risk, not immediately fatal. **Medium** = should fix before/soon after launch. **Low** = polish / hardening.

A "What's already solid" section at the end lists everything the audits confirmed is genuinely well-built — this codebase is well ahead of where most projects are at this stage, and the findings below are what separates "good" from "production-hardened," not signs of a shaky foundation.

---

## CRITICAL — fix before any real production launch

### 1. Database migrations are out of sync with the actual schema — a fresh production database would break immediately
**Where:** `server/server/prisma/manual_sql/` (files 001, 007, 008, 009, 010) vs. `server/server/prisma/schema.prisma` vs. `server/server/prisma/migrations/*/migration.sql`

Ten hand-written SQL scripts in `manual_sql/` were run manually against the current database at various points, but their changes were **never turned into formal Prisma migrations**. If anyone ever sets up a fresh database using only `prisma migrate deploy` (which is the standard, documented way to deploy Prisma — and is exactly what a new hosting environment, a disaster-recovery restore, or a new team member's setup would do), the result would **not** match `schema.prisma`, and the app would fail immediately:

- `doctor_profiles` columns `bank_account_holder_name`, `bank_account_number`, `bank_ifsc_code`, `bank_name`, `bank_upi_id`, `token_numbering_mode`, `online_token_parity` (schema.prisma:257-288) exist only via `manual_sql/007-009`. These are selected on **every single doctor lookup** and **every single booking** (`doctors.service.js:162-168`, `appointments.service.js:608-609`) — missing them means every doctor page and every booking throws a database error.
- `payments.payer_upi_id` (schema.prisma:602, from `manual_sql/010`) is selected on every payment read — same failure mode, payments module dead on arrival.
- The `payment_receipt_seq` sequence (`manual_sql/001:96`) is called on **every payment ever recorded** (`idGenerators.js:16`). Without it, no payment can ever be saved — the entire payments module is down from the first transaction.
- The `appointments_doctor_slot_unique` partial unique index (`manual_sql/001:25`) is the only database-level guard against double-booking the same doctor slot. Prisma's schema language can't even express partial indexes, so this can never auto-generate — it must be hand-migrated or double-bookings become possible.
- The `recompute_doctor_rating()` trigger (`manual_sql/001:34-65`) is missing → every doctor's rating/review count would stay frozen at 0 forever, silently breaking "sort by rating."
- **Bonus risk found:** the formal migrations create `prescriptions`/`prescription_medicines` tables that **don't exist in schema.prisma at all** and are referenced nowhere in the app code. If anyone ever runs `prisma migrate dev` again to generate a new migration, Prisma will see this as drift and may generate a migration that **drops these tables** — a silent, unreviewed data-loss trap for a healthcare app.
- The README's own database setup instructions (`server/server/README.md:21-32`) only ever mention `manual_sql/001` — files 002 through 010 aren't referenced there at all, so following the documented setup exactly reproduces every gap above.

**Fix:** consolidate every `manual_sql` statement that has no Prisma-schema equivalent (the partial index, the trigger, the sequence, the CHECK constraints, the pg_trgm trigram indexes) into properly checked-in Prisma migration files, and add real migrations for the columns added in 007-010. After that, `prisma migrate deploy` alone becomes sufficient and safe. Also explicitly resolve the orphaned `prescriptions` tables (either restore the model, or check in a reviewed migration that intentionally drops them) before anyone runs `prisma migrate dev` unattended.

### 2. Redis has no persistence — a Redis restart silently drops in-flight bookings
**Where:** `docker-compose.yml:48-57` (Redis service — no `volumes:`, no `appendonly` command; compare to Postgres at `:40-41` which does have a volume)

Redis is the only backing store for the BullMQ booking queue, the distributed booking lock, and the rate limiter. Right now, any Redis restart — a crash, `docker compose down`, a host reboot, an out-of-memory kill — **silently erases every waiting/in-progress booking job with no record left behind.** A patient who just got a "booking submitted" response and is waiting for confirmation would get "job not found," with zero trace of what happened. This directly undermines the otherwise well-designed booking durability system (the code's own comments describe a three-layer defense — Redis lock → Postgres advisory lock → unique index — but that only protects a job that already reached the database; a job still queued when Redis loses its data is gone with nothing to fall back on).

**Fix:** mount a persistent volume for Redis and enable `appendonly yes` at minimum for staging/production. `docker-compose.yml` already documents itself as a local/staging convenience file — that caveat needs to be treated as a hard requirement for whatever real production Redis is actually used (managed Redis, ElastiCache, etc. — those normally handle this, but confirm explicitly).

### 3. No CI/CD pipeline anywhere — nothing stops a broken change from reaching production
**Where:** confirmed absent repo-wide — no `.github/workflows/`, no `.gitlab-ci.yml`, no `Jenkinsfile`, no `.circleci/`, no root orchestration script

Every merge to the main branch today ships with **zero automated verification.** The backend has 33 test files with 556 tests, the frontend has 36 test files (465/466 passing) — genuinely good test suites — but nothing actually runs them automatically. A regression in booking logic, payment handling, or auth could merge and reach production having never been executed against the existing tests. There's also no automated lint gate, no Docker-build-succeeds check, and no dependency-vulnerability scan.

**Fix:** a single GitHub Actions workflow that on every PR/push runs `npm test` for `client` and `server/server`, and `flutter test` for `mobile` (skip `integration_test/` unless a device/emulator is set up in CI), plus builds both Dockerfiles to catch build breakage early. This is the single highest-leverage fix in this whole report — it doesn't fix any bug by itself, but it makes every other fix here actually stick instead of silently regressing later.

### 4. Refresh-token rotation/reuse-detection — the most security-critical code in the app — has zero test coverage
**Where:** `server/server/src/services/tokenService.js:199-254` (`rotateRefreshToken`, `revokeRefreshToken`, `revokeAllForUser`)

This is the logic that makes a stolen refresh token detectable and revokes a user's entire session set on reuse — genuinely well-written (it correctly closes a TOCTOU race with an atomic conditional update). But no test anywhere calls it: `tokenService.test.js` only tests token *signing*, not rotation; `auth.service.test.js` mocks the token service entirely; `auth.flow.test.js` has the mock scaffolding needed to test it but never actually calls `POST /auth/refresh`. A future refactor could silently break reuse detection — e.g. accidentally reintroducing the race condition, or letting a replayed token through — and all 556 other passing tests would give false confidence.

**Fix:** add tests asserting: a valid unused refresh token rotates correctly; presenting the *same* token twice triggers reuse detection and revokes every session for that user; an expired or tampered token is rejected; a disabled account's refresh is rejected.

### 5. Mobile app has no native Android/iOS project — it cannot be built at all right now
**Where:** confirmed — no `android/` or `ios/` directory exists anywhere in `mobile/`

The Flutter app has literally never been run through `flutter create` for either target platform. There's no `android/app/build.gradle`, no `AndroidManifest.xml`, no `ios/Runner.xcodeproj` — nothing for `flutter build apk` or `flutter build ios` to build against. Right now this app cannot produce an installable APK or IPA, full stop.

**Fix:** run `flutter create --platforms=android,ios .` at the project root — this only scaffolds the missing platform folders, it will not touch your existing `lib/main.dart` or assets. After that, the app's own `pubspec.yaml` comments already anticipate the next steps correctly (flip `flutter_launcher_icons`'s `ios: false` to `true` once the `ios/` folder exists; then run `dart run flutter_launcher_icons` to generate real icons). Camera/gallery/phone-dialer permissions (used by `image_picker` and `url_launcher` in several screens) will also need to be added by hand to the generated `AndroidManifest.xml`/`Info.plist` — `flutter create` doesn't know your app uses those.

### 6. Mobile app has no crash reporting — a crash on a user's phone is invisible to you
**Where:** confirmed absent — zero references to Sentry/Crashlytics/Bugsnag anywhere in `mobile/lib`; `main.dart` has no `runZonedGuarded` or `FlutterError.onError` handler

If the app crashes on a real patient's or doctor's phone — a bad API response shape, a null field, anything — there is currently no way for you to ever know it happened, unless the user reports it themselves. For a healthcare app where a crash mid-booking is a real patient-facing failure, this is a significant blind spot.

**Fix:** add Sentry (`sentry_flutter` — doesn't need the native platform folders from #5 to work, unlike Crashlytics) and wrap `runApp()` in `runZonedGuarded`, with `FlutterError.onError` and `PlatformDispatcher.instance.onError` wired to report.

---

## HIGH — real production risk, address soon after launch

**Backend / infra**
- **No `HEALTHCHECK` in `server/server/Dockerfile`** — an orchestrator has no way to detect a hung API process short of it being fully dead (`server/server/Dockerfile`, whole file — compare to `client/Dockerfile:39-40` which does have one). Fix: add a Node-based healthcheck hitting `/health`.
- **No visibility into failed background jobs** — a failed booking job's error is only ever shown to the one patient who triggered it; there's no admin dashboard or alert for a spike in job failures, and failed jobs are auto-pruned after 24 hours (`appointments.service.js:417-422`, no admin route for queue status). Fix: a simple admin endpoint or `@bull-board/express` dashboard, plus an alert after repeated consecutive failures.
- **No error-tracking/APM integration** (Sentry etc.) on the backend either — confirmed zero matches for Sentry/Datadog/New Relic anywhere in `server/server/src`. A production exception is only visible in logs, if anyone's watching them.
- **No documented zero-downtime deploy or migration-ordering** — the only documented process is "bring containers up, then manually run migrations after" (`docker-compose.yml:17-22`, `README.md:21-32`), which means there's a real window where the API is serving traffic against a not-yet-migrated schema, with no rollback plan documented anywhere.

**Testing**
- **No end-to-end test of the full "register → book → pay" journey** — no Playwright/Cypress anywhere in the repo. The frontend and backend each pass their own tests against mocks, but nothing verifies the two sides' real contract still matches after a change (e.g. a renamed field in a payment response). For an app whose whole point is book-and-pay, this is a meaningful structural gap.
- **Backend has no linting at all** — no ESLint, no lint script, nothing (`server/server/package.json`). The frontend has a lint tool (`oxlint`) configured but it's never actually run by anything (no CI, no pre-commit hook) — so it exists but catches nothing today.
- **68 mobile screens have zero widget tests** — the only mobile tests cover shared building blocks (buttons, headers) and one guest-browsing integration test; login, booking, and payment screens specifically have no test coverage at all.

**Mobile**
- **No offline/connectivity awareness** — a patient with a weak connection gets a 20-second hang before a generic "can't reach server" message, with no proactive "you're offline" banner.
- **Camera/gallery/dialer permissions don't exist anywhere yet** (a direct consequence of #5 above — no platform folders means no `AndroidManifest.xml`/`Info.plist` to hold them). Needs to be handled as part of the platform-scaffolding fix, not forgotten afterward.
- **The recently-edited `integration_test/app_test.dart` (updated for the guest-home-screen routing change) has not been run against a real Flutter engine** — I checked its assertions by hand against the current widget code and they line up, but this sandbox has no Flutter SDK to actually execute it. **Please run `flutter pub get && flutter test integration_test/app_test.dart -d <device>` yourself before trusting this test.**

---

## MEDIUM — fix before or shortly after launch

**Security**
- Password-reset links are still logged in plaintext, just one file removed from where an earlier audit flagged it — the "fix" moved the log call into an `emailService`/`smsService` abstraction, but the only provider implemented for both is still "log it" (`emailService.js:31-36`, `smsService.js:16-21`). Anyone with log access can still take over any account within the 30-minute reset window. This needs a real email/SMS provider wired in before launch, or at minimum strip the token from the logged text.
- No Razorpay webhook exists — only the client-driven "browser calls `/verify` after payment" path is implemented. If the app/browser closes between a successful charge and that verify call, the booking is stuck in `pending_payment` forever with no automatic reconciliation, even though the patient was actually charged.
- Upload endpoints (profile photo, doctor documents, clinic QR codes) have no dedicated rate limit — only the generous global one applies, making a disk-fill denial-of-service a realistic risk from a single authenticated account.

**Infra**
- No CPU/memory limits set on any Docker service in `docker-compose.yml` — a leak in one container could starve the whole host.
- `server`/`worker`/`client` containers have no healthchecks, so Docker Compose can't actually gate startup ordering on real readiness, only "container started."
- The single `/health` endpoint conflates liveness and readiness — if ever wired as a Kubernetes liveness probe, a brief Postgres/Redis blip would cause pod restarts instead of just a graceful removal from load-balancer rotation.
- No metrics endpoint (queue depth, latency, DB pool usage) — only log lines, no dashboard-able numbers.

**Database**
- Cascade-safe design is good, but there's no database-level CHECK constraint preventing a negative payment amount — only application-code validation, which is bypassable via any other DB access path.
- No documented backup/point-in-time-recovery plan.

**Frontend**
- No vendor-chunk splitting in the Vite build — React/Router/axios/zustand all live in one 333KB chunk that gets re-downloaded by returning visitors on every single deploy, even a one-line change.
- The PDF receipt/booking-slip preview modal (used in payment and appointment flows) doesn't trap keyboard focus the way the app's other modals correctly do — a small but real accessibility inconsistency in a payment-adjacent flow.

**Mobile**
- No certificate pinning (acceptable at this stage given the API already runs over HTTPS, but worth a future hardening pass).
- `flutter_lints` is a declared dependency but there's no `analysis_options.yaml` actually wiring its stricter ruleset in — so even running `flutter analyze` today would use bare defaults, not what the dependency implies is active.

---

## LOW — polish, do whenever convenient

- `.env.example` is missing the two refresh-token rate-limit variables that the code already has sane defaults for — just a documentation gap.
- File uploads are validated by client-declared MIME type only, not by actually inspecting file bytes — low real-world exploitability here since filenames are always server-generated and nothing is ever executed, but worth tightening for a healthcare app handling third-party documents.
- A stale `client/coverage/` directory is still sitting in the repo from before the unused coverage tool was removed, and isn't in `.gitignore` — could get accidentally committed later.
- Prisma's client generation at Docker build time uses a floating version tag (not the exact locked version) and needs network access during the build — a minor reproducibility gap.
- Mobile's `pubspec.yaml` version is bumped by hand with no script — fine for now, worth automating once release cadence picks up.

---

## What's already solid (confirmed by these audits, not just assumed)

This codebase is genuinely ahead of where most projects are at this stage of a solo/small-team build:

- **Payment security is excellent.** The server always re-derives the actual charged amount from Razorpay's own API — the client-supplied amount is never trusted anywhere. A previously-fixed cross-appointment payment-swap bug was re-verified as still fixed. Idempotency on both booking-linked and standalone payments is correctly implemented (row locks, Redis idempotency keys).
- **The booking system's double-booking prevention is a genuinely well-designed three-layer defense** (Redis lock → Postgres advisory lock → database unique index), and it's directly tested at the service level.
- **The app is properly stateless and horizontally scalable** — Redis-backed rate limiting and caching (not in-memory), no session store, no lingering in-process state anywhere that would break with multiple server instances.
- **Graceful shutdown is correctly implemented** in both the API and the background worker — SIGTERM properly drains connections before exiting, which most Node apps at this stage skip entirely.
- **Environment/secret validation fails fast and hard** — a missing or weak secret, or a placeholder value copied from `.env.example`, stops the app from booting in production rather than silently running insecurely.
- **The frontend's error handling is unusually mature** — a real error boundary (no blank white-screen crashes), a properly centralized 401/token-refresh interceptor, no XSS surface found anywhere (zero `dangerouslySetInnerHTML` usage), and route-level code splitting already in place.
- **Test documentation discipline is notably good** — both backend and frontend test files consistently explain *why* a test exists and what bug or audit finding it guards against, which is rare at this project size.
- **Mobile's secure-storage and API-client design are solid** — tokens are stored via `flutter_secure_storage` (never plain storage), never logged, and the release-build API URL has a proper fail-fast guard against accidentally shipping a dev/localhost URL.
- **Injection surface is clean** — every raw SQL call site uses proper parameterization, no command injection points found anywhere.

---

## Suggested order of attack

1. Fix the migration drift (#1) and add the missing Redis persistence (#2) — these are the two that would actually break a fresh production deployment or lose real user data.
2. Stand up basic CI (#3) — every fix after this point becomes safer to make.
3. Add refresh-token rotation tests (#4) and the mobile crash-reporting + platform scaffolding (#5, #6) in parallel — different codebases, no conflict.
4. Work through the High list, then Medium, at your own pace.

Bataiye kis item se shuru karna hai — jaise cleanup task tha, waise hi ek-ek karke fix karenge, har change ke baad tests re-run karke.
