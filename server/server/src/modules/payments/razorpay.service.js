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
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const paymentsService = require('./payments.service');
const { computeMinBookingAmount } = require('../../utils/minBookingAmount');
const { withLock, LockAcquisitionError } = require('../../services/lockService');
const paymentHoldService = require('./paymentHold.service');

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
  return {
    amountRupees: payload.amount / 100,
    amount: payload.amount,
    currency: payload.currency || 'INR',
    status: payload.status || null,
    notes: (payload.notes && typeof payload.notes === 'object') ? payload.notes : {},
  };
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
    // consultationFee/convenienceFee/emergencyFee/gstAmount added (MIN-BOOKING-AMOUNT FIX) —
    // createOrder's 'minimum' branch now needs this whole fee breakdown to compute the correct
    // minimum-booking charge instead of the doctor's raw minBookingAdvanceAmount; see
    // utils/minBookingAmount.js.
    select: {
      id: true,
      patientUserId: true,
      doctorUserId: true,
      status: true,
      paymentStatus: true,
      totalAmount: true,
      source: true,
      appointmentDate: true,
      consultationFee: true,
      convenienceFee: true,
      emergencyFee: true,
      gstAmount: true,
    },
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
  // NO-DOUBLE-CHARGE LOCK FIX (senior-dev payment audit, "payment sahi nahi hua hai"): everything
  // below this point only checks the appointment's CURRENT paymentStatus via a plain (non-locking)
  // read — paymentStatus only ever flips away from unpaid once a payment is later VERIFIED, not
  // when an order is merely created. Without a lock here, two concurrent createOrder calls for the
  // same appointment (a double-click, two open tabs, a slow-network retry) could both pass that
  // check and each get back a genuine, separately-payable Razorpay order. If the patient completed
  // payment on both, Razorpay would capture the money TWICE — our own DB-side idempotency
  // (payments.service.js's row lock + transactionRef replay guard) only stops a SECOND charge from
  // being recorded a second time in our database; it can't stop the gateway from already having
  // taken it. Serializing order creation per appointment closes that window: the second concurrent
  // caller waits for the first to finish (by which point, if the first succeeds and the patient
  // pays, a fresh order-creation check nothing has been fixed here yet — this only prevents the two
  // *concurrent* orders from being created in the first place).
  try {
    return await withLock(
      `razorpay-order:${appointmentId}`,
      () => createOrderLocked(appointmentId, requester, paymentOption),
      { ttlMs: 10000, waitTimeoutMs: 5000, retryDelayMs: 150 }
    );
  } catch (err) {
    if (err instanceof LockAcquisitionError) {
      throw new ApiError(
        409,
        'PAYMENT_ORDER_IN_PROGRESS',
        'A payment for this appointment is already being started. Please wait a moment and try again.'
      );
    }
    throw err;
  }
}

async function createOrderLocked(appointmentId, requester, paymentOption) {
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

  // ATOMIC PAYMENT HOLD & CAPACITY RESERVATION
  // Under PostgreSQL advisory lock for (doctorUserId, appointmentDate):
  // 1. Lock doctor + appointment_date.
  // 2. Remove/release expired payment holds for that doctor/date.
  // 3. Count confirmed active bookings.
  // 4. Count active pending payment holds.
  // 5. Calculate effective occupancy (confirmed + active holds).
  // 6. If capacity is full: reject request. DO NOT create Razorpay order.
  // 7. If capacity is available: create temporary payment hold.
  let holdResult = null;
  if (appointment.source === 'online') {
    holdResult = await prisma.$transaction(async (tx) => {
      return paymentHoldService.createOrRefreshHoldTx(tx, {
        appointment,
        patientUserId: appointment.patientUserId,
      });
    });
  }

  if (holdResult && holdResult.reusedExistingOrder) {
    const existingOrder = await fetchOrderDetails(holdResult.hold.razorpayOrderId);
    if (
      existingOrder.notes.appointmentId !== appointment.id ||
      existingOrder.notes.patientUserId !== appointment.patientUserId
    ) {
      throw new ApiError(502, 'PAYMENT_ORDER_MISMATCH', 'The active payment order could not be safely reused. Please contact support.');
    }
    if (existingOrder.notes.paymentOption && existingOrder.notes.paymentOption !== paymentOption) {
      throw new ApiError(
        409,
        'PAYMENT_ORDER_ACTIVE',
        `A ${existingOrder.notes.paymentOption} payment is already in progress for this appointment. Please complete it or wait for it to expire.`
      );
    }
    return {
      orderId: holdResult.hold.razorpayOrderId,
      amount: existingOrder.amount,
      currency: existingOrder.currency,
      keyId: env.razorpay.keyId,
      appointmentId: appointment.id,
      holdId: holdResult.hold.id,
      holdExpiresAt: holdResult.hold.holdExpiresAt.toISOString(),
      holdDurationSeconds: holdResult.durationSeconds,
      reused: true,
    };
  }

  let amountToCharge = appointment.totalAmount;
  if (paymentOption === 'minimum') {
    // MIN-BOOKING-AMOUNT FIX (superadmin request) — this used to charge the doctor's raw
    // minBookingAdvanceAmount verbatim, meaning the platform collected ZERO cut whenever a
    // patient chose the "pay minimum now" option. Now derives the same minBookingAmount figure
    // shown to the patient on the pending_payment screen (appointments.service.js#shapeFees), via
    // the shared utils/minBookingAmount.js formula, so what's shown and what's charged can never
    // drift apart again.
    const doctorProfile = await prisma.doctorProfile.findUnique({
      where: { userId: appointment.doctorUserId },
      select: { minBookingAdvanceAmount: true },
    });
    const minBookingAmount = doctorProfile
      ? computeMinBookingAmount({
          consultationFee: appointment.consultationFee,
          convenienceFee: appointment.convenienceFee,
          emergencyFee: appointment.emergencyFee,
          gstAmount: appointment.gstAmount,
          minBookingAdvanceAmount: doctorProfile.minBookingAdvanceAmount,
        })
      : null;
    if (minBookingAmount == null) {
      if (holdResult && holdResult.hold) {
        await paymentHoldService.cancelHold(holdResult.hold.id, 'MIN_BOOKING_AMOUNT_NOT_SET');
      }
      throw new ApiError(
        400,
        'MIN_BOOKING_AMOUNT_NOT_SET',
        'This doctor has not set a minimum booking amount. Please pay the full amount instead.'
      );
    }
    amountToCharge = minBookingAmount;
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
    if (holdResult && holdResult.hold) {
      await paymentHoldService.cancelHold(holdResult.hold.id, 'GATEWAY_NETWORK_ERROR');
    }
    throw new ApiError(502, 'PAYMENT_GATEWAY_UNREACHABLE', 'Could not reach the payment gateway. Please try again.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.id) {
    if (holdResult && holdResult.hold) {
      await paymentHoldService.cancelHold(holdResult.hold.id, 'GATEWAY_ERROR');
    }
    throw new ApiError(
      502,
      'PAYMENT_GATEWAY_ERROR',
      (payload && payload.error && payload.error.description) || 'The payment gateway rejected the request.'
    );
  }

  // Attach Razorpay order ID to hold record
  if (holdResult && holdResult.hold) {
    await paymentHoldService.attachRazorpayOrderToHold(holdResult.hold.id, payload.id);
  }

  return {
    orderId: payload.id,
    amount: payload.amount,
    currency: payload.currency,
    keyId: env.razorpay.keyId,
    appointmentId: appointment.id,
    holdId: holdResult && holdResult.hold ? holdResult.hold.id : null,
    holdExpiresAt: holdResult && holdResult.hold ? holdResult.hold.holdExpiresAt.toISOString() : null,
    holdDurationSeconds: holdResult ? holdResult.durationSeconds : env.paymentHoldDurationSeconds,
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
  // guards — 'online' mode, Razorpay's payment id as the transaction reference — via the shared
  // recordOnlinePayment helper below (also used by the webhook reconciliation path, so both ways
  // a payment can land in our system go through the exact same recording/cache-busting logic).
  const row = await recordOnlinePayment(appointmentId, requester, razorpayPaymentId, chargedAmount, razorpayOrderId);

  // Lazy require to avoid a load cycle, matching payments.service.js#createPayment's own pattern.
  const appointmentsService = require('../appointments/appointments.service');

  // Return BOTH the payment and the freshly re-fetched, fully-shaped appointment — the frontend
  // needs the appointment's (possibly just-flipped) status/tokenNumber/paymentStatus to move a
  // `pending_payment` booking screen to "confirmed", not just the payment record.
  //
  // POST-COMMIT REFETCH FIX (senior-dev payment audit, "payment sahi nahi hua hai"): the payment
  // itself is ALREADY correctly recorded by this point — createPaymentForAppointment's own
  // transaction committed above. A failure in just these two read-backs (a transient DB hiccup, a
  // brief connection-pool exhaustion) used to bubble up as whatever raw error Prisma threw,
  // surfacing to the frontend as a generic failure that looks exactly like "your payment did not
  // go through" even though it did. Wrapping this in its own try/catch with a distinct, honest
  // ApiError means the frontend's own recovery path (PatientPages.jsx's payNow/resumePayment
  // already re-checks the appointment's real status on ANY verify failure before showing an
  // error — see hooks/useRazorpayPayment.js) gets a chance to show the true "already paid" state
  // instead of a false "payment failed".
  let payment;
  let appointment;
  try {
    [payment, appointment] = await Promise.all([
      paymentsService.getPaymentById(row.id, requester),
      appointmentsService.getAppointmentById(appointmentId, requester),
    ]);
  } catch (refetchErr) {
    throw new ApiError(
      502,
      'PAYMENT_RECORDED_REFETCH_FAILED',
      'Your payment was recorded, but we could not load the latest booking details. Please refresh.'
    );
  }

  if (row.autoRefunded) {
    const refund = prisma.refund
      ? await prisma.refund.findFirst({
          where: { paymentId: row.id },
        })
      : null;

    return {
      payment,
      appointment,
      refund: refund || null,
      status: refund?.status === 'processed' ? 'REFUNDED' : 'REFUND_PENDING',
      bookingConfirmed: false,
      message: refund?.status === 'processed'
        ? `Payment received, but booking could not be confirmed (${row.cannotConfirmReason || 'capacity full'}). Payment has been refunded.`
        : `Payment received, but booking could not be confirmed (${row.cannotConfirmReason || 'capacity full'}). Refund has been initiated.`,
    };
  }

  return { payment, appointment };
}

/**
 * Shared by verifyAndRecordPayment (the patient's own browser calling back after Checkout) AND
 * reconcilePendingPaymentsFromWebhook below (Razorpay calling us directly): records the actual
 * Payment row via payments.service.js#createPaymentForAppointment (fee-copy/row-lock/already-paid
 * guards), then busts every list cache the new payment affects and writes one activity-log entry.
 * Deliberately idempotent from the CALLER's point of view because createPaymentForAppointment
 * itself already is: it looks up any existing Payment row by (appointmentId, transactionRef)
 * first and returns that instead of creating a duplicate (see its REPLAY-PROTECTION FIX comment).
 * That is exactly what makes it safe for the SAME real payment to be recorded via this function
 * twice — once from the patient's own verify call and once from the webhook, in either order.
 * @param {string} appointmentId
 * @param {{id:string, role:string}} requester
 * @param {string} razorpayPaymentId
 * @param {number} chargedAmount
 * @param {string|null} razorpayOrderId
 */
async function recordOnlinePayment(appointmentId, requester, razorpayPaymentId, chargedAmount, razorpayOrderId = null) {
  const row = await paymentsService.createPaymentForAppointment(
    appointmentId,
    requester,
    'online',
    razorpayPaymentId,
    null, // payerUpiId — not applicable to this gateway flow (see payments.service.js's new param)
    chargedAmount,
    razorpayOrderId
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

  return row;
}

/**
 * RECONCILIATION FIX (production-readiness plan, Phase 2.3): closes the gap where a patient's
 * Razorpay Checkout payment genuinely succeeds, but the frontend never gets to call
 * POST /payments/razorpay/verify — the browser tab is closed, the network drops right after
 * payment, the app crashes — leaving the appointment permanently stuck at `pending_payment` even
 * though Razorpay actually captured the money. Razorpay's own webhook is the fix: it calls THIS
 * server directly, independent of whether the patient's browser ever comes back, whenever a
 * payment on our account is captured.
 *
 * Security model is deliberately DIFFERENT from verifyAndRecordPayment's, because there is no
 * logged-in `requester` here — Razorpay is calling us, not a patient's browser:
 *   - The signature is Razorpay's WEBHOOK signature (HMAC-SHA256 of the raw request body, using a
 *     separate RAZORPAY_WEBHOOK_SECRET configured in the Razorpay dashboard's webhook settings —
 *     never the same value as RAZORPAY_KEY_SECRET) sent in the `X-Razorpay-Signature` header, NOT
 *     the order_id|payment_id signature verifyAndRecordPayment checks.
 *   - Ownership is established by re-fetching the order from Razorpay's own API (fetchOrderDetails)
 *     and trusting only the {appointmentId, patientUserId} notes createOrder stamped onto it at
 *     creation time — never anything from the webhook payload's own free-text fields.
 * app.js registers `express.raw({type:'application/json'})` for this exact route BEFORE the
 * global express.json() body parser, so `rawBody` here is the untouched Buffer Razorpay signed —
 * verifying against a re-serialized/re-parsed body would silently invalidate every signature.
 * @param {Buffer} rawBody
 * @param {string} signatureHeader - the X-Razorpay-Signature request header, verbatim
 * @returns {Promise<{handled:boolean, reason?:string}>} never throws for a merely-irrelevant or
 *   already-settled event — those are legitimate outcomes a webhook must still 200 for (Razorpay
 *   retries with exponential backoff, then disables the webhook, on repeated non-2xx responses).
 *   Throws only for a bad signature (the controller maps that to 400) or a real, unexpected
 *   failure while recording the payment.
 */
async function reconcilePendingPaymentsFromWebhook(rawBody, signatureHeader) {
  if (!env.razorpay.webhookSecret) {
    // Not configured yet — a webhook call arriving anyway (e.g. someone pasted the URL into the
    // Razorpay dashboard before setting the secret here) must not be trusted with no secret to
    // check it against. Same "the app boots fine without it, but the feature is inert" posture as
    // assertGatewayConfigured() above for the key id/secret.
    throw new ApiError(500, 'PAYMENT_WEBHOOK_NOT_CONFIGURED', 'Razorpay webhook is not configured on this server.');
  }

  const expectedSignature = crypto.createHmac('sha256', env.razorpay.webhookSecret).update(rawBody).digest('hex');
  const providedBuffer = Buffer.from(String(signatureHeader || ''), 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const isValid = providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  if (!isValid) {
    throw new ApiError(400, 'PAYMENT_WEBHOOK_SIGNATURE_INVALID', 'Webhook signature verification failed.');
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (parseErr) {
    throw new ApiError(400, 'PAYMENT_WEBHOOK_MALFORMED', 'Webhook body was not valid JSON.');
  }

  // Handle refund events (refund.processed / refund.failed / refund.created)
  if (event.event === 'refund.processed' || event.event === 'refund.failed' || event.event === 'refund.created') {
    return await handleRefundWebhookEvent(event);
  }

  // Only `payment.captured` actually means "money has landed" — every other Razorpay webhook
  // event (order.paid, payment.failed, payment.authorized, ...) is either redundant
  // with this one or not something this reconciliation job needs to act on. Acknowledging with
  // handled:false (not an error) is deliberate: an unrecognized-but-legitimate event must still
  // get a 2xx back so Razorpay does not retry it forever.
  const paymentEntity = event && event.payload && event.payload.payment && event.payload.payment.entity;
  if (event.event !== 'payment.captured' || !paymentEntity || !paymentEntity.order_id || !paymentEntity.id) {
    return { handled: false, reason: 'ignored_event_type' };
  }

  const razorpayOrderId = paymentEntity.order_id;
  const razorpayPaymentId = paymentEntity.id;

  const { amountRupees: chargedAmount, notes } = await fetchOrderDetails(razorpayOrderId);
  if (!notes || !notes.appointmentId || !notes.patientUserId) {
    // An order this Razorpay account captured a payment for, but that was never created by
    // createOrder above (e.g. a manual test payment made directly in the Razorpay dashboard) —
    // nothing in our system to reconcile it against.
    return { handled: false, reason: 'order_not_ours' };
  }

  // Synthetic 'patient' requester built from Razorpay's OWN record of who createOrder made this
  // order for (notes.patientUserId) — never anything the webhook payload itself claims — so
  // recordOnlinePayment's normal patient-ownership check (getOwnAppointmentOrThrow is not called
  // here, but createPaymentForAppointment's own `requester.role === 'patient'` ownership check
  // inside its transaction is) still applies exactly as it does for the patient's own verify call.
  const requester = { id: notes.patientUserId, role: 'patient' };

  try {
    const row = await recordOnlinePayment(notes.appointmentId, requester, razorpayPaymentId, chargedAmount, razorpayOrderId);
    return row && row.autoRefunded ? { handled: true, autoRefunded: true, paymentId: row.id } : { handled: true };
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 409) {
      // 409 PAYMENT_ALREADY_RECORDED: the patient's own verify call already recorded this exact
      // payment (or a replay of this same webhook event, which Razorpay can send more than once)
      return { handled: false, reason: err.code || 'already_settled_or_missing' };
    }
    if (err instanceof ApiError && err.statusCode === 404) {
      // 404 APPOINTMENT_NOT_FOUND: The payment succeeded on Razorpay, but no appointment exists locally.
      // Orphan payment detected — automatically initiate refund on Razorpay so funds are not lost!
      logger.warn(`[webhook-reconciliation] Orphan captured payment ${razorpayPaymentId} for missing appt ${notes.appointmentId}. Initiating direct refund.`);
      try {
        await processDirectRefund({
          paymentId: razorpayPaymentId,
          amount: chargedAmount,
          reason: 'Orphan payment — booking does not exist',
        });
        return { handled: true, orphanRefunded: true };
      } catch (orphanErr) {
        logger.error(`[webhook-reconciliation] Failed to refund orphan payment ${razorpayPaymentId}: ${orphanErr.message}`);
        return { handled: false, reason: 'orphan_refund_failed' };
      }
    }
    // Any other failure (a genuine DB error, an unexpected Prisma exception) is a REAL problem —
    // rethrow so the controller returns a 5xx and Razorpay's normal retry-with-backoff behavior
    // gets a chance to succeed once whatever broke recovers, instead of us silently swallowing it.
    throw err;
  }
}

/**
 * Webhook handler specifically for refund.processed, refund.failed, and refund.created events.
 */
async function handleRefundWebhookEvent(event) {
  const refundEntity = event && event.payload && event.payload.refund && event.payload.refund.entity;
  if (!refundEntity || !refundEntity.id) {
    return { handled: false, reason: 'missing_refund_entity' };
  }

  const razorpayRefundId = refundEntity.id;
  const razorpayPaymentId = refundEntity.payment_id;
  const refundNotes = refundEntity.notes || {};

  // Find corresponding refund record in database
  let refund = await prisma.refund.findFirst({
    where: {
      OR: [
        { razorpayRefundId },
        ...(refundNotes.refundId ? [{ id: refundNotes.refundId }] : []),
        ...(refundNotes.appointmentId ? [{ appointmentId: refundNotes.appointmentId }] : []),
        { razorpayPaymentId },
      ],
    },
  });

  if (!refund) {
    return { handled: false, reason: 'refund_not_ours' };
  }

  if (event.event === 'refund.created') {
    if (refund.status === 'processed') {
      return { handled: true, alreadyProcessed: true };
    }
    await prisma.refund.update({
      where: { id: refund.id },
      data: {
        razorpayRefundId,
        status: refund.status === 'processed' ? 'processed' : 'pending',
        updatedAt: new Date(),
      },
    });
    return { handled: true, event: 'refund.created' };
  }

  if (event.event === 'refund.processed') {
    if (refund.status === 'processed') {
      // Idempotent webhook retry handling: return 200 without duplicate DB write
      return { handled: true, alreadyProcessed: true };
    }

    await finalizeProcessedRefund(refund, razorpayRefundId);

    await activityLogService.log({
      actionType: 'payment.refund_processed',
      targetEntityType: 'refund',
      targetEntityId: refund.id,
      description: `Refund ${refund.id} confirmed processed by webhook (Razorpay refund ${razorpayRefundId})`,
    });

    return { handled: true, event: 'refund.processed' };
  }

  if (event.event === 'refund.failed') {
    await prisma.refund.update({
      where: { id: refund.id },
      data: {
        razorpayRefundId,
        status: 'failed',
        failureReason: refundEntity.error_description || 'Refund failed at gateway',
        updatedAt: new Date(),
      },
    });

    await activityLogService.log({
      actionType: 'payment.refund_failed',
      targetEntityType: 'refund',
      targetEntityId: refund.id,
      description: `Refund ${refund.id} failed at gateway: ${refundEntity.error_description || 'unknown'}`,
    });

    return { handled: true, event: 'refund.failed' };
  }

  return { handled: false, reason: 'unhandled_refund_event' };
}

const RAZORPAY_REFUNDS_URL = 'https://api.razorpay.com/v1/payments';
const REFUND_PROCESSING_LEASE_MS = 5 * 60 * 1000;

async function markRefundFailed(refundId, failureReason) {
  await prisma.refund.update({
    where: { id: refundId },
    data: { status: 'failed', failureReason, updatedAt: new Date() },
  });
}

async function finalizeProcessedRefund(refund, razorpayRefundId) {
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refund.id },
      data: { razorpayRefundId, status: 'processed', failureReason: null, updatedAt: new Date() },
    });
    await tx.payment.updateMany({
      where: { id: refund.paymentId },
      data: { status: 'refunded' },
    });

    // A duplicate late payment must not flip the valid original payment/appointment to refunded.
    const remainingPaidPayments = await tx.payment.count({
      where: { appointmentId: refund.appointmentId, status: 'paid', id: { not: refund.paymentId } },
    });
    if (remainingPaidPayments === 0) {
      await tx.appointment.update({
        where: { id: refund.appointmentId },
        data: { paymentStatus: 'refunded' },
      });
    }
    await paymentHoldService.markHoldRefundedTx(tx, refund.appointmentId);
  });
}

async function saveGatewayRefundState(refund, gatewayRefund) {
  const gatewayStatus = gatewayRefund.status === 'processed' ? 'processed' : 'pending';
  if (gatewayStatus === 'processed') {
    await finalizeProcessedRefund(refund, gatewayRefund.id);
  } else {
    await prisma.refund.update({
      where: { id: refund.id },
      data: { razorpayRefundId: gatewayRefund.id, status: 'pending', failureReason: null, updatedAt: new Date() },
    });
  }
  return { success: true, status: gatewayStatus, razorpayRefundId: gatewayRefund.id };
}

async function findExistingGatewayRefund(paymentId, refundId) {
  let response;
  try {
    response = await fetch(`${RAZORPAY_REFUNDS_URL}/${encodeURIComponent(paymentId)}/refunds?count=100`, {
      headers: { Authorization: razorpayAuthHeader() },
    });
  } catch (_err) {
    throw new ApiError(502, 'REFUND_RECONCILIATION_UNAVAILABLE', 'Could not safely reconcile the prior refund attempt.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !Array.isArray(payload.items)) {
    throw new ApiError(502, 'REFUND_RECONCILIATION_UNAVAILABLE', 'Could not safely reconcile the prior refund attempt.');
  }
  return payload.items.find((item) => item && item.notes && item.notes.refundId === refundId) || null;
}

async function claimRefundExecution(refundRecord) {
  if (refundRecord.status === 'processed') {
    return { claimed: false, result: { success: true, status: 'processed', razorpayRefundId: refundRecord.razorpayRefundId, alreadyProcessed: true } };
  }
  if (refundRecord.status === 'pending' && refundRecord.razorpayRefundId) {
    return { claimed: false, result: { success: true, status: 'pending', razorpayRefundId: refundRecord.razorpayRefundId, inProgress: true } };
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - REFUND_PROCESSING_LEASE_MS);
  const claim = await prisma.refund.updateMany({
    where: {
      id: refundRecord.id,
      OR: [
        { status: 'pending', razorpayRefundId: null },
        { status: 'failed' },
        { status: 'processing', updatedAt: { lte: staleBefore } },
      ],
    },
    data: { status: 'processing', failureReason: null, updatedAt: now },
  });
  if (claim.count === 1) {
    return { claimed: true, needsReconciliation: refundRecord.status !== 'pending' };
  }

  const latest = await prisma.refund.findUnique({ where: { id: refundRecord.id } });
  if (latest && latest.status === 'processed') {
    return { claimed: false, result: { success: true, status: 'processed', razorpayRefundId: latest.razorpayRefundId, alreadyProcessed: true } };
  }
  return { claimed: false, result: { success: true, status: latest?.status || 'processing', razorpayRefundId: latest?.razorpayRefundId || null, inProgress: true } };
}

/**
 * Initiates an online refund with Razorpay.
 * Follows strict safety:
 * - Test / sandbox mode support: does not trigger real money loss
 * - Database state transitions: 'pending' -> 'processed' | 'failed'
 * - DB 'refunded' marker applied ONLY when refund is confirmed successful!
 */
async function processRefund({ refundId, paymentId, amount, appointmentId, reason = 'Appointment cancelled' }) {
  const refundRecord = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refundRecord) {
    throw new ApiError(404, 'REFUND_NOT_FOUND', 'Refund record not found.');
  }

  const claim = await claimRefundExecution(refundRecord);
  if (!claim.claimed) {
    return claim.result;
  }

  // Sandbox / mock mode check:
  // If paymentId is a mock test id, or test environment with simulated payments
  const isMockPayment = !paymentId || paymentId.startsWith('mock_') || paymentId.startsWith('pay_mock_');
  const isGatewayMissing = !env.razorpay.keyId || !env.razorpay.keySecret;

  if (isMockPayment || (isGatewayMissing && process.env.NODE_ENV === 'test')) {
    const mockRefundId = 'rfnd_mock_' + crypto.randomBytes(8).toString('hex');
    return saveGatewayRefundState(refundRecord, { id: mockRefundId, status: 'processed' });
  }

  if (isGatewayMissing) {
    await markRefundFailed(refundId, 'PAYMENT_GATEWAY_NOT_CONFIGURED: Online payments/refunds not configured on this server.');
    return { success: false, status: 'failed', error: 'Payment gateway not configured' };
  }

  const amountPaise = Math.round(Number(amount) * 100);

  try {
    // A retry after a network failure or an abandoned worker lease first adopts a matching gateway
    // refund (by our immutable refundId note) instead of issuing money a second time.
    if (claim.needsReconciliation) {
      const existingGatewayRefund = await findExistingGatewayRefund(paymentId, refundId);
      if (existingGatewayRefund) {
        return saveGatewayRefundState(refundRecord, existingGatewayRefund);
      }
    }

    const response = await fetch(`${RAZORPAY_REFUNDS_URL}/${encodeURIComponent(paymentId)}/refund`, {
      method: 'POST',
      headers: {
        Authorization: razorpayAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        notes: {
          appointmentId,
          refundId,
          reason,
        },
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload || !payload.id) {
      const errorMsg = (payload && payload.error && payload.error.description) || `Gateway returned HTTP ${response.status}`;
      await markRefundFailed(refundId, errorMsg);
      return { success: false, status: 'failed', error: errorMsg };
    }

    return saveGatewayRefundState(refundRecord, payload);
  } catch (netErr) {
    await markRefundFailed(refundId, `Network error: ${netErr.message}`);
    return { success: false, status: 'failed', error: netErr.message };
  }
}

/**
 * List refunds with optional pagination and filters (Admin / Superadmin only).
 */
async function listRefunds({ page = 1, pageSize = 20, status, appointmentId } = {}) {
  const where = {};
  if (status) where.status = status;
  if (appointmentId) where.appointmentId = appointmentId;

  const total = await prisma.refund.count({ where });
  const refunds = await prisma.refund.findMany({
    where,
    include: {
      appointment: {
        select: {
          id: true,
          appointmentDate: true,
          appointmentTime: true,
          status: true,
          patient: { select: { id: true, name: true, phone: true } },
          doctor: { select: { id: true, name: true } },
        },
      },
      payment: {
        select: {
          id: true,
          receiptNumber: true,
          amount: true,
          mode: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip: (Number(page) - 1) * Number(pageSize),
    take: Number(pageSize),
  });

  return {
    refunds,
    pagination: {
      page: Number(page),
      pageSize: Number(pageSize),
      total,
      totalPages: Math.ceil(total / Number(pageSize)),
    },
  };
}

/**
 * Allows admin to retry a failed or pending refund.
 */
async function retryRefund(refundId, actor) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund) {
    throw new ApiError(404, 'REFUND_NOT_FOUND', 'Refund not found.');
  }
  if (refund.status === 'processed') {
    throw new ApiError(400, 'REFUND_ALREADY_PROCESSED', 'This refund has already been processed.');
  }

  const result = await processRefund({
    refundId: refund.id,
    paymentId: refund.razorpayPaymentId,
    amount: refund.amount,
    appointmentId: refund.appointmentId,
    reason: 'Admin refund retry',
  });

  if (actor) {
    await activityLogService.log({
      actorUserId: actor.id,
      actorRole: actor.role,
      actionType: 'payment.refund_retry',
      targetEntityType: 'refund',
      targetEntityId: refund.id,
      description: `Admin retried refund ${refund.id} (result: ${result.status})`,
    });
  }

  return result;
}

/**
 * Direct refund helper for orphan payments or cases where no local refund record exists yet.
 */
async function processDirectRefund({ paymentId, amount, reason = 'Direct/Orphan refund' }) {
  if (!env.razorpay.keyId || !env.razorpay.keySecret) {
    return { success: false, reason: 'gateway_not_configured' };
  }
  const isMockPayment = !paymentId || paymentId.startsWith('mock_') || paymentId.startsWith('pay_mock_');
  if (isMockPayment || process.env.NODE_ENV === 'test') {
    return { success: true, razorpayRefundId: 'rfnd_direct_' + crypto.randomBytes(8).toString('hex') };
  }
  const amountPaise = Math.round(Number(amount) * 100);
  const response = await fetch(`${RAZORPAY_REFUNDS_URL}/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: {
      Authorization: razorpayAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      notes: { reason },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.id) {
    throw new Error((payload && payload.error && payload.error.description) || `HTTP ${response.status}`);
  }
  return { success: true, razorpayRefundId: payload.id };
}

module.exports = {
  createOrder,
  verifyAndRecordPayment,
  reconcilePendingPaymentsFromWebhook,
  handleRefundWebhookEvent,
  processRefund,
  processDirectRefund,
  listRefunds,
  retryRefund,
};
