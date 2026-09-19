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

module.exports = { createPayment, listPayments, getPayment, createRazorpayOrder, verifyRazorpayPayment };
