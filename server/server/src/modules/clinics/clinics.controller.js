/**
 * Controllers for the clinics module.
 * Responsibility: parse req -> call the matching clinics.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const clinicsService = require('./clinics.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const createClinic = asyncHandler(async (req, res) => {
  const clinic = await clinicsService.createClinic(req.body, req.user);
  return success(res, clinic, { statusCode: 201, message: 'Clinic created' });
});

// search filter removed (backend-cleanup audit) — see clinics.validation.js#listClinics's comment.
const listClinics = asyncHandler(async (req, res) => {
  const { city, area, emergencyAvailable, approvalStatus, mine, page, pageSize } = req.query;
  const { rows, pagination } = await clinicsService.listClinics(
    { city, area, emergencyAvailable, approvalStatus, mine, page, pageSize },
    req.user
  );
  return success(res, rows, { pagination });
});

const getClinic = asyncHandler(async (req, res) => {
  const clinic = await clinicsService.getClinicById(req.params.id, req.user);
  return success(res, clinic);
});

const updateClinic = asyncHandler(async (req, res) => {
  const clinic = await clinicsService.updateClinic(req.params.id, req.body, req.user);
  return success(res, clinic, { message: 'Clinic updated' });
});

const approveClinic = asyncHandler(async (req, res) => {
  const clinic = await clinicsService.approveClinic(req.params.id, req.user);
  return success(res, clinic, { message: 'Clinic approved' });
});

const rejectClinic = asyncHandler(async (req, res) => {
  const clinic = await clinicsService.rejectClinic(req.params.id, req.body.rejectionReason, req.user);
  return success(res, clinic, { message: 'Clinic rejected' });
});

const assignDoctor = asyncHandler(async (req, res) => {
  const assignment = await clinicsService.assignDoctorToClinic(req.params.id, req.body, req.user);
  return success(res, assignment, { statusCode: 201, message: 'Doctor assigned to clinic' });
});

const updateDoctorAssignment = asyncHandler(async (req, res) => {
  const assignment = await clinicsService.updateDoctorAssignment(
    req.params.id,
    req.params.doctorUserId,
    req.body,
    req.user
  );
  return success(res, assignment, { message: 'Assignment updated' });
});

const removeDoctorAssignment = asyncHandler(async (req, res) => {
  await clinicsService.removeDoctorAssignment(req.params.id, req.params.doctorUserId, req.user);
  return success(res, null, { message: 'Doctor unassigned from clinic' });
});

const putHours = asyncHandler(async (req, res) => {
  const hours = await clinicsService.upsertHours(req.params.clinicId, req.body, req.user);
  return success(res, hours, { message: 'OPD hours saved' });
});

const listHours = asyncHandler(async (req, res) => {
  const { doctorId, page, pageSize } = req.query;
  const { rows, pagination } = await clinicsService.listHours(req.params.clinicId, { doctorId, page, pageSize }, req.user);
  return success(res, rows, { pagination });
});

const deleteHours = asyncHandler(async (req, res) => {
  await clinicsService.deleteHoursRow(req.params.clinicId, req.params.hoursId, req.user);
  return success(res, null, { message: 'OPD hours entry removed' });
});

const createClosure = asyncHandler(async (req, res) => {
  const closure = await clinicsService.upsertClosure(req.params.clinicId, req.body, req.user);
  return success(res, closure, { statusCode: 201, message: 'Closure saved' });
});

// from/to date-range filter removed (backend-cleanup audit) — see clinics.validation.js#listClosures's comment.
const listClosures = asyncHandler(async (req, res) => {
  const { doctorId, page, pageSize } = req.query;
  const { rows, pagination } = await clinicsService.listClosures(req.params.clinicId, { doctorId, page, pageSize }, req.user);
  return success(res, rows, { pagination });
});

const deleteClosure = asyncHandler(async (req, res) => {
  await clinicsService.deleteClosureRow(req.params.clinicId, req.params.closureId, req.user);
  return success(res, null, { message: 'Closure removed' });
});

module.exports = {
  createClinic,
  listClinics,
  getClinic,
  updateClinic,
  approveClinic,
  rejectClinic,
  assignDoctor,
  updateDoctorAssignment,
  removeDoctorAssignment,
  putHours,
  listHours,
  deleteHours,
  createClosure,
  listClosures,
  deleteClosure,
};
