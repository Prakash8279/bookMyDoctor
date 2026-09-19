/**
 * Unit tests for modules/payments/payments.service.js — payment recording (both the
 * appointment-settling path and the walk-in/standalone-cash path), role-based fee masking, the
 * commission/clinicPayout split shown to admins, and the double-submit idempotency guards.
 * Three classes of bug this suite is written to catch:
 *
 *   - shapePaymentFees's admin commission math (see that function's own header comment): when one
 *     appointment is split across TWO Payment rows (an online advance + a clinic-collected
 *     remainder), commission/clinicPayout must be computed off THIS row's *share* of the
 *     appointment total (scaled by `row.amount / impliedTotalAmount`), never off the full
 *     consultationFee on every row — the latter would double-count commission across the split
 *     and overstate the admin dashboard's revenue figures. STAFF_ROLES must see ONLY
 *     consultationFee (every other money field omitted, not nulled); patients must never see
 *     commission/clinicPayout at all.
 *   - createPaymentForAppointment's ordering and state-machine rules: authorization (receptionist
 *     clinic match / patient ownership) must be checked BEFORE any state-revealing check
 *     (already-paid, cancelled) — an out-of-scope caller must get the same 403/404 regardless of
 *     the appointment's state, never leaking that state first. A 'partial' appointment must
 *     always charge the true remaining balance (never trust a caller-supplied amount for that
 *     case), and the 1-paisa full-payment tolerance must be computed against the CUMULATIVE
 *     amount paid so far, not the current charge alone (else the deliberately-partial remaining-
 *     balance charge would misclassify itself as 'partial' forever).
 *   - createStandalonePayment's server-side fee computation (never trust a client-sent amount)
 *     and its Redis-backed double-submit guard, which must key on requester+clinic+patient+
 *     doctor+amount so two genuinely different walk-in payments never collide.
 *
 * @prisma/client is mocked with a minimal but fully-arithmetic Decimal stand-in (the real
 * generated Decimal needs a `prisma generate`-downloaded query-engine binary this sandbox's
 * network policy blocks — see platformCharges.service.test.js's identical rationale) since this
 * module does real Decimal math (plus/minus/times/dividedBy/toDecimalPlaces/comparisons), not
 * just wrap-and-stringify. config/db and config/redis are mocked (no real Postgres/Redis in this
 * sandbox). appointments.service.js is mocked because payments.service.js `require`s it lazily,
 * INSIDE createPayment, purely to bust its list caches (see createPayment's own comment on why
 * that require is lazy — avoiding a load cycle) — jest's mock hoisting applies to a lazy require
 * exactly the same as a top-level one.
 */
jest.mock('@prisma/client', () => {
  function toNum(x) {
    return x instanceof Decimal ? x.value : Number(x);
  }
  // Real decimal.js does exact base-10 arithmetic; plain JS floats don't (0.1 + 0.2 !== 0.3).
  // Rounding every intermediate result to 8dp is enough headroom above the 2dp this module
  // actually stores/compares, so it behaves like exact decimal math for every test here without
  // reimplementing a real bignum library.
  function roundNoise(n) {
    return Math.round(n * 1e8) / 1e8;
  }
  class Decimal {
    constructor(value) {
      this.value = value instanceof Decimal ? value.value : typeof value === 'string' ? parseFloat(value) : Number(value);
    }
    plus(other) {
      return new Decimal(roundNoise(this.value + toNum(other)));
    }
    minus(other) {
      return new Decimal(roundNoise(this.value - toNum(other)));
    }
    times(other) {
      return new Decimal(roundNoise(this.value * toNum(other)));
    }
    dividedBy(other) {
      return new Decimal(roundNoise(this.value / toNum(other)));
    }
    greaterThan(other) {
      return this.value > toNum(other);
    }
    greaterThanOrEqualTo(other) {
      return this.value >= toNum(other);
    }
    lessThanOrEqualTo(other) {
      return this.value <= toNum(other);
    }
    toDecimalPlaces(n) {
      return new Decimal(Number(this.value.toFixed(n)));
    }
    toFixed(n) {
      return this.value.toFixed(n);
    }
    toNumber() {
      return this.value;
    }
    toString() {
      return String(this.value);
    }
  }
  return { Prisma: { Decimal } };
});
jest.mock('../../../src/config/db', () => ({
  payment: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
  appointment: { findUnique: jest.fn() },
  receptionistProfile: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  doctorClinic: { findUnique: jest.fn() },
  clinic: { findUnique: jest.fn() },
  platformCharges: { findUnique: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../../../src/config/redis', () => ({ set: jest.fn() }));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  invalidate: jest.fn(),
  getOrSet: jest.fn((key, ttlSeconds, fetchFn) => fetchFn()),
}));
jest.mock('../../../src/modules/notifications/notifications.service', () => ({
  notifySystemEventSafe: jest.fn(),
}));
jest.mock('../../../src/utils/idGenerators', () => ({
  nextReceiptNumber: jest.fn().mockResolvedValue('CDR-00000001'),
}));
jest.mock('../../../src/services/commissionLookupService', () => ({
  loadCommissionPercentIfAdmin: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../src/modules/appointments/appointments.service', () => ({
  invalidateAppointmentListCaches: jest.fn(),
}));

const { Prisma } = require('@prisma/client');
const prisma = require('../../../src/config/db');
const redis = require('../../../src/config/redis');
const activityLogService = require('../../../src/services/activityLogService');
const cacheService = require('../../../src/services/cacheService');
const notificationsService = require('../../../src/modules/notifications/notifications.service');
const idGenerators = require('../../../src/utils/idGenerators');
const commissionLookupService = require('../../../src/services/commissionLookupService');
const appointmentsService = require('../../../src/modules/appointments/appointments.service');
const paymentsService = require('../../../src/modules/payments/payments.service');

const dec = (v) => new Prisma.Decimal(v);

function buildAppointmentRow(overrides = {}) {
  return {
    id: 'appt-1',
    status: 'upcoming',
    patientUserId: 'patient-1',
    doctorUserId: 'doctor-1',
    clinicId: 'clinic-1',
    paymentStatus: 'unpaid',
    tokenNumber: 7,
    consultationFee: dec(500),
    convenienceFee: dec(20),
    emergencyFee: dec(0),
    gstAmount: dec(93.6),
    totalAmount: dec(613.6),
    ...overrides,
  };
}

function buildPaymentRow(overrides = {}) {
  return {
    id: 'pay-1',
    receiptNumber: 'CDR-00000001',
    appointmentId: 'appt-1',
    patientUserId: 'patient-1',
    doctorUserId: 'doctor-1',
    clinicId: 'clinic-1',
    consultationFee: dec(500),
    convenienceFee: dec(20),
    emergencyFee: dec(0),
    gstAmount: dec(93.6),
    amount: dec(613.6),
    mode: 'cash',
    transactionRef: null,
    payerUpiId: null,
    status: 'paid',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    appointment: { id: 'appt-1' },
    patient: { id: 'patient-1', name: 'Pat' },
    doctor: { id: 'doctor-1', name: 'Doc' },
    clinic: { id: 'clinic-1', name: 'Clinic' },
    ...overrides,
  };
}

/** Builds a fake Prisma interactive-transaction client and wires prisma.$transaction to run it. */
function makeTx(overrides = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'appt-1' }]),
    appointment: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    receptionistProfile: { findUnique: jest.fn() },
    // findFirst defaults to "no prior payment with this transactionRef" (null) — the
    // replay-protection guard's normal, non-replay path — so every pre-existing test that never
    // sets this override is unaffected.
    payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }), aggregate: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    queueToken: { updateMany: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
  prisma.$transaction.mockImplementation(async (cb) => cb(tx));
  return tx;
}

const PATIENT = { id: 'patient-1', role: 'patient' };
const DOCTOR = { id: 'doctor-1', role: 'doctor' };
const RECEPTIONIST = { id: 'recep-1', role: 'receptionist' };
const ADMIN = { id: 'admin-1', role: 'admin' };

describe('payments.service.createPaymentForAppointment — authorization ordering', () => {
  test('404 APPOINTMENT_NOT_FOUND when the row-lock select finds nothing', async () => {
    makeTx({ $queryRaw: jest.fn().mockResolvedValue([]) });

    await expect(
      paymentsService.createPaymentForAppointment('missing', ADMIN, 'cash', null)
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  test('receptionist outside the appointment clinic gets 403, even when the appointment is already paid — auth runs before state checks', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'paid' }));
    tx.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'other-clinic' });

    await expect(
      paymentsService.createPaymentForAppointment('appt-1', RECEPTIONIST, 'cash', null)
    ).rejects.toMatchObject({ statusCode: 403, code: 'RECEPTIONIST_CLINIC_MISMATCH' });
    // Never got as far as drawing a receipt number for a rejected attempt.
    expect(idGenerators.nextReceiptNumber).not.toHaveBeenCalled();
  });

  test('receptionist assigned to the matching clinic is allowed through', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    tx.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    const result = await paymentsService.createPaymentForAppointment('appt-1', RECEPTIONIST, 'cash', null);

    expect(result.id).toBe('pay-1');
  });

  test('a patient probing someone else\'s appointment gets 404 (not 403) — enumeration avoidance', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ patientUserId: 'someone-else' }));

    await expect(
      paymentsService.createPaymentForAppointment('appt-1', PATIENT, 'online', 'rzp_pay_1')
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  test('the owning patient can pay their own appointment', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    const result = await paymentsService.createPaymentForAppointment('appt-1', PATIENT, 'online', 'rzp_pay_1');

    expect(result.id).toBe('pay-1');
  });
});

describe('payments.service.createPaymentForAppointment — appointment state guards', () => {
  test('409 PAYMENT_ALREADY_RECORDED when paymentStatus is already "paid"', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'paid' }));

    await expect(
      paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'cash', null)
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_ALREADY_RECORDED' });
  });

  test.each(['cancelled', 'no_show'])('409 APPOINTMENT_NOT_PAYABLE for a "%s" appointment', async (status) => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ status }));

    await expect(
      paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'cash', null)
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPOINTMENT_NOT_PAYABLE' });
  });
});

describe('payments.service.createPaymentForAppointment — fee copy, amount, and payment-before-token', () => {
  test('every fee field is copied VERBATIM from the appointment row, never recomputed', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'cash', 'ref-1');

    const data = tx.payment.create.mock.calls[0][0].data;
    expect(data.consultationFee.toString()).toBe('500');
    expect(data.convenienceFee.toString()).toBe('20');
    expect(data.gstAmount.toString()).toBe('93.6');
    expect(data.amount.toString()).toBe('613.6');
    expect(data.mode).toBe('cash');
    expect(data.transactionRef).toBe('ref-1');
    expect(data.status).toBe('paid');
    expect(data.receiptNumber).toBe('CDR-00000001');
  });

  // Cash Payment page addition (request: "utr no aaye upi id aaye ushke pad use show ho") — the
  // payer's UPI id for this transaction, distinct from transactionRef (relabeled client-side to
  // "UTR / Transaction number").
  test('persists the payer UPI id alongside transactionRef when provided', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'upi', 'UTR12345', 'patient@okhdfcbank');

    const data = tx.payment.create.mock.calls[0][0].data;
    expect(data.transactionRef).toBe('UTR12345');
    expect(data.payerUpiId).toBe('patient@okhdfcbank');
  });

  test('defaults the charged amount to the appointment\'s full totalAmount when no explicit amount is passed', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'cash', null);

    expect(tx.payment.create.mock.calls[0][0].data.amount.toString()).toBe('613.6');
    expect(tx.appointment.update.mock.calls[0][0].data.paymentStatus).toBe('paid');
  });

  test('an explicit amount less than totalAmount (Razorpay minimum-advance flow) records paymentStatus "partial" on the appointment', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', PATIENT, 'online', 'rzp_pay_1', null, 100);

    expect(tx.payment.create.mock.calls[0][0].data.amount.toString()).toBe('100');
    expect(tx.appointment.update.mock.calls[0][0].data.paymentStatus).toBe('partial');
  });

  test('a "partial" appointment always auto-computes the true remaining balance — never trusts a caller-supplied amount', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'partial' }));
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: dec(100) } });
    tx.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    // Even though a caller passes amount:9999, it must be ignored for a partial appointment.
    await paymentsService.createPaymentForAppointment('appt-1', RECEPTIONIST_MATCHING(), 'cash', null, null, 9999);

    expect(tx.payment.create.mock.calls[0][0].data.amount.toString()).toBe('513.6'); // 613.6 - 100
    expect(tx.appointment.update.mock.calls[0][0].data.paymentStatus).toBe('paid'); // fully covers the balance
  });

  test('a "partial" appointment whose balance is already fully covered (rounding) throws PAYMENT_ALREADY_RECORDED instead of recording a zero/negative payment', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'partial' }));
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: dec(613.6) } });

    await expect(
      paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'cash', null)
    ).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_ALREADY_RECORDED' });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  test('the 1-paisa full-payment tolerance is computed against the CUMULATIVE amount paid, not this charge alone — the remaining-balance charge itself must land as "paid", not "partial" forever', async () => {
    const tx = makeTx();
    // Doctor's minimum advance was 500, remaining balance is 113.6 — collecting exactly that
    // remainder must flip the appointment fully "paid", not misclassify as another partial leg.
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'partial' }));
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: dec(500) } });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'cash', null);

    expect(tx.payment.create.mock.calls[0][0].data.amount.toString()).toBe('113.6');
    expect(tx.appointment.update.mock.calls[0][0].data.paymentStatus).toBe('paid');
  });

  test('a pending_payment booking flips to upcoming and its on_hold queue token to waiting, in the same transaction', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ status: 'pending_payment' }));
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', PATIENT, 'online', 'rzp_pay_1');

    expect(tx.appointment.update.mock.calls[0][0].data.status).toBe('upcoming');
    expect(tx.queueToken.updateMany).toHaveBeenCalledWith({
      where: { appointmentId: 'appt-1', status: 'on_hold' },
      data: { status: 'waiting' },
    });
  });

  test('an ordinary payment on an already-upcoming appointment does NOT touch appointment.status or queue tokens', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ status: 'upcoming' }));
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'cash', null);

    expect(tx.appointment.update.mock.calls[0][0].data.status).toBeUndefined();
    expect(tx.queueToken.updateMany).not.toHaveBeenCalled();
  });

  // ACCOUNTING FIX regression test (multi-agent payment audit — critical): a 'partial' appointment
  // used to ALWAYS recompute chargedAmount as totalAmount-alreadyPaid, silently discarding any
  // amount an 'online' caller passed — so if a second, real Razorpay-verified charge landed on an
  // already-partial appointment for a DIFFERENT amount than "whatever's left", the difference
  // vanished with no Payment row and no receipt. An 'online' caller's explicit amount (never a
  // client-supplied figure — see razorpay.service.js#verifyAndRecordPayment) must now be trusted
  // directly instead of clamped down.
  test('a "partial" appointment trusts an explicit amount from an ONLINE (Razorpay-verified) caller instead of silently recomputing it', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'partial' }));
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: dec(100) } });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    // The doctor's minimum advance (100) was already paid; a second Razorpay order for the FULL
    // amount (613.6) somehow also got verified — the real charge (613.6) must be recorded as-is,
    // not silently clamped to "totalAmount - alreadyPaid" (513.6).
    await paymentsService.createPaymentForAppointment('appt-1', PATIENT, 'online', 'rzp_pay_2', null, 613.6);

    expect(tx.payment.create.mock.calls[0][0].data.amount.toString()).toBe('613.6');
  });

  test('a "partial" appointment still auto-computes the remaining balance for a receptionist/admin counter payment (no explicit amount, any mode)', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'partial' }));
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: dec(100) } });
    tx.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', RECEPTIONIST_MATCHING(), 'cash', null);

    expect(tx.payment.create.mock.calls[0][0].data.amount.toString()).toBe('513.6'); // 613.6 - 100
  });
});

// REPLAY-PROTECTION regression tests (multi-agent payment audit — critical): resending an
// already-processed Razorpay verify request (same transactionRef) must be a safe no-op that
// returns the existing payment, never a second Payment row created off a recomputed/mismatched
// amount. See the "REPLAY-PROTECTION FIX" comment in createPaymentForAppointment.
describe('payments.service.createPaymentForAppointment — replay protection', () => {
  test('a repeated verify request with an already-recorded transactionRef returns the existing payment instead of creating a duplicate', async () => {
    const tx = makeTx({ payment: { create: jest.fn(), aggregate: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 'pay-existing' }) } });
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ paymentStatus: 'partial' }));
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ id: 'pay-existing' }));

    const result = await paymentsService.createPaymentForAppointment('appt-1', PATIENT, 'online', 'rzp_pay_1', null, 100);

    expect(tx.payment.findFirst).toHaveBeenCalledWith({
      where: { appointmentId: 'appt-1', transactionRef: 'rzp_pay_1' },
      select: { id: true },
    });
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.appointment.update).not.toHaveBeenCalled();
    expect(prisma.payment.findUnique).toHaveBeenCalledWith({ where: { id: 'pay-existing' }, select: expect.anything() });
    expect(result.id).toBe('pay-existing');
  });

  test('a null transactionRef (a cash payment with no reference number) never short-circuits — findFirst is not even queried', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'cash', null);

    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
  });
});

describe('payments.service.createPaymentForAppointment — notifications', () => {
  test('a payment that just confirmed a pending_payment booking pages BOTH the patient (booking-confirmed) and the doctor', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ status: 'pending_payment', tokenNumber: 42 }));
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', PATIENT, 'online', 'rzp_pay_1');

    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledWith(
      'patient-1',
      expect.objectContaining({ title: 'Payment received — booking confirmed' })
    );
    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledWith(
      'doctor-1',
      expect.objectContaining({ title: 'New booking confirmed' })
    );
  });

  test('an ordinary top-up payment only pages the patient — the doctor is not paged for routine payment admin', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow({ status: 'upcoming' }));
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPaymentForAppointment('appt-1', ADMIN, 'cash', null);

    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledWith(
      'patient-1',
      expect.objectContaining({ title: 'Payment received' })
    );
  });
});

describe('payments.service.createPayment — payer UPI id passthrough', () => {
  test('trims and forwards body.payerUpiId, and it comes back on the shaped result (never role-masked)', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    tx.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ payerUpiId: 'patient@okhdfcbank' }));

    const result = await paymentsService.createPayment(
      { appointmentId: 'appt-1', mode: 'upi', transactionRef: 'UTR12345', payerUpiId: '  patient@okhdfcbank  ' },
      RECEPTIONIST
    );

    expect(tx.payment.create.mock.calls[0][0].data.payerUpiId).toBe('patient@okhdfcbank');
    expect(result.payerUpiId).toBe('patient@okhdfcbank');
  });
});

describe('payments.service.shapePaymentFees — role-based masking (exercised via createPayment)', () => {
  test('a doctor sees ONLY consultationFee — every other money field is OMITTED, not nulled', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    const result = await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'cash' }, DOCTOR);

    expect(result.fees).toEqual({ consultationFee: expect.anything() });
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'amount')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'commission')).toBe(false);
  });

  test('a receptionist sees ONLY consultationFee — every other money field is OMITTED, not nulled', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    tx.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    const result = await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'cash' }, RECEPTIONIST);

    expect(result.fees).toEqual({ consultationFee: expect.anything() });
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'amount')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'commission')).toBe(false);
  });

  test('a patient sees the full fee breakdown but never commission/clinicPayout', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    const result = await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'online' }, PATIENT);

    expect(result.fees.amount.toString()).toBe('613.6');
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'commission')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'clinicPayout')).toBe(false);
  });

  test('admin without a resolvable commissionPercent gets null commission/clinicPayout, not a crash', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    commissionLookupService.loadCommissionPercentIfAdmin.mockResolvedValue(null);
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    const result = await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'cash' }, ADMIN);

    expect(result.fees.commission).toBeNull();
    expect(result.fees.clinicPayout).toBeNull();
  });

  // BUSINESS RULE CHANGE (request: "clinic ko jitna doctor decide kiya hai fee utna jayega baki
  // jo extra hai ye plateform charge me rakho") — clinicPayout is now this row's FULL
  // consultation-fee share (never reduced by a commission cut); platform commission is instead
  // whatever this row collected on top of that share (its convenience/emergency/GST share, i.e.
  // row.amount - consultationFeeShare). commissionPercent no longer drives this math — it's only
  // the "is this caller admin and does platformCharges exist" gate (still exercised by the
  // null-commissionPercent test right above).
  test('admin: for a normal, un-split, single full-payment row, clinicPayout is the full consultationFee and commission is everything charged on top', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    commissionLookupService.loadCommissionPercentIfAdmin.mockResolvedValue(dec(10)); // present only to pass the admin/config gate
    // amount (613.6) equals the row's own implied total (500+20+0+93.6) — ratio is exactly 1.
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ amount: dec(613.6) }));

    const result = await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'cash' }, ADMIN);

    // clinicPayout = 500 (the doctor's full consultation fee); commission = 613.6 - 500 = 113.6
    // (convenience fee 20 + GST 93.6).
    expect(result.fees.clinicPayout.toString()).toBe('500');
    expect(result.fees.commission.toString()).toBe('113.6');
  });

  test('admin: a SPLIT payment (this row collected only part of the appointment total) scales BOTH clinicPayout and commission by this row\'s share — regression test for the double-count bug the header comment describes', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    commissionLookupService.loadCommissionPercentIfAdmin.mockResolvedValue(dec(10)); // present only to pass the admin/config gate
    // Appointment's full fee columns still show 500/20/0/93.6 (implied total 613.6), but THIS row
    // only collected the doctor's 100 minimum advance out of that total.
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ amount: dec(100) }));

    const result = await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'online' }, ADMIN);

    // consultationFeeShare = 500 * (100/613.6) ≈ 81.49 -> clinicPayout ≈ 81.49;
    // commission = row.amount(100) - clinicPayout ≈ 18.51. Must NOT be 500/113.6 (the un-split
    // figures) — that would double-count both clinicPayout and commission across the two rows of
    // this split appointment.
    expect(Number(result.fees.clinicPayout.toString())).toBeCloseTo(81.49, 1);
    expect(Number(result.fees.commission.toString())).toBeCloseTo(18.51, 1);
    expect(Number(result.fees.clinicPayout.toString())).not.toBeCloseTo(500, 0);
    expect(Number(result.fees.commission.toString())).not.toBeCloseTo(113.6, 0);
  });
});

describe('payments.service.createStandalonePayment (exercised via createPayment with no appointmentId)', () => {
  const BODY = { patientUserId: 'patient-1', doctorUserId: 'doctor-1', mode: 'cash' };

  function mockHappyPathLookups(overrides = {}) {
    prisma.user.findUnique
      .mockResolvedValueOnce(overrides.patient !== undefined ? overrides.patient : { id: 'patient-1', role: 'patient', status: 'active' })
      .mockResolvedValueOnce(
        overrides.doctor !== undefined
          ? overrides.doctor
          : {
              id: 'doctor-1',
              status: 'active',
              doctorProfile: { status: 'verified', consultationFee: dec(500), emergencyAvailable: true },
            }
      );
    prisma.platformCharges.findUnique.mockResolvedValue(
      overrides.platformCharges !== undefined
        ? overrides.platformCharges
        : {
            applyConvenienceFee: true,
            patientConvenienceFee: dec(20),
            applyEmergencyFee: true,
            emergencyFee: dec(100),
            gstPercent: dec(18),
          }
    );
    redis.set.mockResolvedValue('OK');
  }

  test('404 PATIENT_NOT_FOUND when the patient row is missing/wrong role/inactive', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(paymentsService.createPayment(BODY, ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PATIENT_NOT_FOUND',
    });
  });

  test('404 DOCTOR_NOT_FOUND when the doctor is missing/not verified', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'patient-1', role: 'patient', status: 'active' })
      .mockResolvedValueOnce({ id: 'doctor-1', status: 'active', doctorProfile: { status: 'pending' } });
    prisma.platformCharges.findUnique.mockResolvedValue({});

    await expect(paymentsService.createPayment(BODY, ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'DOCTOR_NOT_FOUND',
    });
  });

  test('400 RECEPTIONIST_NOT_ASSIGNED when the receptionist has no clinic', async () => {
    mockHappyPathLookups();
    prisma.receptionistProfile.findUnique.mockResolvedValue(null);

    await expect(paymentsService.createPayment(BODY, RECEPTIONIST)).rejects.toMatchObject({
      statusCode: 400,
      code: 'RECEPTIONIST_NOT_ASSIGNED',
    });
  });

  test('400 DOCTOR_NOT_AT_CLINIC when the doctor isn\'t linked to the receptionist\'s clinic', async () => {
    mockHappyPathLookups();
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });
    prisma.doctorClinic.findUnique.mockResolvedValue(null);

    await expect(paymentsService.createPayment(BODY, RECEPTIONIST)).rejects.toMatchObject({
      statusCode: 400,
      code: 'DOCTOR_NOT_AT_CLINIC',
    });
  });

  test('a receptionist\'s clinicId is FORCED from their own profile, never trusted from the request body', async () => {
    mockHappyPathLookups();
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-real' });
    prisma.doctorClinic.findUnique.mockResolvedValue({ doctorUserId: 'doctor-1' });
    prisma.clinic.findUnique.mockResolvedValue({ emergencyAvailable: true });
    prisma.payment.create.mockResolvedValue({ id: 'pay-2' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ id: 'pay-2', clinicId: 'clinic-real', appointmentId: null }));

    await paymentsService.createPayment({ ...BODY, clinicId: 'clinic-attacker-supplied' }, RECEPTIONIST);

    expect(prisma.payment.create.mock.calls[0][0].data.clinicId).toBe('clinic-real');
  });

  test('404 CLINIC_NOT_FOUND when an admin passes a non-existent clinicId', async () => {
    mockHappyPathLookups();
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(paymentsService.createPayment({ ...BODY, clinicId: 'nope' }, ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLINIC_NOT_FOUND',
    });
  });

  test('500 PLATFORM_CHARGES_NOT_CONFIGURED when the singleton platform-charges row is missing', async () => {
    mockHappyPathLookups({ platformCharges: null });

    await expect(paymentsService.createPayment(BODY, ADMIN)).rejects.toMatchObject({
      statusCode: 500,
      code: 'PLATFORM_CHARGES_NOT_CONFIGURED',
    });
  });

  test('400 EMERGENCY_NOT_AVAILABLE when isEmergency is requested for a doctor without emergencyAvailable', async () => {
    mockHappyPathLookups({
      doctor: {
        id: 'doctor-1',
        status: 'active',
        doctorProfile: { status: 'verified', consultationFee: dec(500), emergencyAvailable: false },
      },
    });

    await expect(paymentsService.createPayment({ ...BODY, isEmergency: true }, ADMIN)).rejects.toMatchObject({
      statusCode: 400,
      code: 'EMERGENCY_NOT_AVAILABLE',
    });
  });

  test('computes consultationFee + convenienceFee server-side, with NO GST — a standalone/counter payment never went through the website\'s payment gateway', async () => {
    mockHappyPathLookups({
      platformCharges: {
        applyConvenienceFee: true,
        patientConvenienceFee: dec(20),
        applyEmergencyFee: false,
        emergencyFee: dec(0),
        gstPercent: dec(18),
      },
    });
    prisma.payment.create.mockResolvedValue({ id: 'pay-3' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ id: 'pay-3', appointmentId: null }));

    await paymentsService.createPayment(BODY, ADMIN);

    // subtotal = 500 + 20 = 520; GST FIX (superadmin request): GST only ever applies to the
    // portion of a fee paid online through the website (Razorpay) — this is a receptionist/admin
    // typing in a payment collected in person at the counter, so gstAmount stays 0 no matter what
    // platformCharges.gstPercent is configured to. amount = subtotal + 0 = 520.
    const data = prisma.payment.create.mock.calls[0][0].data;
    expect(data.consultationFee.toString()).toBe('500');
    expect(data.convenienceFee.toString()).toBe('20');
    expect(data.emergencyFee.toString()).toBe('0');
    expect(data.gstAmount.toString()).toBe('0');
    expect(data.amount.toString()).toBe('520');
  });

  test('GST is skipped even when platformCharges.gstPercent is non-zero and fees are rounding-sensitive', async () => {
    mockHappyPathLookups({
      doctor: {
        id: 'doctor-1',
        status: 'active',
        doctorProfile: { status: 'verified', consultationFee: dec(333), emergencyAvailable: true },
      },
      platformCharges: {
        applyConvenienceFee: false,
        patientConvenienceFee: dec(0),
        applyEmergencyFee: false,
        emergencyFee: dec(0),
        gstPercent: dec(18),
      },
    });
    prisma.payment.create.mockResolvedValue({ id: 'pay-4' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ id: 'pay-4', appointmentId: null }));

    await paymentsService.createPayment(BODY, ADMIN);

    // subtotal = 333; a non-zero gstPercent (18%) is configured but must never be applied here.
    const data = prisma.payment.create.mock.calls[0][0].data;
    expect(data.gstAmount.toString()).toBe('0');
    expect(data.amount.toString()).toBe('333');
  });

  test('the double-submit guard rejects an identical repeat submission with 409 DUPLICATE_PAYMENT_SUBMISSION', async () => {
    mockHappyPathLookups();
    redis.set.mockResolvedValue(null); // Redis SET ... NX returned nothing => key already held.

    await expect(paymentsService.createPayment(BODY, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DUPLICATE_PAYMENT_SUBMISSION',
    });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  test('the idempotency key is scoped by requester+clinic+patient+doctor+amount (SET ... PX ... NX)', async () => {
    mockHappyPathLookups();
    prisma.payment.create.mockResolvedValue({ id: 'pay-5' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ id: 'pay-5', appointmentId: null }));

    await paymentsService.createPayment(BODY, ADMIN);

    // amount = 500 (consultation) + 20 (convenience) + 0 GST (standalone payments never carry
    // GST — see the "computes consultationFee..." test above) = 520.00.
    expect(redis.set).toHaveBeenCalledWith(
      `lock:payment:standalone:${ADMIN.id}:none:patient-1:doctor-1:520.00`,
      '1',
      'PX',
      10000,
      'NX'
    );
  });

  test('a receipt number is never drawn until after the idempotency guard passes', async () => {
    mockHappyPathLookups();
    redis.set.mockResolvedValue(null);

    await expect(paymentsService.createPayment(BODY, ADMIN)).rejects.toMatchObject({ code: 'DUPLICATE_PAYMENT_SUBMISSION' });

    expect(idGenerators.nextReceiptNumber).not.toHaveBeenCalled();
  });
});

describe('payments.service.createPayment — logging and cache invalidation', () => {
  test('logs a payment.create activity entry without any raw card/UPI details, just the transaction ref', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'card', transactionRef: ' txn-99 ' }, ADMIN);

    expect(activityLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-1',
        actionType: 'payment.create',
        targetEntityType: 'payment',
        targetEntityId: 'pay-1',
      })
    );
  });

  test('trims a whitespace-padded transactionRef before recording it', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'card', transactionRef: '  txn-99  ' }, ADMIN);

    expect(tx.payment.create.mock.calls[0][0].data.transactionRef).toBe('txn-99');
  });

  test('busts the payments-list caches for patient/doctor/clinic scopes plus admin', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'cash' }, ADMIN);

    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:payments:list:patient:patient-1:*');
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:payments:list:doctor:doctor-1:*');
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:payments:list:receptionist:clinic-1:*');
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:payments:list:admin:*');
  });

  test('when appointmentId is present, also busts the appointments-list caches via the lazy cross-module require', async () => {
    const tx = makeTx();
    tx.appointment.findUnique.mockResolvedValue(buildAppointmentRow());
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    await paymentsService.createPayment({ appointmentId: 'appt-1', mode: 'cash' }, ADMIN);

    expect(appointmentsService.invalidateAppointmentListCaches).toHaveBeenCalledWith({
      patientUserId: 'patient-1',
      doctorUserId: 'doctor-1',
      clinicId: 'clinic-1',
    });
  });

  test('a standalone payment (no appointmentId) never touches the appointments-list cache', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'patient-1', role: 'patient', status: 'active' })
      .mockResolvedValueOnce({
        id: 'doctor-1',
        status: 'active',
        doctorProfile: { status: 'verified', consultationFee: dec(500), emergencyAvailable: true },
      });
    prisma.platformCharges.findUnique.mockResolvedValue({
      applyConvenienceFee: false,
      patientConvenienceFee: dec(0),
      applyEmergencyFee: false,
      emergencyFee: dec(0),
      gstPercent: dec(0),
    });
    redis.set.mockResolvedValue('OK');
    prisma.payment.create.mockResolvedValue({ id: 'pay-6' });
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ id: 'pay-6', appointmentId: null }));

    await paymentsService.createPayment({ patientUserId: 'patient-1', doctorUserId: 'doctor-1', mode: 'cash' }, ADMIN);

    expect(appointmentsService.invalidateAppointmentListCaches).not.toHaveBeenCalled();
  });
});

describe('payments.service.getPaymentById / getVisiblePaymentOrThrow — visibility', () => {
  test('404 PAYMENT_NOT_FOUND when no such payment exists', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    await expect(paymentsService.getPaymentById('nope', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
    });
  });

  test('404 (not 403) for a patient who does not own the payment', async () => {
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ patientUserId: 'someone-else' }));

    await expect(paymentsService.getPaymentById('pay-1', PATIENT)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
    });
  });

  test('the owning patient can view their own payment', async () => {
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    const result = await paymentsService.getPaymentById('pay-1', PATIENT);

    expect(result.id).toBe('pay-1');
  });

  test('the treating doctor can view the payment', async () => {
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    const result = await paymentsService.getPaymentById('pay-1', DOCTOR);

    expect(result.id).toBe('pay-1');
  });

  test('an unrelated doctor gets 404', async () => {
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow({ doctorUserId: 'someone-else' }));

    await expect(paymentsService.getPaymentById('pay-1', DOCTOR)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
    });
  });

  test('a receptionist at the matching clinic can view the payment', async () => {
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });

    const result = await paymentsService.getPaymentById('pay-1', RECEPTIONIST);

    expect(result.id).toBe('pay-1');
  });

  test('a receptionist at a different clinic gets 404', async () => {
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'other-clinic' });

    await expect(paymentsService.getPaymentById('pay-1', RECEPTIONIST)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
    });
  });

  test('admin/superadmin can view any payment', async () => {
    prisma.payment.findUnique.mockResolvedValue(buildPaymentRow());

    const result = await paymentsService.getPaymentById('pay-1', { id: 'sa-1', role: 'superadmin' });

    expect(result.id).toBe('pay-1');
  });
});

describe('payments.service.listPayments — forced role scoping and pagination', () => {
  beforeEach(() => {
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
  });

  test('a patient\'s query is forced to their own patientUserId regardless of query params', async () => {
    await paymentsService.listPayments({ patientId: 'someone-else', doctorId: 'x' }, PATIENT);

    const where = prisma.payment.findMany.mock.calls[0][0].where;
    expect(where.patientUserId).toBe('patient-1');
    expect(where.doctorUserId).toBeUndefined();
  });

  test('a doctor\'s query is forced to their own doctorUserId', async () => {
    await paymentsService.listPayments({}, DOCTOR);

    expect(prisma.payment.findMany.mock.calls[0][0].where.doctorUserId).toBe('doctor-1');
  });

  test('a receptionist with no assigned clinic gets an empty page without ever querying payments', async () => {
    prisma.receptionistProfile.findUnique.mockResolvedValue(null);

    const result = await paymentsService.listPayments({}, RECEPTIONIST);

    expect(result).toEqual({ rows: [], pagination: expect.objectContaining({ total: 0 }) });
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  test('a receptionist is scoped to their own clinicId', async () => {
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });

    await paymentsService.listPayments({}, RECEPTIONIST);

    expect(prisma.payment.findMany.mock.calls[0][0].where.clinicId).toBe('clinic-1');
  });

  test('admin may filter by any of appointmentId/patientId/doctorId/clinicId', async () => {
    await paymentsService.listPayments(
      { appointmentId: 'a1', patientId: 'p1', doctorId: 'd1', clinicId: 'c1' },
      ADMIN
    );

    expect(prisma.payment.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ appointmentId: 'a1', patientUserId: 'p1', doctorUserId: 'd1', clinicId: 'c1' })
    );
  });

  test('rows are shaped per requester role (a doctor sees only consultationFee in the list too)', async () => {
    prisma.payment.findMany.mockResolvedValue([buildPaymentRow()]);
    prisma.payment.count.mockResolvedValue(1);

    const result = await paymentsService.listPayments({}, DOCTOR);

    expect(result.rows[0].fees).toEqual({ consultationFee: expect.anything() });
  });
});

describe('payments.service.invalidatePaymentListCaches', () => {
  test('busts only the scopes that were actually passed, plus admin unconditionally', async () => {
    await paymentsService.invalidatePaymentListCaches({ patientUserId: 'p1' });

    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:payments:list:patient:p1:*');
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:payments:list:admin:*');
    expect(cacheService.invalidate).not.toHaveBeenCalledWith(expect.stringContaining(':doctor:'));
  });
});

// Small helper kept at the bottom so the "partial appointment" test above stays a one-liner:
// a fresh receptionist object matching the fixture's clinicId, distinct from the module-level
// RECEPTIONIST constant so it never shares mock call history with other describe blocks.
function RECEPTIONIST_MATCHING() {
  return { id: 'recep-1', role: 'receptionist' };
}
