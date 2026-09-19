/**
 * Catch-all 404 handler for unmatched routes.
 * Responsibility: respond with the standard error envelope instead of Express's default HTML 404.
 */
const ApiError = require('../utils/ApiError');

module.exports = function notFound(req, res, next) {
  next(new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.'));
};
