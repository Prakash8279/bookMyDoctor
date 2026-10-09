/**
 * Payment Hold & Slot Reservation Service
 * 
 * Implements authoritative temporary slot reservations for Razorpay checkout sessions.
 * 
 * Capacity Model:
 *   effective_occupied = confirmed_bookings + active_payment_holds
 *   available_capacity = maxDailyOnlineAppointments - effective_occupied
 * 
 * Guarantees:
 * 1. Atomically locks doctor + date tuple with pg_advisory_xact_lock.
 * 2. Lazily cleans expired holds before computing effective occupancy.
 * 3. Never opens Razorpay order if effective_occupied >= daily_capacity.
 * 4. Temporary holds have backend-authoritative expiration (hold_expires_at).
 * 5. Safely releases/cancels hold if Razorpay order creation fails.
 * 6. Converts hold to CONFIRMED on successful payment verification.
 * 7. Structured audit logging without logging sensitive credentials or payment secrets.
 */
const prisma = require('../../config/db');
const env = require('../../config/env');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

/**
 * Format a Date object to YYYY-MM-DD
 */
function toDateStr(date) {
  if (!date) return '';
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return String(date).slice(0, 10);
}

/**
 * Lazy cleanup of expired holds for a specific doctor + appointmentDate.
 * Runs inside the caller's transaction under the doctor+date advisory lock.
 */
async function cleanExpiredHoldsTx(tx, doctorUserId, appointmentDate) {
  if (!tx?.paymentHold?.updateMany) {
    return 0;
  }
  const now = new Date();
  const dateObj = appointmentDate instanceof Date ? appointmentDate : new Date(appointmentDate);
  const result = await tx.paymentHold.updateMany({
    where: {
      doctorUserId,
      appointmentDate: dateObj,
      status: 'PENDING',
      holdExpiresAt: { lte: now },
    },
    data: {
      status: 'EXPIRED',
      updatedAt: now,
    },
  });
  if (result.count > 0) {
    logger.info(`[payment-hold] PAYMENT_HOLD_EXPIRED: cleaned ${result.count} expired hold(s) for doctor ${doctorUserId} on ${toDateStr(appointmentDate)}`);
  }
  return result.count;
}

/**
 * Global background cleanup of all expired holds across all doctors.
 * Idempotent, concurrency-safe.
 */
async function cleanupAllExpiredHolds() {
  if (!prisma?.paymentHold?.updateMany) {
    return 0;
  }
  try {
    const now = new Date();
    const result = await prisma.paymentHold.updateMany({
      where: {
        status: 'PENDING',
        holdExpiresAt: { lte: now },
      },
      data: {
        status: 'EXPIRED',
        updatedAt: now,
      },
    });
    if (result.count > 0) {
      logger.info(`[payment-hold] PAYMENT_HOLD_EXPIRED: periodic background cleanup marked ${result.count} hold(s) as EXPIRED`);
    }
    return result.count;
  } catch (err) {
    logger.error(`[payment-hold] Error during periodic background cleanup: ${err.message}`, { stack: err.stack });
    return 0;
  }
}

/**
 * Calculates current doctor occupancy for an appointment date:
 * - confirmed_bookings: active online appointments with status in (upcoming, confirmed, completed)
 * - active_payment_holds: holds with status = 'PENDING' and hold_expires_at > NOW()
 * 
 * @param {object} tx Prisma transactional client
 * @param {string} doctorUserId
 * @param {Date} appointmentDate
 * @param {string} [excludeAppointmentId] Exclude the appointment currently requesting order
 */
async function getEffectiveOccupancyTx(tx, doctorUserId, appointmentDate, excludeAppointmentId = null) {
  const confirmedCount = tx?.appointment?.count ? await tx.appointment.count({
    where: {
      doctorUserId,
      appointmentDate,
      source: 'online',
      status: { in: ['upcoming', 'confirmed', 'completed'] },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
  }) : 0;

  const now = new Date();
  let activeHoldsCount = 0;
  if (tx?.paymentHold?.count) {
    activeHoldsCount = await tx.paymentHold.count({
      where: {
        doctorUserId,
        appointmentDate,
        status: 'PENDING',
        holdExpiresAt: { gt: now },
        ...(excludeAppointmentId ? { appointmentId: { not: excludeAppointmentId } } : {}),
      },
    });
  }

  return {
    confirmedCount,
    activeHoldsCount,
    effectiveOccupied: confirmedCount + activeHoldsCount,
  };
}

/**
 * Creates or refreshes a temporary payment hold atomically under doctor+date advisory lock.
 * Rejects if doctor capacity is full.
 * 
 * @param {object} tx Prisma transactional client
 * @param {object} params
 * @param {object} params.appointment Appointment row
 * @param {string} params.patientUserId
 * @param {number} [params.durationSeconds]
 * @returns {Promise<object>} Created/refreshed payment hold
 */
async function createOrRefreshHoldTx(tx, { appointment, patientUserId, durationSeconds }) {
  const duration = durationSeconds || env.paymentHoldDurationSeconds || 600;
  const doctorUserId = appointment.doctorUserId;
  const appointmentDate = appointment.appointmentDate;
  const dateStr = toDateStr(appointmentDate);

  // 1. Acquire per-doctor-day transactional advisory lock
  const lockKey = `doctor-day:${doctorUserId}:${dateStr}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

  // 2. Lazy cleanup of expired holds for this doctor+date
  await cleanExpiredHoldsTx(tx, doctorUserId, appointmentDate);

  // 3. Query doctor's max online bookings setting
  const doctorProfile = await tx.doctorProfile.findUnique({
    where: { userId: doctorUserId },
    select: { maxOnlineBookingsPerDay: true },
  });

  const maxCapacity = doctorProfile ? doctorProfile.maxOnlineBookingsPerDay : null;

  // 4. Calculate effective occupancy (excluding this appointment)
  const { confirmedCount, activeHoldsCount, effectiveOccupied } = await getEffectiveOccupancyTx(
    tx,
    doctorUserId,
    appointmentDate,
    appointment.id
  );

  // 5. Enforce capacity limit
  if (maxCapacity != null && effectiveOccupied >= maxCapacity) {
    logger.warn(`[payment-hold] Doctor capacity full: ${effectiveOccupied}/${maxCapacity} (confirmed: ${confirmedCount}, active holds: ${activeHoldsCount}) for doctor ${doctorUserId} on ${dateStr}`);
    throw new ApiError(
      400,
      'DAILY_ONLINE_LIMIT_REACHED',
      `This doctor has reached the maximum of ${maxCapacity} online bookings for this date. Please try another date, or contact the clinic directly.`
    );
  }

  // 6. Check if an active hold already exists for this appointment
  const now = new Date();
  const expiresAt = new Date(now.getTime() + duration * 1000);

  if (!tx?.paymentHold?.findFirst) {
    return {
      hold: null,
      reusedExistingOrder: false,
      confirmedCount,
      activeHoldsCount,
      effectiveOccupied,
      maxCapacity,
      durationSeconds: duration,
      expiresAt,
    };
  }

  const existingHold = await tx.paymentHold.findFirst({
    where: {
      appointmentId: appointment.id,
      status: 'PENDING',
    },
  });

  let hold;
  if (existingHold) {
    // A Razorpay order remains payable after this API call returns. Reusing its hold/order is the
    // only safe retry behavior; creating another order would expose the patient to two charges.
    if (existingHold.razorpayOrderId) {
      return {
        hold: existingHold,
        reusedExistingOrder: true,
        confirmedCount,
        activeHoldsCount: activeHoldsCount + 1,
        effectiveOccupied: effectiveOccupied + 1,
        maxCapacity,
        durationSeconds: duration,
        expiresAt: existingHold.holdExpiresAt,
      };
    }
    hold = await tx.paymentHold.update({
      where: { id: existingHold.id },
      data: {
        holdExpiresAt: expiresAt,
        updatedAt: now,
      },
    });
    logger.info(`[payment-hold] PAYMENT_HOLD_CREATED: Refreshed hold ${hold.id} for appointment ${appointment.id}, expires at ${expiresAt.toISOString()}`);
  } else {
    hold = await tx.paymentHold.create({
      data: {
        appointmentId: appointment.id,
        doctorUserId,
        patientUserId,
        appointmentDate,
        status: 'PENDING',
        holdCreatedAt: now,
        holdExpiresAt: expiresAt,
      },
    });
    logger.info(`[payment-hold] PAYMENT_HOLD_CREATED: Created hold ${hold.id} for appointment ${appointment.id}, doctor ${doctorUserId}, expires at ${expiresAt.toISOString()}`);
  }

  return {
    hold,
    reusedExistingOrder: false,
    confirmedCount,
    activeHoldsCount: activeHoldsCount + 1,
    effectiveOccupied: effectiveOccupied + 1,
    maxCapacity,
    durationSeconds: duration,
    expiresAt,
  };
}

/**
 * Associates a generated Razorpay order ID with an existing hold.
 */
async function attachRazorpayOrderToHold(holdId, razorpayOrderId) {
  if (!prisma?.paymentHold?.update || !holdId) {
    return null;
  }
  const updated = await prisma.paymentHold.update({
    where: { id: holdId },
    data: { razorpayOrderId },
  });
  logger.info(`[payment-hold] RAZORPAY_ORDER_CREATED: Attached order ${razorpayOrderId} to hold ${holdId}`);
  return updated;
}

/**
 * Cancels/releases a temporary hold (e.g. if Razorpay gateway order creation failed).
 */
async function cancelHold(holdId, reason = 'ORDER_CREATION_FAILED') {
  if (!prisma?.paymentHold?.updateMany || !holdId) {
    return false;
  }
  try {
    const updated = await prisma.paymentHold.updateMany({
      where: { id: holdId, status: 'PENDING' },
      data: { status: 'CANCELLED', updatedAt: new Date() },
    });
    if (updated.count > 0) {
      logger.info(`[payment-hold] PAYMENT_HOLD_RELEASED: Cancelled hold ${holdId} (reason: ${reason})`);
    }
    return updated.count > 0;
  } catch (err) {
    logger.error(`[payment-hold] Failed to cancel hold ${holdId}: ${err.message}`);
    return false;
  }
}

/**
 * Transitions a hold to CONFIRMED inside the payment verification transaction.
 */
async function confirmHoldTx(tx, appointmentId, razorpayOrderId = null) {
  if (!tx?.paymentHold?.findFirst) {
    return null;
  }
  const whereClause = {
    appointmentId,
    status: 'PENDING',
  };
  if (razorpayOrderId) {
    whereClause.OR = [
      { razorpayOrderId },
      { razorpayOrderId: null },
    ];
  }

  const existingHold = await tx.paymentHold.findFirst({
    where: whereClause,
  });

  if (existingHold) {
    const updated = await tx.paymentHold.update({
      where: { id: existingHold.id },
      data: {
        status: 'CONFIRMED',
        ...(razorpayOrderId ? { razorpayOrderId } : {}),
        updatedAt: new Date(),
      },
    });
    logger.info(`[payment-hold] BOOKING_CONFIRMED: Transitioned hold ${existingHold.id} to CONFIRMED for appointment ${appointmentId}`);
    return updated;
  }

  return null;
}

/**
 * Marks a hold as REFUNDED if payment was captured after expiry and capacity was full.
 */
async function markHoldRefundedTx(tx, appointmentId) {
  if (!tx?.paymentHold?.updateMany) {
    return;
  }
  await tx.paymentHold.updateMany({
    where: { appointmentId, status: { in: ['PENDING', 'EXPIRED'] } },
    data: { status: 'REFUNDED', updatedAt: new Date() },
  });
}

async function releaseHoldForRefundTx(tx, appointmentId) {
  if (!tx?.paymentHold?.updateMany) {
    return;
  }
  await tx.paymentHold.updateMany({
    where: { appointmentId, status: { in: ['PENDING', 'EXPIRED'] } },
    data: { status: 'CANCELLED', updatedAt: new Date() },
  });
}

module.exports = {
  cleanExpiredHoldsTx,
  cleanupAllExpiredHolds,
  getEffectiveOccupancyTx,
  createOrRefreshHoldTx,
  attachRazorpayOrderToHold,
  cancelHold,
  confirmHoldTx,
  markHoldRefundedTx,
  releaseHoldForRefundTx,
};
