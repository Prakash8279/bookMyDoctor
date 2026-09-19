/**
 * Controllers for the complaints module.
 * Responsibility: parse req -> call the matching complaints.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const complaintsService = require('./complaints.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const createComplaint = asyncHandler(async (req, res) => {
  const complaint = await complaintsService.createComplaint(req.body, req.user);
  return success(res, complaint, { statusCode: 201, message: 'Complaint submitted.' });
});

const updateComplaint = asyncHandler(async (req, res) => {
  const complaint = await complaintsService.updateComplaint(req.params.id, req.body, req.user);
  return success(res, complaint, { message: 'Complaint updated.' });
});

const listComplaints = asyncHandler(async (req, res) => {
  const { status, page, pageSize } = req.query;
  const { rows, pagination } = await complaintsService.listComplaints({ status, page, pageSize }, req.user);
  return success(res, rows, { pagination });
});

const getComplaint = asyncHandler(async (req, res) => {
  const complaint = await complaintsService.getComplaintById(req.params.id, req.user);
  return success(res, complaint);
});

module.exports = { createComplaint, updateComplaint, listComplaints, getComplaint };
