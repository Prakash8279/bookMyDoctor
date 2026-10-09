/**
 * Phase 4: Razorpay Cancellation & Refund Unit Tests
 * Covers all required scenarios:
 *  - paid + cancelled
 *  - unpaid + cancelled
 *  - refund success
 *  - refund failure
 *  - duplicate refund request
 *  - webhook retry
 *  - payment captured but cancellation transaction failure
 */

const crypto = require('crypto');
const ApiError = require('../../../src/utils/ApiError');

jest.mock('../../../src/config/db', () => ({
  appointment: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  payment: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  refund: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  queueToken: {
    delete: jest.fn(),
    update: jest.fn(),
  },
  bookingRules: {
    findUnique: jest.fn(),
  },
  platformCharges: {
    findUnique: jest.fn().mockResolvedValue({ commissionPercent: 10 }),
  },
  notification: {
    create: jest.fn().mockResolvedValue({}),
  },
  $transaction: jest.fn((callbackOrArray) => {
    if (typeof callbackOrArray === 'function') {
      return callbackOrArray(require('../../../src/config/db'));
    }
    return Promise.all(callbackOrArray);
  }),
}));

jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn().mockResolvedValue({}) }));
jest.mock('../../../src/config/redis', () => ({
  del: jest.fn().mockResolvedValue(1),
  scan: jest.fn().mockResolvedValue(['0', []]),
}));

const env = require('../../../src/config/env');
const prisma = require('../../../src/config/db');
const razorpayService = require('../../../src/modules/payments/razorpay.service');
const appointmentsService = require('../../../src/modules/appointments/appointments.service');

describe('Phase 4: Razorpay Cancellation & Refund Flow', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    env.razorpay.keyId = 'rzp_test_sampleKeyId';
    env.razorpay.keySecret = 'sampleSecret123';
    env.razorpay.webhookSecret = 'webhookSecret456';
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // ── 1. paid + cancelled ───────────────────────────────────────────
  test('paid + cancelled: creates a pending refund record and initiates refund', async () => {
    const { Prisma } = require('@prisma/client');
    const mockAppt = {
      id: 'appt-paid-1',
      patientUserId: 'patient-1',
      doctorUserId: 'doc-1',
      clinicId: 'clinic-1',
      appointmentDate: new Date('2026-10-15'),
      appointmentTime: '10:00',
      status: 'confirmed',
      paymentStatus: 'paid',
      consultationFee: new Prisma.Decimal(500),
      convenienceFee: new Prisma.Decimal(0),
      emergencyFee: new Prisma.Decimal(0),
      gstAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(500),
      queueToken: { id: 'token-1', status: 'waiting' },
    };

    const mockPayment = {
      id: 'pay-db-1',
      appointmentId: 'appt-paid-1',
      amount: 500,
      mode: 'online',
      status: 'paid',
      transactionRef: 'pay_rzp_123',
    };

    prisma.appointment.findUnique
      .mockResolvedValueOnce(mockAppt)
      .mockResolvedValueOnce({ ...mockAppt, status: 'cancelled' });
    prisma.payment.findFirst.mockResolvedValue(mockPayment);
    const refundRecord = {
      id: 'rfnd-db-1',
      appointmentId: 'appt-paid-1',
      paymentId: 'pay-db-1',
      amount: 500,
      razorpayPaymentId: 'pay_rzp_123',
      status: 'pending',
      idempotencyKey: 'refund:appt:appt-paid-1',
    };
    prisma.refund.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(refundRecord);
    prisma.refund.create.mockResolvedValue(refundRecord);

    // Mock Razorpay API response
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'rfnd_rzp_999',
        status: 'processed',
        amount: 50000,
      }),
    });

    const result = await appointmentsService.updateAppointmentStatus(
      'appt-paid-1',
      'cancelled',
      { id: 'admin-1', role: 'admin' }
    );

    expect(result.status).toBe('cancelled');
    expect(prisma.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appointmentId: 'appt-paid-1',
          paymentId: 'pay-db-1',
          status: 'pending',
          idempotencyKey: 'refund:appt:appt-paid-1',
        }),
      })
    );
  });

  // ── 2. unpaid + cancelled ─────────────────────────────────────────
  test('unpaid + cancelled: cancels appointment without creating any refund record', async () => {
    const mockAppt = {
      id: 'appt-unpaid-1',
      patientUserId: 'patient-1',
      doctorUserId: 'doc-1',
      clinicId: 'clinic-1',
      appointmentDate: new Date('2026-10-15'),
      appointmentTime: '10:00',
      status: 'pending_payment',
      paymentStatus: 'pending',
      queueToken: null,
    };

    prisma.appointment.findUnique
      .mockResolvedValueOnce(mockAppt)
      .mockResolvedValueOnce({ ...mockAppt, status: 'cancelled' });
    prisma.bookingRules.findUnique.mockResolvedValue({ cancellationWindowHours: 2 });

    const result = await appointmentsService.updateAppointmentStatus(
      'appt-unpaid-1',
      'cancelled',
      { id: 'patient-1', role: 'patient' }
    );

    expect(result.status).toBe('cancelled');
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
    expect(prisma.refund.create).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── 3. refund success ─────────────────────────────────────────────
  test('refund success: flips refund to processed and marks appointment/payment refunded', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 'rfnd-rec-1',
      appointmentId: 'appt-1',
      paymentId: 'pay-1',
      amount: 500,
      razorpayPaymentId: 'pay_sample_123',
      status: 'pending',
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'rfnd_api_success_1',
        status: 'processed',
        amount: 50000,
      }),
    });

    const res = await razorpayService.processRefund({
      refundId: 'rfnd-rec-1',
      paymentId: 'pay_sample_123',
      amount: 500,
      appointmentId: 'appt-1',
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('processed');
    expect(prisma.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rfnd-rec-1' },
        data: expect.objectContaining({
          status: 'processed',
          razorpayRefundId: 'rfnd_api_success_1',
        }),
      })
    );
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appt-1' },
        data: { paymentStatus: 'refunded' },
      })
    );
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { appointmentId: 'appt-1', transactionRef: 'pay_sample_123' },
        data: { status: 'refunded' },
      })
    );
  });

  // ── 4. refund failure ─────────────────────────────────────────────
  test('refund failure: handles gateway error safely without throwing unhandled exception', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 'rfnd-rec-2',
      appointmentId: 'appt-2',
      paymentId: 'pay-2',
      amount: 500,
      razorpayPaymentId: 'pay_failed_123',
      status: 'pending',
    });

    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'Payment is already fully refunded',
        },
      }),
    });

    const res = await razorpayService.processRefund({
      refundId: 'rfnd-rec-2',
      paymentId: 'pay_failed_123',
      amount: 500,
      appointmentId: 'appt-2',
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('failed');
    expect(prisma.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rfnd-rec-2' },
        data: expect.objectContaining({
          status: 'failed',
          failureReason: 'Payment is already fully refunded',
        }),
      })
    );
    // Appointment and payment are NOT marked refunded on failure
    expect(prisma.appointment.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { paymentStatus: 'refunded' } })
    );
  });

  // ── 5. duplicate refund request ───────────────────────────────────
  test('duplicate refund request: idempotency prevents duplicate refund execution', async () => {
    prisma.refund.findUnique.mockResolvedValue({
      id: 'rfnd-rec-3',
      status: 'processed',
      razorpayRefundId: 'rfnd_already_done',
    });

    const res = await razorpayService.processRefund({
      refundId: 'rfnd-rec-3',
      paymentId: 'pay_123',
      amount: 500,
      appointmentId: 'appt-3',
    });

    expect(res.alreadyProcessed).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── 6. webhook retry ──────────────────────────────────────────────
  test('webhook retry: repeated refund.processed webhook is idempotent and acknowledges 200', async () => {
    const rawPayload = JSON.stringify({
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_webhook_1',
            payment_id: 'pay_webhook_1',
            status: 'processed',
            amount: 50000,
            notes: { refundId: 'rfnd-rec-4', appointmentId: 'appt-4' },
          },
        },
      },
    });

    const signature = crypto
      .createHmac('sha256', 'webhookSecret456')
      .update(Buffer.from(rawPayload))
      .digest('hex');

    // First: existing refund already marked processed (retry scenario)
    prisma.refund.findFirst.mockResolvedValue({
      id: 'rfnd-rec-4',
      appointmentId: 'appt-4',
      razorpayPaymentId: 'pay_webhook_1',
      status: 'processed',
      razorpayRefundId: 'rfnd_webhook_1',
    });

    const res = await razorpayService.reconcilePendingPaymentsFromWebhook(
      Buffer.from(rawPayload),
      signature
    );

    expect(res.handled).toBe(true);
    expect(res.alreadyProcessed).toBe(true);
    expect(prisma.refund.update).not.toHaveBeenCalled();
  });

  // ── 7. payment captured but cancellation transaction failure ──────
  test('cancellation transaction failure: rolls back without creating refund or calling gateway', async () => {
    const mockAppt = {
      id: 'appt-rollback-1',
      patientUserId: 'patient-1',
      doctorUserId: 'doc-1',
      clinicId: 'clinic-1',
      appointmentDate: new Date('2026-10-15'),
      appointmentTime: '10:00',
      status: 'confirmed',
      paymentStatus: 'paid',
      queueToken: { id: 'token-1', status: 'waiting' },
    };

    const mockPayment = {
      id: 'pay-rollback-1',
      appointmentId: 'appt-rollback-1',
      amount: 500,
      mode: 'online',
      status: 'paid',
      transactionRef: 'pay_rzp_rollback',
    };

    prisma.appointment.findUnique.mockResolvedValue(mockAppt);
    prisma.payment.findFirst.mockResolvedValue(mockPayment);
    prisma.bookingRules.findUnique.mockResolvedValue({ cancellationWindowHours: 2 });

    // Simulate database failure during transaction
    prisma.$transaction.mockImplementationOnce(() => {
      throw new Error('DATABASE_CONNECTION_LOST');
    });

    await expect(
      appointmentsService.updateAppointmentStatus(
        'appt-rollback-1',
        'cancelled',
        { id: 'admin-1', role: 'admin' }
      )
    ).rejects.toThrow('DATABASE_CONNECTION_LOST');

    // Verification: Gateway was never called
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
