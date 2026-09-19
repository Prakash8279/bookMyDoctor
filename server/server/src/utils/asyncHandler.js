/**
 * Wraps an async route/controller function so rejected promises are forwarded to next(err)
 * instead of crashing the process. Responsibility: eliminate repetitive try/catch in every controller.
 */
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
