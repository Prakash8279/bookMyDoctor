/**
 * Business logic for the payments module.
 * Responsibility: THIS is where ownership checks, business rules (fee computation, payment
 * amount masking by role, receipt numbering, the double-submit concurrency guard), and all
 * Prisma/DB calls for this module live. Controllers call these functions; these functions never
 * touch req/res directly.
 *
 * Two create paths:
 *  A) appointmentId given — settling an already-booked appointment. Every fee field is copied
 *     verbatim from the appointment row (never recomputed) — that's the figure the patient was
 *     actually quoted at booking time; recomputing here would risk drifting from it.
 *  B) appointmentId absent — cash collected with no prior booking (legitimate per
 *     DATABASE_SCHEMA.md §7: payments.appointment_id is nullable for exactly this case). Fees are
 *     computed server-side using the same formula as appointments.service.js#runBookingJob.
 *
 * Every payment created here is `status: 'paid'` immediately — no pending/gateway-initiated
 * flow exists in the current product (confirmed by the data-model report); "record a payment"
 * means logging money already received. Refund/void is out of scope for this phase.
 */
const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');
const redis = require('../../config/redis');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const notificationsService = require('../notifications/notifications.service');
const idGenerators = require('../../utils/idGenerators');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { ADMIN_ROLES, STAFF_ROLES } = require('../../utils/roles');
const { loadCommissionPercentIfAdmin } = require('../../services/commissionLookupService');
const { computeMinBookingRemainder, resolvePaymentRowFeeSplit } = require('../../utils/minBookingAmount');

const LIST_CACHE_TTL_SECONDS = 60;

// Dedupe window for createStandalonePayment's idempotency guard (see
// guardStandalonePaymentIdempotency below) — long enough to catch a double-click or an
// immediate client retry, short enough that a receptionist genuinely re-collecting the exact
// same fee from the exact same patient/doctor a minute later isn't blocked.
const STANDALONE_PAYMENT_IDEMPOTENCY_TTL_MS = 10000;

/**
 * Builds the listPayments cache key. Output is role-masked (fees) AND ownership-scoped (rows),
 * so the key MUST encode role + owning scope — receptionist is keyed by clinicId (like
 * appointments.service.js's listAppointments) so a write on that clinic can be busted precisely.
 */
function buildListCacheKey(filters, requester, receptionistClinicId) {
  const { page, pageSize, status, mode, dateFrom, dateTo, appointmentId, patientId, doctorId, clinicId } = filters;
  const scope =
    requester.role === 'patient'
      ? `patient:${requester.id}`
      : requester.role === 'doctor'
      ? `doctor:${requester.id}`
      : requester.role === 'receptionist'
      ? `receptionist:${receptionistClinicId || 'none'}`
      : 'admin';
  return `cache:payments:list:${scope}:${status || ''}:${mode || ''}:${dateFrom || ''}:${dateTo || ''}:${
    appointmentId || ''
  }:${patientId || ''}:${doctorId || ''}:${clinicId || ''}:${page || ''}:${pageSize || ''}`;
}

/**
 * Busts every cached listPayments page that could contain a payment touching the given
 * patient/doctor/clinic. Exported for cross-module use is not currently needed (payments.service
 * is the only writer of the payments table), but createPaymentForAppointment also flips
 * appointment.paymentStatus, so its caller here additionally busts the matching
 * appointments-list cache scopes (see createPayment).
 */
async function invalidatePaymentListCaches({ patientUserId, doctorUserId, clinicId }) {
  const patterns = [];
  if (patientUserId) patterns.push(`cache:payments:list:patient:${patientUserId}:*`);
  if (doctorUserId) patterns.push(`cache:payments:list:doctor:${doctorUserId}:*`);
  if (clinicId) patterns.push(`cache:payments:list:receptionist:${clinicId}:*`);
  patterns.push(`cache:payments:list:admin:*`);
  await Promise.all(patterns.map((p) => cacheService.invalidate(p)));
}

const PAYMENT_SELECT = {
  id: true,
  receiptNumber: true,
  appointmentId: true,
  patientUserId: true,
  doctorUserId: true,
  clinicId: true,
  consultationFee: true,
  convenienceFee: true,
  emergencyFee: true,
  gstAmount: true,
  amount: true,
  mode: true,
  transactionRef: true,
  payerUpiId: true,
  status: true,
  createdAt: true,
  appointment: { select: { id: true } },
  patient: { select: { id: true, name: true } },
  // doctorProfile.minBookingAdvanceAmount added (EXACT PAYMENT-ROW-BREAKDOWN FIX — see
  // shapePaymentFees's own header comment) — needed to tell which of the three real payment
  // shapes (full / online minimum advance / clinic-collected remainder) a row is, so its fee
  // breakdown can be resolved exactly instead of trusting the verbatim-copied columns.
  doctor: { select: { id: true, name: true, doctorProfile: { select: { minBookingAdvanceAmount: true } } } },
  // address/phone added (COMPLETENESS FIX — proper receipt/slip generation needs the clinic's
  // address on the printed document; previously only id/name were selected here).
  clinic: { select: { id: true, name: true, address: true, phone: true } },
};

/**
 * Payment-amount masking by role (mandatory rule 8), mirroring
 * appointments.service.js#shapeFees:
 *  - doctor/receptionist: consultationFee only — every other money field OMITTED from the
 *    response object entirely (not nulled).
 *  - patient (their own payment): full fee breakdown, no commission/clinicPayout (platform-
 *    internal figures, not the patient's concern).
 *  - admin/superadmin: full breakdown PLUS commission/clinicPayout, derived on read (not stored
 *    columns) from consultationFee x commissionPercent%. `commissionPercent` is fetched once per
 *    list/get call by the caller — see loadCommissionPercentIfAdmin below.
 *
 * EXACT PAYMENT-ROW-BREAKDOWN FIX (user request: "receptionest and doctor admin ye sab me ye
 * payment thik kro payment system sahi ho" — see
 * utils/minBookingAmount.js#resolvePaymentRowFeeSplit's own header comment for the full
 * rationale): every branch below now reads THIS row's real fee split — exact for the three real
 * payment shapes (full / online minimum advance / clinic-collected remainder) — instead of the
 * appointment's full breakdown copied verbatim onto every row. Previously this double-counted
 * the doctor's consultation fee for STAFF_ROLES (doctorRevenue/bookingTotal/cashTotal on the
 * frontend all sum this per row) and produced a fictional, ratio-scaled commission/clinicPayout
 * for ADMIN_ROLES on any appointment split across two payment rows.
 * @param {object} row - a raw Prisma payment row shaped via PAYMENT_SELECT.
 * @param {string} role
 * @param {import('@prisma/client').Prisma.Decimal|null} [commissionPercent]
 */
function shapePaymentFees(row, role, commissionPercent) {
  const split = resolvePaymentRowFeeSplit({
    consultationFee: row.consultationFee,
    convenienceFee: row.convenienceFee,
    emergencyFee: row.emergencyFee,
    gstAmount: row.gstAmount,
    minBookingAdvanceAmount: row.doctor?.doctorProfile?.minBookingAdvanceAmount ?? null,
    amount: row.amount,
  });

  if (STAFF_ROLES.includes(role)) {
    return { consultationFee: new Prisma.Decimal(split.consultationFee) };
  }

  if (ADMIN_ROLES.includes(role)) {
    let commission = null;
    let clinicPayout = null;
    if (commissionPercent != null) {
      // BUSINESS RULE CHANGE (request: "clinic ko jitna doctor decide kiya hai fee utna jayega
      // baki jo extra hai ye plateform charge me rakho") — the clinic/doctor keeps this row's
      // entire (exact, not ratio-scaled) consultation-fee share; platform commission is whatever
      // this row collected on top of it — its exact convenience/emergency/GST share.
      // `commissionPercent` is kept only as the `!= null` gate above (admin/superadmin +
      // platformCharges row exists) — it no longer drives this arithmetic. See
      // appointments.service.js#shapeFees for the identical change.
      clinicPayout = new Prisma.Decimal(split.consultationFee);
      commission = new Prisma.Decimal(
        Math.round((split.convenienceFee + split.emergencyFee + split.gstAmount) * 100) / 100
      );
    }
    return {
      consultationFee: new Prisma.Decimal(split.consultationFee),
      convenienceFee: new Prisma.Decimal(split.convenienceFee),
      emergencyFee: new Prisma.Decimal(split.emergencyFee),
      gstAmount: new Prisma.Decimal(split.gstAmount),
      amount: row.amount,
      commission,
      clinicPayout,
    };
  }

  // patient (their own payment, enforced by the visibility check upstream).
  return {
    consultationFee: new Prisma.Decimal(split.consultationFee),
    convenienceFee: new Prisma.Decimal(split.convenienceFee),
    emergencyFee: new Prisma.Decimal(split.emergencyFee),
    gstAmount: new Prisma.Decimal(split.gstAmount),
    amount: row.amount,
  };
}

function shapePayment(row, role, commissionPercent) {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    appointment: row.appointment ? { id: row.appointment.id } : null,
    patient: row.patient ? { id: row.patient.id, name: row.patient.name } : null,
    doctor: row.doctor ? { id: row.doctor.id, name: row.doctor.name } : null,
    clinic: row.clinic ? { id: row.clinic.id, name: row.clinic.name, address: row.clinic.address, phone: row.clinic.phone } : null,
    mode: row.mode,
    transactionRef: row.transactionRef,
    // Always visible top-level (like transactionRef above), never role-masked — it's a payer's
    // own reference detail, not one of the "mandatory rule 8" fee-breakdown figures.
    payerUpiId: row.payerUpiId,
    status: row.status,
    fees: shapePaymentFees(row, role, commissionPercent),
    createdAt: row.createdAt,
  };
}

// loadCommissionPercentIfAdmin now lives in services/commissionLookupService.js (was
// byte-identically duplicated here and in appointments.service.js — deduplicated 2026-09-05).

/**
 * 404 (not 403) for anyone who isn't the owning patient, the treating doctor, the receptionist
 * at the matching clinic, or admin/superadmin — same enumeration-avoidance posture as
 * appointments.service.js#getVisibleAppointmentOrThrow.
 * @param {string} id
 * @param {{id:string, role:string}} requester
 */
async function getVisiblePaymentOrThrow(id, requester) {
  const row = await prisma.payment.findUnique({ where: { id }, select: PAYMENT_SELECT });
  if (!row) {
    throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
  }

  if (ADMIN_ROLES.includes(requester.role)) return row;
  if (requester.role === 'patient' && row.patientUserId === requester.id) return row;
  if (requester.role === 'doctor' && row.doctorUserId === requester.id) return row;
  if (requester.role === 'receptionist') {
    const rp = await prisma.receptionistProfile.findUnique({
      where: { userId: requester.id },
      select: { clinicId: true },
    });
    if (rp && rp.clinicId && row.clinicId && rp.clinicId === row.clinicId) return row;
  }

  throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
}

/**
 * Path A: settling an already-booked appointment. Runs inside a Prisma transaction that opens
 * with a row-level lock (`SELECT id ... FOR UPDATE`, a plain single-row select so the locking
 * clause is valid — unlike the token-numbering MAX() case in appointments.service.js, which
 * explicitly cannot use one) to close the double-submit race of a receptionist clicking "Record
 * payment" twice on the same appointment.
 * @param {string} appointmentId
 * @param {{id:string, role:string}} requester
 * @param {'cash'|'upi'|'card'|'online'} mode
 * @param {string|null} transactionRef
 * @param {number|import('@prisma/client/runtime/library').Decimal} [amount] - the amount actually
 *   charged. Defaults to the appointment's full totalAmount (every pre-existing caller — cash/
 *   upi/card receptionist recording, and the old always-full-amount Razorpay flow — relies on
 *   this default and is unaffected). Passed explicitly only by razorpay.service.js's payment-
 *   before-token flow, which can charge either the full amount or the doctor's configured
 *   minimum advance amount; whichever was actually authorized by Razorpay (never a client-
 *   supplied figure — see razorpay.service.js#verifyAndRecordPayment).
 */
async function createPaymentForAppointment(appointmentId, requester, mode, transactionRef, payerUpiId, amount) {
  // Set inside the transaction below (closure variable — the transaction's return value is just
  // the new payment's id, but the post-transaction notification below needs to know whether THIS
  // payment was the one that just unlocked a pending_payment booking, plus the token number to
  // mention in the alert).
  let notifyContext = null;

  const paymentId = await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} FOR UPDATE`;
    if (lockRows.length === 0) {
      throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    }

    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        patientUserId: true,
        doctorUserId: true,
        clinicId: true,
        paymentStatus: true,
        tokenNumber: true,
        consultationFee: true,
        convenienceFee: true,
        emergencyFee: true,
        gstAmount: true,
        totalAmount: true,
        // doctor.doctorProfile.minBookingAdvanceAmount added (MIN-BOOKING-REMAINDER FIX) — the
        // 'partial' branch below needs it to compute the correct clinic-collected remainder
        // (consultationFee - minBookingAdvanceAmount), not totalAmount - alreadyPaid; see
        // utils/minBookingAmount.js#computeMinBookingRemainder.
        doctor: { select: { doctorProfile: { select: { minBookingAdvanceAmount: true } } } },
      },
    });

    // Authorization MUST run before any check that reveals appointment/payment state (rule:
    // no enumeration of out-of-scope appointments). A receptionist outside this appointment's
    // clinic must get the same 403 regardless of whether the appointment is already paid,
    // cancelled, or perfectly payable — checking paymentStatus/status first would let a
    // receptionist probe arbitrary appointment ids and learn their state before ever being
    // told they don't own them. Only the 404-for-nonexistent-id check above is allowed to run
    // first, since a truly nonexistent id genuinely doesn't exist for anyone. Mirrors the
    // walk-in booking scoping in appointments.service.js#runBookingJob. Admin/superadmin bypass.
    if (requester.role === 'receptionist') {
      const rp = await tx.receptionistProfile.findUnique({
        where: { userId: requester.id },
        select: { clinicId: true },
      });
      if (!rp || !rp.clinicId || rp.clinicId !== appointment.clinicId) {
        throw new ApiError(403, 'RECEPTIONIST_CLINIC_MISMATCH', 'You can only record payments for your own clinic.');
      }
    }

    // A patient reaches this function only via the Razorpay self-pay flow (razorpay.service.js) —
    // 404, not 403, on a mismatch (same enumeration-avoidance posture as everywhere else): a
    // patient probing someone else's appointment id must not learn it exists. This is a no-op for
    // the pre-existing receptionist/admin/superadmin callers (the only ones before Razorpay was
    // added), since requester.role is never 'patient' for those.
    if (requester.role === 'patient' && appointment.patientUserId !== requester.id) {
      throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    }

    if (appointment.paymentStatus === 'paid') {
      throw new ApiError(409, 'PAYMENT_ALREADY_RECORDED', 'A payment has already been recorded for this appointment.');
    }

    // REPLAY-PROTECTION FIX (multi-agent payment audit — critical): a Razorpay verify request is
    // safe to retry on the frontend (network blip, double-click, browser back-then-forward), and
    // nothing on Razorpay's side stops the SAME order/payment/signature from being POSTed to our
    // /verify endpoint twice — the HMAC check is a pure function of orderId|paymentId, so it
    // validates identically every time. Without this guard, replaying an already-recorded
    // 'minimum'-advance verify request would fall into the `paymentStatus === 'partial'` branch
    // below a second time and silently fabricate a SECOND Payment row for the remaining balance
    // (recomputed as totalAmount - alreadyPaid) with NO new real charge behind it, flipping the
    // appointment to fully 'paid' for a fraction of its real price. Guard by transactionRef (the
    // Razorpay payment id, or a receptionist's UTR/reference number) + appointmentId: if a payment
    // already exists for this exact (appointment, transactionRef) pair, this is a retried request,
    // not a new charge — return the existing row instead of creating a duplicate. `transactionRef`
    // can legitimately be null (cash payments with no reference number), so only short-circuits
    // when one was actually supplied.
    if (transactionRef) {
      const existing = await tx.payment.findFirst({
        where: { appointmentId: appointment.id, transactionRef },
        select: { id: true },
      });
      if (existing) {
        return existing.id;
      }
    }

    // Refuse to record money against a visit that never happened / was called off — otherwise a
    // cancelled or no-show appointment could be flipped to paymentStatus:'paid', a misleading
    // state with no legitimate business meaning.
    if (appointment.status === 'cancelled' || appointment.status === 'no_show') {
      throw new ApiError(
        409,
        'APPOINTMENT_NOT_PAYABLE',
        `Cannot record a payment for an appointment with status "${appointment.status}".`
      );
    }

    // Only draw a receipt number once every validation check above has passed — deferring this
    // until the last possible moment (mirroring createStandalonePayment below) means a rejected
    // attempt (404/409/403) never burns a number from the shared payment_receipt_seq sequence.
    // This matters most on exactly the double-submit scenario this row lock guards against: a
    // receptionist double-clicking "Record payment" should not skip a receipt number just
    // because the second click lost the race.
    const receiptNumber = await idGenerators.nextReceiptNumber();

    // `amount` defaults to the full fee — every pre-existing caller relies on this (see this
    // function's doc comment). A Payment row itself is always `status: 'paid'` (a recorded
    // transaction that succeeded, full stop); whether that transaction covered the FULL fee or
    // just the doctor's minimum advance amount is recorded on the *appointment* below instead.
    //
    // paymentStatus:'partial' means the patient already paid the doctor's minimum advance amount
    // online (Razorpay flow) and the REST is being collected now — almost always by a
    // receptionist recording cash/UPI/card at the clinic, which never passes an explicit `amount`
    // (see createPayment above). Blindly defaulting that call to the FULL totalAmount again would
    // double-record this appointment's revenue (already-paid advance + a second "full fee"
    // charge) and silently break the "one paid payment row per appointment" assumption the admin
    // dashboard/revenue-trend aggregates rely on. So for a 'partial' appointment, the amount to
    // charge is ALWAYS auto-computed as the doctor's remaining consultation-fee share (see the
    // MIN-BOOKING-REMAINDER FIX below — deliberately NOT totalAmount-alreadyPaid) — never trusted
    // from a caller, exactly like every other amount in this function.
    let chargedAmount;
    let alreadyPaid = new Prisma.Decimal(0);
    // Set only on the "clinic collects the doctor's remaining consultation share" path below —
    // used afterwards to force isFullPayment/newPaymentStatus without re-comparing to
    // totalAmount (see the MIN-BOOKING-REMAINDER FIX comment further down for why).
    let isClinicRemainderSettlement = false;
    if (appointment.paymentStatus === 'partial') {
      const priorPaidAgg = await tx.payment.aggregate({
        where: { appointmentId: appointment.id, status: 'paid' },
        _sum: { amount: true },
      });
      alreadyPaid = priorPaidAgg._sum.amount || new Prisma.Decimal(0);
      if (mode === 'online' && amount != null) {
        // ACCOUNTING FIX (multi-agent payment audit — critical): razorpay.service.js DOES pass an
        // explicit amount here, and it is never a client-supplied figure — it's whatever
        // Razorpay's own order API says was actually charged (see
        // razorpay.service.js#verifyAndRecordPayment). If a patient somehow ends up with two
        // outstanding Razorpay orders for the same appointment (e.g. two tabs, one for 'minimum'
        // and one for 'full') and both get verified, silently clamping the second charge down to
        // "whatever's left" throws away the real amount Razorpay captured — the difference
        // vanishes with no Payment row, no receipt, and no way to detect it from the admin
        // ledger. Recording the actual verified amount instead keeps the books accurate even in
        // that edge case (an overpayment is then visible and refundable, instead of silently
        // lost).
        chargedAmount = new Prisma.Decimal(amount);
      } else {
        // MIN-BOOKING-REMAINDER FIX (superadmin request: "309 kyu bach raha hai 300 bachna
        // chahiye") — this used to ALWAYS recompute chargedAmount as totalAmount - alreadyPaid,
        // which double-subtracts the platform charge/GST already fully settled by the online
        // minimum payment (see utils/minBookingAmount.js#computeMinBookingRemainder for the full
        // rationale). The receptionist/admin counter-payment caller never passes an explicit
        // amount, so this is the only path that reaches here.
        const remainder = computeMinBookingRemainder({
          consultationFee: appointment.consultationFee,
          minBookingAdvanceAmount: appointment.doctor?.doctorProfile?.minBookingAdvanceAmount ?? null,
        });
        // Falls back to the old totalAmount-based remainder if the doctor's minimum can't be
        // found any more (e.g. cleared from their profile after the online min-payment was made)
        // — better a defensive answer than a crash on an edge case this rare.
        chargedAmount = remainder != null ? new Prisma.Decimal(remainder) : appointment.totalAmount.minus(alreadyPaid);
        isClinicRemainderSettlement = true;
      }
      if (chargedAmount.lessThanOrEqualTo(0.01)) {
        // Rounding already covered the balance (or somehow over-covered it) — nothing left to
        // collect. Surface the same error a fully-paid appointment gets rather than recording a
        // zero/negative-amount Payment row.
        throw new ApiError(409, 'PAYMENT_ALREADY_RECORDED', 'A payment has already been recorded for this appointment.');
      }
    } else {
      chargedAmount = amount != null ? new Prisma.Decimal(amount) : appointment.totalAmount;
    }
    // MIN-BOOKING-REMAINDER FIX: once the clinic collects exactly the computed remainder above,
    // the booking is fully settled BY DESIGN even though alreadyPaid + chargedAmount can land
    // below totalAmount (the platform's convenience charge is collected online in full either
    // way, and GST only ever applies to whatever portion of the consultation fee actually went
    // through the online gateway — so nothing is left owing once this remainder is paid). Every
    // other path keeps the original totalAmount comparison: a tiny (1 paisa) tolerance absorbs
    // Decimal/paise rounding between our totalAmount and whatever Razorpay's order API echoes
    // back, computed against the CUMULATIVE amount paid so far (this charge plus whatever was
    // already paid), not this charge alone.
    const isFullPayment =
      isClinicRemainderSettlement || alreadyPaid.plus(chargedAmount).greaterThanOrEqualTo(appointment.totalAmount.minus(0.01));
    const newPaymentStatus = isFullPayment ? 'paid' : 'partial';

    // Every fee field is copied verbatim from the appointment — this is the "never trust client
    // math" rule satisfied by reusing the figure already computed server-side at booking time,
    // not by recomputing (recomputing here would risk drifting from what the patient was quoted).
    const created = await tx.payment.create({
      data: {
        receiptNumber,
        appointmentId: appointment.id,
        patientUserId: appointment.patientUserId,
        doctorUserId: appointment.doctorUserId,
        clinicId: appointment.clinicId,
        consultationFee: appointment.consultationFee,
        convenienceFee: appointment.convenienceFee,
        emergencyFee: appointment.emergencyFee,
        gstAmount: appointment.gstAmount,
        amount: chargedAmount,
        mode,
        transactionRef,
        payerUpiId,
        status: 'paid',
      },
      select: { id: true },
    });

    // Payment-before-token: EITHER payment amount (full or the doctor's minimum advance) unlocks
    // a booking that was held in `pending_payment` — flip it to `upcoming` and its queue token
    // from `on_hold` to `waiting` in the same transaction as the payment itself, so a booking is
    // never left half-confirmed if something fails partway through. A no-op for every booking
    // that was never gated in the first place (walk-ins, free consultations, or an appointment
    // already `upcoming`/`confirmed`).
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        paymentStatus: newPaymentStatus,
        paymentMethod: mode,
        ...(appointment.status === 'pending_payment' ? { status: 'upcoming' } : {}),
      },
    });
    if (appointment.status === 'pending_payment') {
      await tx.queueToken.updateMany({
        where: { appointmentId: appointment.id, status: 'on_hold' },
        data: { status: 'waiting' },
      });
    }

    notifyContext = {
      patientUserId: appointment.patientUserId,
      doctorUserId: appointment.doctorUserId,
      tokenNumber: appointment.tokenNumber,
      chargedAmount: chargedAmount.toString(),
      justConfirmedBooking: appointment.status === 'pending_payment',
    };

    return created.id;
  });

  // Real-time in-app alert — covers BOTH payment paths that reach this function: a patient's own
  // Razorpay online payment (razorpay.service.js#verifyAndRecordPayment) and a receptionist/admin
  // recording cash/UPI/card at the clinic. `justConfirmedBooking` distinguishes "this payment is
  // what unlocked a pending_payment booking" (patient + doctor both get the booking-confirmed
  // alert appointments.service.js#runBookingJob deliberately withheld for prepay-gated bookings)
  // from an ordinary/top-up payment on an already-upcoming appointment (patient gets a lighter
  // "payment received" receipt-style alert; the doctor isn't paged for routine payment admin).
  if (notifyContext) {
    if (notifyContext.justConfirmedBooking) {
      await notificationsService.notifySystemEventSafe(notifyContext.patientUserId, {
        title: 'Payment received — booking confirmed',
        body: `Payment of Rs.${notifyContext.chargedAmount} received. Your booking is confirmed, token number #${notifyContext.tokenNumber}.`,
        type: 'payment',
      });
      await notificationsService.notifySystemEventSafe(notifyContext.doctorUserId, {
        title: 'New booking confirmed',
        body: `Payment received — a new booking is confirmed, token #${notifyContext.tokenNumber}.`,
        type: 'payment',
      });
    } else {
      await notificationsService.notifySystemEventSafe(notifyContext.patientUserId, {
        title: 'Payment received',
        body: `Rs.${notifyContext.chargedAmount} was recorded against your appointment (token #${notifyContext.tokenNumber}).`,
        type: 'payment',
      });
    }
  }

  return prisma.payment.findUnique({ where: { id: paymentId }, select: PAYMENT_SELECT });
}

/**
 * createStandalonePayment guard against a double-submit / retried request creating two
 * separate Payment rows for one real cash collection. Unlike createPaymentForAppointment,
 * there's no appointment row to `SELECT ... FOR UPDATE` on here (appointmentId is null for this
 * path by definition), so there's no natural row to lock.
 *
 * lockService.js's withLock isn't a fit either: it releases its lock the instant the wrapped
 * function returns (see its `finally`), which is exactly backwards for idempotency — the first
 * (successful) request would free the key the moment it finishes, and a retried/double-clicked
 * request arriving a beat later would sail straight through and create a second Payment row for
 * the same collection. What's needed is a key that stays HELD for a short window regardless of
 * how fast the first request completes.
 *
 * So this reuses lockService's own underlying primitive — Redis `SET key val PX ttl NX` — direct
 * against the shared `redis` client (same one lockService itself uses), but deliberately never
 * releases it: the key is simply left to expire on its own TTL, turning it into a short-lived
 * idempotency marker rather than a mutex. Keyed on requester + clinic + patient + doctor +
 * amount: an identical repeat submission within the window collides on the same key and is
 * rejected as a likely duplicate, while two genuinely different walk-in payments (different
 * patient, doctor, or amount) never collide.
 * @param {{id:string, role:string}} requester
 * @param {string|null} clinicId
 * @param {string} patientUserId
 * @param {string} doctorUserId
 * @param {import('@prisma/client').Prisma.Decimal} amount
 */
async function guardStandalonePaymentIdempotency(requester, clinicId, patientUserId, doctorUserId, amount) {
  const key = `lock:payment:standalone:${requester.id}:${clinicId || 'none'}:${patientUserId}:${doctorUserId}:${amount.toFixed(
    2
  )}`;
  const acquired = await redis.set(key, '1', 'PX', STANDALONE_PAYMENT_IDEMPOTENCY_TTL_MS, 'NX');
  if (acquired !== 'OK') {
    throw new ApiError(
      409,
      'DUPLICATE_PAYMENT_SUBMISSION',
      'An identical payment was just submitted. Please wait a moment before retrying.'
    );
  }
}

/**
 * Path B: cash collected with no prior booking. patientUserId/doctorUserId are already
 * confirmed present by payments.validation.js's cross-field check; here they're verified to
 * resolve to real, active records.
 * @param {object} body
 * @param {{id:string, role:string}} requester
 * @param {'cash'|'upi'|'card'|'online'} mode
 * @param {string|null} transactionRef
 * @param {string|null} payerUpiId
 */
async function createStandalonePayment(body, requester, mode, transactionRef, payerUpiId) {
  // Patient, doctor, and platform-charges lookups are all independent of one another (none
  // depends on another's result) — fetch concurrently instead of three round-trips in series.
  // Error-precedence is preserved below: patient is still validated before doctor, and
  // platformCharges before the fee computation, exactly as when each was fetched inline.
  const [patient, doctor, platformCharges] = await Promise.all([
    prisma.user.findUnique({
      where: { id: body.patientUserId },
      select: { id: true, role: true, status: true },
    }),
    prisma.user.findUnique({
      where: { id: body.doctorUserId },
      select: {
        id: true,
        status: true,
        doctorProfile: { select: { status: true, consultationFee: true, emergencyAvailable: true } },
      },
    }),
    prisma.platformCharges.findUnique({ where: { id: 1 } }),
  ]);
  if (!patient || patient.role !== 'patient' || patient.status !== 'active') {
    throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
  }

  if (!doctor || doctor.status !== 'active' || !doctor.doctorProfile || doctor.doctorProfile.status !== 'verified') {
    throw new ApiError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
  }

  // Receptionist: clinicId is FORCED from their own profile (ignore any client-sent value) and
  // the doctor must actually be linked to that clinic. Admin/superadmin may pass any clinicId
  // (validated to exist) or omit it entirely.
  let clinicId = null;
  // Only meaningful when a clinic is actually in play (clinicId gets set below) — a standalone
  // payment with no clinic at all only gates emergency eligibility on the doctor's own flag,
  // matching there being no clinic-level emergency policy to consult.
  let clinicEmergencyAvailable = true;
  if (requester.role === 'receptionist') {
    const rp = await prisma.receptionistProfile.findUnique({
      where: { userId: requester.id },
      select: { clinicId: true },
    });
    if (!rp || !rp.clinicId) {
      throw new ApiError(400, 'RECEPTIONIST_NOT_ASSIGNED', 'You are not assigned to a clinic.');
    }
    clinicId = rp.clinicId;

    const link = await prisma.doctorClinic.findUnique({
      where: { doctorUserId_clinicId: { doctorUserId: doctor.id, clinicId } },
      select: { doctorUserId: true },
    });
    if (!link) {
      throw new ApiError(400, 'DOCTOR_NOT_AT_CLINIC', 'This doctor is not linked to your clinic.');
    }

    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { emergencyAvailable: true } });
    clinicEmergencyAvailable = Boolean(clinic && clinic.emergencyAvailable);
  } else if (body.clinicId) {
    const clinic = await prisma.clinic.findUnique({
      where: { id: body.clinicId },
      select: { id: true, emergencyAvailable: true },
    });
    if (!clinic) {
      throw new ApiError(404, 'CLINIC_NOT_FOUND', 'Clinic not found.');
    }
    clinicId = clinic.id;
    clinicEmergencyAvailable = Boolean(clinic.emergencyAvailable);
  }

  if (!platformCharges) {
    throw new ApiError(500, 'PLATFORM_CHARGES_NOT_CONFIGURED', 'Platform charges are not configured.');
  }

  // Fee computation (server-side, ALWAYS — rule 7), reusing the exact formula already
  // implemented in appointments.service.js#runBookingJob.
  const isEmergency = body.isEmergency === true;

  // Mirrors appointments.service.js#runBookingJob's explicit emergency-eligibility gate — a
  // receptionist/admin cannot add emergencyFee for a doctor who doesn't offer emergency
  // consultations, or (when a clinic is in play) a clinic not marked emergency-capable.
  if (isEmergency && (!doctor.doctorProfile.emergencyAvailable || !clinicEmergencyAvailable)) {
    throw new ApiError(400, 'EMERGENCY_NOT_AVAILABLE', 'Emergency booking is not available for this doctor/clinic.');
  }

  const consultationFee = doctor.doctorProfile.consultationFee;
  // MUTUAL-EXCLUSIVITY FIX (superadmin request, mirrors appointments.service.js#runBookingJob):
  // the platform charge and the emergency charge never stack — an emergency booking pays the
  // emergency surcharge INSTEAD OF the platform charge, not both.
  const convenienceFee = !isEmergency && platformCharges.applyConvenienceFee
    ? platformCharges.patientConvenienceFee
    : new Prisma.Decimal(0);
  const emergencyFee =
    isEmergency && platformCharges.applyEmergencyFee ? platformCharges.emergencyFee : new Prisma.Decimal(0);
  const subtotal = consultationFee.plus(convenienceFee).plus(emergencyFee);
  // GST FIX (superadmin request, mirrors appointments.service.js#runBookingJob): this function
  // records a payment a receptionist/admin typed in for money collected in person at the clinic
  // counter (cash/card/UPI) — it never goes through the website's Razorpay gateway, even when
  // `mode` happens to be 'online', so GST never applies here.
  const gstAmount = new Prisma.Decimal(0);
  const amount = subtotal.plus(gstAmount).toDecimalPlaces(2);

  // Double-submit / retry guard (see guardStandalonePaymentIdempotency) — must run after the
  // amount is known (it's part of the dedupe key) and before the receipt number is drawn, so a
  // rejected duplicate never burns a number from the shared payment_receipt_seq sequence.
  await guardStandalonePaymentIdempotency(requester, clinicId, patient.id, doctor.id, amount);

  const receiptNumber = await idGenerators.nextReceiptNumber();

  const created = await prisma.payment.create({
    data: {
      receiptNumber,
      appointmentId: null,
      patientUserId: patient.id,
      doctorUserId: doctor.id,
      clinicId,
      consultationFee,
      convenienceFee,
      emergencyFee,
      gstAmount,
      amount,
      mode,
      transactionRef,
      payerUpiId,
      status: 'paid',
    },
    select: { id: true },
  });

  return prisma.payment.findUnique({ where: { id: created.id }, select: PAYMENT_SELECT });
}

/**
 * @param {object} body - already shape-validated by payments.validation.js#createPayment.
 * @param {{id:string, role:string}} requester - always receptionist/admin/superadmin (route-enforced).
 */
async function createPayment(body, requester) {
  const mode = body.mode;
  const transactionRef = body.transactionRef ? String(body.transactionRef).trim() : null;
  const payerUpiId = body.payerUpiId ? String(body.payerUpiId).trim() : null;

  const row = body.appointmentId
    ? await createPaymentForAppointment(body.appointmentId, requester, mode, transactionRef, payerUpiId)
    : await createStandalonePayment(body, requester, mode, transactionRef, payerUpiId);

  // No raw card/UPI numbers are ever logged, only the transaction reference id if present.
  await activityLogService.log({
    actorUserId: requester.id,
    actorRole: requester.role,
    actionType: 'payment.create',
    targetEntityType: 'payment',
    targetEntityId: row.id,
    description: `Recorded payment of Rs.${row.amount} via ${mode}, receipt ${row.receiptNumber}`,
  });

  await invalidatePaymentListCaches({
    patientUserId: row.patientUserId,
    doctorUserId: row.doctorUserId,
    clinicId: row.clinicId,
  });
  if (body.appointmentId) {
    // createPaymentForAppointment also flipped appointment.paymentStatus — bust the matching
    // appointments-list cache scopes (cross-module, lazy require to avoid a load cycle since
    // appointments.service.js itself requires queue.service.js, not payments.service.js).
    const appointmentsService = require('../appointments/appointments.service');
    await appointmentsService.invalidateAppointmentListCaches({
      patientUserId: row.patientUserId,
      doctorUserId: row.doctorUserId,
      clinicId: row.clinicId,
    });
  }

  const commissionPercent = await loadCommissionPercentIfAdmin(requester.role);
  return shapePayment(row, requester.role, commissionPercent);
}

/**
 * @param {object} query
 * @param {{id:string, role:string}} requester
 */
async function listPayments(
  { page, pageSize, status, mode, dateFrom, dateTo, appointmentId, patientId, doctorId, clinicId },
  requester
) {
  let receptionistClinicId = null;
  if (requester.role === 'receptionist') {
    const rp = await prisma.receptionistProfile.findUnique({
      where: { userId: requester.id },
      select: { clinicId: true },
    });
    receptionistClinicId = rp ? rp.clinicId : null;
  }

  const cacheKey = buildListCacheKey(
    { page, pageSize, status, mode, dateFrom, dateTo, appointmentId, patientId, doctorId, clinicId },
    requester,
    receptionistClinicId
  );

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {};
    if (status) where.status = status;
    if (mode) where.mode = mode;
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
      };
    }

    // Forced role scoping (never client-controlled, rule 3) overrides/ignores any
    // appointmentId/patientId/doctorId/clinicId query params for every role except admin/superadmin.
    if (requester.role === 'patient') {
      where.patientUserId = requester.id;
    } else if (requester.role === 'doctor') {
      where.doctorUserId = requester.id;
    } else if (requester.role === 'receptionist') {
      if (!receptionistClinicId) {
        return { rows: [], pagination: buildPaginationMeta({ page: p, pageSize: ps, total: 0 }) };
      }
      where.clinicId = receptionistClinicId;
    } else if (ADMIN_ROLES.includes(requester.role)) {
      if (appointmentId) where.appointmentId = appointmentId;
      if (patientId) where.patientUserId = patientId;
      if (doctorId) where.doctorUserId = doctorId;
      if (clinicId) where.clinicId = clinicId;
    }

    // The commission lookup doesn't depend on the payment query below (or vice versa) — run all
    // three concurrently instead of paying for the commission round-trip before even starting
    // the payment fetch.
    const [commissionPercent, rows, total] = await Promise.all([
      loadCommissionPercentIfAdmin(requester.role),
      prisma.payment.findMany({
        where,
        select: PAYMENT_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      rows: rows.map((row) => shapePayment(row, requester.role, commissionPercent)),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

/**
 * @param {string} id
 * @param {{id:string, role:string}} requester
 */
async function getPaymentById(id, requester) {
  // Independent lookups (commission only needs requester.role, not the fetched row) — run
  // concurrently rather than paying for both round-trips back to back.
  const [row, commissionPercent] = await Promise.all([
    getVisiblePaymentOrThrow(id, requester),
    loadCommissionPercentIfAdmin(requester.role),
  ]);
  return shapePayment(row, requester.role, commissionPercent);
}

module.exports = {
  createPayment,
  listPayments,
  getPaymentById,
  invalidatePaymentListCaches,
  // Exported for razorpay.service.js — the patient self-pay flow reuses this exact
  // fee-copy/row-lock/status-guard path instead of duplicating it, passing mode:'online' and the
  // Razorpay payment id as transactionRef.
  createPaymentForAppointment,
};
