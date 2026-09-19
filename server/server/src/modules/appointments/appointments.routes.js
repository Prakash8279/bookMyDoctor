/**
 * Route definitions for the appointments module.
 * Scope: Booking (waiting-room enqueue + poll), listing (role-scoped), status transitions, cancel.
 * The highest-traffic module.
 * Allowed roles: patient, doctor, receptionist, admin
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in appointments.service.js.
 *
 * POST / is rate-limited by bookingLimiter (middleware/rateLimiter.js) — that limiter's own
 * header comment documents it as "consumed by the appointments module in a later phase"; this is
 * that phase. Mounted AFTER authenticate so the limiter's per-user keyGenerator has req.user
 * available.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const { bookingLimiter } = require('../../middleware/rateLimiter');
const validation = require('./appointments.validation');
const controller = require('./appointments.controller');

const ALL_ROLES = ['patient', 'doctor', 'receptionist', 'admin', 'superadmin'];

// ── A. Booking write path (waiting-room enqueue + poll) ─────────────────────

router.post(
  '/',
  authenticate,
  authorize('patient', 'receptionist'),
  bookingLimiter,
  validation.createAppointment,
  validateRequest,
  controller.createAppointment
);

router.get(
  '/booking-status/:jobId',
  authenticate,
  authorize('patient', 'receptionist', 'admin', 'superadmin'),
  validation.bookingStatus,
  validateRequest,
  controller.getBookingStatus
);

// ── B. Read + status transitions ─────────────────────────────────────────

router.get('/', authenticate, authorize(...ALL_ROLES), validation.listAppointments, validateRequest, controller.listAppointments);

router.get('/:id', authenticate, authorize(...ALL_ROLES), validation.getAppointment, validateRequest, controller.getAppointment);

router.patch(
  '/:id/status',
  authenticate,
  authorize(...ALL_ROLES),
  validation.updateStatus,
  validateRequest,
  controller.updateAppointmentStatus
);

module.exports = router;
