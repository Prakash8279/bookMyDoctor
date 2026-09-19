/**
 * Route definitions for the me module.
 * Scope: Own-profile management: GET/PATCH /me, change-password. Applies to every role.
 * Allowed roles: any authenticated (self only)
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in me.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const { passwordChangeLimiter } = require('../../middleware/rateLimiter');
const validation = require('./me.validation');
const controller = require('./me.controller');

// Every route in this module is "any authenticated user, acting on their own row" —
// no authorize(...) needed since there is no role restriction, only the ownership guarantee
// that req.user.id (set by authenticate) is the only id ever used downstream.
router.use(authenticate);

router.get('/', controller.getMe);
router.patch('/', validation.patchMe, validateRequest, controller.updateMe);
// passwordChangeLimiter (same strictness as the authLimiter used on POST /auth/login, but keyed
// per-authenticated-user instead of per-IP) is applied here: changePassword() runs
// bcrypt.compare(currentPassword, ...), a credential-guessing surface just like login. Without
// a dedicated limiter, anyone holding a valid access token (e.g. stolen via XSS) could use the
// generous global defaultLimiter (300 req/min/IP) to brute-force currentPassword, and could even
// evade an IP-keyed limiter by spreading requests across source IPs. Keying by req.user.id (set
// by `authenticate` above) closes that gap.
router.patch(
  '/password',
  passwordChangeLimiter,
  validation.patchPassword,
  validateRequest,
  controller.changePassword
);

module.exports = router;
