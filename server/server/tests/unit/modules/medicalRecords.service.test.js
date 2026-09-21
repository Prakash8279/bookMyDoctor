/**
 * Unit tests for modules/medicalRecords/medicalRecords.service.js — the patient/appointment
 * resolution guard (resolvePatientAndAppointment) and the three-way visibility rule
 * (doctor-who-authored / owning-patient / admin), the actual fix for the historical bug this
 * module exists to close (any patient's EMR list showed every record globally, no real FKs).
 *
 *   - resolvePatientAndAppointment: an appointmentId not owned by the requesting doctor 404s
 *     (never leaks whose appointment it actually is); a patientUserId path requires an
 *     ACTIVE patient account, and deliberately has NO "prior appointment" gate (a walk-in/
 *     phone-consult record has no prior appointment by definition — see the file's own
 *     comment on this).
 *   - listMedicalRecords: doctor/patient roles are hard-scoped to their own id regardless of
 *     query params; admin/superadmin gets a fully unfiltered where clause (the
 *     patientId/doctorId/appointmentId filters were removed — backend-cleanup audit, no
 *     web/mobile caller ever sent them).
 *
 * getMedicalRecordById/getVisibleMedicalRecordOrThrow (the old 3-way visibility check: treating
 * doctor / owning patient / admin, 404 never 403) were removed from the service entirely along
 * with GET /medical-records/:id — see medicalRecords.service.js's own comment.
 *
 * config/db is mocked (no real Postgres in this sandbox); activityLogService/cacheService are
 * mocked to isolate this module's own branching from their internals.
 */
jest.mock('../../../src/config/db', () => ({
  appointment: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  medicalRecord: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttl, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));

const prisma = require('../../../src/config/db');
const medicalRecordsService = require('../../../src/modules/medicalRecords/medicalRecords.service');

const DOCTOR = { id: 'doc-1', role: 'doctor' };
const OTHER_DOCTOR = { id: 'doc-2', role: 'doctor' };
const PATIENT = { id: 'patient-1', role: 'patient' };
const ADMIN = { id: 'admin-1', role: 'admin' };

function recordRow(overrides = {}) {
  return {
    id: 'record-1',
    appointmentId: 'appt-1',
    doctorUserId: DOCTOR.id,
    patientUserId: PATIENT.id,
    title: 'Checkup',
    type: 'consultation',
    notes: 'notes',
    carePlan: 'plan',
    createdAt: new Date(),
    appointment: { id: 'appt-1' },
    doctor: { id: DOCTOR.id, name: 'Dr. Rao' },
    patient: { id: PATIENT.id, name: 'Patty' },
    ...overrides,
  };
}

describe('medicalRecordsService.createMedicalRecord — resolvePatientAndAppointment', () => {
  test('404 APPOINTMENT_NOT_FOUND when the appointment does not exist', async () => {
    prisma.appointment.findUnique.mockResolvedValue(null);

    await expect(
      medicalRecordsService.createMedicalRecord({ appointmentId: 'appt-x', title: 'T' }, DOCTOR)
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  test('404 (not 403) when the appointment belongs to a DIFFERENT doctor', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', doctorUserId: OTHER_DOCTOR.id, patientUserId: PATIENT.id });

    await expect(
      medicalRecordsService.createMedicalRecord({ appointmentId: 'appt-1', title: 'T' }, DOCTOR)
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });
  });

  test('422 VALIDATION_ERROR when neither appointmentId nor patientUserId is given', async () => {
    await expect(medicalRecordsService.createMedicalRecord({ title: 'T' }, DOCTOR)).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  test('404 PATIENT_NOT_FOUND when patientUserId refers to a non-patient or disabled account', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'patient-x', role: 'patient', status: 'disabled' });

    await expect(
      medicalRecordsService.createMedicalRecord({ patientUserId: 'patient-x', title: 'T' }, DOCTOR)
    ).rejects.toMatchObject({ statusCode: 404, code: 'PATIENT_NOT_FOUND' });
  });

  test('a walk-in record (patientUserId, no appointmentId) succeeds with no prior-appointment check', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: PATIENT.id, role: 'patient', status: 'active' });
    prisma.medicalRecord.create.mockResolvedValue(recordRow({ appointmentId: null, appointment: null }));

    const result = await medicalRecordsService.createMedicalRecord({ patientUserId: PATIENT.id, title: 'Walk-in visit' }, DOCTOR);

    expect(prisma.medicalRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ appointmentId: null, doctorUserId: DOCTOR.id, patientUserId: PATIENT.id }) })
    );
    expect(result.appointment).toBeNull();
  });

  test('doctorUserId on the created record is always requester.id, never client-supplied', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', doctorUserId: DOCTOR.id, patientUserId: PATIENT.id });
    prisma.medicalRecord.create.mockResolvedValue(recordRow());

    await medicalRecordsService.createMedicalRecord(
      { appointmentId: 'appt-1', title: 'T', doctorUserId: 'attacker-controlled' },
      DOCTOR
    );

    expect(prisma.medicalRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ doctorUserId: DOCTOR.id }) })
    );
  });
});

// getMedicalRecordById/getVisibleMedicalRecordOrThrow removed entirely (backend-cleanup audit —
// user request: "website frontend me nahi hai but backend bna hua hai to backend se hata do"):
// neither web nor mobile ever fetches a single medical record by id, and no other module called
// either function internally — see medicalRecords.service.js's own comment. The 3-way-visibility
// tests that used to live here (treating doctor / owning patient / admin / unrelated-doctor /
// unrelated-patient / not-found) were removed along with the code they exercised.

describe('medicalRecordsService.listMedicalRecords — forced role scoping', () => {
  test('a doctor\'s where clause is forced to their own id, ignoring patientId/doctorId query params', async () => {
    prisma.medicalRecord.findMany.mockResolvedValue([]);
    prisma.medicalRecord.count.mockResolvedValue(0);

    await medicalRecordsService.listMedicalRecords({ doctorId: 'someone-else', patientId: 'anyone' }, DOCTOR);

    expect(prisma.medicalRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { doctorUserId: DOCTOR.id } }));
  });

  test('a patient\'s where clause is forced to their own id', async () => {
    prisma.medicalRecord.findMany.mockResolvedValue([]);
    prisma.medicalRecord.count.mockResolvedValue(0);

    await medicalRecordsService.listMedicalRecords({ doctorId: 'someone-else' }, PATIENT);

    expect(prisma.medicalRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { patientUserId: PATIENT.id } }));
  });

  // patientId/doctorId/appointmentId filters removed (backend-cleanup audit — see
  // medicalRecords.validation.js's comment): no web/mobile caller ever sent them, so even an
  // admin's where clause is now always fully unfiltered, regardless of what a caller passes in.
  test('admin gets a fully unfiltered where clause, even if patientId/doctorId/appointmentId are still passed in', async () => {
    prisma.medicalRecord.findMany.mockResolvedValue([]);
    prisma.medicalRecord.count.mockResolvedValue(0);

    await medicalRecordsService.listMedicalRecords({ doctorId: 'doc-x', patientId: 'patient-x', appointmentId: 'appt-x' }, ADMIN);

    expect(prisma.medicalRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
