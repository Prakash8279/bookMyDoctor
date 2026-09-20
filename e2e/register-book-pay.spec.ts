// End-to-end scaffold: register -> search/select a doctor -> book an appointment -> reach payment.
//
// WHY THIS SPEC LOOKS THE WAY IT DOES
// ------------------------------------------------------------------------------------------
// Every selector below was taken from what actually renders today in
// client/src/pages/PublicPages.jsx (Register) and client/src/pages/PatientPages.jsx (Booking /
// payNow) — not invented. In particular:
//   - Register's "Doctor"/"Specialization"/etc. fields are NOT plain <select> elements. They're
//     the shared components/Select.jsx widget: a visually-hidden (but still real/accessible)
//     native <select> plus a hand-drawn <button role="button">/<ul role="listbox"> pair (see
//     that file's header comment for why). We drive the button + listbox, which is what a real
//     user actually clicks, rather than relying on the hidden native <select>.
//   - Booking is MANDATORY online payment for any doctor with a non-zero consultation fee (see
//     appointments.service.js#runBookingJob) — a booking only shows "Payment required to
//     confirm" (with Pay buttons) in that case; a doctor with a ₹0 fee confirms immediately with
//     no payment step at all. This spec handles both outcomes (see the branch below) rather than
//     assuming one, and warns loudly when the payment step wasn't reached.
//   - Completing a REAL Razorpay payment needs a live Razorpay test-mode account and a
//     genuine HMAC-signed response from Razorpay's own servers — neither exists in CI or in this
//     sandbox. So `window.Razorpay` itself is stubbed (see mockRazorpayCheckout below) before the
//     app loads: the app's own loadRazorpayScript() short-circuits and never fetches Razorpay's
//     real checkout.js the moment `window.Razorpay` already exists (see
//     client/src/lib/loadRazorpayScript.js), so the stub is used instead of any real network
//     call to checkout.razorpay.com. This spec verifies the widget was opened with a real
//     server-issued order (proving the booking -> "pay now" -> create-order flow works end to
//     end) and deliberately stops there, rather than faking a payment success.
//
// THIS SUITE CANNOT RUN IN THE SANDBOX IT WAS AUTHORED IN — there is no frontend/backend running,
// no seeded test database, and no Playwright browsers installed there. See ./README.md for what
// a real run needs. It has NOT been executed; treat it as a reviewed scaffold, not a passing test.
import { test, expect, type Page } from '@playwright/test'

// Unique per run so repeat runs against a persistent local test database don't collide on
// phone/email uniqueness checks (auth.validation.js#register).
const RUN_ID = Date.now().toString()
const TEST_PATIENT = {
  // Must satisfy NAME_RE in PublicPages.jsx: letters (plus space/./'/-) only, no digits — so this
  // can't be e.g. "E2E Test Patient" (a digit in the name trips the exact validation error this
  // spec would otherwise silently sit on until its own toHaveURL timeout).
  name: 'QA Test Patient',
  // Server-side validation (auth.validation.js#register) requires a 10-digit number starting
  // 6-9 — see PHONE_RE in PublicPages.jsx. Built from the run id so it's both valid and unique.
  phone: `9${RUN_ID.slice(-9)}`,
  email: `e2e.patient.${RUN_ID}@example.com`,
  // Must satisfy PASSWORD_RE in PublicPages.jsx: 8-72 chars, at least one letter and one digit.
  password: 'TestPass123',
}

// Optional knobs for whoever runs this against their own seeded test data — none of these need
// to be set; sensible fallbacks (first available option) are used when they aren't. See README.
const DOCTOR_CITY = process.env.E2E_DOCTOR_CITY
const DOCTOR_SPECIALIZATION = process.env.E2E_DOCTOR_SPECIALIZATION
const DOCTOR_NAME = process.env.E2E_DOCTOR_NAME

// Stubs window.Razorpay with a fake Checkout constructor BEFORE any app script runs, so
// client/src/lib/loadRazorpayScript.js's `if (window.Razorpay) return Promise.resolve(...)`
// short-circuits and the real https://checkout.razorpay.com/v1/checkout.js is never requested.
// `open()` records that it was called (and with what order) instead of showing a real modal;
// it deliberately never invokes the `handler` callback passed in PatientPages.jsx#payNow, since
// simulating a genuine payment success would require forging a Razorpay HMAC signature that the
// real backend (razorpay.service.js#verifyAndRecordPayment) would reject anyway.
async function stubRazorpayCheckout(page: Page) {
  await page.addInitScript(() => {
    class MockRazorpayCheckout {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(options: any) {
        this.options = options
      }
      open() {
        // @ts-expect-error - test-only globals read back by the spec via page.evaluate
        window.__e2eRazorpayOpened = true
        // @ts-expect-error - test-only globals read back by the spec via page.evaluate
        window.__e2eRazorpayOrder = { amount: this.options?.amount, orderId: this.options?.order_id }
      }
      on() {
        /* no-op stand-in for checkout.on('payment.failed', ...) */
      }
    }
    // @ts-expect-error - intentionally overriding the real Razorpay Checkout global for this test
    window.Razorpay = MockRazorpayCheckout
  })
}

// Opens one of the app's custom Select widgets (components/Select.jsx) by the visible label text
// on its trigger button (e.g. "Select Doctor"), then clicks the listbox option with the given
// visible text. Mirrors exactly what a real user does — click the button, then click an option —
// rather than reaching into the hidden native <select> the widget also keeps around.
async function chooseFromCustomSelect(page: Page, placeholder: string, optionText: string | RegExp) {
  await page.getByRole('button', { name: placeholder }).click()
  await page.getByRole('listbox').getByRole('option', { name: optionText }).click()
}

// Same, but picks the first real (non-placeholder) option instead of a known one — used when the
// caller has no opinion on which doctor/etc. gets picked.
async function chooseFirstRealOption(page: Page, placeholder: string) {
  await page.getByRole('button', { name: placeholder }).click()
  const options = page.getByRole('listbox').getByRole('option')
  // Index 0 is always the "Select <label>" placeholder row (Select.jsx's `includeBlank` option).
  await options.nth(1).click()
}

test.describe('register -> book appointment -> pay', () => {
  test('a new patient can register, find a doctor, book an appointment, and reach payment', async ({ page }) => {
    await stubRazorpayCheckout(page)

    await test.step('Register a new patient account', async () => {
      await page.goto('/register')

      // Defaults to the 'patient' tab already, but click it explicitly so the test still makes
      // sense if that default ever changes (Register()'s accountType state in PublicPages.jsx).
      await page.getByRole('tab', { name: "I'm a patient" }).click()

      await page.getByLabel('Full name').fill(TEST_PATIENT.name)
      await page.getByLabel('Phone').fill(TEST_PATIENT.phone)
      await page.getByLabel('Email address').fill(TEST_PATIENT.email)
      await page.getByLabel('Password', { exact: true }).fill(TEST_PATIENT.password)
      await page.getByLabel('Confirm password').fill(TEST_PATIENT.password)

      await page.getByRole('button', { name: 'Create account' }).click()

      // A successful register() logs the account in and navigates to roleHome('patient') ==
      // '/patient/dashboard' (see roleHome() in PublicPages.jsx).
      await expect(page).toHaveURL(/\/patient\/dashboard$/)
      await expect(page.getByRole('heading', { name: /^Welcome, / }).first()).toBeVisible()
    })

    await test.step('Go to the booking page', async () => {
      await page.getByRole('link', { name: 'Book appointment' }).click()
      await expect(page).toHaveURL(/\/patient\/book$/)
      await expect(page.getByRole('heading', { name: 'Book an appointment' })).toBeVisible()
    })

    await test.step('Search for a doctor using the filters, then select one', async () => {
      // The booking page's own filter panel (city/specialization/24x7-emergency) mirrors the
      // public search page's filters (see the "TRIMMED" comment above the Booking() filter form
      // in PatientPages.jsx). Only apply the ones a caller actually asked for via env vars, then
      // press "Apply filters" — that's this page's whole "search for a doctor" step.
      if (DOCTOR_CITY) await chooseFromCustomSelect(page, 'Select City', DOCTOR_CITY)
      if (DOCTOR_SPECIALIZATION) await chooseFromCustomSelect(page, 'Select Specialization', DOCTOR_SPECIALIZATION)
      await page.getByRole('button', { name: 'Apply filters' }).click()

      await expect(page.getByText(/doctors? match — pick one below\./)).toBeVisible()

      if (DOCTOR_NAME) {
        await chooseFromCustomSelect(page, 'Select Doctor', DOCTOR_NAME)
      } else {
        await chooseFirstRealOption(page, 'Select Doctor')
      }
    })

    await test.step('Fill in the rest of the booking form and confirm', async () => {
      // "Myself" is always the first real option in the Patient dropdown (Booking()'s
      // `['Myself', ...familyMembers]` options list in PatientPages.jsx).
      await chooseFromCustomSelect(page, 'Select Patient', 'Myself')

      // Appointment date already defaults to today (Booking()'s `useState(todayStr())`) and
      // there's no slot/time field any more — the server auto-assigns the next free slot — so
      // nothing else is required here beyond an optional reason.
      await page.getByLabel('Reason for visit').fill('E2E scaffold booking - please disregard.')

      await page.getByRole('button', { name: 'Confirm booking' }).click()
    })

    await test.step('Reach the payment step (or confirm booking, if no fee applies)', async () => {
      const paymentHeading = page.getByRole('heading', { name: 'Payment required to confirm' })
      const confirmedHeading = page.getByRole('heading', { name: 'Booking confirmed' })

      await expect(paymentHeading.or(confirmedHeading)).toBeVisible({ timeout: 20_000 })

      if (await paymentHeading.isVisible()) {
        // This is the actual target of this scenario: a booking with a fee is created as
        // `pending_payment` and must be paid before it gets a token (see
        // appointments.service.js#runBookingJob) — click through to Razorpay Checkout.
        const payFullButton = page.getByRole('button', { name: /^Pay ₹[\d.]+ now$/ }).first()
        await expect(payFullButton).toBeVisible()
        await payFullButton.click()

        // Confirms payNow() in PatientPages.jsx actually reached `checkout.open()` against a
        // real server-issued order (POST /payments/razorpay/order), using our stubbed
        // window.Razorpay instead of the real widget. Intentionally does NOT simulate a
        // successful payment beyond this point — see the header comment on
        // stubRazorpayCheckout() above for why.
        await expect
          .poll(() => page.evaluate(() => (window as unknown as { __e2eRazorpayOpened?: boolean }).__e2eRazorpayOpened))
          .toBe(true)

        const openedOrder = await page.evaluate(() => (window as unknown as { __e2eRazorpayOrder?: { amount?: number; orderId?: string } }).__e2eRazorpayOrder)
        expect(openedOrder?.orderId).toBeTruthy()
      } else {
        // The doctor picked above has no consultation fee configured, so the booking confirmed
        // immediately with no online payment step to reach. Not a failure of this flow, but
        // worth flagging loudly since it means the Razorpay stub above never got exercised.
        // eslint-disable-next-line no-console
        console.warn(
          '[e2e] Booked doctor required no online payment, so the payment/Razorpay step was never reached. ' +
            'Seed (or pick via E2E_DOCTOR_NAME) a doctor with a non-zero consultation fee to exercise it.'
        )
        await expect(confirmedHeading).toBeVisible()
      }
    })
  })
})
