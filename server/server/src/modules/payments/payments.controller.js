/**
 * Controllers for the payments module.
 * Responsibility: parse req -> call the matching payments.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const paymentsService = require('./payments.service');
const razorpayService = require('./razorpay.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const createPayment = asyncHandler(async (req, res) => {
  const payment = await paymentsService.createPayment(req.body, req.user);
  return success(res, payment, { statusCode: 201, message: 'Payment recorded.' });
});

const listPayments = asyncHandler(async (req, res) => {
  const { page, pageSize, status, mode, dateFrom, dateTo, appointmentId, patientId, doctorId, clinicId } = req.query;
  const { rows, pagination } = await paymentsService.listPayments(
    { page, pageSize, status, mode, dateFrom, dateTo, appointmentId, patientId, doctorId, clinicId },
    req.user
  );
  return success(res, rows, { pagination });
});

const getPayment = asyncHandler(async (req, res) => {
  const payment = await paymentsService.getPaymentById(req.params.id, req.user);
  return success(res, payment);
});

// Razorpay self-pay flow — see razorpay.service.js for the create-order/verify-signature logic.
const createRazorpayOrder = asyncHandler(async (req, res) => {
  const order = await razorpayService.createOrder(req.body.appointmentId, req.user, req.body.paymentOption);
  return success(res, order, { statusCode: 201, message: 'Payment order created.' });
});

const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  // { payment, appointment } — the frontend needs the appointment's possibly-just-flipped
  // status/tokenNumber/paymentStatus to move a `pending_payment` booking screen to "confirmed",
  // not just the payment record.
  const result = await razorpayService.verifyAndRecordPayment(req.body, req.user);
  return success(res, result, { statusCode: 201, message: 'Payment verified and recorded.' });
});

// WEBHOOK RECONCILIATION FIX (production-readiness plan, Phase 2.3) — Razorpay calls this
// directly (no logged-in user, no req.user), whenever a payment on our account is captured, so a
// pending_payment booking still gets reconciled even if the patient's own browser never comes
// back to call verifyRazorpayPayment above. req.body here is the raw Buffer app.js's
// express.raw({type:'application/json'}) put there for this exact path — mounted BEFORE the
// global express.json() specifically so the bytes reaching reconcilePendingPaymentsFromWebhook
// are byte-for-byte what Razorpay actually signed (re-serializing a parsed-then-stringified body
// would not reliably reproduce the same bytes and would silently break signature verification).
// Always resolves 200 unless the signature itself was invalid or something genuinely broke —
// see that function's doc comment for exactly which outcomes are "handled" vs. benign no-ops.
const handleRazorpayWebhook = asyncHandler(async (req, res) => {
  const result = await razorpayService.reconcilePendingPaymentsFromWebhook(req.body, req.headers['x-razorpay-signature']);
  return success(res, result);
});

module.exports = {
  createPayment,
  listPayments,
  getPayment,
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
};
