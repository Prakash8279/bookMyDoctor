/**
 * express-validator chains for every clinics endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "you don't own this clinic", "slot already
 * assigned") belongs in the service layer.
 */
const { body, param, query } = require('express-validator');

const OPT_NULLABLE = { values: 'null' };
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// `.optional()` with no options only skips a chain when the field is `undefined` — so an
// explicit JSON `null` still reaches `.custom()` below and fails it, producing a clean
// per-field 422 message, and `.bail()` stops the chain there so the type-specific validator
// after it (isBoolean/isLength, which can throw or coerce oddly on a raw null rather than fail
// cleanly) never runs on a `null` value. Used only for fields backed by a NOT NULL column,
// where null must be a shape error rather than treated as "clear it" the way OPT_NULLABLE
// fields elsewhere in this chain (backing nullable columns) legitimately allow.
function rejectNull(fieldName) {
  return body(fieldName)
    .optional()
    .custom((value) => value !== null)
    .withMessage(`${fieldName} cannot be null.`)
    .bail();
}

// ── Clinic CRUD + approval ──────────────────────────────────────────────

const createClinic = [
  body('name').trim().notEmpty().withMessage('name is required.').isLength({ max: 200 }),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 20 }),
  body('address').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
  body('cityId').notEmpty().withMessage('cityId is required.').isUUID(),
  body('areaId').optional({ values: 'falsy' }).isUUID(),
  body('emergencyAvailable').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  body('paymentCashEnabled').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  body('paymentUpiEnabled').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  body('paymentUpiId').optional({ values: 'falsy' }).trim().isLength({ max: 100 }),
  body('paymentQrUrl')
    .optional({ values: 'falsy' })
    .isString()
    .isLength({ max: 2048 })
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('paymentQrUrl must be a valid http(s) URL.'),
];

// search filter removed (backend-cleanup audit — user request: "website frontend me nahi hai but
// backend bna hua hai to backend se hata do"): neither web nor mobile clinic list/search screen
// ever sends a free-text `search` param — every one filters by city/area/emergencyAvailable/mine
// instead.
const listClinics = [
  query('city').optional({ values: 'falsy' }).isUUID().withMessage('city must be a valid id.'),
  query('area').optional({ values: 'falsy' }).isUUID().withMessage('area must be a valid id.'),
  query('emergencyAvailable').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  query('approvalStatus').optional({ values: 'falsy' }).isIn(['pending', 'active', 'disabled']),
  query('mine').optional({ values: 'falsy' }).isBoolean().toBoolean(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const getClinic = [param('id').isUUID().withMessage('id must be a valid id.')];

const patchClinic = [
  param('id').isUUID(),
  // name is a NOT NULL column — rejectNull() turns an explicit `null` into a clean 422 instead
  // of it silently skipping type validation and reaching Prisma (or `String(updates.name)`,
  // which would coerce it into the literal 4-character string "null") as a raw null.
  rejectNull('name').trim().isLength({ min: 1, max: 200 }),
  body('phone').optional(OPT_NULLABLE).trim().isLength({ max: 20 }),
  body('address').optional(OPT_NULLABLE).trim().isLength({ max: 500 }),
  // cityId is a required-in-practice field (a clinic must always reference a real city) —
  // 'falsy' here means an explicit null/omitted cityId is treated as "not touching this
  // field", not "clear it", so the service layer never has to look up a null city id.
  // areaId, by contrast, may legitimately be cleared (a clinic without a specific area).
  body('cityId').optional({ values: 'falsy' }).isUUID(),
  body('areaId').optional(OPT_NULLABLE).isUUID(),
  // emergencyAvailable/paymentCashEnabled/paymentUpiEnabled are all NOT NULL columns.
  rejectNull('emergencyAvailable').isBoolean().toBoolean(),
  rejectNull('paymentCashEnabled').isBoolean().toBoolean(),
  rejectNull('paymentUpiEnabled').isBoolean().toBoolean(),
  body('paymentUpiId').optional(OPT_NULLABLE).trim().isLength({ max: 100 }),
  body('paymentQrUrl')
    .optional(OPT_NULLABLE)
    .isString()
    .isLength({ max: 2048 })
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('paymentQrUrl must be a valid http(s) URL.'),
];

const approveClinic = [param('id').isUUID()];

const rejectClinic = [
  param('id').isUUID(),
  body('rejectionReason')
    .trim()
    .notEmpty()
    .withMessage('rejectionReason is required.')
    .isLength({ min: 5, max: 1000 })
    .withMessage('rejectionReason must be between 5 and 1000 characters.'),
];

// ── doctor_clinics assignment ───────────────────────────────────────────

const assignDoctor = [
  param('id').isUUID(),
  body('doctorUserId').notEmpty().withMessage('doctorUserId is required.').isUUID(),
  // isOwner/isPrimary/onlineBooking are all NOT NULL Boolean columns on doctor_clinics.
  // `{values:'falsy'}` treats explicit `null` as "not provided" and would let it skip
  // isBoolean() entirely, so rejectNull() runs first to turn it into a clean 422 instead of it
  // surviving as a raw null all the way into a destructuring default (which only covers
  // `undefined`, not `null`) and crashing Prisma with an unhandled PrismaClientValidationError.
  rejectNull('isOwner').isBoolean().toBoolean(),
  rejectNull('isPrimary').isBoolean().toBoolean(),
  rejectNull('onlineBooking').isBoolean().toBoolean(),
];

// isOwner/isPrimary removed (backend-cleanup audit — user request: "website frontend me nahi hai
// but backend bna hua hai to backend se hata do"): no web/mobile screen ever edits either flag
// after assignment — only the create-time POST (assignDoctor above) sets them; every PATCH caller
// only ever toggles onlineBooking.
const updateDoctorAssignment = [
  param('id').isUUID(),
  param('doctorUserId').isUUID(),
  rejectNull('onlineBooking').isBoolean().toBoolean(),
];

const removeDoctorAssignment = [param('id').isUUID(), param('doctorUserId').isUUID()];

// ── doctor_clinic_hours ─────────────────────────────────────────────────

const putHours = [
  param('clinicId').isUUID(),
  // doctorUserId body field removed (backend-cleanup audit — user request: "website frontend me
  // nahi hai but backend bna hua hai to backend se hata do"): this only ever mattered for an
  // admin-initiated request (see clinics.service.js#resolveTargetDoctorId) — no web/mobile screen
  // ever calls this endpoint as admin or sends this field; a doctor caller always uses their own
  // id regardless.
  body('weekday').isInt({ min: 0, max: 6 }).withMessage('weekday must be between 0 (Sunday) and 6 (Saturday).').toInt(),
  body('startTime').matches(TIME_RE).withMessage('startTime must be in HH:MM 24-hour format.'),
  body('endTime').matches(TIME_RE).withMessage('endTime must be in HH:MM 24-hour format.'),
  body('slotMinutes').optional({ values: 'falsy' }).isInt({ min: 5, max: 120 }).toInt(),
  // status removed (mobile parity audit round 2 — user request: "backend hai but website me
  // nahi hai to hata do app se backend v oo hata do"): web only ever DISPLAYS this field
  // (StaffPages.jsx's read-only StatusPill), it never has a form control to set it, and the
  // app's own weekly-hours form was the only place that could set it. Hours now always save as
  // 'active' — see clinics.service.js#upsertHours.
];

const listHours = [
  param('clinicId').isUUID(),
  query('doctorId').optional({ values: 'falsy' }).isUUID(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const deleteHours = [param('clinicId').isUUID(), param('hoursId').isUUID()];

// ── doctor_clinic_closures ──────────────────────────────────────────────

// doctorUserId body field removed (backend-cleanup audit) — same reasoning as putHours above.
const createClosure = [
  param('clinicId').isUUID(),
  body('closedDate').isISO8601().withMessage('closedDate must be a valid date (YYYY-MM-DD).').toDate(),
  body('reason').optional({ values: 'falsy' }).trim().isLength({ max: 500 }),
];

// from/to date-range filter removed (backend-cleanup audit — user request: "website frontend me
// nahi hai but backend bna hua hai to backend se hata do"): no web/mobile closures list screen
// ever sends a date range — every one just lists all of a doctor's/clinic's closures.
const listClosures = [
  param('clinicId').isUUID(),
  query('doctorId').optional({ values: 'falsy' }).isUUID(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const deleteClosure = [param('clinicId').isUUID(), param('closureId').isUUID()];

module.exports = {
  createClinic,
  listClinics,
  getClinic,
  patchClinic,
  approveClinic,
  rejectClinic,
  assignDoctor,
  updateDoctorAssignment,
  removeDoctorAssignment,
  putHours,
  listHours,
  deleteHours,
  createClosure,
  listClosures,
  deleteClosure,
};
