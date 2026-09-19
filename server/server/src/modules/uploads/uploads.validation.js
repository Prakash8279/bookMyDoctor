/**
 * express-validator chains for the uploads module's non-file body fields. Shape validation only
 * (required-ness, type, length) — ownership/business rules (e.g. "does this clinicId belong to
 * a clinic you actually own") belong in uploads.service.js, the same split every other module in
 * this codebase uses (see e.g. me.validation.js's own header comment).
 *
 * These chains necessarily run AFTER this module's services/fileUploadService.js middleware, not
 * before it like every other module's validation chain in this app: `clinicId`/`name` here are
 * regular multipart TEXT fields, and Express's req.body for a multipart request is only
 * populated once multer has parsed the whole form — there is no framework-level way to validate
 * a multipart text field before the file alongside it has already been streamed/buffered/saved.
 */
const { body } = require('express-validator');

const uploadDocument = [
  body('name')
    .optional({ values: 'falsy' })
    .isString()
    .trim()
    .isLength({ max: 150 })
    .withMessage('name must be at most 150 characters.'),
];

const uploadQr = [
  body('clinicId')
    .trim()
    .notEmpty()
    .withMessage('clinicId is required.')
    .isUUID()
    .withMessage('clinicId must be a valid id.'),
];

module.exports = { uploadDocument, uploadQr };
