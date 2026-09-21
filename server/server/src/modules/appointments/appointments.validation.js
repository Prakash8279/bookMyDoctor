/**
 * express-validator chains for every appointments endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "slot already booked", "you don't own this
 * appointment", "doctor not available that day") belongs in appointments.service.js.
 */
const { body, param, query } = require('express-validator');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// POST /appointments — body shape only. Which of patientUserId/familyMemberId actually apply
// (patient vs receptionist caller), and whether the referenced doctor/clinic/patient/family
// member are real, visible, and consistent with each other, is all business-rule validation
// that belongs in appointments.service.js#enqueueBooking / #runBookingJob — see rule 4 in the
// phase brief. This chain only confirms "if present, shaped correctly".
const createAppointment = [
  body('doctorUserId').notEmpty().withMessage('doctorUserId is required.').isUUID(),
  body('clinicId').optional({ values: 'falsy' }).isUUID().withMessage('clinicId must be a valid id.'),
  body('appointmentDate')
    .notEmpty()
    .withMessage('appointmentDate is required.')
    .matches(DATE_RE)
    .withMessage('appointmentDate must be in YYYY-MM-DD format.'),
  // Optional — when omitted, appointments.service.js#runBookingJob auto-assigns the doctor's
  // next free slot on the selected date (see that function for why: the patient booking form no
  // longer collects an exact time, only a token/queue position matters to the patient). Still
  // accepted when a caller (receptionist/admin walk-in) does supply one, validated identically.
  body('appointmentTime')
    .optional({ values: 'falsy' })
    .matches(TIME_RE)
    .withMessage('appointmentTime must be in HH:MM 24-hour format.'),
  body('reason').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }),
  body('isEmergency').optional({ values: 'falsy' }).isBoolean().withMessage('isEmergency must be a boolean.').toBoolean(),
  body('familyMemberId').optional({ values: 'falsy' }).isUUID().withMessage('familyMemberId must be a valid id.'),
  body('patientUserId').optional({ values: 'falsy' }).isUUID().withMessage('patientUserId must be a valid id.'),
  // COMPLETENESS FIX (audit Priority 1 #2 — walk-in registration): a receptionist/admin booking
  // on behalf of a brand-new patient has no existing patientUserId yet. These three let
  // appointments.service.js#enqueueBooking find-or-create that patient account inline instead of
  // requiring one to already exist — shape check only here, same convention as the rest of this
  // file; "at least one of patientUserId or (patientName + patientPhone)" is a business rule
  // enforced in the service.
  body('patientName').optional({ values: 'falsy' }).isString().trim().isLength({ min: 1, max: 150 }).withMessage('patientName must be 1-150 characters.'),
  body('patientPhone').optional({ values: 'falsy' }).isString().trim().isLength({ min: 6, max: 20 }).withMessage('patientPhone must be 6-20 characters.'),
  body('patientEmail').optional({ values: 'falsy' }).isEmail().withMessage('patientEmail must be a valid email address.'),
  body('paymentMethod')
    .optional({ values: 'falsy' })
    .isIn(['cash', 'upi', 'card', 'online'])
    .withMessage('paymentMethod must be one of: cash, upi, card, online.'),
];

const bookingStatus = [param('jobId').isUUID().withMessage('jobId must be a valid id.')];

const listAppointments = [
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['pending_payment', 'upcoming', 'confirmed', 'completed', 'cancelled', 'no_show'])
    .withMessage('status must be one of: pending_payment, upcoming, confirmed, completed, cancelled, no_show.'),
  query('date').optional({ values: 'falsy' }).matches(DATE_RE).withMessage('date must be in YYYY-MM-DD format.'),
  query('dateFrom').optional({ values: 'falsy' }).matches(DATE_RE).withMessage('dateFrom must be in YYYY-MM-DD format.'),
  query('dateTo').optional({ values: 'falsy' }).matches(DATE_RE).withMessage('dateTo must be in YYYY-MM-DD format.'),
  query('doctorId').optional({ values: 'falsy' }).isUUID().withMessage('doctorId must be a valid id.'),
  // patientId and the admin-list-filter use of clinicId removed (backend-cleanup audit — user
  // request: "website frontend me nahi hai but backend bna hua hai to backend se hata do"):
  // admin's own web/mobile filter UI never wired either one up.
  // ADMIN FILTER FIX (user request: "city wise doctor name se v aur date se v") — admin/superadmin
  // only (see appointments.service.js#listAppointments); every other role is forced-scoped and
  // ignores this the same way it already ignores doctorId/clinicId/patientId.
  query('cityId').optional({ values: 'falsy' }).isUUID().withMessage('cityId must be a valid id.'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const getAppointment = [param('id').isUUID().withMessage('id must be a valid id.')];

const updateStatus = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  // 'upcoming' is deliberately excluded — it's the create-time default only, never a valid
  // client-requested target status.
  body('status')
    .notEmpty()
    .withMessage('status is required.')
    .isIn(['confirmed', 'completed', 'cancelled', 'no_show'])
    .withMessage('status must be one of: confirmed, completed, cancelled, no_show.'),
];

module.exports = { createAppointment, bookingStatus, listAppointments, getAppointment, updateStatus };
