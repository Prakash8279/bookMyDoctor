/**
 * Unit tests for modules/payments/razorpay.service.js — the patient self-pay "Pay now" flow.
 * Two classes of bug this suite is written to catch, one of them squarely security-critical:
 *
 *   - verifyAndRecordPayment's HMAC signature check (order_id + "|" + payment_id, signed with our
 *     Razorpay key secret) is the ONLY thing standing between "a client can call this endpoint
 *     with made-up ids" and "a real charge is recorded" — mirrored here with the same rigor as
 *     tokenService.test.js's tampered-token tests: a validly-signed payload must pass, a
 *     TAMPERED payload/signature must fail, and a signature produced under the WRONG secret must
 *     fail. It also must never leak whether a signature was valid before ownership is checked
 *     (a non-owner gets 404 regardless), and — the function's own "SECURITY FIX" comment —
 *     `notes.appointmentId`/`notes.patientUserId` (fetched fresh from Razorpay, never trusted
 *     from the frontend) must be cross-checked against the request's claimed appointmentId/
 *     requester, closing the "pay for a cheap appointment, replay the valid signature against an
 *     expensive one" swap.
 *   - createOrder's payload shape and state guards: amount is always in paise
 *     (Math.round(rupees*100)), 'minimum' requires the doctor to have actually configured a
 *     minBookingAdvanceAmount > 0, and an already-paid/partial/cancelled/no-show appointment must
 *     never reach Razorpay at all.
 *
 * config/db is mocked (no real Postgres in this sandbox). payments.service.js is mocked because
 * this suite is about razorpay.service.js's OWN logic (signature verification, order creation,
 * cross-checking notes) — not re-testing createPaymentForAppointment's transaction/fee logic,
 * which payments.service.test.js already covers. appointments.service.js and queue.service.js
 * are mocked because razorpay.service.js `require`s them LAZILY inside verifyAndRecordPayment
 * purely to bust their list caches / re-fetch the appointment — jest's mock hoisting applies to a
 * lazy require the same as a top-level one. `crypto` is left real and exercised for real: this is
 * exactly the module whose signature math must not be faked out from under itself.
 *
 * razorpay.service.js talks to Razorpay over the global `fetch` (deliberately dependency-free —
 * see its own header comment), never the `razorpay` npm package — so the real network call is
 * cut off by replacing `global.fetch` with a fresh jest.fn() before every test in this file
 * (rebuilt in beforeEach rather than relying on `clearMocks`, since clearMocks resets a mock's
 * call history but NOT a previously-set mockResolvedValue/mockImplementation, which would
 * otherwise leak one test's fetch response into the next).
 */
jest.mock('../../../src/config/db', () => ({
  appointment: { findUnique: jest.fn() },
  doctorProfile: { findUnique: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/modules/payments/payments.service', () => ({
  createPaymentForAppointment: jest.fn(),
  invalidatePaymentListCaches: jest.fn(),
  getPaymentById: jest.fn(),
}));
jest.mock('../../../src/modules/appointments/appointments.service', () => ({
  invalidateAppointmentListCaches: jest.fn(),
  getAppointmentById: jest.fn(),
}));
jest.mock('../../../src/modules/queue/queue.service', () => ({
  invalidateQueueListCaches: jest.fn(),
}));

const crypto = require('crypto');
const prisma = require('../../../src/config/db');
const env = require('../../../src/config/env');
const activityLogService = require('../../../src/services/activityLogService');
const paymentsService = require('../../../src/modules/payments/payments.service');
const appointmentsService = require('../../../src/modules/appointments/appointments.service');
const queueService = require('../../../src/modules/queue/queue.service');
const razorpayService = require('../../../src/modules/payments/razorpay.service');

const KEY_ID = 'rzp_test_key_id';
const KEY_SECRET = 'rzp_test_key_secret_do_not_use';

function signature(orderId, paymentId, secret = KEY_SECRET) {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

const PATIENT = { id: 'patient-1', role: 'patient' };
const ADMIN = { id: 'admin-1', role: 'admin' };

function buildAppointmentRow(overrides = {}) {
  return {
    id: 'appt-1',
    patientUserId: 'patient-1',
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    totalAmount: 613.6,
    doctorUserId: 'doctor-1',
    ...overrides,
  };
}

beforeEach(() => {
  // Fresh gateway credentials before every test — assertGatewayConfigured (called at the top of
  // both exported functions) must see real-looking keys unless a specific test deliberately
  // blanks them out to exercise the "not configured" path.
  env.razorpay.keyId = KEY_ID;
  env.razorpay.keySecret = KEY_SECRET;
  global.fetch = jest.fn();
});

describe('razorpay.service — gateway-not-configured guard', () => {
  test('createOrder throws 500 PAYMENT_GATEWAY_NOT_CONFIGURED when keys are blank', async () => {
    env.razorpay.keyId = '';
    env.razorpay.keySecret = '';

    await expect(razorpayService.createOrder('appt-1', PATIENT)).rejects.toMatchObject({
      statusCode: 500,
      code: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('verifyAndRecordPayment throws 500 PAYMENT_GATEWAY_NOT_CONFIGURED when keys are blank', async () => {
    env.razorpay.keyId = '';
    env.razorpay.keySecret = '';

    await expect(
      razorpayService.verifyAndRecordPayment(
        { appointmentId: 'appt-1', razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1', razorpaySignature: 'x' },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 500, code: 'PAYMENT_GATEWAY_NOT_CONFIGURED' });
  });
});

describe('razorpay.service.createOrder — ownership and state guards', () => {
  test('404 APPOINTMENT_NOT_FOUND when the appointment does not exist', async () => {
    prisma.appointment.findUnique.mockResolvedValue(null);

    await expect(razorpayService.createOrder('appt-1', PATIENT)).rejects.toMatchObject({
      statusCode: 404,
      code: 'APPOINTMENT_NOT_FOUND',
    });
  });

  test('a patient probing someone else\'s appointment gets 404 (not 403) — enumeration avoidance', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ patientUserId: 'someone-else' }));

    await expect(razorpayService.createOrder('appt-1', PATIENT)).rejects.toMatchObject({
      statusCode: 404,
      code: 'APPOINTMENT_NOT_FOUND',
    });
  });

  test('admin is not subject to the ownership check', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ patientUserId: 'someone-else' }));
    global.fetch.mockResolvedValue(jsonResponse({ id: 'order_1', amount: 61360, currency: 'INR' }));

    const result = await razorpayService.createOrder('appt-1', ADMIN);

    expect(result.orderId).toBe('order_1');
  });

  test('409 PAYMENT_ALREADY_RECORDED when the appointment is already paid', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'paid' }));

    await expect(razorpayService.createOrder('appt-1', PATIENT)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_ALREADY_RECORDED',
    });
  });

  test('409 when the appointment is already "partial" — the remaining balance is collected at the clinic, not re-charged online here', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'partial' }));

    await expect(razorpayService.createOrder('appt-1', PATIENT)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_ALREADY_RECORDED',
    });
  });

  test.each(['cancelled', 'no_show'])('409 APPOINTMENT_NOT_PAYABLE for a "%s" appointment', async (status) => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ status }));

    await expect(razorpayService.createOrder('appt-1', PATIENT)).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPOINTMENT_NOT_PAYABLE',
    });
  });
});

describe('razorpay.service.createOrder — payload shape (full vs minimum)', () => {
  test('"full" option orders the appointment\'s totalAmount, converted to paise, with notes stamped for later verification', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ totalAmount: 613.6 }));
    global.fetch.mockResolvedValue(jsonResponse({ id: 'order_full', amount: 61360, currency: 'INR' }));

    const result = await razorpayService.createOrder('appt-1', PATIENT, 'full');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    const body = JSON.parse(options.body);
    expect(body.amount).toBe(61360); // Math.round(613.6 * 100)
    expect(body.currency).toBe('INR');
    expect(body.notes).toEqual({ appointmentId: 'appt-1', patientUserId: 'patient-1', paymentOption: 'full' });
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
    // The frontend gets just enough to open Checkout — never the key secret.
    expect(result).toEqual({
      orderId: 'order_full',
      amount: 61360,
      currency: 'INR',
      keyId: KEY_ID,
      appointmentId: 'appt-1',
    });
  });

  test('the Razorpay receipt string is capped at 40 characters', async () => {
    prisma.appointment.findUnique.mockResolvedValue(
      buildAppointmentRow({ id: 'a-very-long-appointment-id-that-would-overflow-40-chars' })
    );
    global.fetch.mockResolvedValue(jsonResponse({ id: 'order_1', amount: 61360, currency: 'INR' }));

    await razorpayService.createOrder(
      'a-very-long-appointment-id-that-would-overflow-40-chars',
      PATIENT
    );

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.receipt.length).toBeLessThanOrEqual(40);
  });

  test('"minimum" option orders the doctor\'s configured minBookingAdvanceAmount instead of the full fee', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ totalAmount: 613.6 }));
    prisma.doctorProfile.findUnique.mockResolvedValue({ minBookingAdvanceAmount: 100 });
    global.fetch.mockResolvedValue(jsonResponse({ id: 'order_min', amount: 10000, currency: 'INR' }));

    await razorpayService.createOrder('appt-1', PATIENT, 'minimum');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.amount).toBe(10000); // 100 rupees -> paise
    expect(body.notes.paymentOption).toBe('minimum');
  });

  // REGRESSION (production bug, found via a real "Pay minimum now" click that surfaced
  // errorHandler.js's generic 500 instead of a real error): getOwnAppointmentOrThrow's `select`
  // was missing `doctorUserId`, so this branch's `prisma.doctorProfile.findUnique({ where: {
  // userId: appointment.doctorUserId } })` ran with userId: undefined against a REAL Prisma
  // client — a PrismaClientValidationError, not an ApiError, so it fell through to the generic
  // error handler. buildAppointmentRow's mock already has doctorUserId hardcoded onto the
  // resolved value regardless of what was actually selected, so it could not have caught this —
  // only asserting on the `select` argument itself can. Guards against the same field silently
  // being dropped again.
  test('fetches doctorUserId in the appointment select — required for the "minimum" branch to look up the doctor\'s profile', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.doctorProfile.findUnique.mockResolvedValue({ minBookingAdvanceAmount: 100 });
    global.fetch.mockResolvedValue(jsonResponse({ id: 'order_min', amount: 10000, currency: 'INR' }));

    await razorpayService.createOrder('appt-1', PATIENT, 'minimum');

    expect(prisma.appointment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ doctorUserId: true }) })
    );
    expect(prisma.doctorProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'doctor-1' } })
    );
  });

  test('400 MIN_BOOKING_AMOUNT_NOT_SET when "minimum" is requested but the doctor never configured one', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.doctorProfile.findUnique.mockResolvedValue({ minBookingAdvanceAmount: null });

    await expect(razorpayService.createOrder('appt-1', PATIENT, 'minimum')).rejects.toMatchObject({
      statusCode: 400,
      code: 'MIN_BOOKING_AMOUNT_NOT_SET',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('400 MIN_BOOKING_AMOUNT_NOT_SET when the configured minimum is zero/negative', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.doctorProfile.findUnique.mockResolvedValue({ minBookingAdvanceAmount: 0 });

    await expect(razorpayService.createOrder('appt-1', PATIENT, 'minimum')).rejects.toMatchObject({
      statusCode: 400,
      code: 'MIN_BOOKING_AMOUNT_NOT_SET',
    });
  });

  test('502 PAYMENT_GATEWAY_UNREACHABLE when the fetch call itself throws (network error)', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    global.fetch.mockRejectedValue(new Error('ECONNRESET'));

    await expect(razorpayService.createOrder('appt-1', PATIENT)).rejects.toMatchObject({
      statusCode: 502,
      code: 'PAYMENT_GATEWAY_UNREACHABLE',
    });
  });

  test('502 PAYMENT_GATEWAY_ERROR when Razorpay responds with a non-OK/malformed payload', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    global.fetch.mockResolvedValue(jsonResponse({ error: { description: 'Invalid API key' } }, false));

    await expect(razorpayService.createOrder('appt-1', PATIENT)).rejects.toMatchObject({
      statusCode: 502,
      code: 'PAYMENT_GATEWAY_ERROR',
      message: 'Invalid API key',
    });
  });
});

describe('razorpay.service.verifyAndRecordPayment — HMAC signature verification (security-critical)', () => {
  const ORDER_ID = 'order_abc123';
  const PAYMENT_ID = 'pay_xyz789';

  function mockOrderDetails(notes) {
    global.fetch.mockResolvedValue(jsonResponse({ amount: 61360, notes }));
  }

  beforeEach(() => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
  });

  test('a validly-signed payload with matching notes passes and records the payment', async () => {
    mockOrderDetails({ appointmentId: 'appt-1', patientUserId: 'patient-1' });
    paymentsService.createPaymentForAppointment.mockResolvedValue({
      id: 'pay-1',
      amount: '613.6',
      receiptNumber: 'CDR-00000001',
      patientUserId: 'patient-1',
      doctorUserId: 'doctor-1',
      clinicId: 'clinic-1',
    });
    paymentsService.getPaymentById.mockResolvedValue({ id: 'pay-1' });
    appointmentsService.getAppointmentById.mockResolvedValue({ id: 'appt-1' });

    const result = await razorpayService.verifyAndRecordPayment(
      {
        appointmentId: 'appt-1',
        razorpayOrderId: ORDER_ID,
        razorpayPaymentId: PAYMENT_ID,
        razorpaySignature: signature(ORDER_ID, PAYMENT_ID),
      },
      PATIENT
    );

    expect(paymentsService.createPaymentForAppointment).toHaveBeenCalledWith(
      'appt-1',
      PATIENT,
      'online',
      PAYMENT_ID,
      null,
      613.6
    );
    expect(result).toEqual({ payment: { id: 'pay-1' }, appointment: { id: 'appt-1' } });
  });

  test('a TAMPERED signature (payload bytes changed after signing) is rejected with 400 PAYMENT_SIGNATURE_INVALID, and nothing is recorded', async () => {
    const validSignature = signature(ORDER_ID, PAYMENT_ID);
    // Flip one hex character — same length, different bytes, exactly what a tampered signature
    // looks like on the wire.
    const tampered = (validSignature[0] === 'a' ? 'b' : 'a') + validSignature.slice(1);

    await expect(
      razorpayService.verifyAndRecordPayment(
        { appointmentId: 'appt-1', razorpayOrderId: ORDER_ID, razorpayPaymentId: PAYMENT_ID, razorpaySignature: tampered },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_SIGNATURE_INVALID' });
    expect(paymentsService.createPaymentForAppointment).not.toHaveBeenCalled();
  });

  test('a signature produced under the WRONG key secret is rejected', async () => {
    const wrongSecretSignature = signature(ORDER_ID, PAYMENT_ID, 'a-totally-different-secret');

    await expect(
      razorpayService.verifyAndRecordPayment(
        {
          appointmentId: 'appt-1',
          razorpayOrderId: ORDER_ID,
          razorpayPaymentId: PAYMENT_ID,
          razorpaySignature: wrongSecretSignature,
        },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_SIGNATURE_INVALID' });
  });

  test('a TAMPERED payload (order/payment id changed but the OLD signature reused) is rejected', async () => {
    const signatureForDifferentPayment = signature(ORDER_ID, 'pay_original');

    await expect(
      razorpayService.verifyAndRecordPayment(
        {
          appointmentId: 'appt-1',
          razorpayOrderId: ORDER_ID,
          razorpayPaymentId: 'pay_substituted', // attacker swapped the payment id
          razorpaySignature: signatureForDifferentPayment,
        },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_SIGNATURE_INVALID' });
  });

  test('a signature of the WRONG LENGTH is rejected the same way as any other invalid one, not a crash from timingSafeEqual', async () => {
    await expect(
      razorpayService.verifyAndRecordPayment(
        { appointmentId: 'appt-1', razorpayOrderId: ORDER_ID, razorpayPaymentId: PAYMENT_ID, razorpaySignature: 'ab' },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_SIGNATURE_INVALID' });
  });

  test('a missing/empty signature is rejected, not treated as an empty-string match', async () => {
    await expect(
      razorpayService.verifyAndRecordPayment(
        { appointmentId: 'appt-1', razorpayOrderId: ORDER_ID, razorpayPaymentId: PAYMENT_ID, razorpaySignature: undefined },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_SIGNATURE_INVALID' });
  });

  test('ownership is checked BEFORE the signature — a non-owner gets 404 even with a perfectly valid signature', async () => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ patientUserId: 'someone-else' }));

    await expect(
      razorpayService.verifyAndRecordPayment(
        {
          appointmentId: 'appt-1',
          razorpayOrderId: ORDER_ID,
          razorpayPaymentId: PAYMENT_ID,
          razorpaySignature: signature(ORDER_ID, PAYMENT_ID),
        },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
    // The order-details fetch (which would reveal whether the signature was even checked) must
    // never happen for an out-of-scope caller.
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('razorpay.service.verifyAndRecordPayment — order/appointment cross-check (the audit-fixed swap)', () => {
  const ORDER_ID = 'order_abc123';
  const PAYMENT_ID = 'pay_xyz789';
  const VALID_SIG = () => signature(ORDER_ID, PAYMENT_ID);

  beforeEach(() => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
  });

  test('400 PAYMENT_APPOINTMENT_MISMATCH when the order\'s notes.appointmentId does not match the claimed appointmentId — closes the cheap-order-replayed-against-an-expensive-appointment swap', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({ amount: 61360, notes: { appointmentId: 'some-other-appt', patientUserId: 'patient-1' } })
    );

    await expect(
      razorpayService.verifyAndRecordPayment(
        { appointmentId: 'appt-1', razorpayOrderId: ORDER_ID, razorpayPaymentId: PAYMENT_ID, razorpaySignature: VALID_SIG() },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_APPOINTMENT_MISMATCH' });
    expect(paymentsService.createPaymentForAppointment).not.toHaveBeenCalled();
  });

  test('400 PAYMENT_APPOINTMENT_MISMATCH when notes.patientUserId does not match the requester', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({ amount: 61360, notes: { appointmentId: 'appt-1', patientUserId: 'someone-else' } })
    );

    await expect(
      razorpayService.verifyAndRecordPayment(
        { appointmentId: 'appt-1', razorpayOrderId: ORDER_ID, razorpayPaymentId: PAYMENT_ID, razorpaySignature: VALID_SIG() },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_APPOINTMENT_MISMATCH' });
  });

  test('missing/malformed notes on the order (never an object) are treated as a mismatch, not a crash', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ amount: 61360, notes: null }));

    await expect(
      razorpayService.verifyAndRecordPayment(
        { appointmentId: 'appt-1', razorpayOrderId: ORDER_ID, razorpayPaymentId: PAYMENT_ID, razorpaySignature: VALID_SIG() },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_APPOINTMENT_MISMATCH' });
  });

  test('502 PAYMENT_GATEWAY_ERROR when Razorpay\'s order-lookup response is malformed (no numeric amount)', async () => {
    global.fetch.mockResolvedValue(jsonResponse({ amount: 'not-a-number', notes: {} }));

    await expect(
      razorpayService.verifyAndRecordPayment(
        { appointmentId: 'appt-1', razorpayOrderId: ORDER_ID, razorpayPaymentId: PAYMENT_ID, razorpaySignature: VALID_SIG() },
        PATIENT
      )
    ).rejects.toMatchObject({ statusCode: 502, code: 'PAYMENT_GATEWAY_ERROR' });
  });
});

describe('razorpay.service.verifyAndRecordPayment — never trusts the frontend for the charged amount', () => {
  const ORDER_ID = 'order_abc123';
  const PAYMENT_ID = 'pay_xyz789';

  beforeEach(() => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
  });

  test('the amount passed to createPaymentForAppointment comes from Razorpay\'s own order record (in rupees), not anything in the request body', async () => {
    // Order was actually created for 100 rupees (minimum-advance flow) — the request body itself
    // never carries an amount field at all, but even if it did, this must ignore it.
    global.fetch.mockResolvedValue(
      jsonResponse({ amount: 10000, notes: { appointmentId: 'appt-1', patientUserId: 'patient-1' } })
    );
    paymentsService.createPaymentForAppointment.mockResolvedValue({
      id: 'pay-1',
      amount: '100',
      receiptNumber: 'CDR-00000001',
      patientUserId: 'patient-1',
      doctorUserId: 'doctor-1',
      clinicId: 'clinic-1',
    });
    paymentsService.getPaymentById.mockResolvedValue({ id: 'pay-1' });
    appointmentsService.getAppointmentById.mockResolvedValue({ id: 'appt-1' });

    await razorpayService.verifyAndRecordPayment(
      {
        appointmentId: 'appt-1',
        razorpayOrderId: ORDER_ID,
        razorpayPaymentId: PAYMENT_ID,
        razorpaySignature: signature(ORDER_ID, PAYMENT_ID),
      },
      PATIENT
    );

    expect(paymentsService.createPaymentForAppointment).toHaveBeenCalledWith('appt-1', PATIENT, 'online', PAYMENT_ID, null, 100);
  });
});

describe('razorpay.service.verifyAndRecordPayment — side effects after a successful verification', () => {
  const ORDER_ID = 'order_abc123';
  const PAYMENT_ID = 'pay_xyz789';

  beforeEach(() => {
    prisma.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    global.fetch.mockResolvedValue(
      jsonResponse({ amount: 61360, notes: { appointmentId: 'appt-1', patientUserId: 'patient-1' } })
    );
    paymentsService.createPaymentForAppointment.mockResolvedValue({
      id: 'pay-1',
      amount: '613.6',
      receiptNumber: 'CDR-00000001',
      patientUserId: 'patient-1',
      doctorUserId: 'doctor-1',
      clinicId: 'clinic-1',
    });
    paymentsService.getPaymentById.mockResolvedValue({ id: 'pay-1' });
    appointmentsService.getAppointmentById.mockResolvedValue({ id: 'appt-1' });
  });

  async function run() {
    return razorpayService.verifyAndRecordPayment(
      {
        appointmentId: 'appt-1',
        razorpayOrderId: ORDER_ID,
        razorpayPaymentId: PAYMENT_ID,
        razorpaySignature: signature(ORDER_ID, PAYMENT_ID),
      },
      PATIENT
    );
  }

  test('logs a payment.create activity entry referencing the Razorpay receipt', async () => {
    await run();

    expect(activityLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'patient-1',
        actionType: 'payment.create',
        targetEntityId: 'pay-1',
        description: expect.stringContaining('Razorpay'),
      })
    );
  });

  test('busts payments-list, appointments-list, and queue-list caches for the affected patient/doctor/clinic', async () => {
    await run();

    expect(paymentsService.invalidatePaymentListCaches).toHaveBeenCalledWith({
      patientUserId: 'patient-1',
      doctorUserId: 'doctor-1',
      clinicId: 'clinic-1',
    });
    expect(appointmentsService.invalidateAppointmentListCaches).toHaveBeenCalledWith({
      patientUserId: 'patient-1',
      doctorUserId: 'doctor-1',
      clinicId: 'clinic-1',
    });
    expect(queueService.invalidateQueueListCaches).toHaveBeenCalledWith({
      doctorUserId: 'doctor-1',
      clinicId: 'clinic-1',
    });
  });

  test('returns BOTH the freshly-shaped payment and the freshly re-fetched appointment', async () => {
    const result = await run();

    expect(result).toEqual({ payment: { id: 'pay-1' }, appointment: { id: 'appt-1' } });
    expect(paymentsService.getPaymentById).toHaveBeenCalledWith('pay-1', PATIENT);
    expect(appointmentsService.getAppointmentById).toHaveBeenCalledWith('appt-1', PATIENT);
  });
});
