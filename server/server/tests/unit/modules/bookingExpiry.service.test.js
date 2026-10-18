jest.mock('../../../src/config/db', () => ({
  appointment: { findMany: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../../../src/config/logger', () => ({ info: jest.fn() }));
jest.mock('../../../src/modules/appointments/appointments.service', () => ({
  invalidateAppointmentListCaches: jest.fn().mockResolvedValue(),
}));
jest.mock('../../../src/modules/queue/queue.service', () => ({
  invalidateQueueListCaches: jest.fn().mockResolvedValue(),
}));

const prisma = require('../../../src/config/db');
const expiry = require('../../../src/modules/appointments/bookingExpiry.service');

const row = { id: 'a1', patientUserId: 'p1', doctorUserId: 'd1', clinicId: 'c1' };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.appointment.findMany.mockResolvedValue([row]);
});

test('payment deadline is exactly ten minutes after booking creation', () => {
  const createdAt = new Date('2026-10-17T10:00:00.000Z');
  expect(expiry.paymentDeadline(createdAt).toISOString()).toBe('2026-10-17T10:10:00.000Z');
  expect(expiry.paymentWindowExpired(createdAt, new Date('2026-10-17T10:09:59.999Z'))).toBe(false);
  expect(expiry.paymentWindowExpired(createdAt, new Date('2026-10-17T10:10:00.000Z'))).toBe(true);
});

test('an overdue unpaid booking releases its slot, hidden token, and payment hold', async () => {
  const tx = {
    appointment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    queueToken: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    paymentHold: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  prisma.$transaction.mockImplementation((fn) => fn(tx));

  expect(await expiry.expireOverduePendingBookings({ doctorUserId: 'd1' })).toBe(1);
  expect(prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ status: 'pending_payment', source: 'online', doctorUserId: 'd1' }),
  }));
  expect(tx.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: 'a1', status: 'pending_payment' }),
    data: { status: 'cancelled' },
  }));
  expect(tx.queueToken.deleteMany).toHaveBeenCalledWith({ where: { appointmentId: 'a1', status: 'on_hold' } });
  expect(tx.paymentHold.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { appointmentId: 'a1', status: 'PENDING' },
    data: { status: 'EXPIRED' },
  }));
});

test('a booking paid concurrently is not expired or stripped of its token', async () => {
  const tx = {
    appointment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    queueToken: { deleteMany: jest.fn() },
    paymentHold: { updateMany: jest.fn() },
  };
  prisma.$transaction.mockImplementation((fn) => fn(tx));

  expect(await expiry.expireOverduePendingBookings()).toBe(0);
  expect(tx.queueToken.deleteMany).not.toHaveBeenCalled();
  expect(tx.paymentHold.updateMany).not.toHaveBeenCalled();
});
