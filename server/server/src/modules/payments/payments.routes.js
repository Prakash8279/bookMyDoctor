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

router.get('/:id', authenticate, authorize(...ALL_ROLES), validation.getPayment, validateRequest, controller.getPayment);

module.exports = router;
