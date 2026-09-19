/**
 * Mounts every module's router onto the main Express app under its path prefix, in one place,
 * so app.js stays a thin file. Responsibility: routing table only — no business logic here.
 */
const router = require('express').Router();

// Mounted first, ahead of every other route: a load balancer/uptime monitor must be able to
// reach it regardless of what's added below, and it needs no auth/rate-limit tier of its own
// (see modules/health/health.routes.js for the full rationale).
router.use('/health', require('../modules/health/health.routes'));

router.use('/auth', require('../modules/auth/auth.routes'));
router.use('/me', require('../modules/me/me.routes'));

// Multipart file uploads (profile photos, doctor verification documents, clinic QR codes).
// Mounted at '/media', NOT '/uploads' — app.js already owns the literal '/uploads' path for
// `express.static`, which serves the files this module writes back out (see app.js step 7 and
// modules/uploads/uploads.routes.js's own header comment for the full rationale).
router.use('/media', require('../modules/uploads/uploads.routes'));

// Directory & Reference Data phase.
router.use('/geography', require('../modules/geography/geography.routes'));
router.use('/doctors', require('../modules/doctors/doctors.routes'));
router.use('/clinics', require('../modules/clinics/clinics.routes'));
router.use('/family-members', require('../modules/familyMembers/familyMembers.routes'));
router.use('/receptionists', require('../modules/receptionists/receptionists.routes'));

// Booking Core phase.
router.use('/appointments', require('../modules/appointments/appointments.routes'));
router.use('/queue', require('../modules/queue/queue.routes'));

// Clinical & Payments phase.
router.use('/medical-records', require('../modules/medicalRecords/medicalRecords.routes'));
router.use('/payments', require('../modules/payments/payments.routes'));
router.use('/platform-charges', require('../modules/platformCharges/platformCharges.routes'));

// Engagement & Admin Ops phase.
router.use('/reviews', require('../modules/reviews/reviews.routes'));
router.use('/notifications', require('../modules/notifications/notifications.routes'));
router.use('/complaints', require('../modules/complaints/complaints.routes'));
router.use('/contact', require('../modules/contact/contact.routes'));
router.use('/admin', require('../modules/admin/admin.routes'));

// Future phases append more router.use('/<prefix>', require('../modules/<module>/<module>.routes'))
// lines here — nothing else about this file changes.

module.exports = router;
