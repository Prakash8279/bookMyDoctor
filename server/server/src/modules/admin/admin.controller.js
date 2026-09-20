/**
 * Controllers for the admin module.
 * Responsibility: parse req -> call the matching admin.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const adminService = require('./admin.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const getActivityLog = asyncHandler(async (req, res) => {
  const { actorUserId, actionType, page, pageSize } = req.query;
  const { rows, pagination } = await adminService.getActivityLog({ actorUserId, actionType, page, pageSize });
  return success(res, rows, { pagination });
});

const getSystemSettings = asyncHandler(async (req, res) => {
  const settings = await adminService.getSystemSettings();
  return success(res, settings);
});

const updateSystemSettings = asyncHandler(async (req, res) => {
  const settings = await adminService.updateSystemSettings(req.body, req.user);
  return success(res, settings, { message: 'System settings updated.' });
});

const getBookingRules = asyncHandler(async (req, res) => {
  const rules = await adminService.getBookingRules();
  return success(res, rules);
});

const updateBookingRules = asyncHandler(async (req, res) => {
  const rules = await adminService.updateBookingRules(req.body, req.user);
  return success(res, rules, { message: 'Booking rules updated.' });
});

const getDashboardStats = asyncHandler(async (req, res) => {
  const stats = await adminService.getDashboardStats();
  return success(res, stats);
});

const getRevenueTrend = asyncHandler(async (req, res) => {
  const { months } = req.query;
  const trend = await adminService.getRevenueTrend(months);
  return success(res, trend);
});

const listPatients = asyncHandler(async (req, res) => {
  const { search, page, pageSize } = req.query;
  const { rows, pagination } = await adminService.listPatients({ search, page, pageSize });
  return success(res, rows, { pagination });
});

// COMPLETENESS FIX (audit Priority 4): account-level login enable/disable for a patient — see
// admin.service.js#updatePatientStatus.
const updatePatientStatus = asyncHandler(async (req, res) => {
  const patient = await adminService.updatePatientStatus(req.params.id, req.body.status, req.user);
  return success(res, patient, { message: 'Patient account login status updated' });
});

// Operational visibility into the BullMQ booking queue — see admin.service.js#getFailedBookingJobs.
// `truncated` follows the same convention as queue.controller.js#listQueue — see that function
// and admin.service.js#getFailedBookingJobs's own comment on it.
const getFailedBookingJobs = asyncHandler(async (req, res) => {
  const { limit } = req.query;
  const { jobs, truncated } = await adminService.getFailedBookingJobs({ limit });
  return success(res, jobs, { truncated });
});

module.exports = {
  getActivityLog,
  getSystemSettings,
  updateSystemSettings,
  getBookingRules,
  updateBookingRules,
  getDashboardStats,
  getRevenueTrend,
  listPatients,
  updatePatientStatus,
  getFailedBookingJobs,
};
