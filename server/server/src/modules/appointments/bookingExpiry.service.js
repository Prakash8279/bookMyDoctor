const prisma = require('../../config/db');
const logger = require('../../config/logger');

const PAYMENT_WINDOW_MS = 10 * 60 * 1000;

function paymentDeadline(createdAt) {
  return new Date(new Date(createdAt).getTime() + PAYMENT_WINDOW_MS);
}

function paymentWindowExpired(createdAt, now = new Date()) {
  return now >= paymentDeadline(createdAt);
}

// The guarded status update wins only while the booking remains unpaid. Payment recording
// locks the same appointment row, so a successful payment can never be cancelled mid-commit.
async function expirePendingBooking(row, cutoff) {
  const expired = await prisma.$transaction(async (tx) => {
    const result = await tx.appointment.updateMany({
      where: { id: row.id, status: 'pending_payment', source: 'online', createdAt: { lte: cutoff } },
      data: { status: 'cancelled' },
    });
    if (!result.count) return false;
    await tx.queueToken.deleteMany({ where: { appointmentId: row.id, status: 'on_hold' } });
    await tx.paymentHold.updateMany({
      where: { appointmentId: row.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    return true;
  });
  if (!expired) return false;

  // Lazy imports avoid a cycle: appointments.service and queue.service both use this module.
  const appointmentsService = require('./appointments.service');
  const queueService = require('../queue/queue.service');
  await Promise.allSettled([
    appointmentsService.invalidateAppointmentListCaches({
      patientUserId: row.patientUserId,
      doctorUserId: row.doctorUserId,
      clinicId: row.clinicId,
    }),
    queueService.invalidateQueueListCaches({ doctorUserId: row.doctorUserId, clinicId: row.clinicId }),
  ]);
  logger.info(`[booking-expiry] Released unpaid booking ${row.id} after ten minutes`);
  return true;
}

async function expireOverduePendingBookings({ doctorUserId, appointmentDate, limit = 100 } = {}) {
  const cutoff = new Date(Date.now() - PAYMENT_WINDOW_MS);
  const rows = await prisma.appointment.findMany({
    where: {
      source: 'online',
      status: 'pending_payment',
      createdAt: { lte: cutoff },
      ...(doctorUserId ? { doctorUserId } : {}),
      ...(appointmentDate ? { appointmentDate } : {}),
    },
    select: { id: true, patientUserId: true, doctorUserId: true, clinicId: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  let count = 0;
  for (const row of rows) {
    if (await expirePendingBooking(row, cutoff)) count += 1;
  }
  return count;
}

module.exports = { PAYMENT_WINDOW_MS, paymentDeadline, paymentWindowExpired, expireOverduePendingBookings };
