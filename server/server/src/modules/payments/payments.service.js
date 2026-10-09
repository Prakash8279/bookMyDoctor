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
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const notificationsService = require('../notifications/notifications.service');
const idGenerators = require('../../utils/idGenerators');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { ADMIN_ROLES, STAFF_ROLES } = require('../../utils/roles');
const { loadCommissionPercentIfAdmin } = require('../../services/commissionLookupService');
const { computeMinBookingRemainder, resolvePaymentRowFeeSplit } = require('../../utils/minBookingAmount');
const paymentHoldService = require('./paymentHold.service');

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
 *
 * status/mode/dateFrom/dateTo/appointmentId/patientId/doctorId/clinicId admin list-filters
 * removed (backend-cleanup audit) — see listPayments's own comment.
 */
function buildListCacheKey(filters, requester, receptionistClinicId) {
  const { page, pageSize } = filters;
  const scope =
    requester.role === 'patient'
      ? `patient:${requester.id}`
      : requester.role === 'doctor'
      ? `doctor:${requester.id}`
      : requester.role === 'receptionist'
      ? `receptionist:${receptionistClinicId || 'none'}`
      : 'admin';
  return `cache:payments:list:${scope}:${page || ''}:${pageSize || ''}`;
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
  let autoRefundContext = null;

  const result = await prisma.$transaction(
    async (tx) => {
      const lockRows = await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId} FOR UPDATE`;
      if (lockRows.length === 0) {
        throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
      }

      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true,
          status: true,
          source: true,
          appointmentDate: true,
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
          doctor: { select: { doctorProfile: { select: { minBookingAdvanceAmount: true, maxOnlineBookingsPerDay: true } } } },
        },
      });

      // ATOMIC CONCURRENCY GUARD: Acquire per-doctor-day advisory lock to ensure daily capacity cap
      // is enforced strictly atomically under high-concurrency verify requests.
      if (appointment.appointmentDate && appointment.doctorUserId) {
        const dateStr =
          appointment.appointmentDate instanceof Date
            ? appointment.appointmentDate.toISOString().slice(0, 10)
            : String(appointment.appointmentDate).slice(0, 10);
        const lockKey = `doctor-day:${appointment.doctorUserId}:${dateStr}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      }

      // Authorization MUST run before any check that reveals appointment/payment state
      if (requester.role === 'receptionist') {
        const rp = await tx.receptionistProfile.findUnique({
          where: { userId: requester.id },
          select: { clinicId: true },
        });
        if (!rp || !rp.clinicId || rp.clinicId !== appointment.clinicId) {
          throw new ApiError(403, 'RECEPTIONIST_CLINIC_MISMATCH', 'You can only record payments for your own clinic.');
        }
      }

      if (requester.role === 'patient' && appointment.patientUserId !== requester.id) {
        throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
      }

      if (appointment.paymentStatus === 'paid') {
        throw new ApiError(409, 'PAYMENT_ALREADY_RECORDED', 'A payment has already been recorded for this appointment.');
      }

      // REPLAY-PROTECTION: if a payment already exists for this exact (appointment, transactionRef) pair,
      // return the existing row instead of creating a duplicate.
      if (transactionRef) {
        const existing = await tx.payment.findFirst({
          where: { appointmentId: appointment.id, transactionRef },
          select: { id: true },
        });
        if (existing) {
          return { id: existing.id, isReplay: true };
        }
      }

      // ── AUTHORITATIVE CONFIRMATION & CAPACITY CHECK ──────────────────────────
      // When an online payment is captured by Razorpay, we MUST verify whether the booking can actually
      // be confirmed:
      // 1. Is appointment status cancelled / no_show (e.g. hold expired while patient was on payment page)?
      // 2. Has the doctor's daily online capacity been exhausted by other concurrent bookings?
      let cannotConfirmBooking = false;
      let cannotConfirmReason = null;

      if (appointment.status === 'cancelled' || appointment.status === 'no_show') {
        cannotConfirmBooking = true;
        cannotConfirmReason = `Appointment status is already "${appointment.status}".`;
      } else if (appointment.status === 'pending_payment' && appointment.source === 'online') {
        // Check if there is an active valid payment hold for this appointment
        const hold = await tx.paymentHold.findFirst({
          where: { appointmentId: appointment.id },
          orderBy: { createdAt: 'desc' },
        });

        const now = new Date();
        const hasValidHold = hold && hold.status === 'PENDING' && hold.holdExpiresAt > now;

        const maxLimit = appointment.doctor?.doctorProfile?.maxOnlineBookingsPerDay;
        if (maxLimit != null) {
          const activeConfirmedCount = await tx.appointment.count({
            where: {
              doctorUserId: appointment.doctorUserId,
              appointmentDate: appointment.appointmentDate,
              source: 'online',
              status: { in: ['upcoming', 'confirmed', 'completed'] },
              id: { not: appointment.id },
            },
          });

          if (hasValidHold) {
            // Patient holds a valid reservation! Booking confirmed without double counting.
            cannotConfirmBooking = false;
          } else if (activeConfirmedCount >= maxLimit) {
            // Hold expired or missing, and capacity is already full!
            cannotConfirmBooking = true;
            cannotConfirmReason = `Payment hold expired and doctor daily online capacity (${maxLimit}) is already full.`;
          }
        }
      }

      // If booking CANNOT be confirmed:
      if (cannotConfirmBooking) {
        // If receptionist is trying to record offline payment on a cancelled booking, reject normally
        if (mode !== 'online' || !transactionRef) {
          throw new ApiError(
            409,
            'APPOINTMENT_NOT_PAYABLE',
            `Cannot record a payment for an appointment with status "${appointment.status}". ${cannotConfirmReason || ''}`
          );
        }

        // CRITICAL FINTECH BUSINESS REQUIREMENT:
        // Razorpay payment was CAPTURED, but booking cannot be confirmed!
        // NO SUCCESSFUL PAYMENT MAY EVER DISAPPEAR.
        // 1. Maintain complete Payment record in DB.
        // 2. Mark appointment status = 'cancelled', paymentStatus = 'refunded'.
        // 3. Create persistent Refund record (status: 'pending').
        // 4. Return context to execute Razorpay refund immediately after commit.
        const receiptNumber = await idGenerators.nextReceiptNumber(tx);
        const chargedAmount = amount != null ? new Prisma.Decimal(amount) : appointment.totalAmount;

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
            status: 'paid', // Recorded as paid transaction
          },
          select: { id: true },
        });

        await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            status: 'cancelled',
            paymentStatus: 'refunded',
            paymentMethod: mode,
          },
        });

        await tx.queueToken.deleteMany({
          where: { appointmentId: appointment.id },
        });

        await paymentHoldService.markHoldRefundedTx(tx, appointment.id);

        const idempotencyKey = `refund:appt:${appointment.id}`;
        const refund = await tx.refund.upsert({
          where: { idempotencyKey },
          create: {
            appointmentId: appointment.id,
            paymentId: created.id,
            amount: chargedAmount,
            razorpayPaymentId: transactionRef,
            status: 'pending',
            idempotencyKey,
            failureReason: cannotConfirmReason,
          },
          update: {},
        });

        autoRefundContext = {
          paymentId: created.id,
          refundId: refund.id,
          chargedAmount: chargedAmount.toString(),
          appointmentId: appointment.id,
          patientUserId: appointment.patientUserId,
          doctorUserId: appointment.doctorUserId,
          transactionRef,
          cannotConfirmReason,
        };

        return { id: created.id, autoRefunded: true };
      }

      // Normal booking confirmation path:
      // Pass transactional client `tx` to idGenerators so it uses the same DB connection!
      const receiptNumber = await idGenerators.nextReceiptNumber(tx);

      let chargedAmount;
      let alreadyPaid = new Prisma.Decimal(0);
      let isClinicRemainderSettlement = false;
      if (appointment.paymentStatus === 'partial') {
        const priorPaidAgg = await tx.payment.aggregate({
          where: { appointmentId: appointment.id, status: 'paid' },
          _sum: { amount: true },
        });
        alreadyPaid = priorPaidAgg._sum.amount || new Prisma.Decimal(0);
        if (mode === 'online' && amount != null) {
          chargedAmount = new Prisma.Decimal(amount);
        } else {
          const remainder = computeMinBookingRemainder({
            consultationFee: appointment.consultationFee,
            minBookingAdvanceAmount: appointment.doctor?.doctorProfile?.minBookingAdvanceAmount ?? null,
          });
          chargedAmount = remainder != null ? new Prisma.Decimal(remainder) : appointment.totalAmount.minus(alreadyPaid);
          isClinicRemainderSettlement = true;
        }
        if (chargedAmount.lessThanOrEqualTo(0.01)) {
          throw new ApiError(409, 'PAYMENT_ALREADY_RECORDED', 'A payment has already been recorded for this appointment.');
        }
      } else {
        chargedAmount = amount != null ? new Prisma.Decimal(amount) : appointment.totalAmount;
      }

      const isFullPayment =
        isClinicRemainderSettlement || alreadyPaid.plus(chargedAmount).greaterThanOrEqualTo(appointment.totalAmount.minus(0.01));
      const newPaymentStatus = isFullPayment ? 'paid' : 'partial';

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
        await paymentHoldService.confirmHoldTx(tx, appointment.id, transactionRef);
      }

      notifyContext = {
        patientUserId: appointment.patientUserId,
        doctorUserId: appointment.doctorUserId,
        tokenNumber: appointment.tokenNumber,
        chargedAmount: chargedAmount.toString(),
        justConfirmedBooking: appointment.status === 'pending_payment',
      };

      return { id: created.id, autoRefunded: false };
    },
    {
      timeout: env.booking.txTimeoutMs ? Math.max(env.booking.txTimeoutMs, 25000) : 25000,
      maxWait: env.booking.txMaxWaitMs ? Math.max(env.booking.txMaxWaitMs, 25000) : 25000,
    }
  );

  if (result.isReplay) {
    return prisma.payment.findUnique({ where: { id: result.id }, select: PAYMENT_SELECT });
  }

  // Handle AUTO-REFUND if booking could not be confirmed
  if (result.autoRefunded && autoRefundContext) {
    try {
      const razorpayService = require('./razorpay.service');
      await razorpayService.processRefund({
        refundId: autoRefundContext.refundId,
        paymentId: autoRefundContext.transactionRef,
        amount: autoRefundContext.chargedAmount,
        appointmentId: autoRefundContext.appointmentId,
        reason: autoRefundContext.cannotConfirmReason,
      });
    } catch (refundErr) {
      logger.error(`[auto-refund] Error executing refund for payment ${autoRefundContext.paymentId}: ${refundErr.message}`);
    }

    if (autoRefundContext.patientUserId) {
      await notificationsService.notifySystemEventSafe(autoRefundContext.patientUserId, {
        title: 'Payment received — refund initiated',
        body: `Payment of Rs.${autoRefundContext.chargedAmount} received, but booking could not be confirmed (${autoRefundContext.cannotConfirmReason}). A refund has been automatically initiated.`,
        type: 'payment',
      });
    }

    const finalPayment = await prisma.payment.findUnique({ where: { id: result.id }, select: PAYMENT_SELECT });
    return Object.assign(finalPayment, {
      autoRefunded: true,
      refundId: autoRefundContext.refundId,
      cannotConfirmReason: autoRefundContext.cannotConfirmReason,
    });
  }

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

  return prisma.payment.findUnique({ where: { id: result.id }, select: PAYMENT_SELECT });
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
 * status/mode/dateFrom/dateTo/appointmentId/patientId/doctorId/clinicId admin list-filters
 * removed (backend-cleanup audit — user request: "website frontend me nahi hai but backend bna
 * hua hai to backend se hata do"): the admin/receptionist payments pages never wired up filter
 * inputs for any of these. Every non-admin role's FORCED scoping (patientUserId/doctorUserId/
 * clinicId, never client-controlled) is untouched — admin/superadmin now simply always get the
 * full unfiltered set, same as before when no filter query params were passed.
 * @param {object} query
 * @param {{id:string, role:string}} requester
 */
async function listPayments({ page, pageSize }, requester) {
  let receptionistClinicId = null;
  if (requester.role === 'receptionist') {
    const rp = await prisma.receptionistProfile.findUnique({
      where: { userId: requester.id },
      select: { clinicId: true },
    });
    receptionistClinicId = rp ? rp.clinicId : null;
  }

  const cacheKey = buildListCacheKey({ page, pageSize }, requester, receptionistClinicId);

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {};

    // Forced role scoping (never client-controlled, rule 3) for every role except admin/superadmin.
    if (requester.role === 'patient') {
      where.patientUserId = requester.id;
    } else if (requester.role === 'doctor') {
      where.doctorUserId = requester.id;
    } else if (requester.role === 'receptionist') {
      if (!receptionistClinicId) {
        return { rows: [], pagination: buildPaginationMeta({ page: p, pageSize: ps, total: 0 }) };
      }
      where.clinicId = receptionistClinicId;
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
 * The HTTP route this originally backed, GET /payments/:id, had zero web/mobile callers and was
 * removed (backend-cleanup audit — user request: "website frontend me nahi hai but backend bna
 * hua hai to backend se hata do"). This function itself stays — razorpay.service.js's
 * verifyAndRecordPayment calls getPaymentById below internally, as part of the actively-used
 * patient "Pay now" verification flow.
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

/**
 * Admin Payment Reconciliation Report
 * Identifies:
 * - Payment successful + booking confirmed (BOOKED_AND_PAID)
 * - Payment successful + refund pending (REFUND_PENDING)
 * - Payment successful + refunded (REFUNDED)
 * - Payment successful + refund failed (REFUND_FAILED)
 * - Payment pending (PAYMENT_PENDING)
 * - Unreconciled payments (UNRECONCILED)
 *
 * Filters: doctorId, date, patientId, paymentId, orderId, appointmentId, status, refundStatus
 */
async function getPaymentReconciliationReport({
  doctorId,
  date,
  patientId,
  paymentId,
  orderId,
  appointmentId,
  status,
  refundStatus,
  page = 1,
  pageSize = 50,
} = {}) {
  const where = {};
  if (doctorId) where.doctorUserId = doctorId;
  if (patientId) where.patientUserId = patientId;
  if (paymentId) where.id = paymentId;
  if (appointmentId) where.appointmentId = appointmentId;
  if (orderId) where.transactionRef = { contains: orderId };
  if (status) where.status = status;
  if (date) {
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);
    where.OR = [
      { appointment: { appointmentDate: startOfDay } },
      { createdAt: { gte: startOfDay, lte: endOfDay } },
    ];
  }

  const [totalCount, rows, allPayments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: {
        appointment: {
          select: {
            id: true,
            appointmentDate: true,
            appointmentTime: true,
            tokenNumber: true,
            status: true,
            paymentStatus: true,
            paymentHolds: {
              select: { status: true, holdExpiresAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        patient: { select: { id: true, name: true, phone: true } },
        doctor: { select: { id: true, name: true } },
        refunds: {
          select: {
            id: true,
            amount: true,
            razorpayPaymentId: true,
            razorpayRefundId: true,
            status: true,
            failureReason: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
    prisma.payment.findMany({
      where,
      select: {
        status: true,
        amount: true,
        appointment: {
          select: {
            status: true,
            paymentStatus: true,
            paymentHolds: {
              select: { status: true, holdExpiresAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        refunds: { select: { status: true } },
      },
    }),
  ]);

  let bookedAndPaidCount = 0;
  let refundPendingCount = 0;
  let refundedCount = 0;
  let refundFailedCount = 0;
  let unreconciledCount = 0;
  let holdActiveCount = 0;
  let holdExpiredCount = 0;
  let totalRevenue = new Prisma.Decimal(0);

  for (const p of allPayments) {
    totalRevenue = totalRevenue.plus(p.amount);
    const latestRefund = p.refunds && p.refunds[0];
    const latestHold = p.appointment?.paymentHolds && p.appointment.paymentHolds[0];

    if (
      p.status === 'paid' &&
      p.appointment &&
      (p.appointment.status === 'upcoming' || p.appointment.status === 'confirmed' || p.appointment.status === 'completed')
    ) {
      bookedAndPaidCount++;
    } else if (p.status === 'refunded' || latestRefund?.status === 'processed') {
      refundedCount++;
    } else if (latestRefund?.status === 'pending') {
      refundPendingCount++;
    } else if (latestRefund?.status === 'failed') {
      refundFailedCount++;
    } else if (p.status === 'pending') {
      if (latestHold && latestHold.status === 'PENDING' && new Date(latestHold.holdExpiresAt) > new Date()) {
        holdActiveCount++;
      } else if (latestHold && (latestHold.status === 'EXPIRED' || new Date(latestHold.holdExpiresAt) <= new Date())) {
        holdExpiredCount++;
      }
    } else if (p.status === 'paid' && (!p.appointment || p.appointment.status === 'cancelled')) {
      unreconciledCount++;
    }
  }

  const items = rows.map((p) => {
    let reconciliationCategory = 'UNRECONCILED';
    const latestRefund = p.refunds && p.refunds[0];
    const latestHold = p.appointment?.paymentHolds && p.appointment.paymentHolds[0];

    if (p.status === 'paid' && p.appointment && ['upcoming', 'confirmed', 'completed'].includes(p.appointment.status)) {
      reconciliationCategory = 'BOOKED_AND_PAID';
    } else if (p.status === 'refunded' || latestRefund?.status === 'processed') {
      reconciliationCategory = 'REFUNDED';
    } else if (latestRefund?.status === 'pending') {
      reconciliationCategory = 'REFUND_PENDING';
    } else if (latestRefund?.status === 'failed') {
      reconciliationCategory = 'REFUND_FAILED';
    } else if (p.status === 'pending') {
      if (latestHold && latestHold.status === 'PENDING' && new Date(latestHold.holdExpiresAt) > new Date()) {
        reconciliationCategory = 'HOLD_ACTIVE';
      } else if (latestHold && (latestHold.status === 'EXPIRED' || new Date(latestHold.holdExpiresAt) <= new Date())) {
        reconciliationCategory = 'HOLD_EXPIRED';
      } else {
        reconciliationCategory = 'PAYMENT_PENDING';
      }
    }

    return {
      id: p.id,
      receiptNumber: p.receiptNumber,
      transactionRef: p.transactionRef,
      mode: p.mode,
      amount: p.amount,
      paymentStatus: p.status,
      appointmentId: p.appointmentId,
      bookingStatus: p.appointment?.status || 'NO_APPOINTMENT',
      appointmentPaymentStatus: p.appointment?.paymentStatus || null,
      tokenNumber: p.appointment?.tokenNumber || null,
      appointmentDate: p.appointment?.appointmentDate || null,
      patient: p.patient,
      doctor: p.doctor,
      refunds: p.refunds,
      reconciliationCategory,
      createdAt: p.createdAt,
    };
  });

  const filteredItems = refundStatus
    ? items.filter((item) => {
        if (refundStatus === 'none') return !item.refunds || item.refunds.length === 0;
        return item.refunds?.some((r) => r.status === refundStatus);
      })
    : items;

  return {
    kpi: {
      totalPayments: totalCount,
      totalAmount: totalRevenue.toString(),
      bookedAndPaidCount,
      refundPendingCount,
      refundedCount,
      refundFailedCount,
      unreconciledCount,
      holdActiveCount,
      holdExpiredCount,
    },
    items: filteredItems,
    pagination: {
      page: Number(page),
      pageSize: Number(pageSize),
      total: totalCount,
      totalPages: Math.ceil(totalCount / Number(pageSize)),
    },
  };
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
  getPaymentReconciliationReport,
};
