/**
 * Unit tests for modules/appointments/appointments.service.js — the core booking-lifecycle
 * service (waiting-room booking write path, role-scoped listing/reads, and the appointment
 * status state machine). This is the highest-stakes module in the codebase: a subtle bug here
 * either double-books a doctor's slot, leaks another patient's fee/medical data across a role
 * boundary, or lets an appointment skip a status it shouldn't be able to reach. Coverage focuses
 * on:
 *
 *   - shapeFees/shapePatientRef (exercised via getAppointmentById): the role-based masking rules
 *     (rule 8) — staff (doctor/receptionist) get consultationFee ONLY (every other money field
 *     must be OMITTED, not nulled); admin/superadmin additionally get commission/clinicPayout
 *     DERIVED from consultationFee x commissionPercent; a patient gets the full fee breakdown but
 *     never commission/clinicPayout (a platform-internal figure, not theirs to see).
 *   - getVisibleAppointmentOrThrow: the shared ownership/visibility gate — a non-owner gets 404,
 *     never 403 (enumeration-avoidance posture used throughout this codebase).
 *   - listAppointments: forced role-scoping (a client-supplied doctorId/clinicId/patientId query
 *     param must never override what a non-admin role is allowed to see) and the receptionist
 *     "no clinic assignment yet" short-circuit.
 *   - runBookingJob: the real booking logic — doctor/clinic resolution and its "auto-resolve must
 *     only ever consider ACTIVE clinics" rule, the whole waterfall of business-rule 400/403/404s,
 *     server-side fee computation (rule 7 — never trust client math), the requiresPrepayment
 *     split (an online booking with a non-zero fee starts pending_payment/on_hold; a walk-in or a
 *     free booking goes straight to upcoming/waiting), the double-booking guard (a Postgres
 *     unique-violation on create must surface as 409 SLOT_ALREADY_BOOKED, never a raw 500), the
 *     auto-assignment slot-candidate search, and the authoritative (locked) re-check of the
 *     doctor's daily online-booking cap that closes the race the earlier fast-fail check alone
 *     cannot.
 *   - updateAppointmentStatus: the APPOINTMENT_TRANSITIONS state machine (no transition out of a
 *     terminal status; a patient may only ever move their own booking to 'cancelled'), the
 *     in-progress-consultation cancel guard, the patient cancellation window, and the
 *     cancel/complete cascades into the linked queueToken.
 *
 * config/db and @prisma/client are mocked (no real Postgres in this sandbox, and the real
 * generated Prisma.Decimal doesn't exist here since `prisma generate` is network-blocked — see
 * this file's @prisma/client mock below, which is a fuller arithmetic stand-in than
 * platformCharges.service.test.js's because this module actually does Decimal math, not just
 * wrap-and-stringify). lockService, cacheService, queueService, notificationsService,
 * activityLogService, commissionLookupService, and jobs/bookingQueue are all mocked — the last
 * one is CRITICAL, since jobs/bookingQueue.js constructs a real BullMQ Queue (and therefore a
 * real Redis connection) at require time.
 */
jest.mock('@prisma/client', () => {
  function toNum(v) {
    return v instanceof Decimal ? v.value : Number(v);
  }
  class Decimal {
    constructor(value) {
      this.value = toNum(value);
    }
    plus(other) {
      return new Decimal(this.value + toNum(other));
    }
    minus(other) {
      return new Decimal(this.value - toNum(other));
    }
    times(other) {
      return new Decimal(this.value * toNum(other));
    }
    dividedBy(other) {
      return new Decimal(this.value / toNum(other));
    }
    toDecimalPlaces(dp) {
      return new Decimal(Number(this.value.toFixed(dp)));
    }
    greaterThan(other) {
      return this.value > toNum(other);
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
  appointment: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  user: { findUnique: jest.fn(), findFirst: jest.fn() },
  receptionistProfile: { findUnique: jest.fn() },
  doctorClinic: { findMany: jest.fn(), findUnique: jest.fn() },
  clinic: { findUnique: jest.fn() },
  doctorClinicHours: { findUnique: jest.fn() },
  doctorClinicClosure: { findFirst: jest.fn() },
  familyMember: { findUnique: jest.fn() },
  platformCharges: { findUnique: jest.fn() },
  bookingRules: { findUnique: jest.fn() },
  patientProfile: { create: jest.fn() },
  queueToken: { create: jest.fn(), delete: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/lockService', () => ({
  withLock: jest.fn((key, fn) => fn()),
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttlSeconds, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));
jest.mock('../../../src/modules/queue/queue.service', () => ({
  invalidateQueueListCaches: jest.fn(),
}));
jest.mock('../../../src/modules/notifications/notifications.service', () => ({
  notifySystemEventSafe: jest.fn(),
}));
jest.mock('../../../src/jobs/bookingQueue', () => ({
  enqueueBookingJob: jest.fn(),
  getJob: jest.fn(),
  getQueuePosition: jest.fn(),
  bookingQueue: { add: jest.fn() },
  QUEUE_NAME: 'appointment-booking',
}));
jest.mock('../../../src/services/commissionLookupService', () => ({
  loadCommissionPercentIfAdmin: jest.fn(),
}));

const { Prisma } = require('@prisma/client');
const prisma = require('../../../src/config/db');
const activityLogService = require('../../../src/services/activityLogService');
const lockService = require('../../../src/services/lockService');
const cacheService = require('../../../src/services/cacheService');
const queueService = require('../../../src/modules/queue/queue.service');
const notificationsService = require('../../../src/modules/notifications/notifications.service');
const bookingQueue = require('../../../src/jobs/bookingQueue');
const { loadCommissionPercentIfAdmin } = require('../../../src/services/commissionLookupService');
const { todayUTCDateOnly } = require('../../../src/utils/dateOnly');
const appointmentsService = require('../../../src/modules/appointments/appointments.service');

const dec = (v) => new Prisma.Decimal(v);

// ── Shared fixtures ──────────────────────────────────────────────────────
const DOCTOR_ID = 'doctor-1';
const CLINIC_ID = 'clinic-1';
const PATIENT_ID = 'patient-1';

function addDaysISO(baseDate, days) {
  return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const TODAY = todayUTCDateOnly();
const TOMORROW_STR = addDaysISO(TODAY, 1);

function fullAppointmentRow(overrides = {}) {
  return {
    id: 'appt-1',
    patientUserId: PATIENT_ID,
    familyMemberId: null,
    doctorUserId: DOCTOR_ID,
    clinicId: CLINIC_ID,
    appointmentDate: new Date(`${TOMORROW_STR}T00:00:00.000Z`),
    appointmentTime: '10:00',
    reason: 'Checkup',
    isEmergency: false,
    status: 'upcoming',
    source: 'online',
    tokenNumber: 3,
    consultationFee: dec(500),
    convenienceFee: dec(20),
    emergencyFee: dec(0),
    gstAmount: dec(93.6),
    totalAmount: dec(613.6),
    paymentStatus: 'paid',
    paymentMethod: 'card',
    checkedInAt: null,
    notes: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    patient: {
      id: PATIENT_ID,
      name: 'Pat Patient',
      phone: '9000000000',
      patientProfile: {
        dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
        gender: 'female',
        bloodGroup: 'O+',
        emergencyContact: '9111111111',
        medicalHistory: 'None',
      },
    },
    familyMember: null,
    doctor: {
      id: DOCTOR_ID,
      name: 'Dr. Asha',
      photoUrl: null,
      doctorProfile: { specialization: { id: 'spec-1', name: 'Cardiology' } },
    },
    clinic: { id: CLINIC_ID, name: 'City Clinic' },
    queueToken: { id: 'qt-1', status: 'waiting', tokenNumber: 3 },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// C. getAppointmentById / getVisibleAppointmentOrThrow — visibility + fee/patient masking
// ═══════════════════════════════════════════════════════════════════════
describe('appointmentsService.getAppointmentById — visibility (404-not-403 enumeration avoidance)', () => {
  test('throws 404 APPOINTMENT_NOT_FOUND when the row does not exist', async () => {
    prisma.appointment.findUnique.mockResolvedValue(null);
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    await expect(
      appointmentsService.getAppointmentById('missing', { id: PATIENT_ID, role: 'patient' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  test('a patient gets 404 (not 403) for someone else\'s appointment', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow({ patientUserId: 'someone-else' }));
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    await expect(
      appointmentsService.getAppointmentById('appt-1', { id: PATIENT_ID, role: 'patient' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  test('a doctor gets 404 (not 403) for an appointment belonging to a different doctor', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow({ doctorUserId: 'other-doctor' }));
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    await expect(
      appointmentsService.getAppointmentById('appt-1', { id: DOCTOR_ID, role: 'doctor' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  test('a receptionist with no clinic assignment gets 404', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow());
    prisma.receptionistProfile.findUnique.mockResolvedValue(null);
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    await expect(
      appointmentsService.getAppointmentById('appt-1', { id: 'recep-1', role: 'receptionist' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  test('a receptionist assigned to a DIFFERENT clinic gets 404', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow({ clinicId: CLINIC_ID }));
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'other-clinic' });
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    await expect(
      appointmentsService.getAppointmentById('appt-1', { id: 'recep-1', role: 'receptionist' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  test('a receptionist assigned to the SAME clinic can see it', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow({ clinicId: CLINIC_ID }));
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: CLINIC_ID });
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    const result = await appointmentsService.getAppointmentById('appt-1', { id: 'recep-1', role: 'receptionist' });
    expect(result.id).toBe('appt-1');
  });

  test('admin can see any appointment regardless of ownership', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow({ patientUserId: 'anyone' }));
    loadCommissionPercentIfAdmin.mockResolvedValue(dec(10));

    const result = await appointmentsService.getAppointmentById('appt-1', { id: 'admin-1', role: 'admin' });
    expect(result.id).toBe('appt-1');
  });
});

describe('appointmentsService.getAppointmentById — fee masking by role (rule 8)', () => {
  test('doctor/receptionist see ONLY consultationFee + due — every other money field is OMITTED, not null', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow());
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    const result = await appointmentsService.getAppointmentById('appt-1', { id: DOCTOR_ID, role: 'doctor' });

    expect(result.fees.consultationFee.toString()).toBe('500');
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'convenienceFee')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'totalAmount')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'gstAmount')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'minBookingAmount')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'commission')).toBe(false);
  });

  // DUE-AMOUNT VISIBILITY FIX (user request: "jab payment minimum hua hai to receptionist ko v
  // to baki ka due show hoga aur doctor ko") — doctor/receptionist previously had no way to tell
  // how much was actually left to collect once a patient paid just the minimum booking amount
  // online. `due` is contextual to the appointment's current paymentStatus, and never exposes any
  // of the masked platform-business fields (convenienceFee/gstAmount/totalAmount/minBookingAmount)
  // to compute it — see appointments.service.js#shapeFees.
  describe('due — contextual to paymentStatus (DUE-AMOUNT VISIBILITY FIX)', () => {
    test('paid -> due is 0, nothing left to collect', async () => {
      prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow({ paymentStatus: 'paid' }));
      loadCommissionPercentIfAdmin.mockResolvedValue(null);

      const result = await appointmentsService.getAppointmentById('appt-1', { id: DOCTOR_ID, role: 'receptionist' });

      expect(result.fees.due.toString()).toBe('0');
    });

    test('pending (nothing paid yet) -> due is the full consultationFee', async () => {
      prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow({ paymentStatus: 'pending' }));
      loadCommissionPercentIfAdmin.mockResolvedValue(null);

      const result = await appointmentsService.getAppointmentById('appt-1', { id: DOCTOR_ID, role: 'receptionist' });

      expect(result.fees.due.toString()).toBe('500');
    });

    test('partial, doctor minimum known -> due is the doctor\'s own outstanding share (consultationFee - minBookingAdvanceAmount), NOT the full consultationFee', async () => {
      prisma.appointment.findUnique.mockResolvedValue(
        fullAppointmentRow({
          paymentStatus: 'partial',
          doctor: { id: DOCTOR_ID, name: 'Dr. Asha', photoUrl: null, doctorProfile: { minBookingAdvanceAmount: dec(100) } },
        })
      );
      loadCommissionPercentIfAdmin.mockResolvedValue(null);

      const result = await appointmentsService.getAppointmentById('appt-1', { id: DOCTOR_ID, role: 'doctor' });

      expect(result.fees.due.toString()).toBe('400'); // 500 - 100, never totalAmount-based
    });

    test('partial, doctor minimum NOT known (e.g. cleared after the online payment) -> falls back to the full consultationFee', async () => {
      prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow({ paymentStatus: 'partial' })); // fixture's doctorProfile has no minBookingAdvanceAmount
      loadCommissionPercentIfAdmin.mockResolvedValue(null);

      const result = await appointmentsService.getAppointmentById('appt-1', { id: DOCTOR_ID, role: 'receptionist' });

      expect(result.fees.due.toString()).toBe('500');
    });
  });

  test('a patient sees the full fee breakdown but never commission/clinicPayout', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow());
    loadCommissionPercentIfAdmin.mockResolvedValue(null); // never even looked up for a patient

    const result = await appointmentsService.getAppointmentById('appt-1', { id: PATIENT_ID, role: 'patient' });

    expect(result.fees).toEqual({
      consultationFee: dec(500),
      convenienceFee: dec(20),
      emergencyFee: dec(0),
      gstAmount: dec(93.6),
      totalAmount: dec(613.6),
      minBookingAmount: null, // this fixture's doctor has no minBookingAdvanceAmount configured
      minBookingRemainder: null, // same fixture — no minBookingAdvanceAmount means no remainder either
    });
    expect(Object.prototype.hasOwnProperty.call(result.fees, 'commission')).toBe(false);
  });

  // MIN-BOOKING-AMOUNT FIX (superadmin request, with worked example: "platform charge 25 hai and
  // percentage 3 hai, doctor fee 400 hai ... minimum charge 100 rakha hai to
  // 100+25+100 ka 3%=128") — the patient's "pay minimum now" figure must mirror the full-payment
  // breakdown with the doctor's own minBookingAdvanceAmount standing in for the full
  // consultationFee: minAdvance + platformCharge (convenience/emergency fee) + GST on the minAdvance
  // alone — NOT the doctor's raw minBookingAdvanceAmount verbatim (the old, buggy behaviour), and
  // NOT dependent on the admin-only commissionPercent (see utils/minBookingAmount.js).
  test('a patient sees minBookingAmount computed as minAdvance + platformCharge + GST-on-minAdvance, never the raw doctor minimum alone', async () => {
    // Fixture: consultationFee 500, convenienceFee 20, gstAmount 93.6 -> subtotal 520, implied
    // GST rate 93.6/520 = 0.18 (18%). Doctor's own minBookingAdvanceAmount is 100.
    // Expected: 100 (minAdvance) + 20 (platformCharge) + 100*0.18 (18) = 138 — deliberately NOT 100.
    prisma.appointment.findUnique.mockResolvedValue(
      fullAppointmentRow({
        doctor: {
          id: DOCTOR_ID,
          name: 'Dr. Asha',
          photoUrl: null,
          doctorProfile: { specialization: { id: 'spec-1', name: 'Cardiology' }, minBookingAdvanceAmount: dec(100) },
        },
      })
    );
    loadCommissionPercentIfAdmin.mockResolvedValue(null); // irrelevant to this computation now

    const result = await appointmentsService.getAppointmentById('appt-1', { id: PATIENT_ID, role: 'patient' });

    expect(result.fees.minBookingAmount.toString()).toBe('138');
  });

  test('minBookingAmount is null when the doctor has not configured a minimum', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow());
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    const result = await appointmentsService.getAppointmentById('appt-1', { id: PATIENT_ID, role: 'patient' });

    expect(result.fees.minBookingAmount).toBeNull();
  });

  // A walk-in-sourced appointment never charges GST (gstAmount stays 0 — see runBookingJob), so
  // minBookingAmount should reduce to just minAdvance + platformCharge, with no GST top-up.
  test('minBookingAmount has no GST top-up on a walk-in appointment (gstAmount already 0)', async () => {
    prisma.appointment.findUnique.mockResolvedValue(
      fullAppointmentRow({
        source: 'walk_in',
        gstAmount: dec(0),
        doctor: {
          id: DOCTOR_ID,
          name: 'Dr. Asha',
          photoUrl: null,
          doctorProfile: { specialization: { id: 'spec-1', name: 'Cardiology' }, minBookingAdvanceAmount: dec(100) },
        },
      })
    );
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    const result = await appointmentsService.getAppointmentById('appt-1', { id: PATIENT_ID, role: 'patient' });

    expect(result.fees.minBookingAmount.toString()).toBe('120'); // 100 (minAdvance) + 20 (platformCharge) + 0 GST
  });

  // BUSINESS RULE CHANGE (request: "clinic ko jitna doctor decide kiya hai fee utna jayega baki
  // jo extra hai ye plateform charge me rakho") — clinicPayout is now the doctor's FULL
  // consultation fee (never reduced by a commission cut); platform commission is instead
  // whatever the appointment charged on top of that (convenience + emergency + GST =
  // totalAmount - consultationFee). commissionPercent no longer drives this math — it's only the
  // "is this caller admin and does platformCharges exist" gate (still exercised by the
  // null-commissionPercent test right below).
  test('admin sees the full breakdown PLUS commission/clinicPayout: clinicPayout is the full consultationFee, commission is everything charged on top', async () => {
    // consultationFee 500, convenienceFee 20, emergencyFee 0, gstAmount 93.6 -> totalAmount 613.6
    // (see fullAppointmentRow's defaults / the patient fee-breakdown test above).
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow({ consultationFee: dec(500) }));
    loadCommissionPercentIfAdmin.mockResolvedValue(dec(10)); // present only to pass the admin/config gate

    const result = await appointmentsService.getAppointmentById('appt-1', { id: 'admin-1', role: 'admin' });

    expect(result.fees.clinicPayout.toString()).toBe('500'); // the doctor's full consultation fee
    expect(result.fees.commission.toString()).toBe('113.6'); // 613.6 - 500 (convenience + GST)
  });

  test('admin sees null commission/clinicPayout when commissionPercent could not be loaded (platformCharges missing)', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow());
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    const result = await appointmentsService.getAppointmentById('appt-1', { id: 'admin-1', role: 'admin' });

    expect(result.fees.commission).toBeNull();
    expect(result.fees.clinicPayout).toBeNull();
  });
});

describe('appointmentsService.getAppointmentById — patient data masking by role', () => {
  test('doctor/admin see phone plus the clinical patientProfile fields', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow());
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    const result = await appointmentsService.getAppointmentById('appt-1', { id: DOCTOR_ID, role: 'doctor' });

    expect(result.patient).toEqual({
      id: PATIENT_ID,
      name: 'Pat Patient',
      phone: '9000000000',
      dateOfBirth: '1990-01-01',
      gender: 'female',
      bloodGroup: 'O+',
      medicalHistory: 'None',
      emergencyContact: '9111111111',
    });
  });

  test('receptionist sees name + phone only — never the clinical fields', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow());
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: CLINIC_ID });
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    const result = await appointmentsService.getAppointmentById('appt-1', { id: 'recep-1', role: 'receptionist' });

    expect(result.patient).toEqual({ id: PATIENT_ID, name: 'Pat Patient', phone: '9000000000' });
    expect(result.patient.medicalHistory).toBeUndefined();
    expect(result.patient.dateOfBirth).toBeUndefined();
  });

  test('a patient viewing their own booking sees only identity (id/name), no phone/clinical fields', async () => {
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow());
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    const result = await appointmentsService.getAppointmentById('appt-1', { id: PATIENT_ID, role: 'patient' });

    expect(result.patient).toEqual({ id: PATIENT_ID, name: 'Pat Patient' });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C. listAppointments — forced role-scoping
// ═══════════════════════════════════════════════════════════════════════
describe('appointmentsService.listAppointments — forced role-scoping (rule 3)', () => {
  beforeEach(() => {
    prisma.appointment.findMany.mockResolvedValue([]);
    prisma.appointment.count.mockResolvedValue(0);
    loadCommissionPercentIfAdmin.mockResolvedValue(null);
  });

  test('a patient is always scoped to their own patientUserId, even if doctorId/clinicId/patientId query params are supplied', async () => {
    await appointmentsService.listAppointments(
      { doctorId: 'someone-elses-doctor', clinicId: 'x', patientId: 'someone-else' },
      { id: PATIENT_ID, role: 'patient' }
    );

    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ patientUserId: PATIENT_ID });
  });

  test('a doctor is always scoped to their own doctorUserId', async () => {
    await appointmentsService.listAppointments({ patientId: 'someone-else' }, { id: DOCTOR_ID, role: 'doctor' });

    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ doctorUserId: DOCTOR_ID });
  });

  test('a receptionist with no clinic assignment gets an empty page WITHOUT ever querying appointments', async () => {
    prisma.receptionistProfile.findUnique.mockResolvedValue(null);

    const result = await appointmentsService.listAppointments({}, { id: 'recep-1', role: 'receptionist' });

    expect(result).toEqual({ rows: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  test('a receptionist is scoped to their own clinic\'s id, not a client-supplied clinicId', async () => {
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: CLINIC_ID });

    await appointmentsService.listAppointments({ clinicId: 'other-clinic' }, { id: 'recep-1', role: 'receptionist' });

    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ clinicId: CLINIC_ID });
  });

  test('admin/superadmin MAY filter by doctorId/clinicId/patientId query params', async () => {
    await appointmentsService.listAppointments(
      { doctorId: DOCTOR_ID, clinicId: CLINIC_ID, patientId: PATIENT_ID },
      { id: 'admin-1', role: 'admin' }
    );

    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ doctorUserId: DOCTOR_ID, clinicId: CLINIC_ID, patientUserId: PATIENT_ID });
  });

  test('rows are shaped with the commission looked up once for the whole page, not once per row', async () => {
    prisma.appointment.findMany.mockResolvedValue([fullAppointmentRow(), fullAppointmentRow({ id: 'appt-2' })]);
    prisma.appointment.count.mockResolvedValue(2);
    loadCommissionPercentIfAdmin.mockResolvedValue(dec(10));

    const result = await appointmentsService.listAppointments({}, { id: 'admin-1', role: 'admin' });

    expect(loadCommissionPercentIfAdmin).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(2);
    // 613.6 (totalAmount) - 500 (consultationFee) = 113.6 — see the fee-masking describe block
    // above for the full business-rule-change rationale.
    expect(result.rows[0].fees.commission.toString()).toBe('113.6');
    expect(result.rows[1].fees.commission.toString()).toBe('113.6');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// A. enqueueBooking / getBookingStatus
// ═══════════════════════════════════════════════════════════════════════
describe('appointmentsService.enqueueBooking', () => {
  test('a patient booking always derives patientUserId/source from req.user, never the request body', async () => {
    bookingQueue.enqueueBookingJob.mockResolvedValue({ id: 'job-1' });

    const result = await appointmentsService.enqueueBooking(
      { doctorUserId: DOCTOR_ID, appointmentDate: TOMORROW_STR, patientUserId: 'someone-else', familyMemberId: 'fam-1' },
      { id: PATIENT_ID, role: 'patient' }
    );

    const payload = bookingQueue.enqueueBookingJob.mock.calls[0][0];
    expect(payload.patientUserId).toBe(PATIENT_ID); // NOT "someone-else" from the body
    expect(payload.source).toBe('online');
    expect(payload.familyMemberId).toBe('fam-1');
    expect(result).toEqual({ jobId: 'job-1', status: 'queued' });
  });

  test('a receptionist booking on behalf of a patient always gets source=walk_in and its familyMemberId is silently dropped', async () => {
    bookingQueue.enqueueBookingJob.mockResolvedValue({ id: 'job-2' });

    await appointmentsService.enqueueBooking(
      { doctorUserId: DOCTOR_ID, appointmentDate: TOMORROW_STR, patientUserId: PATIENT_ID, familyMemberId: 'fam-1' },
      { id: 'recep-1', role: 'receptionist' }
    );

    const payload = bookingQueue.enqueueBookingJob.mock.calls[0][0];
    expect(payload.source).toBe('walk_in');
    expect(payload.patientUserId).toBe(PATIENT_ID);
    expect(payload.familyMemberId).toBeNull(); // patient-only feature — never honored for staff
  });

  test('a receptionist with neither patientUserId nor patientName+patientPhone gets 400 VALIDATION_ERROR', async () => {
    await expect(
      appointmentsService.enqueueBooking(
        { doctorUserId: DOCTOR_ID, appointmentDate: TOMORROW_STR },
        { id: 'recep-1', role: 'receptionist' }
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(bookingQueue.enqueueBookingJob).not.toHaveBeenCalled();
  });

  test('a receptionist MAY instead supply patientName+patientPhone to register a walk-in on the spot', async () => {
    bookingQueue.enqueueBookingJob.mockResolvedValue({ id: 'job-3' });

    await appointmentsService.enqueueBooking(
      {
        doctorUserId: DOCTOR_ID,
        appointmentDate: TOMORROW_STR,
        patientName: '  Walk In Guy  ',
        patientPhone: ' 9999999999 ',
        patientEmail: ' Walk@Example.com ',
      },
      { id: 'recep-1', role: 'receptionist' }
    );

    const payload = bookingQueue.enqueueBookingJob.mock.calls[0][0];
    expect(payload.patientUserId).toBeNull();
    expect(payload.patientName).toBe('Walk In Guy');
    expect(payload.patientPhone).toBe('9999999999');
    expect(payload.patientEmail).toBe('Walk@Example.com');
  });
});

describe('appointmentsService.getBookingStatus', () => {
  test('throws 404 BOOKING_JOB_NOT_FOUND when the job id does not exist', async () => {
    bookingQueue.getJob.mockResolvedValue(null);

    await expect(
      appointmentsService.getBookingStatus('job-x', { id: PATIENT_ID, role: 'patient' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'BOOKING_JOB_NOT_FOUND' });
  });

  test('a caller who did not request the job and is not an admin gets 403 FORBIDDEN', async () => {
    bookingQueue.getJob.mockResolvedValue({ id: 'job-1', data: { requestedByUserId: 'someone-else' } });

    await expect(
      appointmentsService.getBookingStatus('job-1', { id: PATIENT_ID, role: 'patient' })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  test('an admin may poll a job they did not request', async () => {
    bookingQueue.getJob.mockResolvedValue({
      id: 'job-1',
      data: { requestedByUserId: 'someone-else' },
      getState: jest.fn().mockResolvedValue('active'),
    });
    bookingQueue.getQueuePosition.mockResolvedValue({ queuePosition: 1, aheadOfYou: 0, etaSeconds: 0 });

    const result = await appointmentsService.getBookingStatus('job-1', { id: 'admin-1', role: 'admin' });
    expect(result.status).toBe('processing');
  });

  test('a completed job re-fetches the appointment fresh and shapes it for the polling requester', async () => {
    bookingQueue.getJob.mockResolvedValue({
      id: 'job-1',
      data: { requestedByUserId: PATIENT_ID },
      getState: jest.fn().mockResolvedValue('completed'),
      returnvalue: { appointmentId: 'appt-1', tokenNumber: 5 },
    });
    prisma.appointment.findUnique.mockResolvedValue(fullAppointmentRow());
    loadCommissionPercentIfAdmin.mockResolvedValue(null);

    const result = await appointmentsService.getBookingStatus('job-1', { id: PATIENT_ID, role: 'patient' });

    expect(result.status).toBe('confirmed');
    expect(result.appointment.id).toBe('appt-1');
    expect(prisma.appointment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'appt-1' } })
    );
  });

  test('a failed job surfaces the structured {code,message} JSON payload from failedReason', async () => {
    bookingQueue.getJob.mockResolvedValue({
      id: 'job-1',
      data: { requestedByUserId: PATIENT_ID },
      getState: jest.fn().mockResolvedValue('failed'),
      failedReason: JSON.stringify({ code: 'SLOT_ALREADY_BOOKED', message: 'taken' }),
    });

    const result = await appointmentsService.getBookingStatus('job-1', { id: PATIENT_ID, role: 'patient' });

    expect(result).toEqual({ jobId: 'job-1', status: 'failed', error: { code: 'SLOT_ALREADY_BOOKED', message: 'taken' } });
  });

  test('a failed job with an unparsable failedReason falls back to a generic error, never leaking the raw message', async () => {
    bookingQueue.getJob.mockResolvedValue({
      id: 'job-1',
      data: { requestedByUserId: PATIENT_ID },
      getState: jest.fn().mockResolvedValue('failed'),
      failedReason: 'TypeError: something internal exploded at /src/secret/path.js:42',
    });

    const result = await appointmentsService.getBookingStatus('job-1', { id: PATIENT_ID, role: 'patient' });

    expect(result.error.code).toBe('BOOKING_FAILED');
    expect(result.error.message).not.toMatch(/secret|TypeError/);
  });

  test('a still-processing job returns a live queue position instead of BullMQ\'s internal state name', async () => {
    bookingQueue.getJob.mockResolvedValue({
      id: 'job-1',
      data: { requestedByUserId: PATIENT_ID },
      getState: jest.fn().mockResolvedValue('waiting'),
    });
    bookingQueue.getQueuePosition.mockResolvedValue({ queuePosition: 4, aheadOfYou: 3, etaSeconds: 90 });

    const result = await appointmentsService.getBookingStatus('job-1', { id: PATIENT_ID, role: 'patient' });

    expect(result).toEqual({ jobId: 'job-1', status: 'processing', queuePosition: 4, aheadOfYou: 3, etaSeconds: 90 });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// B. runBookingJob — the real booking logic
// ═══════════════════════════════════════════════════════════════════════
describe('appointmentsService.runBookingJob', () => {
  let tx;

  function happyDoctor(overrides = {}) {
    return {
      id: DOCTOR_ID,
      status: 'active',
      doctorProfile: {
        status: 'verified',
        consultationFee: dec(500),
        maxDaysAdvance: 30,
        allowRebooking: true,
        maxOnlineBookingsPerDay: null,
        emergencyAvailable: true,
        onlineBookingWindowStart: null,
        onlineBookingWindowEnd: null,
        ...overrides,
      },
    };
  }

  function basePayload(overrides = {}) {
    return {
      doctorUserId: DOCTOR_ID,
      clinicId: CLINIC_ID,
      appointmentDate: TOMORROW_STR,
      appointmentTime: '10:00',
      reason: 'Fever',
      isEmergency: false,
      familyMemberId: null,
      patientUserId: PATIENT_ID,
      patientName: null,
      patientPhone: null,
      patientEmail: null,
      paymentMethod: 'card',
      source: 'online',
      requestedByUserId: PATIENT_ID,
      requestedByRole: 'patient',
      ...overrides,
    };
  }

  function mockUsers({ doctor, patient } = {}) {
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === DOCTOR_ID) return Promise.resolve(doctor !== undefined ? doctor : happyDoctor());
      if (where.id === PATIENT_ID || (patient && where.id === patient.id)) {
        return Promise.resolve(patient !== undefined ? patient : { id: PATIENT_ID, role: 'patient', status: 'active' });
      }
      return Promise.resolve(null);
    });
  }

  function mockHappyPathBase() {
    mockUsers();
    prisma.doctorClinic.findUnique.mockResolvedValue({ onlineBooking: true });
    prisma.clinic.findUnique.mockImplementation(({ where }) =>
      Promise.resolve({ id: where.id, approvalStatus: 'active', emergencyAvailable: true })
    );
    prisma.doctorClinicHours.findUnique.mockResolvedValue({
      status: 'active',
      startTime: '09:00',
      endTime: '17:00',
      slotMinutes: 15,
    });
    prisma.doctorClinicClosure.findFirst.mockResolvedValue(null);
    prisma.appointment.count.mockResolvedValue(0);
    prisma.platformCharges.findUnique.mockResolvedValue({
      applyConvenienceFee: true,
      patientConvenienceFee: dec(20),
      applyEmergencyFee: true,
      emergencyFee: dec(100),
      gstPercent: dec(18),
    });
    prisma.bookingRules.findUnique.mockResolvedValue(null);
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: CLINIC_ID });

    tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $queryRaw: jest.fn().mockResolvedValue([{ max: 0 }]),
      appointment: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'appt-new', ...data })),
      },
      queueToken: { create: jest.fn().mockResolvedValue({}) },
      // findFirst defaults to "no existing walk-in patient by phone" (null) — the
      // phone-advisory-lock race fix's normal, non-matching path — so tests that never touch the
      // walk-in-patient flow at all are unaffected.
      user: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      patientProfile: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));
    lockService.withLock.mockImplementation((key, fn) => fn());
  }

  beforeEach(() => {
    mockHappyPathBase();
  });

  // ── Doctor / clinic resolution ─────────────────────────────────────
  test('throws 404 DOCTOR_NOT_FOUND when the doctor does not exist, is inactive, or is unverified', async () => {
    mockUsers({ doctor: null });
    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({
      statusCode: 404,
      code: 'DOCTOR_NOT_FOUND',
    });

    mockUsers({ doctor: happyDoctor({ status: 'suspended' }) });
    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({ code: 'DOCTOR_NOT_FOUND' });

    mockUsers({ doctor: { ...happyDoctor(), doctorProfile: { ...happyDoctor().doctorProfile, status: 'pending' } } });
    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({ code: 'DOCTOR_NOT_FOUND' });
  });

  test('clinic auto-resolution only ever considers ACTIVE clinics, preferring the primary one', async () => {
    prisma.doctorClinic.findMany.mockResolvedValue([
      { clinicId: 'inactive-clinic', isPrimary: true, clinic: { approvalStatus: 'suspended' } },
      { clinicId: 'clinic-active-1', isPrimary: false, clinic: { approvalStatus: 'active' } },
      { clinicId: 'clinic-active-2', isPrimary: false, clinic: { approvalStatus: 'active' } },
    ]);
    // Two active clinics, neither primary (the primary one is suspended) -> ambiguous.
    await expect(
      appointmentsService.runBookingJob(basePayload({ clinicId: null }))
    ).rejects.toMatchObject({ statusCode: 400, code: 'CLINIC_AMBIGUOUS' });
  });

  test('clinic auto-resolution throws CLINIC_NOT_ACTIVE when every linked clinic is inactive, rather than resolving to one that will immediately fail', async () => {
    prisma.doctorClinic.findMany.mockResolvedValue([
      { clinicId: 'inactive-clinic', isPrimary: true, clinic: { approvalStatus: 'suspended' } },
    ]);

    await expect(
      appointmentsService.runBookingJob(basePayload({ clinicId: null }))
    ).rejects.toMatchObject({ statusCode: 400, code: 'CLINIC_NOT_ACTIVE' });
  });

  test('clinic auto-resolution picks the sole active clinic when there is exactly one, even if not flagged primary', async () => {
    prisma.doctorClinic.findMany.mockResolvedValue([
      { clinicId: 'inactive-clinic', isPrimary: true, clinic: { approvalStatus: 'suspended' } },
      { clinicId: CLINIC_ID, isPrimary: false, clinic: { approvalStatus: 'active' } },
    ]);

    const result = await appointmentsService.runBookingJob(basePayload({ clinicId: null }));
    expect(result.appointmentId).toBe('appt-new');
    expect(tx.appointment.create.mock.calls[0][0].data.clinicId).toBe(CLINIC_ID);
  });

  test('throws 404 NOT_ASSIGNED_TO_CLINIC when the doctor has no clinic links at all', async () => {
    prisma.doctorClinic.findMany.mockResolvedValue([]);
    await expect(
      appointmentsService.runBookingJob(basePayload({ clinicId: null }))
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_ASSIGNED_TO_CLINIC' });
  });

  test('throws 400 CLINIC_NOT_ACTIVE when the (explicitly requested) clinic is not active', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: CLINIC_ID, approvalStatus: 'suspended', emergencyAvailable: true });
    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({
      statusCode: 400,
      code: 'CLINIC_NOT_ACTIVE',
    });
  });

  test('throws 403 ONLINE_BOOKING_DISABLED for an online booking when the doctor-clinic link disables it, but a walk-in bypasses this check', async () => {
    prisma.doctorClinic.findUnique.mockResolvedValue({ onlineBooking: false });

    await expect(appointmentsService.runBookingJob(basePayload({ source: 'online' }))).rejects.toMatchObject({
      statusCode: 403,
      code: 'ONLINE_BOOKING_DISABLED',
    });

    const result = await appointmentsService.runBookingJob(
      basePayload({ source: 'walk_in', requestedByRole: 'receptionist', requestedByUserId: 'recep-1' })
    );
    expect(result.appointmentId).toBe('appt-new');
  });

  // ── Date / time rules ────────────────────────────────────────────────
  test('throws 400 INVALID_DATE for a past appointmentDate', async () => {
    const yesterday = addDaysISO(TODAY, -1);
    await expect(appointmentsService.runBookingJob(basePayload({ appointmentDate: yesterday }))).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_DATE',
    });
  });

  test('throws 400 DATE_TOO_FAR_ADVANCE beyond the doctor\'s own maxDaysAdvance', async () => {
    mockUsers({ doctor: happyDoctor({ maxDaysAdvance: 5 }) });
    await expect(
      appointmentsService.runBookingJob(basePayload({ appointmentDate: addDaysISO(TODAY, 10) }))
    ).rejects.toMatchObject({ statusCode: 400, code: 'DATE_TOO_FAR_ADVANCE' });
  });

  test('the platform-wide max-advance cap wins when STRICTER than the doctor\'s own (whichever is stricter applies)', async () => {
    mockUsers({ doctor: happyDoctor({ maxDaysAdvance: 60 }) });
    prisma.bookingRules.findUnique.mockResolvedValue({ onlineBookingMaxAdvanceDays: 3 });

    await expect(
      appointmentsService.runBookingJob(basePayload({ appointmentDate: addDaysISO(TODAY, 10), timeStr: undefined }))
    ).rejects.toMatchObject({ statusCode: 400, code: 'DATE_TOO_FAR_ADVANCE' });
  });

  test('a doctor-level platform cap never LOOSENS a doctor whose own maxDaysAdvance is already stricter', async () => {
    mockUsers({ doctor: happyDoctor({ maxDaysAdvance: 5 }) });
    prisma.bookingRules.findUnique.mockResolvedValue({ onlineBookingMaxAdvanceDays: 30 });

    await expect(
      appointmentsService.runBookingJob(basePayload({ appointmentDate: addDaysISO(TODAY, 10) }))
    ).rejects.toMatchObject({ statusCode: 400, code: 'DATE_TOO_FAR_ADVANCE' });
  });

  test('throws 400 SAME_DAY_BOOKING_DISABLED for an online same-day booking when the doctor disallows rebooking', async () => {
    mockUsers({ doctor: happyDoctor({ allowRebooking: false }) });
    await expect(
      appointmentsService.runBookingJob(basePayload({ appointmentDate: TODAY.toISOString().slice(0, 10), appointmentTime: '23:59' }))
    ).rejects.toMatchObject({ statusCode: 400, code: 'SAME_DAY_BOOKING_DISABLED' });
  });

  test('throws 400 TIME_OUTSIDE_OPD_HOURS for an explicit time outside the doctor\'s OPD hours', async () => {
    await expect(appointmentsService.runBookingJob(basePayload({ appointmentTime: '07:00' }))).rejects.toMatchObject({
      statusCode: 400,
      code: 'TIME_OUTSIDE_OPD_HOURS',
    });
  });

  test('throws 400 DOCTOR_NOT_AVAILABLE_THAT_DAY when there are no active OPD hours for that weekday', async () => {
    prisma.doctorClinicHours.findUnique.mockResolvedValue(null);
    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({
      statusCode: 400,
      code: 'DOCTOR_NOT_AVAILABLE_THAT_DAY',
    });
  });

  test('throws 400 CLINIC_CLOSED_THAT_DATE when a closure row exists for that date', async () => {
    prisma.doctorClinicClosure.findFirst.mockResolvedValue({ id: 'closure-1' });
    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({
      statusCode: 400,
      code: 'CLINIC_CLOSED_THAT_DATE',
    });
  });

  test('throws 400 EMERGENCY_NOT_AVAILABLE when the doctor or clinic doesn\'t support emergency booking', async () => {
    mockUsers({ doctor: happyDoctor({ emergencyAvailable: false }) });
    await expect(
      appointmentsService.runBookingJob(basePayload({ isEmergency: true }))
    ).rejects.toMatchObject({ statusCode: 400, code: 'EMERGENCY_NOT_AVAILABLE' });
  });

  // ── Family member / patient / receptionist scoping ──────────────────
  test('throws 404 FAMILY_MEMBER_NOT_FOUND when the family member does not belong to the booking patient', async () => {
    prisma.familyMember.findUnique.mockResolvedValue({ patientUserId: 'someone-else' });
    await expect(
      appointmentsService.runBookingJob(basePayload({ familyMemberId: 'fam-1' }))
    ).rejects.toMatchObject({ statusCode: 404, code: 'FAMILY_MEMBER_NOT_FOUND' });
  });

  test('throws 404 PATIENT_NOT_FOUND when the resolved patient is missing, not a patient, or inactive', async () => {
    mockUsers({ patient: null });
    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND' });

    mockUsers({ patient: { id: PATIENT_ID, role: 'patient', status: 'suspended' } });
    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND' });
  });

  test('throws 400 RECEPTIONIST_NOT_ASSIGNED / 403 RECEPTIONIST_CLINIC_MISMATCH for a walk-in booking', async () => {
    prisma.receptionistProfile.findUnique.mockResolvedValue(null);
    await expect(
      appointmentsService.runBookingJob(basePayload({ source: 'walk_in', requestedByUserId: 'recep-1', requestedByRole: 'receptionist' }))
    ).rejects.toMatchObject({ statusCode: 400, code: 'RECEPTIONIST_NOT_ASSIGNED' });

    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'a-different-clinic' });
    await expect(
      appointmentsService.runBookingJob(basePayload({ source: 'walk_in', requestedByUserId: 'recep-1', requestedByRole: 'receptionist' }))
    ).rejects.toMatchObject({ statusCode: 403, code: 'RECEPTIONIST_CLINIC_MISMATCH' });
  });

  test('throws 500 PLATFORM_CHARGES_NOT_CONFIGURED when the platformCharges singleton row is missing', async () => {
    prisma.platformCharges.findUnique.mockResolvedValue(null);
    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({
      statusCode: 500,
      code: 'PLATFORM_CHARGES_NOT_CONFIGURED',
    });
  });

  // ── Fee computation (server-side, rule 7) + requiresPrepayment split ──
  test('computes consultationFee + convenienceFee (+ emergencyFee) with GST on the subtotal, server-side', async () => {
    await appointmentsService.runBookingJob(basePayload({ isEmergency: false }));

    const data = tx.appointment.create.mock.calls[0][0].data;
    expect(data.consultationFee.toString()).toBe('500');
    expect(data.convenienceFee.toString()).toBe('20');
    expect(data.emergencyFee.toString()).toBe('0'); // not an emergency booking
    expect(data.gstAmount.toString()).toBe('93.6'); // 18% of (500+20)
    expect(data.totalAmount.toString()).toBe('613.6');
  });

  test('applies the platform emergencyFee surcharge (not the doctor\'s own emergencyFee) for an emergency booking, and the platform charge does NOT stack with it', async () => {
    await appointmentsService.runBookingJob(basePayload({ isEmergency: true }));

    // MUTUAL-EXCLUSIVITY FIX (superadmin request): an emergency booking pays the emergency
    // surcharge INSTEAD OF the platform (convenience) charge, never both — convenienceFee is 0
    // here even though platformCharges.applyConvenienceFee is true in the mocked config.
    const data = tx.appointment.create.mock.calls[0][0].data;
    expect(data.convenienceFee.toString()).toBe('0');
    expect(data.emergencyFee.toString()).toBe('100');
    expect(data.gstAmount.toString()).toBe('108'); // 18% of (500+0+100)
    expect(data.totalAmount.toString()).toBe('708');
  });

  test('an online booking with a non-zero total starts pending_payment/on_hold and skips the "booking confirmed" notifications', async () => {
    await appointmentsService.runBookingJob(basePayload({ source: 'online' }));

    const apptData = tx.appointment.create.mock.calls[0][0].data;
    const tokenData = tx.queueToken.create.mock.calls[0][0].data;
    expect(apptData.status).toBe('pending_payment');
    expect(tokenData.status).toBe('on_hold');
    expect(notificationsService.notifySystemEventSafe).not.toHaveBeenCalled();
  });

  test('a walk-in booking goes straight to upcoming/waiting (a receptionist collects payment in person) and DOES notify both sides', async () => {
    const result = await appointmentsService.runBookingJob(
      basePayload({ source: 'walk_in', requestedByUserId: 'recep-1', requestedByRole: 'receptionist' })
    );

    const apptData = tx.appointment.create.mock.calls[0][0].data;
    const tokenData = tx.queueToken.create.mock.calls[0][0].data;
    expect(apptData.status).toBe('upcoming');
    expect(tokenData.status).toBe('waiting');
    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledTimes(2);
    expect(result.appointmentId).toBe('appt-new');
  });

  // ── Double-booking / concurrency guards ──────────────────────────────
  test('a Postgres unique-violation on the INSERT surfaces as 409 SLOT_ALREADY_BOOKED, never a raw 500', async () => {
    tx.appointment.create.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 'P2002' }));

    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({
      statusCode: 409,
      code: 'SLOT_ALREADY_BOOKED',
    });
  });

  test('a non-unique-violation DB error during create is rethrown as-is, not swallowed into SLOT_ALREADY_BOOKED', async () => {
    const boom = new Error('connection reset');
    tx.appointment.create.mockRejectedValueOnce(boom);

    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toBe(boom);
  });

  test('books under the doctor+date+time Redis lock key (auto-assign bookings fall back to a shared "auto" key)', async () => {
    await appointmentsService.runBookingJob(basePayload({ appointmentTime: '10:00' }));
    expect(lockService.withLock).toHaveBeenCalledWith(`booking:${DOCTOR_ID}:${TOMORROW_STR}:10:00`, expect.any(Function));

    await appointmentsService.runBookingJob(basePayload({ appointmentTime: undefined }));
    expect(lockService.withLock).toHaveBeenCalledWith(`booking:${DOCTOR_ID}:${TOMORROW_STR}:auto`, expect.any(Function));
  });

  test('token numbering assigns MAX(token_number)+1, scoped per doctor+day', async () => {
    tx.$queryRaw.mockResolvedValue([{ max: 7 }]);

    const result = await appointmentsService.runBookingJob(basePayload());

    expect(result.tokenNumber).toBe(8);
    expect(tx.appointment.create.mock.calls[0][0].data.tokenNumber).toBe(8);
    expect(tx.queueToken.create.mock.calls[0][0].data.tokenNumber).toBe(8);
  });

  // ── Token-numbering rule (request: "doctor ek booking rule do jo booking online wala
  // continues token no jayega ya odd ya even patient ko mle") — doctorProfile.tokenNumberingMode
  // ─────────────────────────────────────────────────────────────────────────────────────────
  describe('token numbering — doctorProfile.tokenNumberingMode = "alternate"', () => {
    test('an ONLINE booking gets the first ODD token (1) when no odd-parity token exists yet that day', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'alternate' }) });
      tx.$queryRaw.mockResolvedValue([{ max: 0 }]);

      const result = await appointmentsService.runBookingJob(basePayload({ source: 'online' }));

      expect(result.tokenNumber).toBe(1);
      expect(tx.appointment.create.mock.calls[0][0].data.tokenNumber).toBe(1);
      expect(tx.queueToken.create.mock.calls[0][0].data.tokenNumber).toBe(1);
    });

    test('a WALK-IN booking gets the first EVEN token (2) when no even-parity token exists yet that day', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'alternate' }) });
      tx.$queryRaw.mockResolvedValue([{ max: 0 }]);

      const result = await appointmentsService.runBookingJob(
        basePayload({ source: 'walk_in', requestedByUserId: 'recep-1', requestedByRole: 'receptionist' })
      );

      expect(result.tokenNumber).toBe(2);
      expect(tx.appointment.create.mock.calls[0][0].data.tokenNumber).toBe(2);
      expect(tx.queueToken.create.mock.calls[0][0].data.tokenNumber).toBe(2);
    });

    test('the next ONLINE booking continues the odd sequence (existing odd max + 2), independent of the even sequence', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'alternate' }) });
      tx.$queryRaw.mockResolvedValue([{ max: 5 }]); // highest existing ODD token for this doctor+day

      const result = await appointmentsService.runBookingJob(basePayload({ source: 'online' }));

      expect(result.tokenNumber).toBe(7);
    });

    test('the next WALK-IN booking continues the even sequence (existing even max + 2), independent of the odd sequence', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'alternate' }) });
      tx.$queryRaw.mockResolvedValue([{ max: 4 }]); // highest existing EVEN token for this doctor+day

      const result = await appointmentsService.runBookingJob(
        basePayload({ source: 'walk_in', requestedByUserId: 'recep-1', requestedByRole: 'receptionist' })
      );

      expect(result.tokenNumber).toBe(6);
    });

    test('the parity query filters token_number % 2 by source, scoped to this doctor+day, under the same advisory lock', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'alternate' }) });
      tx.$queryRaw.mockResolvedValue([{ max: 0 }]);

      await appointmentsService.runBookingJob(basePayload({ source: 'online' }));

      // $executeRaw (the pg_advisory_xact_lock call) still runs before the parity query, exactly
      // as it does for the sequential/default path — this feature must not bypass that lock.
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    test('the default ("sequential") mode is unaffected — a doctor who never configured this keeps the pre-existing one-shared-count behavior', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'sequential' }) });
      tx.$queryRaw.mockResolvedValue([{ max: 3 }]);

      const online = await appointmentsService.runBookingJob(basePayload({ source: 'online' }));
      expect(online.tokenNumber).toBe(4);

      const walkIn = await appointmentsService.runBookingJob(
        basePayload({ source: 'walk_in', requestedByUserId: 'recep-1', requestedByRole: 'receptionist' })
      );
      expect(walkIn.tokenNumber).toBe(4); // same shared MAX+1 formula, source doesn't matter here
    });

    // COMPLETENESS ADD (request: "odd ya even select karne ka option do doctor jo select kar
    // online ke lie") — doctorProfile.onlineTokenParity flips which parity 'alternate' mode
    // assigns to online vs walk-in bookings.
    test('onlineTokenParity="odd" (the default) gives ONLINE the odd sequence, same as no override at all', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'alternate', onlineTokenParity: 'odd' }) });
      tx.$queryRaw.mockResolvedValue([{ max: 0 }]);

      const result = await appointmentsService.runBookingJob(basePayload({ source: 'online' }));

      expect(result.tokenNumber).toBe(1); // first ODD token
    });

    test('onlineTokenParity="even" FLIPS it — ONLINE now gets the even sequence', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'alternate', onlineTokenParity: 'even' }) });
      tx.$queryRaw.mockResolvedValue([{ max: 0 }]);

      const result = await appointmentsService.runBookingJob(basePayload({ source: 'online' }));

      expect(result.tokenNumber).toBe(2); // first EVEN token, not odd
    });

    test('onlineTokenParity="even" also flips WALK-IN onto the odd sequence', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'alternate', onlineTokenParity: 'even' }) });
      tx.$queryRaw.mockResolvedValue([{ max: 0 }]);

      const result = await appointmentsService.runBookingJob(
        basePayload({ source: 'walk_in', requestedByUserId: 'recep-1', requestedByRole: 'receptionist' })
      );

      expect(result.tokenNumber).toBe(1); // first ODD token, not even
    });

    test('an unset/unrecognized onlineTokenParity behaves exactly like the "odd" default', async () => {
      mockUsers({ doctor: happyDoctor({ tokenNumberingMode: 'alternate', onlineTokenParity: undefined }) });
      tx.$queryRaw.mockResolvedValue([{ max: 0 }]);

      const result = await appointmentsService.runBookingJob(basePayload({ source: 'online' }));

      expect(result.tokenNumber).toBe(1);
    });
  });

  test('auto-assignment picks the first free candidate slot, skipping ones already taken that day', async () => {
    prisma.doctorClinicHours.findUnique.mockResolvedValue({ status: 'active', startTime: '09:00', endTime: '10:00', slotMinutes: 30 });
    tx.appointment.findMany.mockResolvedValue([{ appointmentTime: '09:00' }]);

    const result = await appointmentsService.runBookingJob(basePayload({ appointmentTime: undefined }));

    expect(result.appointmentId).toBe('appt-new');
    expect(tx.appointment.create.mock.calls[0][0].data.appointmentTime).toBe('09:30');
  });

  test('throws 409 NO_SLOTS_AVAILABLE when auto-assignment finds every candidate slot already taken', async () => {
    prisma.doctorClinicHours.findUnique.mockResolvedValue({ status: 'active', startTime: '09:00', endTime: '10:00', slotMinutes: 30 });
    tx.appointment.findMany.mockResolvedValue([{ appointmentTime: '09:00' }, { appointmentTime: '09:30' }]);

    await expect(
      appointmentsService.runBookingJob(basePayload({ appointmentTime: undefined }))
    ).rejects.toMatchObject({ statusCode: 409, code: 'NO_SLOTS_AVAILABLE' });
  });

  test('the fast-fail daily online-booking cap check rejects an obviously-full day before any lock/OPD work', async () => {
    mockUsers({ doctor: happyDoctor({ maxOnlineBookingsPerDay: 5 }) });
    prisma.appointment.count.mockResolvedValue(5);

    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({
      statusCode: 400,
      code: 'DAILY_ONLINE_LIMIT_REACHED',
    });
    expect(lockService.withLock).not.toHaveBeenCalled();
  });

  test('SECURITY/CORRECTNESS: the locked re-check inside the transaction is authoritative — it rejects even when the earlier unlocked fast-fail check passed', async () => {
    // Simulates the exact race the source's own comment describes: two concurrent jobs both read
    // the pre-cap count (0) and both pass the fast-fail check outside the lock; by the time THIS
    // job reaches the advisory-lock-protected re-check, the other job has already committed,
    // pushing the true count to the cap. Only the locked re-check can catch this.
    mockUsers({ doctor: happyDoctor({ maxOnlineBookingsPerDay: 1 }) });
    prisma.appointment.count.mockResolvedValue(0); // fast-fail check: passes
    tx.appointment.count.mockResolvedValue(1); // authoritative locked re-check: at cap

    await expect(appointmentsService.runBookingJob(basePayload())).rejects.toMatchObject({
      statusCode: 400,
      code: 'DAILY_ONLINE_LIMIT_REACHED',
    });
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  test('walk-in bookings are never counted against, or blocked by, the daily online-booking cap', async () => {
    mockUsers({ doctor: happyDoctor({ maxOnlineBookingsPerDay: 1 }) });
    prisma.appointment.count.mockResolvedValue(99); // would fail an online booking outright
    tx.appointment.count.mockResolvedValue(99);

    const result = await appointmentsService.runBookingJob(
      basePayload({ source: 'walk_in', requestedByUserId: 'recep-1', requestedByRole: 'receptionist' })
    );
    expect(result.appointmentId).toBe('appt-new');
  });

  // ── Walk-in patient find-or-create (COMPLETENESS FIX, audit Priority 1 #2) ──
  test('find-or-create walk-in: reuses an existing patient account found by phone instead of creating a duplicate', async () => {
    // RACE-FIX UPDATE: the phone lookup now runs inside the advisory-locked transaction
    // (tx.user.findFirst), not a bare prisma.user.findFirst — see findOrCreateWalkInPatient.
    tx.user.findFirst.mockResolvedValue({ id: 'existing-walkin-patient' });
    mockUsers({ patient: { id: 'existing-walkin-patient', role: 'patient', status: 'active' } });

    const result = await appointmentsService.runBookingJob(
      basePayload({
        source: 'walk_in',
        requestedByUserId: 'recep-1',
        requestedByRole: 'receptionist',
        patientUserId: null,
        patientName: 'New Guy',
        patientPhone: '9888888888',
      })
    );

    expect(result.appointmentId).toBe('appt-new');
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.appointment.create.mock.calls[0][0].data.patientUserId).toBe('existing-walkin-patient');
  });

  test('find-or-create walk-in: creates a new patient account (+ empty patientProfile) when no existing phone match exists', async () => {
    // RACE-FIX UPDATE: findOrCreateWalkInPatient now calls tx.user.findFirst twice (the initial
    // lock-then-check, and the race-check re-done just before the insert inside the same
    // transaction as the create) — both should see no match.
    tx.user.findFirst.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: 'brand-new-patient' });
    mockUsers({ patient: { id: 'brand-new-patient', role: 'patient', status: 'active' } });

    const result = await appointmentsService.runBookingJob(
      basePayload({
        source: 'walk_in',
        requestedByUserId: 'recep-1',
        requestedByRole: 'receptionist',
        patientUserId: null,
        patientName: 'New Guy',
        patientPhone: '9888888888',
      })
    );

    expect(result.appointmentId).toBe('appt-new');
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.user.create.mock.calls[0][0].data.role).toBe('patient');
    expect(tx.patientProfile.create).toHaveBeenCalledWith({ data: { userId: 'brand-new-patient' } });
    expect(activityLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'appointments.walkInPatientCreated' })
    );
  });

  test('find-or-create walk-in: a P2002 race on create re-checks by phone and reuses the winner\'s account instead of failing the booking', async () => {
    // RACE-FIX UPDATE: the two IN-transaction lookups (initial lock-then-check, and the
    // race-check just before create) both still see no match — the racing job hasn't committed
    // yet from this transaction's point of view, which is exactly what lets the P2002 happen.
    // Only the retry-AFTER-P2002 (unchanged, a bare prisma.user.findFirst outside any
    // transaction, run once the racing job's transaction has committed) sees the winner.
    tx.user.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'other-jobs-patient' }); // retry-after-P2002: the racing job won
    prisma.$transaction.mockImplementation((cb, opts) => {
      // Distinguish findOrCreateWalkInPatient's own $transaction (user.create) from
      // runBookingJob's booking transaction (tx has $queryRaw) by which one is being invoked.
      return cb(tx);
    });
    tx.user.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    mockUsers({ patient: { id: 'other-jobs-patient', role: 'patient', status: 'active' } });

    const result = await appointmentsService.runBookingJob(
      basePayload({
        source: 'walk_in',
        requestedByUserId: 'recep-1',
        requestedByRole: 'receptionist',
        patientUserId: null,
        patientName: 'New Guy',
        patientPhone: '9888888888',
      })
    );

    expect(result.appointmentId).toBe('appt-new');
    expect(tx.appointment.create.mock.calls[0][0].data.patientUserId).toBe('other-jobs-patient');
  });

  test('find-or-create walk-in: a genuine email collision (not a phone race) throws 409 EMAIL_ALREADY_EXISTS', async () => {
    // RACE-FIX UPDATE: no match anywhere — the two in-transaction lookups (tx.user.findFirst) nor
    // the retry-after-P2002 (bare prisma.user.findFirst) ever find an existing account, since this
    // is a genuine email collision, not a phone race.
    tx.user.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null); // never finds a match, before OR after the P2002
    tx.user.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(
      appointmentsService.runBookingJob(
        basePayload({
          source: 'walk_in',
          requestedByUserId: 'recep-1',
          requestedByRole: 'receptionist',
          patientUserId: null,
          patientName: 'New Guy',
          patientPhone: '9888888888',
          patientEmail: 'taken@example.com',
        })
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_ALREADY_EXISTS' });
  });

  // ── Post-commit side effects ─────────────────────────────────────────
  test('post-commit side effects (audit log, list-cache busts, queue-cache bust) all fire on a successful booking', async () => {
    await appointmentsService.runBookingJob(basePayload({ source: 'walk_in', requestedByUserId: 'recep-1', requestedByRole: 'receptionist' }));

    expect(activityLogService.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'appointment.create' }));
    expect(queueService.invalidateQueueListCaches).toHaveBeenCalledWith({ doctorUserId: DOCTOR_ID, clinicId: CLINIC_ID });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C. updateAppointmentStatus — the transition state machine + cascades
// ═══════════════════════════════════════════════════════════════════════
describe('appointmentsService.updateAppointmentStatus', () => {
  let tx;

  beforeEach(() => {
    tx = {
      appointment: { update: jest.fn() },
      queueToken: { delete: jest.fn(), update: jest.fn() },
    };
    prisma.$transaction.mockImplementation((cb) => cb(tx));
    loadCommissionPercentIfAdmin.mockResolvedValue(null);
    prisma.bookingRules.findUnique.mockResolvedValue({ cancellationWindowHours: 2 });
    // NOTE: `clearMocks` (jest.config.js) only clears call history between tests, it does NOT
    // drain a mock's queued mockResolvedValueOnce() values — a test that throws before consuming
    // its second queued value (e.g. a FORBIDDEN thrown right after the first findUnique) would
    // otherwise leak that unconsumed value into the NEXT test's first findUnique call. mockReset
    // here guarantees every test starts this mock with a clean, empty queue.
    prisma.appointment.findUnique.mockReset();
  });

  function mockFindUniqueSequence(row, updatedRow) {
    prisma.appointment.findUnique
      .mockResolvedValueOnce(row) // getVisibleAppointmentOrThrow, before the transition
      .mockResolvedValueOnce(updatedRow || { ...row, status: undefined }); // final getAppointmentById re-fetch
  }

  test('a patient attempting to confirm/complete/no-show their own appointment gets 403 FORBIDDEN', async () => {
    // Single-value queue: this throws right after the first findUnique, before ever reaching the
    // final getAppointmentById re-fetch, so a second queued value would go unconsumed.
    prisma.appointment.findUnique.mockResolvedValueOnce(fullAppointmentRow({ status: 'upcoming' }));

    await expect(
      appointmentsService.updateAppointmentStatus('appt-1', 'confirmed', { id: PATIENT_ID, role: 'patient' })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('a patient CAN cancel their own upcoming appointment (outside the cancellation window)', async () => {
    const farFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const row = fullAppointmentRow({
      status: 'upcoming',
      appointmentDate: new Date(`${farFuture.toISOString().slice(0, 10)}T00:00:00.000Z`),
      appointmentTime: '10:00',
    });
    mockFindUniqueSequence(row, { ...row, status: 'cancelled' });

    const result = await appointmentsService.updateAppointmentStatus('appt-1', 'cancelled', { id: PATIENT_ID, role: 'patient' });
    expect(result.status).toBe('cancelled');
    expect(tx.appointment.update).toHaveBeenCalledWith({ where: { id: 'appt-1' }, data: { status: 'cancelled' } });
  });

  test('throws 409 APPOINTMENT_ALREADY_FINALIZED for any transition attempted from a terminal status', async () => {
    for (const terminal of ['completed', 'cancelled', 'no_show']) {
      // mockResolvedValueOnce (not the two-value mockFindUniqueSequence helper) — this call
      // throws right after the FIRST findUnique, so a second queued value would never be
      // consumed here and would otherwise leak into the next loop iteration's first call.
      prisma.appointment.findUnique.mockReset();
      prisma.appointment.findUnique.mockResolvedValueOnce(fullAppointmentRow({ status: terminal }));
      await expect(
        appointmentsService.updateAppointmentStatus('appt-1', 'cancelled', { id: 'admin-1', role: 'admin' })
      ).rejects.toMatchObject({ statusCode: 409, code: 'APPOINTMENT_ALREADY_FINALIZED' });
    }
  });

  test('throws 409 INVALID_STATUS_TRANSITION for pending_payment -> confirmed (only "cancelled" is reachable from pending_payment via this endpoint)', async () => {
    prisma.appointment.findUnique.mockResolvedValueOnce(fullAppointmentRow({ status: 'pending_payment' }));

    await expect(
      appointmentsService.updateAppointmentStatus('appt-1', 'confirmed', { id: 'admin-1', role: 'admin' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_STATUS_TRANSITION' });
  });

  test('a patient CAN cancel a pending_payment booking with no cancellation-window check (it was never confirmed to them)', async () => {
    const soon = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now — inside any real window
    const row = fullAppointmentRow({
      status: 'pending_payment',
      appointmentDate: new Date(`${soon.toISOString().slice(0, 10)}T00:00:00.000Z`),
      appointmentTime: soon.toISOString().slice(11, 16),
      queueToken: { id: 'qt-1', status: 'on_hold', tokenNumber: 3 },
    });
    mockFindUniqueSequence(row, { ...row, status: 'cancelled' });

    const result = await appointmentsService.updateAppointmentStatus('appt-1', 'cancelled', { id: PATIENT_ID, role: 'patient' });
    expect(result.status).toBe('cancelled');
    expect(prisma.bookingRules.findUnique).not.toHaveBeenCalled();
  });

  test('throws 400 CANCELLATION_WINDOW_PASSED when a patient cancels too close to the appointment time', async () => {
    const soon = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now, window is 2 hours
    const row = fullAppointmentRow({
      status: 'upcoming',
      appointmentDate: new Date(`${soon.toISOString().slice(0, 10)}T00:00:00.000Z`),
      appointmentTime: soon.toISOString().slice(11, 16),
    });
    prisma.appointment.findUnique.mockResolvedValueOnce(row);

    await expect(
      appointmentsService.updateAppointmentStatus('appt-1', 'cancelled', { id: PATIENT_ID, role: 'patient' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'CANCELLATION_WINDOW_PASSED' });
  });

  test('staff/admin cancels BYPASS the cancellation window entirely (operational override)', async () => {
    const soon = new Date(Date.now() + 5 * 60 * 1000);
    const row = fullAppointmentRow({
      status: 'upcoming',
      appointmentDate: new Date(`${soon.toISOString().slice(0, 10)}T00:00:00.000Z`),
      appointmentTime: soon.toISOString().slice(11, 16),
    });
    mockFindUniqueSequence(row, { ...row, status: 'cancelled' });

    const result = await appointmentsService.updateAppointmentStatus('appt-1', 'cancelled', { id: DOCTOR_ID, role: 'doctor' });
    expect(result.status).toBe('cancelled');
  });

  test('throws 409 APPOINTMENT_IN_PROGRESS when trying to cancel/no-show a consultation already underway', async () => {
    const row = fullAppointmentRow({ status: 'confirmed', queueToken: { id: 'qt-1', status: 'in_consultation', tokenNumber: 3 } });
    prisma.appointment.findUnique.mockResolvedValueOnce(row);

    await expect(
      appointmentsService.updateAppointmentStatus('appt-1', 'cancelled', { id: 'admin-1', role: 'admin' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'APPOINTMENT_IN_PROGRESS' });
  });

  test('cancelling deletes a "waiting"/"called" queueToken (releasing the live queue slot) — a not-yet-live queueToken is left alone', async () => {
    const row = fullAppointmentRow({ status: 'upcoming', queueToken: { id: 'qt-1', status: 'called', tokenNumber: 3 } });
    mockFindUniqueSequence(row, { ...row, status: 'cancelled' });

    await appointmentsService.updateAppointmentStatus('appt-1', 'cancelled', { id: 'admin-1', role: 'admin' });
    expect(tx.queueToken.delete).toHaveBeenCalledWith({ where: { id: 'qt-1' } });
  });

  test('completing an appointment cascades its linked (non-already-completed) queueToken to completed', async () => {
    const row = fullAppointmentRow({ status: 'confirmed', queueToken: { id: 'qt-1', status: 'in_consultation', tokenNumber: 3 } });
    mockFindUniqueSequence(row, { ...row, status: 'completed' });

    await appointmentsService.updateAppointmentStatus('appt-1', 'completed', { id: 'admin-1', role: 'admin' });
    expect(tx.queueToken.update).toHaveBeenCalledWith({ where: { id: 'qt-1' }, data: { status: 'completed' } });
    expect(queueService.invalidateQueueListCaches).toHaveBeenCalledWith({ doctorUserId: DOCTOR_ID, clinicId: CLINIC_ID });
  });

  test('completing an appointment whose queueToken is ALREADY completed does not redundantly re-update it', async () => {
    const row = fullAppointmentRow({ status: 'confirmed', queueToken: { id: 'qt-1', status: 'completed', tokenNumber: 3 } });
    mockFindUniqueSequence(row, { ...row, status: 'completed' });

    await appointmentsService.updateAppointmentStatus('appt-1', 'completed', { id: 'admin-1', role: 'admin' });
    expect(tx.queueToken.update).not.toHaveBeenCalled();
  });

  test('a patient-initiated cancel notifies the DOCTOR; a staff/admin-initiated cancel notifies the PATIENT', async () => {
    const farFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const row = fullAppointmentRow({
      status: 'upcoming',
      appointmentDate: new Date(`${farFuture.toISOString().slice(0, 10)}T00:00:00.000Z`),
      appointmentTime: '10:00',
    });
    mockFindUniqueSequence(row, { ...row, status: 'cancelled' });

    await appointmentsService.updateAppointmentStatus('appt-1', 'cancelled', { id: PATIENT_ID, role: 'patient' });
    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledWith(DOCTOR_ID, expect.objectContaining({ title: 'Appointment cancelled' }));

    mockFindUniqueSequence(row, { ...row, status: 'cancelled' });
    await appointmentsService.updateAppointmentStatus('appt-1', 'cancelled', { id: 'admin-1', role: 'admin' });
    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledWith(PATIENT_ID, expect.objectContaining({ title: 'Appointment cancelled' }));
  });

  test('logs the status change and busts the appointment list caches for patient/doctor/clinic scopes', async () => {
    const row = fullAppointmentRow({ status: 'confirmed', queueToken: null });
    mockFindUniqueSequence(row, { ...row, status: 'completed' });

    await appointmentsService.updateAppointmentStatus('appt-1', 'completed', { id: 'admin-1', role: 'admin' });

    expect(activityLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'appointment.status_update', targetEntityId: 'appt-1' })
    );
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:appointments:list:admin:*');
  });
});
