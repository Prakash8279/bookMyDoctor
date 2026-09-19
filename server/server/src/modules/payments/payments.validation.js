/**
 * express-validator chains for every payments endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "appointment already paid", "you don't own
 * this clinic", fee computation) belongs in payments.service.js.
 */
const { body, param, query } = require('express-validator');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Same UPI VPA shape used for the doctor's own payout UPI id (me.validation.js#patchMe's
// bankUpiId) — handle + '@' + PSP/bank handle in letters.
const UPI_RE = /^[A-Za-z0-9.\-_]{2,256}@[A-Za-z]{2,64}$/;

const createPayment = [
  body('appointmentId').optional({ values: 'falsy' }).isUUID().withMessage('appointmentId must be a valid id.'),
  body('patientUserId').optional({ values: 'falsy' }).isUUID().withMessage('patientUserId must be a valid id.'),
  body('doctorUserId').optional({ values: 'falsy' }).isUUID().withMessage('doctorUserId must be a valid id.'),
  body('clinicId').optional({ values: 'falsy' }).isUUID().withMessage('clinicId must be a valid id.'),
  body('isEmergency').optional({ values: 'falsy' }).isBoolean().withMessage('isEmergency must be a boolean.').toBoolean(),
  body('mode')
    .notEmpty()
    .withMessage('mode is required.')
    .bail()
    .isIn(['cash', 'upi', 'card', 'online'])
    .withMessage('mode must be one of: cash, upi, card, online.'),
  body('transactionRef').optional({ values: 'falsy' }).isString().trim().isLength({ max: 200 }).withMessage('transactionRef must be at most 200 characters.'),
  // Payer's own UPI id for this transaction (request: "utr no aaye upi id aaye", clarified to
  // always show on the Cash Payment form, not gated to mode==='upi' — a receptionist may still
  // jot it down for a UPI-via-QR cash-adjacent collection recorded under a different mode).
  body('payerUpiId')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 150 })
    .withMessage('payerUpiId must be at most 150 characters.')
    .bail()
    .matches(UPI_RE)
    .withMessage('payerUpiId must be a valid UPI id, e.g. name@okhdfcbank.'),
  // Cross-field shape rules — still shape-only, no DB lookups: whether these ids actually
  // resolve to real/visible records is business-rule validation in payments.service.js.
  //  - mode !== 'cash' requires a non-empty transactionRef.
  //  - when appointmentId is absent, patientUserId + doctorUserId are both required — the only
  //    way to identify who is paying whom for a cash-collected-without-booking payment.
  body().custom((value) => {
    const b = value || {};
    if (b.mode && b.mode !== 'cash' && (!b.transactionRef || !String(b.transactionRef).trim())) {
      throw new Error('transactionRef is required when mode is not cash.');
    }
    if (!b.appointmentId && (!b.patientUserId || !b.doctorUserId)) {
      throw new Error('patientUserId and doctorUserId are required when appointmentId is not provided.');
    }
    return true;
  }),
];

const listPayments = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['pending', 'paid', 'refunded'])
    .withMessage('status must be one of: pending, paid, refunded.'),
  query('mode')
    .optional({ values: 'falsy' })
    .isIn(['cash', 'upi', 'card', 'online'])
    .withMessage('mode must be one of: cash, upi, card, online.'),
  query('dateFrom').optional({ values: 'falsy' }).matches(DATE_RE).withMessage('dateFrom must be in YYYY-MM-DD format.'),
  query('dateTo').optional({ values: 'falsy' }).matches(DATE_RE).withMessage('dateTo must be in YYYY-MM-DD format.'),
  query('appointmentId').optional({ values: 'falsy' }).isUUID().withMessage('appointmentId must be a valid id.'),
  query('patientId').optional({ values: 'falsy' }).isUUID().withMessage('patientId must be a valid id.'),
  query('doctorId').optional({ values: 'falsy' }).isUUID().withMessage('doctorId must be a valid id.'),
  query('clinicId').optional({ values: 'falsy' }).isUUID().withMessage('clinicId must be a valid id.'),
];

const getPayment = [param('id').isUUID().withMessage('id must be a valid id.')];

// Razorpay self-pay flow (razorpay.service.js) — shape-only here, same as every other chain in
// this file; ownership/already-paid/signature checks are all business-rule validation that
// belongs in razorpay.service.js.
const createRazorpayOrder = [
  body('appointmentId').notEmpty().withMessage('appointmentId is required.').isUUID().withMessage('appointmentId must be a valid id.'),
  body('paymentOption')
    .optional({ values: 'falsy' })
    .isIn(['full', 'minimum'])
    .withMessage('paymentOption must be either "full" or "minimum".'),
];

const verifyRazorpayPayment = [
  body('appointmentId').notEmpty().withMessage('appointmentId is required.').isUUID().withMessage('appointmentId must be a valid id.'),
  body('razorpayOrderId').notEmpty().withMessage('razorpayOrderId is required.').isString().trim(),
  body('razorpayPaymentId').notEmpty().withMessage('razorpayPaymentId is required.').isString().trim(),
  body('razorpaySignature').notEmpty().withMessage('razorpaySignature is required.').isString().trim(),
];

module.exports = { createPayment, listPayments, getPayment, createRazorpayOrder, verifyRazorpayPayment };
