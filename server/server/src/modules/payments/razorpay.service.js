/**
 * Razorpay online-payment integration — the patient-facing "Pay now" flow shown right after a
 * booking is confirmed. Two-step flow, standard for every Razorpay server integration:
 *   1) createOrder      — server creates a Razorpay Order for the appointment's total amount and
 *                          hands the frontend just enough to open Razorpay's Checkout widget.
 *   2) verifyAndRecord   — after the patient completes (or fails) payment in that widget, Razorpay
 *                          hands the frontend an order id + payment id + HMAC signature. The
 *                          frontend posts those here; ONLY once the signature verifies against our
 *                          own key secret do we record a real Payment row. A client can never mark
 *                          its own booking "paid" by simply calling an API with made-up ids — the
 *                          signature can only have been produced by Razorpay itself.
 *
 * Deliberately dependency-free: uses Node's built-in `fetch` (Node >=18, matches this project's
 * engines requirement) to call Razorpay's plain REST API instead of adding the `razorpay` npm
 * package, and Node's built-in `crypto` for the signature check. One fewer dependency to install.
 * Reference: https://razorpay.com/docs/api/orders/ and
 * https://razorpay.com/docs/payments/server-integration/nodejs/build-integration/#3-verify-payment-signature
 *
 * Recording the actual Payment row is delegated entirely to
 * payments.service.js#createPaymentForAppointment — the exact same fee-copy/row-lock/
 * already-paid/cancelled-appointment guards the receptionist/admin cash-recording path already
 * has, just reached via a new (patient, mode:'online') caller instead of duplicating that logic.
 */
const crypto = require('crypto');
const prisma = require('../../config/db');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const paymentsService = require('./payments.service');

const RAZORPAY_ORDERS_URL = 'https://api.razorpay.com/v1/orders';

function razorpayAuthHeader() {
  return `Basic ${Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString('base64')}`;
}

/**
 * Looks up the authoritative amount (in rupees) Razorpay actually created an order for, given
 * its order id. Used at verify time instead of trusting any amount the frontend might send —
 * the frontend never gets a say in how much an order was for; it only ever echoes back
 * order/payment ids and a signature. Reused by verifyAndRecordPayment to decide whether the
 * patient paid the full consultation fee or just the doctor's minimum advance amount.
 * @param {string} orderId
 */
async function fetchOrderAmountRupees(orderId) {
  return (await fetchOrderDetails(orderId)).amountRupees;
}

/**
 * Fetches an order's authoritative amount AND its `notes` (the {appointmentId, patientUserId,
 * paymentOption} createOrder stamped on it — see that function below) directly from Razorpay,
 * never trusted from the frontend. verifyAndRecordPayment uses `notes` to confirm this order was
 * actually created FOR the appointment/patient the verify request claims — see the security fix
 * comment at that call site for exactly what this closes.
 * @param {string} orderId
 */
async function fetchOrderDetails(orderId) {
  let response;
  try {
    response = await fetch(`${RAZORPAY_ORDERS_URL}/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: razorpayAuthHeader() },
    });
  } catch (networkError) {
    throw new ApiError(502, 'PAYMENT_GATEWAY_UNREACHABLE', 'Could not reach the payment gateway. Please try again.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload.amount !== 'number') {
    throw new ApiError(502, 'PAYMENT_GATEWAY_ERROR', 'Could not verify the payment amount with the payment gateway.');
  }
  return { amountRupees: payload.amount / 100, notes: (payload.notes && typeof payload.notes === 'object') ? payload.notes : {} };
}

function assertGatewayConfigured() {
  if (!env.razorpay.keyId || !env.razorpay.keySecret) {
    throw new ApiError(
      500,
      'PAYMENT_GATEWAY_NOT_CONFIGURED',
      'Online payments are not set up yet — please pay at the clinic instead.'
    );
  }
}

/**
 * 404 (not 403) for anyone but the owning patient or admin/superadmin — same enumeration-
 * avoidance posture as every other ownership check in this codebase (see
 * appointments.service.js#getVisibleAppointmentOrThrow). Only 'patient' and admin/superadmin
 * roles ever reach these two functions (route-enforced in payments.routes.js), so no other role
 * needs handling here.
 * @param {string} appointmentId
 * @param {{id:string, role:string}} requester
 */
async function getOwnAppointmentOrThrow(appointmentId, requester) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    // BUG FIX: doctorUserId was missing here — createOrder's 'minimum' payment-option branch
    // reads appointment.doctorUserId to look up the doctor's minBookingAdvanceAmount. With it
    // absent from this select, that read came back undefined, and
    // `prisma.doctorProfile.findUnique({ where: { userId: undefined } })` throws a
    // PrismaClientValidationError — an unhandled exception (not an ApiError), so it fell through
    // to errorHandler.js's generic "Something went wrong" 500 instead of a real error message.
    // The 'full' payment option never hit this because it only needs totalAmount.
    select: { id: true, patientUserId: true, doctorUserId: true, status: true, paymentStatus: true, totalAmount: true },
  });
  if (!appointment) {
    throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  }
  if (requester.role === 'patient' && appointment.patientUserId !== requester.id) {
    throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  }
  return appointment;
}

/**
 * Step 1 — create a Razorpay Order for either the appointment's already-computed totalAmount
 * ('full', never recomputed here, same "don't drift from what the patient was quoted" rule as
 * createPaymentForAppointment) or the doctor's configured minimum advance amount ('minimum') —
 * the two payment choices offered on a `pending_payment` booking's confirmation screen. Returns
 * just enough for the frontend to open Razorpay Checkout — never the key secret.
 * @param {string} appointmentId
 * @param {{id:string, role:string}} requester
 * @param {'full'|'minimum'} [paymentOption]
 */
async function createOrder(appointmentId, requester, paymentOption = 'full') {
  assertGatewayConfigured();
  const appointment = await getOwnAppointmentOrThrow(appointmentId, requester);

  if (appointment.paymentStatus === 'paid') {
    throw new ApiError(409, 'PAYMENT_ALREADY_RECORDED', 'This appointment is already paid for.');
  }
  if (appointment.paymentStatus === 'partial') {
    // Out of scope for this pass — "pay the remaining balance online" would need to charge just
    // the difference, not the full/minimum amount again. The remaining balance is collected at
    // the clinic instead, same as any other partial payment.
    throw new ApiError(
      409,
      'PAYMENT_ALREADY_RECORDED',
      'You already paid the booking amount for this appointment online. The remaining balance is collected at the clinic.'
    );
  }
  if (appointment.status === 'cancelled' || appointment.status === 'no_show') {
    throw new ApiError(
      409,
      'APPOINTMENT_NOT_PAYABLE',
      `Cannot pay for an appointment with status "${appointment.status}".`
    );
  }

  let amountToCharge = appointment.totalAmount;
  if (paymentOption === 'minimum') {
    const doctorProfile = await prisma.doctorProfile.findUnique({
      where: { userId: appointment.doctorUserId },
      select: { minBookingAdvanceAmount: true },
    });
    if (!doctorProfile || doctorProfile.minBookingAdvanceAmount == null || Number(doctorProfile.minBookingAdvanceAmount) <= 0) {
      throw new ApiError(
        400,
        'MIN_BOOKING_AMOUNT_NOT_SET',
        'This doctor has not set a minimum booking amount. Please pay the full amount instead.'
      );
    }
    amountToCharge = doctorProfile.minBookingAdvanceAmount;
  }

  // Razorpay amounts are always in the smallest currency unit — paise for INR.
  const amountPaise = Math.round(Number(amountToCharge) * 100);

  let response;
  try {
    response = await fetch(RAZORPAY_ORDERS_URL, {
      method: 'POST',
      headers: { Authorization: razorpayAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: `appt_${appointment.id}`.slice(0, 40), // Razorpay caps receipt at 40 chars.
        notes: { appointmentId: appointment.id, patientUserId: requester.id, paymentOption },
      }),
    });
  } catch (networkError) {
    throw new ApiError(502, 'PAYMENT_GATEWAY_UNREACHABLE', 'Could not reach the payment gateway. Please try again.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.id) {
    throw new ApiError(
      502,
      'PAYMENT_GATEWAY_ERROR',
      (payload && payload.error && payload.error.description) || 'The payment gateway rejected the request.'
    );
  }

  return {
    orderId: payload.id,
    amount: payload.amount,
    currency: payload.currency,
    keyId: env.razorpay.keyId,
    appointmentId: appointment.id,
  };
}

/**
 * Step 2 — verify Razorpay's HMAC-SHA256 signature (order_id + "|" + payment_id, signed with our
 * key secret) before recording anything. Ownership is re-checked FIRST, before the signature
 * comparison even runs, so a non-owner gets the same 404 whether or not the signature they
 * supplied happens to be valid — this endpoint must never confirm another patient's appointment
 * even exists.
 * @param {{appointmentId:string, razorpayOrderId:string, razorpayPaymentId:string, razorpaySignature:string}} body
 * @param {{id:string, role:string}} requester
 */
async function verifyAndRecordPayment(body, requester) {
  assertGatewayConfigured();
  const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;

  await getOwnAppointmentOrThrow(appointmentId, requester);

  const expectedSignature = crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  // timingSafeEqual throws on a length mismatch rather than returning false, so guard that first
  // — an attacker-supplied signature of the wrong length must fail the same way as a wrong one.
  const providedBuffer = Buffer.from(String(razorpaySignature || ''), 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const isValid = providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  if (!isValid) {
    throw new ApiError(400, 'PAYMENT_SIGNATURE_INVALID', 'Payment verification failed. No charge has been recorded.');
  }

  // Never trust the frontend for how much was actually paid — it only ever echoes back ids and a
  // signature. Ask Razorpay itself what the order was for; this is what decides whether
  // createPaymentForAppointment records the appointment as fully `paid` or just `partial`
  // (doctor's minimum advance amount).
  const { amountRupees: chargedAmount, notes } = await fetchOrderDetails(razorpayOrderId);

  // SECURITY FIX (found in an audit): the signature checked above only proves this order/payment
  // pair really came from Razorpay — it's an HMAC of `orderId|paymentId` alone, completely
  // independent of which appointment the request claims to be paying for. Before this check,
  // nothing here confirmed the order was actually CREATED for `appointmentId`/this patient: a
  // patient owning two `pending_payment` appointments could create+pay a real, small Razorpay
  // order for a CHEAP one, then call this endpoint with that same valid order/payment/signature
  // but `appointmentId` set to an EXPENSIVE one — the signature would still validate, and
  // createPaymentForAppointment would unconditionally flip the expensive appointment to
  // `upcoming` the moment any payment landed on it. `createOrder` above stamps
  // {appointmentId, patientUserId} into the order's `notes` at creation time specifically so this
  // can be checked back against Razorpay's own record of the order, not anything the frontend
  // sends.
  if (notes.appointmentId !== appointmentId || notes.patientUserId !== requester.id) {
    throw new ApiError(
      400,
      'PAYMENT_APPOINTMENT_MISMATCH',
      'This payment does not match the selected appointment. No charge has been recorded against it.'
    );
  }

  // Reuses the receptionist/admin cash-recording path's exact fee-copy/row-lock/already-paid
  // guards — 'online' mode, Razorpay's payment id as the transaction reference.
  const row = await paymentsService.createPaymentForAppointment(
    appointmentId,
    requester,
    'online',
    razorpayPaymentId,
    null, // payerUpiId — not applicable to this gateway flow (see payments.service.js's new param)
    chargedAmount
  );

  await activityLogService.log({
    actorUserId: requester.id,
    actorRole: requester.role,
    actionType: 'payment.create',
    targetEntityType: 'payment',
    targetEntityId: row.id,
    description: `Recorded online payment of Rs.${row.amount} via Razorpay, receipt ${row.receiptNumber}`,
  });

  await paymentsService.invalidatePaymentListCaches({
    patientUserId: row.patientUserId,
    doctorUserId: row.doctorUserId,
    clinicId: row.clinicId,
  });
  // Lazy require to avoid a load cycle, matching payments.service.js#createPayment's own pattern.
  const appointmentsService = require('../appointments/appointments.service');
  await appointmentsService.invalidateAppointmentListCaches({
    patientUserId: row.patientUserId,
    doctorUserId: row.doctorUserId,
    clinicId: row.clinicId,
  });
  // A payment-before-token booking's queue token may have just flipped on_hold -> waiting —
  // bust the live queue-list cache so it appears for staff immediately (same reason
  // appointments.service.js#runBookingJob busts it on every new booking).
  const queueService = require('../queue/queue.service');
  await queueService.invalidateQueueListCaches({ doctorUserId: row.doctorUserId, clinicId: row.clinicId });

  // Return BOTH the payment and the freshly re-fetched, fully-shaped appointment — the frontend
  // needs the appointment's (possibly just-flipped) status/tokenNumber/paymentStatus to move a
  // `pending_payment` booking screen to "confirmed", not just the payment record.
  const [payment, appointment] = await Promise.all([
    paymentsService.getPaymentById(row.id, requester),
    appointmentsService.getAppointmentById(appointmentId, requester),
  ]);
  return { payment, appointment };
}

module.exports = { createOrder, verifyAndRecordPayment };
