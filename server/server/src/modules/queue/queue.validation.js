/**
 * express-validator chains for every queue endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums, numeric
 * ranges). Business-rule validation (ownership, strictly-sequential status transitions) belongs
 * in queue.service.js.
 *
 * NEW FILE — not part of this phase's originally listed skeleton set (flagged in the phase
 * summary). Every other routed module (auth, me, geography, doctors, clinics, familyMembers,
 * receptionists) has its own *.validation.js per rule 4 in the phase brief, so queue.routes.js
 * should not inline body()/param() chains. Purely additive — no conflict with anything existing.
 */
const { body, param, query } = require('express-validator');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// status query filter removed (backend-cleanup audit — user request: "website frontend me nahi
// hai but backend bna hua hai to backend se hata do"): neither web nor mobile ever sent it — both
// always fetch the day's full queue.
const listQueue = [
  query('date').optional({ values: 'falsy' }).matches(DATE_RE).withMessage('date must be in YYYY-MM-DD format.'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const updateStatus = [
  param('id').isUUID().withMessage('id must be a valid id.'),
  // 'waiting' is deliberately excluded — it's the create-time default only, never a valid
  // client-requested target status.
  body('status')
    .notEmpty()
    .withMessage('status is required.')
    .isIn(['called', 'in_consultation', 'completed'])
    .withMessage('status must be one of: called, in_consultation, completed.'),
];

const getMyQueueStatus = [param('appointmentId').isUUID().withMessage('appointmentId must be a valid id.')];

module.exports = { listQueue, updateStatus, getMyQueueStatus };
