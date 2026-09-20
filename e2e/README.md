# End-to-end tests (Playwright)

This folder is a **scaffold**: `register-book-pay.spec.ts` was written against the real
selectors/labels/text in `client/src/pages/PublicPages.jsx` (Register) and
`client/src/pages/PatientPages.jsx` (Booking / `payNow`), but it has **not been run against a
real backend** and cannot be, in the sandbox it was authored in — there is no live backend or
database there. Treat it as reviewed-but-unverified until you run it here.

## What you need running first

This suite drives the real app, not a mock of it. Before `npm run test:e2e` can do anything
useful, from the repo root:

1. **A real Postgres database** for the backend, migrated (and ideally seeded) — see
   `server/server/README.md` / `prisma/` for how you normally set this up locally, and
   `docker-compose.yml` at the repo root if you'd rather run Postgres (and Redis) in containers.
2. **The backend**, in `server/server/`:
   ```
   cd server/server
   npm install        # first time only
   cp .env.example .env   # fill in real local values — DATABASE_URL, JWT secrets, etc.
   npm run dev             # nodemon src/server.js — defaults to http://localhost:4000
   ```
3. **The frontend**, in `client/`:
   ```
   cd client
   npm install        # first time only
   cp .env.example .env   # VITE_API_BASE_URL should point at your backend, e.g. http://localhost:4000
   npm run dev             # vite — defaults to http://localhost:5173
   ```
4. **At least one verified doctor** in that database, reachable from patient search/booking
   (`GET /doctors` — see `Booking()` in `PatientPages.jsx`). To actually exercise the payment
   step (not just fall back to the "no fee, booking confirms immediately" branch), that doctor
   needs a **non-zero `consultationFee`**.
5. **Playwright's browser binaries**, installed once via:
   ```
   npx playwright install chromium
   ```
   (needs network access to Playwright's CDN — this sandbox has none, which is the other reason
   this suite can't run here.)

## Running it

From the **repo root** (`/tmp/connect_live` in this checkout):
```
npm install          # pulls in @playwright/test — see package.json
npm run test:e2e
```
Useful environment variables (all optional):

| Variable                    | Purpose                                                                 |
| ---------------------------- | ------------------------------------------------------------------------ |
| `E2E_BASE_URL`               | Frontend URL, if not the Vite default `http://localhost:5173`.          |
| `E2E_DOCTOR_CITY`             | City filter to apply on the booking page before picking a doctor.       |
| `E2E_DOCTOR_SPECIALIZATION`  | Specialization filter to apply before picking a doctor.                 |
| `E2E_DOCTOR_NAME`             | Pick a specific doctor by name instead of the first one in the results. |

With none of those set, the spec just applies no filters and picks the first doctor returned —
which only reaches the actual payment step if that doctor happens to have a non-zero fee. Set
`E2E_DOCTOR_NAME` to a specific seeded test doctor if you want the payment step reliably
exercised.

## What the test actually covers

`register-book-pay.spec.ts`:
1. Registers a brand-new patient account (unique phone/email per run, so reruns against a
   persistent local database don't collide with `auth.validation.js#register`'s uniqueness
   checks) via the real `/register` form, and confirms it lands on `/patient/dashboard`.
2. Goes to `/patient/book`, applies the (optional) City/Specialization filters and clicks
   "Apply filters" — the booking page's own doctor search — then selects a doctor from the
   results.
3. Fills in the rest of the booking form ("Myself" as patient, a reason for visit; the
   appointment date already defaults to today) and clicks "Confirm booking".
4. Asserts the booking reaches either the **"Payment required to confirm"** screen (a doctor
   with a fee — the actual target of this scenario) or, if the picked doctor has no
   consultation fee configured, the **"Booking confirmed"** screen directly (and logs a warning,
   since that branch never exercises payment at all).
5. On the payment screen, clicks "Pay ... now" and asserts Razorpay's Checkout widget was
   opened with a real, server-issued order.

## Why payment isn't actually completed

Completing a real Razorpay payment needs a live Razorpay **test-mode** account and a genuine
HMAC-signed response from Razorpay's own servers (verified server-side in
`razorpay.service.js#verifyAndRecordPayment`) — nothing this suite can fake safely or
meaningfully. Instead, the spec stubs `window.Razorpay` itself (see `stubRazorpayCheckout()` in
the spec) before the app loads, so `loadRazorpayScript()`'s existing
`if (window.Razorpay) return Promise.resolve(...)` short-circuit (see
`client/src/lib/loadRazorpayScript.js`) kicks in and the real
`https://checkout.razorpay.com/v1/checkout.js` is never even requested. The stub records that
`checkout.open()` was called, with what order, and stops there — proving the booking →
"pay now" → create-order flow works end to end, without needing a real payment gateway account
or forging a signature the backend would reject anyway.

## Known sandbox limitations at the time this was written

- Not run end-to-end: no backend, no database, and no Playwright browsers were available in the
  authoring sandbox to exercise the full flow against a real app.
- The Register step's field-filling *was* sanity-checked in that sandbox against a real,
  running `client` Vite dev server (no backend) using a locally-available Playwright install —
  every selector (`Full name`, `Phone`, `Email address`, `Password`, `Confirm password`,
  `Create account`, etc.) was confirmed to resolve to a real element and the form's own
  client-side validation was confirmed to pass with the test's sample data, up to the point
  where the app tried (and, with no backend running, failed) to call
  `POST /auth/register`. The booking/payment steps further down were not reachable that way
  (they need an authenticated session and real doctor data) and so remain unverified against a
  live app.
