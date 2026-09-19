# Razorpay Script Load-Time Fix — Detailed Plan

## Background

Measuring the homepage's real load time in a browser showed it takes **~42.7 seconds** to reach the "fully loaded" state, even though the app itself (React bundle + all API calls to the backend) is ready in under 200ms. The entire 42+ second delay comes from one line in `client/index.html`:

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

This tag has no `async` or `defer` attribute, and it sits in `<head>`, so the browser cannot finish loading the page until this script has downloaded — on every single page (homepage, doctor search, admin panel, everywhere), not just the payment screen. When Razorpay's CDN is slow to respond (as it was during testing), the whole site appears frozen for that entire time, for every visitor, regardless of whether they ever intend to pay online.

## Why this is safe to fix — verified, not assumed

Before proposing a change, the codebase was searched end-to-end for every place that depends on this script, to be certain the fix cannot silently break something else:

- **Only one `<script>` tag** loads Razorpay's checkout widget anywhere in the project: `client/index.html` line 15.
- **Only one place in the entire frontend reads `window.Razorpay`**: the `payNow` function inside `client/src/pages/PatientPages.jsx` (the patient's "Pay now" button on the booking confirmation screen).
- **Only one test touches `window.Razorpay`**: `client/src/pages/PatientPages.test.jsx` ("pays online for a pending_payment booking…"). That test assigns `window.Razorpay` directly as a mock — it never relies on the real `<script>` tag (jsdom, the test environment, doesn't load external scripts at all). This means the test is unaffected by *how* the script gets loaded in production; it only cares that `window.Razorpay` exists by the time `payNow` runs, which will still be true after this fix.
- No backend file, no other page, no other component references this script or this global.

This confirms the blast radius of the fix is exactly one production file's behavior (`PatientPages.jsx`'s payment button) and nothing else.

## The fix

Replace "always load Razorpay globally on every page" with "load Razorpay only when a patient is actually about to pay," using a small, reusable, safe loader instead of the raw `<script>` tag.

### 1. New file: `client/src/lib/loadRazorpayScript.js`

A tiny utility that loads the script on demand, exactly once, no matter how many times or from how many places it's called:

```js
// Loads Razorpay's Checkout widget script on demand instead of blocking every page
// load with it (see index.html history / razorpay-script-loading-fix-plan.md).
// Safe to call multiple times or from multiple components — the script is only
// ever injected once, and every caller shares the same in-flight promise.
let razorpayScriptPromise = null

export function loadRazorpayScript() {
  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay)
  }
  if (razorpayScriptPromise) {
    return razorpayScriptPromise
  }
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => {
      if (window.Razorpay) {
        resolve(window.Razorpay)
      } else {
        reject(new Error('Razorpay script loaded but window.Razorpay is missing.'))
      }
    }
    script.onerror = () => reject(new Error('Failed to load the Razorpay payment script.'))
    document.head.appendChild(script)
  }).catch((err) => {
    // Let a later call retry instead of permanently caching a failure.
    razorpayScriptPromise = null
    throw err
  })
  return razorpayScriptPromise
}
```

Key safety details:
- If `window.Razorpay` already exists (e.g. a unit test mocked it directly), it resolves immediately and never touches the DOM — this is exactly why the existing test keeps working untouched.
- If two components call it at the same time, only one `<script>` tag is ever injected (shared promise).
- If loading fails, the failure isn't cached forever — the next attempt gets a fresh try.

### 2. `client/index.html` — remove the blocking tag

```diff
-    <!-- Razorpay Checkout widget, used by the patient "Pay now" button right after a booking is
-         confirmed (src/pages/PatientPages.jsx#Booking). Loaded globally here (not injected
-         on-demand) so it's already warm by the time a patient reaches the confirmation screen. -->
-    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

Nothing replaces it here — loading now happens from inside `PatientPages.jsx` (see below).

### 3. `client/src/pages/PatientPages.jsx` — update `payNow`

Current code (lines ~250–256):

```js
const payNow = async (paymentOption = 'full') => {
  setPaymentError('')
  if (!window.Razorpay) {
    setPaymentError('Payment gateway failed to load. Check your internet connection and try again.')
    return
  }
  setPayingNow(true)
  try {
```

New code — same error message on the same failure condition, just reached via the loader instead of a synchronous check:

```js
const payNow = async (paymentOption = 'full') => {
  setPaymentError('')
  setPayingNow(true)
  try {
    await loadRazorpayScript()
```

(and remove the now-unreachable inner `try`'s duplicate `setPayingNow(true)` line, then wrap the existing script body in a single `catch` that sets the same `'Payment gateway failed to load...'` message when `loadRazorpayScript()` rejects, and the existing `orderError` message when order creation fails — both already flow into the same `catch (err)` block naturally.)

Add the import at the top of the file:

```js
import { loadRazorpayScript } from '../lib/loadRazorpayScript'
```

The button's existing "Opening payment…" loading state (already tied to `payingNow`) now also covers the brief script-load time, so the UI behavior a patient sees is unchanged — the button just says "Opening payment…" for a moment longer on a cold load, instead of the whole page being frozen for 42 seconds before the patient even reaches this screen.

### 4. Optional (recommended) — keep the original "pre-warm" intent, without the page-blocking cost

The original comment in `index.html` explained the script was loaded globally so it would "already be warm" by the time a patient reaches the confirmation screen. That's a reasonable goal — it can be kept, just moved somewhere that can't block the homepage: fire the same `loadRazorpayScript()` call in the background the moment the "Payment required to confirm" screen mounts (a `useEffect`, result ignored), rather than on every page from the very first byte:

```js
useEffect(() => {
  if (booked?.status === 'pending_payment') {
    loadRazorpayScript().catch(() => {}) // best-effort warm-up; payNow will retry and surface any real error
  }
}, [booked?.status])
```

This only runs for patients who've actually completed a booking and owe an online payment — a small fraction of all page views — and it doesn't block anything, so even a slow Razorpay CDN never delays this screen's own render.

## Module-by-module impact check

| Module | Touches Razorpay script/global? | Impact of this change |
|---|---|---|
| `client/index.html` | Yes — the tag being removed | Script no longer loads on every page load |
| `client/src/pages/PatientPages.jsx` (`payNow`) | Yes — only real consumer | Behavior identical to a patient; loads the script just-in-time instead of assuming it's already there |
| `client/src/pages/PatientPages.test.jsx` | Mocks `window.Razorpay` directly | Unaffected — loader resolves instantly when the mock is already present |
| Every other page/component (AdminPages, StaffPages, FeaturePages, PaymentSourceBadge, paymentVisibility, etc.) | No — grep confirmed these only reference payment *data* (mode/status labels), never the Razorpay script or global | Unaffected |
| Backend (`payments.service.js`, `razorpay.service.js`) | No — these run server-side and never touch the browser script | Unaffected |
| Mobile app (Flutter) | Separate codebase, doesn't load this `index.html` at all | Unaffected |

## Testing plan

1. **Run the existing frontend suite unchanged** — `PatientPages.test.jsx`'s Razorpay test should pass exactly as before (it never depended on the script tag).
2. **Add two small new unit tests** for `loadRazorpayScript.js`:
   - Resolves immediately without touching the DOM when `window.Razorpay` is already set.
   - Injects exactly one `<script>` tag even when called twice concurrently (asserts `document.head.appendChild` count / or checks `document.querySelectorAll('script[src*="razorpay"]').length === 1`).
3. **Manual verification in a real browser** (repeat the same measurement done earlier):
   - Reload the homepage and confirm it now reaches "fully loaded" in well under 1 second, with no `checkout.razorpay.com` request in the Network tab until a payment is actually attempted.
   - Complete a full test booking + "Pay now" flow end-to-end and confirm the Razorpay modal still opens, a test payment still completes, and the appointment still flips from `pending_payment` to a confirmed, token-bearing booking exactly as before.
   - Temporarily block `checkout.razorpay.com` (e.g., via browser dev tools request blocking) and confirm `payNow` still shows the same `'Payment gateway failed to load...'` message instead of hanging or crashing.

## Rollout

This is a small, self-contained change — one new file, one line removed from `index.html`, and a handful of lines changed in one function. Recommended order:
1. Add `loadRazorpayScript.js`.
2. Update `payNow` (and optionally add the warm-up `useEffect`) in `PatientPages.jsx`.
3. Remove the `<script>` tag from `index.html`.
4. Run the full test suite, then verify manually per the steps above.

## Rollback

If anything unexpected turns up, this is a single, isolated commit — reverting it restores the old always-loaded `<script>` tag and the old synchronous `window.Razorpay` check exactly as they are today. No database, backend, or other frontend module is touched by this change in either direction.
