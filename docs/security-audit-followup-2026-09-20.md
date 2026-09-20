# BookMyDoctor24 — Security Audit Follow-up (2026-09-20, later pass)

**Scope:** Backend (`server/server`), frontend (`client`), mobile (`mobile`) — full read-only re-review against every finding in `docs/security-audit-2026-09-20.md`, plus a fresh OWASP-Top-10-style sweep (injection, auth/authz, configuration, secrets, dependencies) covering everything built since that report, including today's own new work (Razorpay webhook reconciliation, backend Sentry error tracking, upload rate limiting, admin failed-jobs visibility).

**Method:** Manual code review + targeted greps across the whole repo for hardcoded secrets, unsafe SQL/HTML sinks, and route-level auth coverage. `npm audit` was attempted on both Node projects but this sandbox has no network route to `registry.npmjs.org` (pre-existing, documented environment limitation) — dependency findings below are from reading installed versions directly, not a live CVE database. **This is a static review, not a penetration test.**

---

## Summary scorecard

| Category | Status |
|---|---|
| Injection (SQL/command/XSS/path traversal) | ✅ Clean — no findings |
| Authentication & session management | ✅ Clean — no findings |
| Authorization / access control (IDOR, RBAC) | ✅ Clean — no findings |
| CSRF | ✅ Mitigated by design (see below) |
| Hardcoded secrets/credentials | ✅ Clean — no findings |
| Configuration (CORS, headers, error leakage) | ✅ Clean — one informational note |
| Dependencies | ⚠️ Cannot verify live CVEs from this sandbox (no registry access) — versions installed look current; **run `npm audit` yourself in both `client` and `server/server`** for an authoritative answer |
| New code added today (webhook, Sentry, rate limiter, admin endpoint) | ✅ Clean — no findings |

**Overall: no Critical or High findings.** Every Medium/Critical item from the previous `docs/security-audit-2026-09-20.md` report has since been fixed. One item remains genuinely open (production email/SMS provider not yet configured — that's an operational/deployment step, not a code fix).

---

## Status of every finding from `docs/security-audit-2026-09-20.md`

| # | Finding | Status now |
|---|---|---|
| 1 | `bcrypt`/`tar` supply-chain advisory (install-time only) | ✅ **Fixed** — `package.json` now pins `bcrypt@^6.0.0` (commit `1e279ae`) |
| 2 | Password-reset token printed in plaintext logs | ✅ **Fixed** — `emailService.js`/`smsService.js` now strip the token before logging (see the "SECURITY FIX" comment in `emailService.js`) |
| 3 | `/uploads` served unauthenticated via `express.static` | ✅ **Fixed** — private documents now go through the authenticated `secureDocument.routes.js`, mounted at the more specific `/uploads/documents` path *before* the public `express.static` mount (`app.js` step 6.5/7) — Express's registration-order matching means a private-document request never reaches the public static server. Only genuinely public assets (profile photos, clinic QR codes) are still served openly, which is correct. |
| 4 | Doctor bank details stored plaintext | ✅ **Fixed** — `services/encryptionService.js` (AES-256-GCM) now encrypts `bankAccountHolderName`/`bankAccountNumber`/`bankIfscCode`/`bankName`/`bankUpiId` at rest (commit `d22a7de`); a one-time `scripts/encryptExistingBankDetails.js` migration script exists for already-stored rows — **you still need to run it yourself** against your real database once `BANK_DETAILS_ENCRYPTION_KEY` is set, per that script's own instructions. |
| 5 | Refresh token in `localStorage` (XSS blast radius) | ✅ **Fixed** — refresh token now lives only in an httpOnly, `Secure`-in-production cookie, scoped to `/auth` (commits `5a179d0`, `2fad927`). The short-lived (15 min) access token intentionally stays in `localStorage`/memory — a deliberate, documented tradeoff (small blast radius vs. added complexity), not an oversight. |
| 6 | `react-router` open-redirect/SSR advisories | Installed version is now `react-router-dom@6.30.4` (was `^6.30.1`) — looks current, but **confirm with `npm audit` on your machine** since this sandbox can't reach the registry to check live advisory status. |
| 7 | `morgan`/`qs` advisories (backend) | Installed versions: `morgan@1.11.0`, `qs@6.15.3` — same caveat as above, run `npm audit` yourself to confirm. |
| 8 | Admin IP allowlist off by default | Unchanged — this was informational, not a bug, then and now. Admin routes remain protected by `authenticate` + `authorize('admin','superadmin')` regardless. |

**Still genuinely open (operational, not code):** a real email/SMS provider is not configured in this environment (expected — no live provider account exists here). Until one is, `emailService.js`/`smsService.js` fall back to a log-based provider that (post-fix) no longer prints the token itself, so the original leak risk is closed either way — but delivery obviously still won't reach a real inbox/phone until a provider is wired up before going live.

---

## Fresh findings from today's own new code

Reviewed with the same rigor as the rest of the app — all clean, called out explicitly since these files didn't exist at the time of the last audit:

- **Razorpay webhook** (`modules/payments/razorpay.service.js#reconcilePendingPaymentsFromWebhook`, `payments.controller.js`, `payments.routes.js`, `app.js`'s new raw-body middleware): signature verified with `crypto.timingSafeEqual` (length-guarded first, same pattern as the existing order/payment signature check), ownership derived only from Razorpay's own order `notes` (never from the webhook payload's own claims), idempotent by construction (reuses `createPaymentForAppointment`'s existing replay guard). Deliberately has no `authenticate`/`authorize` — correct, since Razorpay is the caller and the signature check *is* its access control. 46 unit tests, all passing.
- **Backend Sentry wiring** (`config/sentry.js`, `app.js`, `errorHandler.js`): no secret ever logged; DSN is a public-ish identifier anyway (not a bearer credential in Sentry's own model), read from `env.js` the same way every other optional integration is. Only 5xx/unexpected errors are forwarded, never ordinary 4xx client errors (so no risk of, say, a wrong-password attempt being reported as an "incident"). Fails safe (never installed / no DSN / a broken Sentry SDK call are all silent no-ops, never crash the request). 8 unit tests, all passing.
- **Upload rate limiter** (`middleware/rateLimiter.js#uploadLimiter`, `uploads.routes.js`): mounted *after* `authenticate`/`authorize` (so it can key by `req.user.id`, falling back to IP) and *before* the multer middleware (so an over-limit caller is rejected before the process spends effort buffering their multipart body) — correct ordering, closes the one previously-unlimited sensitive write path. 5 unit tests, all passing.
- **Admin failed-jobs visibility** (`GET /admin/jobs/failed`): sits under the module's existing `router.use(adminIpAllowlist, authenticate, authorize('admin','superadmin'))` — same protection as every other admin route, verified by reading the route file directly rather than assuming it. Read-only, no user-controlled data reaches a query (the `limit` param is defensively clamped, not interpolated anywhere). 12 unit tests, all passing.

---

## A few things worth naming explicitly (not bugs — design decisions, confirmed sound)

- **CORS now uses `credentials: true`** (changed since the last audit's note that it was `false`) — this is *intentional*, required for the httpOnly refresh cookie to work cross-port/cross-subdomain, and safe specifically because `origin` stays pinned to one exact value (`env.clientOrigin`), never a wildcard — the `cors` package itself refuses to combine a wildcard origin with `credentials:true`, so this can't silently regress into something dangerous.
- **CSRF exposure from the new cookie** is real but narrow and consciously accepted: only `POST /auth/refresh`/`POST /auth/logout` ever read the cookie, `SameSite=Lax` already blocks it being attached to a forged cross-site `POST` in the first place, and the worst a forged request could do (rotate a token, or log the victim out) never leaks data back to the attacker because CORS still blocks reading the response. Documented in `utils/webClientAuth.js`'s own header comment, including the explicit fallback plan (a real CSRF token) if `REFRESH_COOKIE_SAME_SITE` is ever set to `none` for a genuinely cross-domain deployment.
- **No CSP `<meta>` tag in `client/index.html`** — not flagged as a finding: this SPA is typically served by a static host/CDN (Vercel, Netlify, nginx) that sets response headers, which is the more standard place for a real CSP anyway; helmet already covers the backend API's own headers. Worth adding at the hosting layer before a public launch, but it's an infra/deploy step, not an app code gap.
- **Android/iOS native project files** (`mobile/android/`, any future `mobile/ios/`) were not in scope for this pass (not present in this working copy) — a cleartext-traffic / App Transport Security check on those is worth doing separately once that platform scaffolding exists on your machine (`flutter create` needs the real Flutter SDK, which isn't available in this sandbox either).

---

## Priority action list

1. **Run `npm audit` yourself** in both `client/` and `server/server/` (this sandbox can't reach the npm registry) — confirm no residual advisories on `react-router-dom`, `morgan`, `qs`, or anything else, and patch if so.
2. **Run `scripts/encryptExistingBankDetails.js`** against your real database once `BANK_DETAILS_ENCRYPTION_KEY` is set for real (see that script's own instructions) — any doctor bank details saved *before* encryption was added are still plaintext in the database until this runs.
3. **Configure a real email/SMS provider** before any real user relies on password reset / OTP delivery.
4. Everything else from the original audit is closed. No new Critical/High items were found in today's pass.

---

*Static code review only — no live database, real email/SMS, third-party service, or production traffic was touched. Not a substitute for a penetration test; recommend a dedicated third-party pen-test before handling real patient data in production.*
