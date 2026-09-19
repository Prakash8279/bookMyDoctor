/**
 * Controllers for the doctors module.
 * Responsibility: parse req -> call the matching doctors.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const doctorsService = require('./doctors.service');
const tokenService = require('../../services/tokenService');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const listDoctors = asyncHandler(async (req, res) => {
  const { specializationId, cityId, areaId, minRating, search, emergencyAvailable, sortBy, sortOrder, page, pageSize, status } =
    req.query;
  const { rows, pagination } = await doctorsService.listDoctors({
    specializationId,
    cityId,
    areaId,
    minRating,
    search,
    emergencyAvailable,
    sortBy,
    sortOrder,
    page,
    pageSize,
    // `status` only has any effect for an admin/superadmin requester — see
    // doctors.service.js#listDoctors's isAdminCaller branch.
    requester: req.user,
    status,
  });
  return success(res, rows, { pagination });
});

const getDoctor = asyncHandler(async (req, res) => {
  const doctor = await doctorsService.getDoctorById(req.params.id, req.user);
  return success(res, doctor);
});

const patchDoctor = asyncHandler(async (req, res) => {
  const doctor = await doctorsService.updateBookingSettings(req.params.id, req.body, req.user);
  return success(res, doctor, { message: 'Booking settings updated' });
});

const createDoctor = asyncHandler(async (req, res) => {
  const doctor = await doctorsService.createDoctor(req.body, req.user);
  return success(res, doctor, { statusCode: 201, message: 'Doctor account created' });
});

// Public self-registration (no authenticate middleware — see doctors.routes.js). Deliberately
// destructures only the fields a public applicant may set: `verifyImmediately` and
// `verificationDocuments` are admin-only concerns (see createDoctor's validation vs
// registerDoctor's validation in doctors.validation.js) and are never read from this body, so a
// self-registered doctor can never skip the pending-verification queue no matter what the
// request contains.
const registerDoctor = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    phone,
    city,
    specializationId,
    qualification,
    registrationNumber,
    experienceYears,
    consultationFee,
    emergencyFee,
    languages,
    bio,
  } = req.body;
  const doctor = await doctorsService.createDoctor(
    { name, email, password, phone, city, specializationId, qualification, registrationNumber, experienceYears, consultationFee, emergencyFee, languages, bio },
    null
  );
  const tokens = await tokenService.issueTokenPair({ id: doctor.id, role: 'doctor' });
  return success(res, { user: doctor, ...tokens }, {
    statusCode: 201,
    message: 'Registration submitted. An admin will review your details before you appear to patients.',
  });
});

const updateDoctorStatus = asyncHandler(async (req, res) => {
  const doctor = await doctorsService.updateDoctorStatus(req.params.id, req.body.status, req.user);
  return success(res, doctor, { message: 'Doctor status updated' });
});

// COMPLETENESS FIX (audit Priority 4): account-level login enable/disable — see
// doctors.service.js#updateDoctorAccountStatus.
const updateDoctorAccountStatus = asyncHandler(async (req, res) => {
  const doctor = await doctorsService.updateDoctorAccountStatus(req.params.id, req.body.status, req.user);
  return success(res, doctor, { message: 'Doctor account login status updated' });
});

module.exports = { listDoctors, getDoctor, patchDoctor, createDoctor, registerDoctor, updateDoctorStatus, updateDoctorAccountStatus };
