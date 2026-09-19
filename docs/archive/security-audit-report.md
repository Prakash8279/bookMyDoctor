# BookMyDoctor24 — Security Audit Report

**Date:** 5 Sep 2026
**Scope:** Full codebase — `server/server/` (Node/Express/Prisma/PostgreSQL/Redis backend), `client/` (React/Vite frontend), `mobile/` (Flutter app)
**Method:** Static, read-only source review across 8 dimensions (auth/session, authorization/IDOR, input validation/injection, secrets/CORS/headers, rate limiting/error handling, frontend client-side, mobile client-side, dependency/config hygiene). No live network/DB access was available in this environment, so `npm audit` / `flutter pub outdated` / dynamic penetration testing could not be run — those are called out explicitly wherever they'd add value.

## Overall verdict

This is an unusually well-hardened codebase for its stage. **No Critical or High-severity exploitable vulnerability was found in any of the eight areas audited.** Authorization/IDOR — normally the richest source of bugs in a multi-role healthcare app like this — came back completely clean: every module enforces ownership checks server-side with a consistent, deliberately-designed pattern (404-not-403 on mismatch to avoid enumeration, role-scoped queries, never trusting client-supplied "whose record is this" fields). SQL injection, mass assignment, prototype pollution, and command injection were all checked and are not present anywhere.

The issues found are genuine but modest: a couple of **Medium** items worth fixing before a production launch, and a longer tail of **Low/Informational** hardening suggestions. Nothing here should block using the app; the Medium items are worth a short follow-up pass.

### Severity summary

| Severity | Count | Items |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 6 | Password-reset link logged in plaintext; no rate limiter on `/auth/refresh`; no HTTPS-redirect/HSTS enforcement at app layer; `jwt.verify()` missing explicit algorithm allowlist; seed script has no production guard; localStorage token/PII storage (accepted SPA tradeoff, listed for awareness) |
| Low | 8 | See §7 |
| Info | 5 | See §7 |

---

## 1. Authentication & session security — strong

- **JWT secrets**: no hardcoded fallback anywhere — `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are required at boot, and production additionally enforces ≥32 characters, access≠refresh, and rejects obvious placeholder text (`src/config/env.js`). Secret rotation is supported via `_PREVIOUS` verify-only secrets.
- **Password hashing**: bcrypt, cost factor 12, used consistently. No passwords or hashes are ever logged or returned in any API response (verified via grep and by reading every `select` clause).
- **Refresh token rotation**: refresh tokens are stored only as a SHA-256 hash (never raw) in a `refresh_tokens` table, rotation is single-use, and **reuse of an already-rotated token correctly revokes the entire session family** via a race-safe conditional update — this is a materially correct implementation, better than most production apps at this stage.
- **Timing/enumeration resistance**: login always runs a real `bcrypt.compare()` (even for a nonexistent email, against a precomputed dummy hash) and returns an identical error for "no such user" vs "wrong password". `forgotPassword` also returns an identical response whether or not the account exists.
- **Logout** performs real server-side revocation (sets `revokedAt` in the DB), not just a client-side token discard.
- **Rate limiting on auth routes**: `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, and password-change are all behind dedicated limiters (10 req/15min, IP- or user-keyed as appropriate).

**Medium — password-reset link is logged in plaintext.** `server/server/src/modules/auth/auth.service.js:238` logs the reset link (which contains the raw, usable reset token) via `logger.info` as the only current delivery mechanism, pending a real email/SMS provider (already flagged as a `TODO` in the code). Anyone with read access to server logs can take over any account until this is replaced. **Fix:** wire a real provider (SES/SendGrid/etc.) before production launch; until then, restrict log access and never ship these logs to a lower-trust aggregator.

**Medium — no dedicated rate limiter on `POST /auth/refresh`.** It only sits behind the generous global limiter (300 req/min/IP), relying on rotation/reuse-detection as the real defense. A stolen or guessed refresh token could still be hammered up to 300×/min before that trips. **Fix:** add a moderate dedicated limiter here too.

**Medium (defense-in-depth) — `jwt.verify()` calls don't pass an explicit `algorithms` allowlist.** Not currently exploitable (a string secret only permits HS256/384/512 by default, and `alg:"none"` is never implicitly accepted), but if a secret is ever swapped for an RSA/EC key without adding this, it opens the classic HS256-vs-RS256 algorithm-confusion attack. **Fix:** add `{ algorithms: ['HS256'] }` explicitly now, in `src/services/tokenService.js`, as cheap insurance.

**Low** — password-reset tokens share the same secret pool as access tokens (mitigated correctly today via a `purpose` claim checked both directions, but fragile to a future change). **Info** — no password complexity/strength policy beyond an 8–72 character length check.

---

## 2. Authorization / IDOR — clean

Every module examined (appointments, payments, family members, medical records, reviews, queue tokens, receptionists, doctor clinic-hours/closures, admin routes) implements ownership checks server-side before returning or mutating data — a patient cannot view another patient's appointment/payment/family member/record by guessing an id; a doctor cannot modify another doctor's schedule; a receptionist is scoped to their own clinic; every admin route is gated by `authenticate` + `authorize('admin','superadmin')` with no gaps found. Field-level masking (e.g. contact info only shown to admin/self) is layered on top of row-level ownership checks. **No findings in this category** — this is the area most likely to hide bugs in an app with this many roles, and it came back genuinely clean.

---

## 3. Input validation & injection — clean, one Low finding

- **No raw SQL string concatenation anywhere.** All 5 `$queryRaw`/`$executeRaw` call sites use Prisma's safe tagged-template parameterization.
- **express-validator coverage is complete** — every route accepting body/query/params has a matching validation chain, and `validateRequest` fails closed (rejects on any validation error) rather than failing open.
- **No mass assignment** — every `create`/`update` either builds `data:` from named fields or funnels through a strict allowlist helper (`pickPresentFields.js`). Role/status/verification flags are never client-settable (e.g. registration hardcodes `role: 'patient'` regardless of what the client sends).
- **No prototype pollution, no command injection, no ReDoS** — checked and clean.
- **File uploads**: MIME-allowlisted (not extension-based), size-capped, server-generated random filenames (no path traversal, no extension spoofing), and ownership-checked before writing.

**Low** — uploaded PDFs (doctor verification documents) are served back via `express.static` with no explicit `Content-Disposition` header, so they render inline in-browser rather than as a forced download. SVG/HTML are already excluded from every upload allowlist so classic stored-XSS-via-upload isn't reachable, but a malicious PDF could still exploit a PDF-viewer bug in some browsers. **Fix:** set `Content-Disposition: attachment` for `application/pdf` uploads via `express.static`'s `setHeaders` option.

---

## 4. Secrets, CORS & headers — strong, a few Low items

- **No real hardcoded secrets found anywhere** in server, client, or mobile code — all live values come from `process.env`, and `.env` is correctly gitignored at every level with no `.env` file actually present in the repo (only `.env.example` with placeholders).
- **CORS** is a single explicit origin from an env var with `credentials: false` — not a wildcard, not `origin: true`.
- **`helmet()`** is applied with only one deliberate, documented relaxation (`crossOriginResourcePolicy` for public upload assets); CSP, HSTS, X-Frame-Options, X-Content-Type-Options all remain at helmet's sane defaults.
- **No cookies/sessions** are used at all — auth is bearer-token based, which eliminates CSRF entirely as an attack class (the tradeoff, localStorage token exposure to XSS, is covered in §6).
- **Swagger UI** (`/api-docs`) is correctly mounted only when `NODE_ENV !== 'production'`.

**Medium** — no HTTPS-redirect/HSTS-enforcement at the application layer; this currently relies entirely on whatever's in front of the app (load balancer/CDN) to terminate TLS. **Fix:** add an explicit `X-Forwarded-Proto` check + redirect for production, or confirm and document that the deployment topology guarantees TLS termination upstream.

**Low** — `docker-compose.yml` hardcodes a default Postgres password (`changeme`) for the local/staging compose stack; fine for local dev, risky if ever deployed as-is. **Low** — `client/.gitignore` has no explicit `.env` entry (root `.gitignore` backstops this, but it's fragile to rely on). **Low** — `prisma/seed.js` (which upserts 5 demo accounts, including admin/superadmin, with known passwords) has no `NODE_ENV=production` guard — nothing stops it from being run against a real production database. **Fix (recommended, easy):** add a guard at the top of `seed.js` that refuses to run when `NODE_ENV=production`.

---

## 5. Rate limiting & error/log leakage — strong

- **Rate limiting** is implemented with a Redis-backed store (correct for horizontal scaling): auth routes, password-change (user-keyed, not IP-keyed — correctly closes the "spread guesses across IPs" gap), booking/payment writes, and a sane global default (300/min) are all covered. `trust proxy` is a fixed hop count, not `true`, so IP-keyed limits can't be defeated by a forged `X-Forwarded-For` header.
- **Error handler** never leaks stack traces, raw Prisma error text, or file paths to the client under any environment — unknown errors always return a generic message; full detail is logged server-side only.
- **No sensitive data in logs** — verified no request bodies, passwords, or tokens are ever logged; the activity-log service explicitly documents and enforces "field names only, never values."
- **Process-level crash protection** is in place (`unhandledRejection`/`uncaughtException` handlers log and fail fast, paired with graceful shutdown on SIGTERM/SIGINT).
- **Body size limits** are set (`1mb` JSON limit; file uploads bounded separately by multer).

This section's one Medium item (reset-link logging) is already covered in §1 since it's really an auth-flow issue. **Low** — cache keys interpolate free-text search filters without encoding, which could in rare cases serve a stale/wrong result to the *same* user within their own cache scope (not a cross-user leak) until the 30–300s TTL expires.

---

## 6. Frontend (React) client-side security — clean, one architectural note

- **No `dangerouslySetInnerHTML`, no `eval`/`new Function`/`.innerHTML =`, no `document.write`** anywhere in the client — doctor bios and review text are rendered as plain JSX (auto-escaped by React), not raw HTML.
- **No secrets in the client bundle** — the only `VITE_*` variable used is the public API base URL; Razorpay payment integration is correctly server-brokered (client only ever sees a public order id, never a secret key).
- **No open-redirect vector** — post-login redirect is always a same-origin path derived from the app's own routing, never an attacker-suppliable URL param.
- **No debug logging of sensitive data** — no `console.log` calls exist in the client source at all; error logging only prints error messages, never raw responses/tokens.
- Dependencies (`react`, `axios`, `vite`, `zustand`, etc.) are all current majors — no historically-flagged abandoned packages present.

**Medium (accepted tradeoff, flagged for awareness)** — JWT access/refresh tokens (and the cached `currentUser` profile) are stored in `localStorage`, which any successful XSS could read directly. This is a standard SPA tradeoff for avoiding CSRF entirely (which this app does, by not using cookies at all) rather than a bug. Given how clean the XSS surface is, this is low-probability but high-impact if a future dependency or component ever introduces an XSS bug. **Suggested hardening (not urgent):** add a Content-Security-Policy header, and consider a future migration to httpOnly refresh cookie + short-lived in-memory access token if this app scales further.

---

## 7. Mobile (Flutter) app security — clean

- **Tokens are stored exclusively via `flutter_secure_storage`** (Keychain/Keystore-backed) — no `SharedPreferences` or plaintext fallback anywhere, and no other local persistence (no `sqflite`/`Hive`) of appointment/medical/payment data at all.
- **Demo account credentials** are confirmed to exist in exactly one place (`login_screen.dart`, `kDebugMode`-gated), correctly compiled out of release builds.
- **No TLS/certificate-validation bypass** anywhere — standard `Dio` with default trust-store validation. No certificate pinning is implemented, which is normal for most apps and not a blocking issue, but worth considering given this app carries medical data.
- **No debug logging interceptor** exists at all, so there's no risk of a forgotten log line leaking tokens.

**Low** — the default (non-debug-build) API base URL fallback in `lib/config/env.dart` is plain `http://`, not `https://`. Harmless in practice (it only matters if a release build is ever shipped without the `--dart-define=API_BASE_URL` build flag, and it fails safe to `localhost`), but worth tightening: fail loudly at startup in release mode instead of silently defaulting. **Info** — Android/iOS platform folders don't exist yet in this repo (pre-`flutter create` scaffolding), so manifest/permission review is pending until those are generated; when they are, this app's features need no camera/location/background-location permissions.

---

## 8. Dependencies & config hygiene

- No dependency version raised a definite red flag from version numbers alone (backend: express/jsonwebtoken/multer/bcrypt/helmet/prisma all on current, patched majors; frontend: react 19/axios 1.8/vite 8 all current; mobile: dio/flutter_secure_storage current). **This environment has no network access, so `npm audit` (server + client) and `flutter pub outdated`/`dart pub audit` (mobile) could not actually be run — please run these yourself once you have connectivity, since transitive dependency versions (visible only in the lockfile) are what really determine CVE exposure, not the top-level version ranges in `package.json`.**
- `.gitignore` coverage is correct at every level (root, `server/server/`, `client/`, `mobile/`) — `.env` cannot be accidentally committed anywhere.
- **Prisma schema has no raw payment-card data anywhere** — only gateway references (`transactionRef`) and UPI id/QR fields, confirmed by a full read of `schema.prisma`, not just a grep.
- Environment separation (dev vs. production) correctly drives secret-strength checks, log verbosity, and Swagger visibility.
- `package.json` scripts contain no destructive reset/drop script; `prisma migrate deploy` (non-destructive) is used for production migrations.

---

## Recommended fix order

1. Wire a real email/SMS provider for password reset before production launch (currently logs the raw token) — §1.
2. Add a dedicated rate limiter on `/auth/refresh` — §1.
3. Add explicit `algorithms: ['HS256']` to every `jwt.verify()` call — §1 (cheap, 10-minute fix).
4. Add a `NODE_ENV=production` guard to `prisma/seed.js` — §4 (cheap, prevents known-password admin accounts ever landing in prod).
5. Add HTTPS-redirect/HSTS enforcement at the app layer, or confirm+document that your deployment's load balancer already terminates TLS — §4.
6. Lower-priority cleanup: PDF `Content-Disposition` header (§3), `docker-compose.yml` password parameterization (§4), `client/.gitignore` explicit `.env` line (§4), mobile `https://` fallback (§7).
7. Once you have local network access: run `npm audit` in both `server/server/` and `client/`, and `flutter pub outdated`/`dart pub audit` in `mobile/`, to catch anything version-number analysis alone can't see.

None of the above touch login credentials, require a destructive database operation, or need to be run from this session — they're all code-level changes I can make for you on request.
