/**
 * express-validator chains for every platformCharges endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation belongs in the service layer.
 *
 * PUT / is a full-replace of the singleton config row (not a partial patch) — all 6 fields are
 * required on every call. Using isFloat({min,max})/isBoolean() directly (no separate notEmpty())
 * doubles as the "required" check: an absent field stringifies to "undefined", which fails both
 * validators cleanly with the same per-field message.
 */
const { body } = require('express-validator');

const updateCharges = [
  body('commissionPercent')
    .isFloat({ min: 0, max: 100 })
    .withMessage('commissionPercent is required and must be a number between 0 and 100.'),
  body('patientConvenienceFee')
    .isFloat({ min: 0, max: 99999999.99 })
    .withMessage('patientConvenienceFee is required and must be a number between 0 and 99999999.99.'),
  body('emergencyFee')
    .isFloat({ min: 0, max: 99999999.99 })
    .withMessage('emergencyFee is required and must be a number between 0 and 99999999.99.'),
  body('gstPercent')
    .isFloat({ min: 0, max: 100 })
    .withMessage('gstPercent is required and must be a number between 0 and 100.'),
  body('applyConvenienceFee')
    .isBoolean()
    .withMessage('applyConvenienceFee is required and must be a boolean.')
    .toBoolean(),
  body('applyEmergencyFee')
    .isBoolean()
    .withMessage('applyEmergencyFee is required and must be a boolean.')
    .toBoolean(),
];

module.exports = { updateCharges };
