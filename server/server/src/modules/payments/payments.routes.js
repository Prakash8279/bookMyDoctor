/**
 * Route definitions for the payments module.
 * Scope: Payment recording (cash/upi/card/online), receipt numbers, doctor-vs-admin amount masking.
 * Allowed roles: receptionist/admin/superadmin (write), all roles (read own/scoped, masked)
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in payments.service.js.
 *
 * POST / is rate-limited by paymentLimiter (middleware/rateLimiter.js) — a financial mutation
 * that also consumes the shared payment_receipt_seq sequence, so it gets the same per-endpoint
 * moderate limiter precedent as the appointments module's bookingLimiter, rather than relying on
 * only the generous global defaultLimiter. Mounted AFTER authenticate so the limiter's per-user
 * keyGenerator has req.user available.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const { paymentLimiter } = require('../../middleware/rateLimiter');
const validation = require('./payments.validation');
const controller = require('./payments.controller');

const ALL_ROLES = ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'];

router.post(
  '/',
  authenticate,
  authorize('receptionist', 'admin', 'superadmin'),
  paymentLimiter,
  validation.createPayment,
  validateRequest,
  controller.createPayment
);

router.get('/', authenticate, authorize(...ALL_ROLES), validation.listPayments, validateRequest, controller.listPayments);

// GET /:id removed (backend-cleanup audit — user request: "website frontend me nahi hai but
// backend bna hua hai to backend se hata do"): no web/mobile screen ever fetched a single payment
// by id — every payment detail shown in the app comes from the list above. The underlying
// payments.service.js#getPaymentById function stays — razorpay.service.js's "Pay now" verify flow
// calls it internally.

// Razorpay self-pay flow — patient-only (the "Pay now" button shown right after a booking is
// confirmed). Same paymentLimiter as the ledger-write path above: this also mutates payment state
// and, on verify, consumes the shared payment_receipt_seq sequence via createPaymentForAppointment.
router.post(
  '/razorpay/order',
  authenticate,
  authorize('patient'),
  paymentLimiter,
  validation.createRazorpayOrder,
  validateRequest,
  controller.createRazorpayOrder
);

router.post(
  '/razorpay/verify',
  authenticate,
  authorize('patient'),
  paymentLimiter,
  validation.verifyRazorpayPayment,
  validateRequest,
  controller.verifyRazorpayPayment
);

// WEBHOOK RECONCILIATION FIX (production-readiness plan, Phase 2.3) — deliberately NO
// authenticate/authorize here: Razorpay calls this directly with no JWT of ours, and its own
// X-Razorpay-Signature header (checked inside reconcilePendingPaymentsFromWebhook, using a
// separate RAZORPAY_WEBHOOK_SECRET) is this endpoint's actual access control. Relies on the
// global defaultLimiter (app.js) rather than paymentLimiter above, since paymentLimiter's
// keyGenerator expects req.user which never exists on this route. app.js registers
// express.raw({type:'application/json'}) for this EXACT path before its global express.json()
// call, so req.body here is the untouched raw Buffer the signature was computed over — do not
// add any body-parsing middleware in front of this route.
router.post('/webhook/razorpay', controller.handleRazorpayWebhook);

module.exports = router;
