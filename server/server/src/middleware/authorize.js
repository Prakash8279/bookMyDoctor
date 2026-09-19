/**
 * Role-based access control middleware factory: authorize('doctor', 'admin') etc.
 * Responsibility: reject with 403 if req.user.role is not in the allowed list.
 * MUST run after authenticate.js on every protected route. Ownership checks (e.g. a doctor
 * editing only their own profile) belong in the service layer, not here — this only checks role.
 */
const ApiError = require('../utils/ApiError');

module.exports = function authorize(...allowedRoles) {
  return function authorizeMiddleware(req, res, next) {
    if (!req.user) {
      return next(new ApiError(401, 'UNAUTHORIZED', 'Authentication is required to access this resource.'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
    }

    next();
  };
};
