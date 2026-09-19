/**
 * Centralized Express error-handling middleware (4-arg signature, mounted last in app.js).
 * Responsibility: catch every thrown/next(err) error in the app, map known ApiError types to
 * their status code, log unexpected errors, and always respond with the standard
 * {success:false, error:{message, code}} envelope. Never leak stack traces in production.
 */
const ApiError = require('../utils/ApiError');
const { fail } = require('../utils/apiResponse');
const logger = require('../config/logger');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error(`[${req.id || '-'}] ${err.code}: ${err.message}`, { stack: err.stack });
    }
    return fail(res, err.statusCode, err.code, err.message, err.details);
  }

  // express.json() body-parser failure on malformed JSON.
  if (err && err.type === 'entity.parse.failed') {
    return fail(res, 400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
  }

  // Anything else is unexpected: log the full stack server-side, never expose it to the client.
  logger.error(`[${req.id || '-'}] Unhandled error: ${err && err.message}`, { stack: err && err.stack });
  return fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again later.');
};
