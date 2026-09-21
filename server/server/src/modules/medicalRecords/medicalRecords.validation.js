/**
 * express-validator chains for every medicalRecords endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "you don't own this appointment", "patient
 * not found") belongs in medicalRecords.service.js.
 */
const { body, query } = require('express-validator');

const createMedicalRecord = [
  body('appointmentId').optional({ values: 'falsy' }).isUUID().withMessage('appointmentId must be a valid id.'),
  body('patientUserId').optional({ values: 'falsy' }).isUUID().withMessage('patientUserId must be a valid id.'),
  body('title')
    .notEmpty()
    .withMessage('title is required.')
    .bail()
    .isString()
    .trim()
    .isLength({ max: 300 })
    .withMessage('title must be at most 300 characters.'),
  body('type').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }).withMessage('type must be at most 100 characters.'),
  // notes/carePlan — the literal bug fix (see service header comment): both are now actually
  // persisted, unlike the current frontend's addRecord which silently drops them.
  body('notes').optional({ values: 'falsy' }).isString().trim().isLength({ max: 4000 }).withMessage('notes must be at most 4000 characters.'),
  body('carePlan').optional({ values: 'falsy' }).isString().trim().isLength({ max: 4000 }).withMessage('carePlan must be at most 4000 characters.'),
];

// patientId/doctorId/appointmentId filters removed (backend-cleanup audit — user request:
// "website frontend me nahi hai but backend bna hua hai to backend se hata do"): neither web nor
// mobile ever sends any of these three — every caller (doctor/patient scoped automatically,
// admin unfiltered) just fetches the plain paginated list.
const listMedicalRecords = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

// getMedicalRecord validation removed (backend-cleanup audit) — see medicalRecords.routes.js's
// comment.

module.exports = { createMedicalRecord, listMedicalRecords };
