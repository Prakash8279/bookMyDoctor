/**
 * Business logic for the medicalRecords module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules, and
 * all Prisma/DB calls for this module live. Controllers call these functions; these functions
 * never touch req/res directly.
 *
 * The literal bug fix this module exists for (DATABASE_SCHEMA.md §6 / data-model report): the
 * current frontend's addRecord only ever persisted {name,type} and had NO foreign keys at all
 * (any patient's EMR list showed every record globally). This schema/module fixes both: real
 * FKs to patient/doctor/appointment, and notes/carePlan are now actually saved.
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { ADMIN_ROLES } = require('../../utils/roles');

const LIST_CACHE_TTL_SECONDS = 60;

/**
 * Busts every cached listMedicalRecords page that could contain a record touching the given
 * doctor/patient (the two ownership scopes a caller can be keyed by — admin's unfiltered view
 * is busted too, since admin can filter by either id).
 */
async function invalidateMedicalRecordListCaches({ doctorUserId, patientUserId }) {
  const patterns = [];
  if (doctorUserId) patterns.push(`cache:medicalRecords:list:doctor:${doctorUserId}:*`);
  if (patientUserId) patterns.push(`cache:medicalRecords:list:patient:${patientUserId}:*`);
  patterns.push(`cache:medicalRecords:list:admin:*`);
  await Promise.all(patterns.map((p) => cacheService.invalidate(p)));
}

const MEDICAL_RECORD_SELECT = {
  id: true,
  appointmentId: true,
  doctorUserId: true,
  patientUserId: true,
  title: true,
  type: true,
  notes: true,
  carePlan: true,
  createdAt: true,
  appointment: { select: { id: true } },
  doctor: { select: { id: true, name: true } },
  patient: { select: { id: true, name: true } },
};

function shapeMedicalRecord(row) {
  return {
    id: row.id,
    appointment: row.appointment ? { id: row.appointment.id } : null,
    doctor: row.doctor ? { id: row.doctor.id, name: row.doctor.name } : null,
    patient: row.patient ? { id: row.patient.id, name: row.patient.name } : null,
    title: row.title,
    type: row.type,
    notes: row.notes,
    carePlan: row.carePlan,
    createdAt: row.createdAt,
  };
}

/**
 * Derives the patient/appointment pairing from either an appointmentId or an explicit
 * patientUserId, kept local rather than cross-imported (matching how appointments.service.js
 * doesn't import from other modules either).
 * @param {{appointmentId?:string, patientUserId?:string}} body
 * @param {{id:string, role:string}} requester
 */
async function resolvePatientAndAppointment(body, requester) {
  if (body.appointmentId) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: body.appointmentId },
      select: { id: true, doctorUserId: true, patientUserId: true },
    });
    if (!appointment || appointment.doctorUserId !== requester.id) {
      throw new ApiError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    }
    return { appointmentId: appointment.id, patientUserId: appointment.patientUserId };
  }

  if (!body.patientUserId) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'patientUserId is required when appointmentId is not provided.');
  }

  const patient = await prisma.user.findUnique({
    where: { id: body.patientUserId },
    select: { id: true, role: true, status: true },
  });
  if (!patient || patient.role !== 'patient' || patient.status !== 'active') {
    throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
  }

  // NOTE: deliberately no "prior appointment with this doctor" gate here — an earlier revision
  // added one, but that wasn't part of the approved plan and was inconsistent with the sibling
  // walk-in path (payments.service.js#createStandalonePayment, Path B), which only verifies the
  // patient exists and is active. A legitimate walk-in/phone-consult medical record has no prior
  // appointment by definition, so requiring one here would incorrectly block that exact flow.
  return { appointmentId: null, patientUserId: patient.id };
}

/**
 * @param {object} body - already shape-validated by medicalRecords.validation.js#createMedicalRecord.
 * @param {{id:string, role:string}} requester - always a doctor (route-enforced).
 */
async function createMedicalRecord(body, requester) {
  const { appointmentId, patientUserId } = await resolvePatientAndAppointment(body, requester);

  const created = await prisma.medicalRecord.create({
    data: {
      appointmentId,
      // doctorUserId is ALWAYS req.user.id — never read from the body (rule 3).
      doctorUserId: requester.id,
      patientUserId,
      title: String(body.title).trim(),
      type: body.type ? String(body.type).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
      carePlan: body.carePlan ? String(body.carePlan).trim() : null,
    },
    select: MEDICAL_RECORD_SELECT,
  });

  await activityLogService.log({
    actorUserId: requester.id,
    actorRole: requester.role,
    actionType: 'medicalRecord.create',
    targetEntityType: 'medicalRecord',
    targetEntityId: created.id,
    // Never embed clinical content (title/type/notes/carePlan — all potentially free-text PHI)
    // in the plaintext audit log — matches activityLogService.js's documented contract
    // ('field NAMES only where that matters').
    description: 'Created medical record',
  });

  await invalidateMedicalRecordListCaches({ doctorUserId: requester.id, patientUserId });

  return shapeMedicalRecord(created);
}

/**
 * 404 (not 403) for a non-owner, non-treating-doctor, non-admin caller — same enumeration-
 * avoidance posture as appointments.service.js#getVisibleAppointmentOrThrow.
 * @param {string} id
 * @param {{id:string, role:string}} requester
 */
async function getVisibleMedicalRecordOrThrow(id, requester) {
  const row = await prisma.medicalRecord.findUnique({ where: { id }, select: MEDICAL_RECORD_SELECT });
  if (!row) {
    throw new ApiError(404, 'MEDICAL_RECORD_NOT_FOUND', 'Medical record not found.');
  }
  if (ADMIN_ROLES.includes(requester.role)) return row;
  if (requester.role === 'doctor' && row.doctorUserId === requester.id) return row;
  if (requester.role === 'patient' && row.patientUserId === requester.id) return row;
  throw new ApiError(404, 'MEDICAL_RECORD_NOT_FOUND', 'Medical record not found.');
}

/**
 * @param {object} query
 * @param {{id:string, role:string}} requester
 */
async function listMedicalRecords({ page, pageSize, patientId, doctorId, appointmentId }, requester) {
  // Ownership-scoped output -> key MUST include role + requester id (patient/doctor) or the
  // admin filters (admin can see everything, scoped only by its own query params).
  const scope =
    requester.role === 'doctor'
      ? `doctor:${requester.id}`
      : requester.role === 'patient'
      ? `patient:${requester.id}`
      : 'admin';
  const cacheKey = `cache:medicalRecords:list:${scope}:${patientId || ''}:${doctorId || ''}:${
    appointmentId || ''
  }:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {};
    // Forced role scoping (never client-controlled, rule 3): doctorId/patientId/appointmentId
    // query params are only honored for admin/superadmin.
    if (requester.role === 'doctor') {
      where.doctorUserId = requester.id;
    } else if (requester.role === 'patient') {
      where.patientUserId = requester.id;
    } else if (ADMIN_ROLES.includes(requester.role)) {
      if (patientId) where.patientUserId = patientId;
      if (doctorId) where.doctorUserId = doctorId;
      if (appointmentId) where.appointmentId = appointmentId;
    }

    const [rows, total] = await Promise.all([
      prisma.medicalRecord.findMany({
        where,
        select: MEDICAL_RECORD_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.medicalRecord.count({ where }),
    ]);

    return {
      rows: rows.map(shapeMedicalRecord),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

/**
 * @param {string} id
 * @param {{id:string, role:string}} requester
 */
async function getMedicalRecordById(id, requester) {
  const row = await getVisibleMedicalRecordOrThrow(id, requester);
  return shapeMedicalRecord(row);
}

module.exports = {
  createMedicalRecord,
  listMedicalRecords,
  getMedicalRecordById,
};
