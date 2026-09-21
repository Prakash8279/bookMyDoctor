/**
 * Controllers for the medicalRecords module.
 * Responsibility: parse req -> call the matching medicalRecords.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const medicalRecordsService = require('./medicalRecords.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const createMedicalRecord = asyncHandler(async (req, res) => {
  const record = await medicalRecordsService.createMedicalRecord(req.body, req.user);
  return success(res, record, { statusCode: 201, message: 'Medical record created.' });
});

// patientId/doctorId/appointmentId filters removed (backend-cleanup audit) — see
// medicalRecords.validation.js#listMedicalRecords's comment.
const listMedicalRecords = asyncHandler(async (req, res) => {
  const { page, pageSize } = req.query;
  const { rows, pagination } = await medicalRecordsService.listMedicalRecords({ page, pageSize }, req.user);
  return success(res, rows, { pagination });
});

// getMedicalRecord handler removed (backend-cleanup audit) — see medicalRecords.routes.js's
// comment. medicalRecordsService.getMedicalRecordById/getVisibleMedicalRecordOrThrow were removed
// too — grepped and confirmed no other module called either function internally.

module.exports = { createMedicalRecord, listMedicalRecords };
