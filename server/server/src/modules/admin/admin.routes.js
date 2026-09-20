/**
 * Route definitions for the admin module.
 * Scope: THIS PHASE ONLY covers activity log (read), system_settings (singleton read/write),
 * booking_rules (singleton read/write), dashboard-stats (read-only aggregate), revenue-trend
 * (read-only monthly aggregate for the dashboard's revenue chart), and (added later) read-only
 * BullMQ booking-queue failed-job visibility. Clinic/doctor approval queues
 * already live in the clinics/doctors/payments modules from earlier phases and are deliberately
 * not duplicated here; a full revenue-reporting suite (CSV export, per-doctor breakdowns) is also
 * deliberately out of scope — revenue-trend below is one bounded chart-data endpoint, not that.
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

router.get('/revenue-trend', validation.getRevenueTrend, validateRequest, controller.getRevenueTrend);

router.get('/patients', validation.listPatients, validateRequest, controller.listPatients);

// COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
// account-level login enable/disable (users.status) for a patient — see
// admin.service.js#updatePatientStatus. Patients have no dedicated module/verification-lifecycle
// field of their own (unlike doctors), so this directory is the natural home for it.
router.patch('/patients/:id/status', validation.updatePatientStatus, validateRequest, controller.updatePatientStatus);

// Operational visibility into the BullMQ booking queue (src/jobs/bookingQueue.js /
// bookingWorker.js): recent FAILED booking jobs, so admin/superadmin can spot a spike (e.g. a
// burst of SLOT_ALREADY_BOOKED races, or a sustained Redis/DB blip) without shelling into Redis
// directly. Read-only, gated by the same router.use(...) admin/superadmin check as every other
// route in this module above — no dedicated validation chain: the optional `limit` query int is
// defensively clamped inside admin.service.js#getFailedBookingJobs, the same way
// getSystemSettings/getBookingRules/getDashboardStats above also run with no validation chain for
// their own parameterless GETs (admin.validation.js is intentionally left untouched here).
router.get('/jobs/failed', controller.getFailedBookingJobs);

module.exports = router;
