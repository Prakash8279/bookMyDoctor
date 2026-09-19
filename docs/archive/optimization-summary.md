# BookMyDoctor24 — Optimization Pass Summary

**Date:** 5 Sep 2026
**Scope:** Security fixes from the earlier audit report, backend + frontend performance, and dead-code cleanup. Investigated with 3 parallel read-only recon passes, then implemented and syntax-verified every change below (`esbuild`/`node --check` — no live build/DB available in this environment).

## 1. Security fixes applied

| # | Fix | File(s) |
|---|---|---|
| 1 | `jwt.verify()` now passes an explicit `{ algorithms: ['HS256'] }` allowlist | `src/services/tokenService.js` |
| 2 | New dedicated rate limiter on `POST /auth/refresh` (previously only the generous global 300/min limiter) | `src/config/env.js`, `src/middleware/rateLimiter.js`, `src/modules/auth/auth.routes.js` |
| 3 | `prisma/seed.js` now refuses to run when `NODE_ENV=production` (it creates 5 demo accounts, including admin/superadmin, with known passwords) | `prisma/seed.js` |
| 4 | App-layer HTTPS redirect in production (`req.secure` check + 301, relies on your proxy setting `X-Forwarded-Proto`, which `trust proxy` is already configured to trust) | `src/app.js` |
| 5 | Uploaded PDFs now served with `Content-Disposition: attachment` instead of rendering inline | `src/app.js` |
| 6 | `docker-compose.yml`'s Postgres password is now overridable via a `POSTGRES_PASSWORD` env var (defaults to `changeme` unchanged, so local `docker compose up` still works with no setup) | `docker-compose.yml` |
| 7 | `client/.gitignore` now explicitly lists `.env`/`.env.*` (previously relied only on the root `.gitignore`) | `client/.gitignore` |
| 8 | Mobile release builds now fail loudly at startup if `--dart-define=API_BASE_URL` wasn't provided, instead of silently falling back to a `http://localhost` dev address | `mobile/lib/config/env.dart` |

**Not auto-fixed — needs your decision:** the password-reset link is still logged via `logger.info` in `auth.service.js` (it's currently the *only* delivery mechanism — no email/SMS provider is wired up anywhere in this codebase). I didn't touch this because both directions have a real tradeoff: redacting the token from logs would break password reset in production entirely (no other delivery channel exists), while a real fix needs actual email/SMS provider credentials (SES, SendGrid, Twilio, etc.) that only you can supply. Let me know if you have a provider in mind and I'll wire it in.

## 2. Backend performance fixes applied

- **Concurrent independent lookups** (previously sequential `await`s, now `Promise.all`): `appointments.service.js` (`listAppointments`, `getAppointmentById`), `payments.service.js` (`listPayments`, `getPaymentById`, `createStandalonePayment`), `doctors.service.js` (`createDoctor`). None of these change behavior — the calls were already independent of each other, just needlessly serialized.
- **Doctor directory search no longer fetches `bio` on every row.** `listDoctors` (the public doctor-search endpoint — almost certainly your highest-traffic read path, cached 60s) previously selected each doctor's full free-text `bio` field on every paginated page (up to 100 rows) even though only the single-doctor detail page (`getDoctorById`) ever shows it. Split into `DOCTOR_LIST_SELECT` (no bio) and `DOCTOR_DETAIL_SELECT` (bio included) in `doctors.service.js`.
- **Two new database indexes queued up** for the admin patient-search feature (`admin.service.js#listPatients` searches name/email/phone, but only `name` had a supporting index):
  - `schema.prisma`: `User`'s `@@index([role])` widened to `@@index([role, createdAt])` — a strict superset (still serves any plain role-only filter, and now also serves the `role='patient'` + `orderBy createdAt desc` query without a separate sort step). This one's expressible in Prisma's schema DSL, so it'll be picked up automatically the next time you run `npx prisma migrate dev` with real DB access.
  - `prisma/manual_sql/006_admin_patient_search_indexes.sql` (new file, same hand-written pattern as the existing `005_scalability_indexes.sql` since this sandbox has no DB access and GIN trigram indexes have no Prisma DSL representation): adds trigram indexes on `users.email` and `users.phone` so the patient-search `ILIKE '%term%'` queries stop forcing a full table scan. **Run this by hand against your real database** (same as 001-005) whenever convenient — it's additive and idempotent (`IF NOT EXISTS` throughout).

**Flagged but not changed** (documented, lower priority, or needs a bigger design call): `appointments.service.js`/`queue.service.js` also always select `patient.patientProfile.medicalHistory` regardless of caller role — this is an existing, deliberate tradeoff already commented in the code (avoiding per-role query variants); worth revisiting for `queue.service.js` specifically since it's polled every ~10s, but that's a larger refactor I'd rather scope with you first. `familyMembers.service.js#listFamilyMembers` is the one list endpoint that skips the Redis caching layer every sibling module uses — low urgency (small per-patient row counts) but flagged for consistency.

## 3. Frontend performance fixes applied

- **`App.jsx`**: `patientsFromAppointments` (a filter + Map dedupe over the full appointments list) now wrapped in `useMemo`, keyed on `data.appointments` — it was recomputing on every single render of the app shell before.
- **`AdminPages.jsx` (`RevenueReports`)**: found and fixed a genuine duplicate-work bug — the payment-mode breakdown was computed via the exact same `.reduce()` call **twice** per render (once to check if it was empty, once to actually render it). Now computed once (`paymentModeCounts`) and reused. The whole revenue-derivation pipeline (filtering, fee shaping, doctor-wise grouping) is now wrapped in a single `useMemo`.
- **`PublicLanding.jsx`**: the specializations section was doing `(data.doctors||[]).filter(...)` once *per specialization, per render* (O(specializations × doctors)) just to get a per-specialty doctor count. Replaced with one pass over doctors building a count map (`useMemo`), then O(1) lookups.

**Investigated, found already well-implemented — no changes needed:** Zustand selectors are fine-grained everywhere except two top-level `state.data` subscriptions (`App.jsx`, `PublicLanding.jsx`) — I looked at fixing these too, but since nearly every routed page genuinely needs `data` as a prop, restructuring this would mean a bigger prop-drilling/context change for a modest gain (React Router only actually re-renders the one matched route; the rest are cheap unrendered JSX descriptors). Flagging it here rather than doing a risky rewrite — happy to revisit if you want it. No waterfalled API calls, no full-list-refetch-after-single-mutation inconsistency, no inline component definitions, and no bundle-size concerns were found.

## 4. Code cleanup applied

- Deleted 2 confirmed-dead files with zero remaining references anywhere in the codebase: `client/src/lib/api.js` (already self-documented in its own header as a deprecated stub) and `client/src/lib/apiContracts.js`.
- **Investigated, found already clean — no changes needed:** no unused imports or unused variables/functions in any of the 15 largest files across the codebase, no commented-out dead code blocks, no TODO/FIXME/HACK markers anywhere in the repo, and pagination/error-handling patterns are consistent across modules. A few small, genuinely duplicated patterns were found (the appointments/payments ownership-check functions are structurally identical; three client-side delete-confirm flows share the same shape) but at 2-3 call sites each, extracting a shared helper would add an abstraction layer for a very modest payoff — I'd rather you weigh in before I touch working code purely for DRY-ness.

## What to do next

1. Run `npx prisma migrate dev` (or `migrate deploy`) once you have real DB access — it'll pick up the `(role, createdAt)` index change automatically.
2. Run `prisma/manual_sql/006_admin_patient_search_indexes.sql` by hand against your database (same way you'd run 001-005).
3. Decide on an email/SMS provider for password reset (see §1's "not auto-fixed" note) — I'll wire it in once you tell me which one.
4. Everything else is already live in the files delivered alongside this summary — just restart your dev servers to pick it up.
