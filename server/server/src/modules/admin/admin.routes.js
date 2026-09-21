/**
 * Route definitions for the admin module.
 * Scope: activity log (read), system_settings (singleton read/write), booking_rules (singleton
 * read/write), dashboard-stats (read-only aggregate), and the patients directory. Clinic/doctor
 * approval queues already live in the clinics/doctors/payments modules from earlier phases and are
 * deliberately not duplicated here.
 * revenue-trend and the BullMQ failed-jobs view were removed (backend-cleanup audit — user
 * request: "website frontend me nahi hai but backend bna hua hai to backend se hata do"): the
 * web/mobile dashboards never had a UI wired up for either one.
 * Allowed roles: admin, superadmin (every route in this module)
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in admin.service.js.
 */
const router = require('express').Router();

const adminIpAllowlist = require('../../middleware/adminIpAllowlist');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const validation = require('./admin.validation');
const controller = require('./admin.controller');

// adminIpAllowlist first — it's an env-gated, no-DB, no-crypto string comparison, the cheapest
// possible check, so an unlisted caller is rejected before paying for JWT verification and a
// user lookup. No-op (passes every request through) unless ADMIN_IP_ALLOWLIST is configured.
router.use(adminIpAllowlist, authenticate, authorize('admin', 'superadmin'));

router.get('/activity-log', validation.listActivityLog, validateRequest, controller.getActivityLog);

router.get('/system-settings', controller.getSystemSettings);
router.put('/system-settings', validation.updateSystemSettings, validateRequest, controller.updateSystemSettings);

router.get('/booking-rules', controller.getBookingRules);
router.put('/booking-rules', validation.updateBookingRules, validateRequest, controller.updateBookingRules);

router.get('/dashboard-stats', controller.getDashboardStats);

router.get('/patients', validation.listPatients, validateRequest, controller.listPatients);

// COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
// account-level login enable/disable (users.status) for a patient — see
// admin.service.js#updatePatientStatus. Patients have no dedicated module/verification-lifecycle
// field of their own (unlike doctors), so this directory is the natural home for it.
router.patch('/patients/:id/status', validation.updatePatientStatus, validateRequest, controller.updatePatientStatus);

module.exports = router;
