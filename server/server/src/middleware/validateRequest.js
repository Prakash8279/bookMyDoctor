/**
 * express-validator result handler.
 * Responsibility: run after a route's validation chain; if there are validation errors,
 * respond 422 with a consistent {success:false, error:{fields:[...]}} envelope. Otherwise next().
 */
const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

module.exports = function validateRequest(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const fields = result.array({ onlyFirstError: true }).map((e) => ({
    field: e.path || e.param,
    message: e.msg,
  }));

  next(new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', fields));
};
