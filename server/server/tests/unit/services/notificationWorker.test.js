jest.mock('../../../src/config/db', () => ({ notification: { findUnique: jest.fn() }, user: { findUnique: jest.fn() } }));
jest.mock('../../../src/services/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../../../src/services/pushService', () => ({ sendPush: jest.fn() }));
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), error: jest.fn() }));
const prisma = require('../../../src/config/db');
const email = require('../../../src/services/emailService');
const push = require('../../../src/services/pushService');
const { deliverNotification } = require('../../../src/jobs/notificationWorker');

describe('durable payment notification delivery', () => {
  const job = { data: { notificationId: 'n1', userId: 'u1', message: { emailAmount: 'Rs. 500', emailDetails: [{ label: 'Token', value: '#1' }], emailActionPath: '/patient/payments' } } };
  beforeEach(() => {
    prisma.notification.findUnique.mockResolvedValue({ id: 'n1', targetUserId: 'u1', audience: 'single_user', title: 'Booking confirmed', body: 'Token #1', type: 'payment' });
    prisma.user.findUnique.mockResolvedValue({ email: 'patient@example.test' });
    email.sendEmail.mockResolvedValue(undefined);
  });
  test('delivers complete branded receipt context to the authoritative recipient', async () => {
    await deliverNotification(job);
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'patient@example.test', amount: 'Rs. 500', details: job.data.message.emailDetails, actionPath: '/patient/payments', throwOnError: true }));
    expect(push.sendPush).toHaveBeenCalledWith('u1', { title: 'Booking confirmed', body: 'Token #1' });
  });
  test('rejects another recipient and deleted notifications without sending anything', async () => {
    prisma.notification.findUnique.mockResolvedValue({ targetUserId: 'other', audience: 'single_user' });
    await deliverNotification(job);
    expect(email.sendEmail).not.toHaveBeenCalled();
    prisma.notification.findUnique.mockResolvedValue(null);
    await deliverNotification(job);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
  test('propagates SMTP failures so BullMQ can retry instead of silently dropping email', async () => {
    email.sendEmail.mockRejectedValue(new Error('SMTP timeout'));
    await expect(deliverNotification(job)).rejects.toThrow('SMTP timeout');
    expect(push.sendPush).not.toHaveBeenCalled();
  });
});
