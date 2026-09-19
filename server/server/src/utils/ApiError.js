/**
 * Custom Error subclass carrying an HTTP status code + machine-readable error code.
 * Responsibility: services throw `new ApiError(404, 'DOCTOR_NOT_FOUND', "Doctor not found")`
 * instead of raw Error/strings; errorHandler.js knows how to turn this into the right response.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code to send.
   * @param {string} code - machine-readable error code, e.g. 'VALIDATION_ERROR'.
   * @param {string} message - human-readable message, safe to show to a client.
   * @param {*} [details] - optional extra detail (e.g. field-level validation errors).
   */
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
