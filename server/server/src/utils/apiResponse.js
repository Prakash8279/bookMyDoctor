/**
 * Standard response envelope helpers: success(res, data, meta) and fail(res, status, message, code).
 * Responsibility: guarantee every endpoint in the app returns the SAME shape
 * {success, data, message} / {success, error} as required by the API contract.
 */

/**
 * Send a successful response.
 * @param {import('express').Response} res
 * @param {*} data - payload; an array for list endpoints, an object/null otherwise.
 * @param {object} [options]
 * @param {string} [options.message] - optional human-readable message.
 * @param {{page:number,pageSize:number,total:number,totalPages:number}} [options.pagination]
 * @param {boolean} [options.truncated] - LOAD-REVIEW FIX: set only by endpoints (e.g. queue
 *   listing) whose service layer enforces a defensive result cap, so a caller can tell "this list
 *   silently left rows out" apart from "this is genuinely everything." Omitted entirely (not sent
 *   as false) when the endpoint has no such cap, so its presence itself is meaningful.
 * @param {number} [options.statusCode=200]
 */
function success(res, data, options = {}) {
  const { message, pagination, truncated, statusCode = 200 } = options;

  const body = { success: true, data };
  if (pagination) body.pagination = pagination;
  if (truncated !== undefined) body.truncated = truncated;
  if (message) body.message = message;

  return res.status(statusCode).json(body);
}

/**
 * Send an error response. Prefer throwing an ApiError and letting errorHandler.js call this
 * instead of calling it directly from a controller/service.
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} code - machine-readable error code.
 * @param {string} message - human-readable message.
 * @param {*} [details] - optional extra detail (e.g. field-level validation errors).
 */
function fail(res, statusCode, code, message, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;

  return res.status(statusCode).json({ success: false, error });
}

module.exports = { success, fail };
