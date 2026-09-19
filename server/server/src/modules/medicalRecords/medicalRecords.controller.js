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

const listMedicalRecords = asyncHandler(async (req, res) => {
  const { page, pageSize, patientId, doctorId, appointmentId } = req.query;
  const { rows, pagination } = await medicalRecordsService.listMedicalRecords(
    { page, pageSize, patientId, doctorId, appointmentId },
    req.user
  );
  return success(res, rows, { pagination });
});

const getMedicalRecord = asyncHandler(async (req, res) => {
  const record = await medicalRecordsService.getMedicalRecordById(req.params.id, req.user);
  return success(res, record);
});

module.exports = { createMedicalRecord, listMedicalRecords, getMedicalRecord };
