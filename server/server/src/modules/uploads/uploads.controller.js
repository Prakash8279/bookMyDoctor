/**
 * Controllers for the uploads module.
 * Responsibility: parse req -> call the matching uploads.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no ownership rules here. By the
 * time these run, services/fileUploadService.js's middleware has already validated, saved, and
 * exposed the file as req.uploadedFile = {filename, url}.
 */
const uploadsService = require('./uploads.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const uploadPhoto = asyncHandler(async (req, res) => {
  const url = await uploadsService.savePhoto(req.user, req.uploadedFile.url);
  return success(res, { url }, { message: 'Photo uploaded.' });
});

const uploadDocument = asyncHandler(async (req, res) => {
  const url = await uploadsService.saveVerificationDocument(req.user, req.uploadedFile.url, req.body.name);
  return success(res, { url }, { statusCode: 201, message: 'Verification document uploaded.' });
});

const uploadQr = asyncHandler(async (req, res) => {
  const url = await uploadsService.saveClinicQr(req.user, req.body.clinicId, req.uploadedFile.url);
  return success(res, { url }, { message: 'Clinic QR code uploaded.' });
});

module.exports = { uploadPhoto, uploadDocument, uploadQr };
