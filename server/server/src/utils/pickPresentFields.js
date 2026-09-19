/**
 * Shared helper: picks only the properties present on `body` (via hasOwnProperty — this
 * intentionally matches express-validator's `optional()` semantics, under which a field
 * explicitly sent as JSON `null` still counts as "present", not "absent") out of
 * `allowedFields`.
 *
 * Any field named in `nonNullableFields` that is present but explicitly `null` throws a clean
 * 422 VALIDATION_ERROR instead of being forwarded into `data` for a Prisma update. Without this
 * guard, a raw `null` reaching Prisma for a NOT NULL column either throws an unhandled
 * PrismaClientValidationError (caught only by errorHandler.js's generic catch-all -> a bare 500
 * INTERNAL_ERROR) or, for a NOT NULL String column, gets silently coerced by a naive
 * `String(updates.field)` call into the 4-character string "null" and persisted as real data.
 *
 * The corresponding *.validation.js chain is expected to already reject explicit null on these
 * same fields with a clean per-field message (see e.g. doctors.validation.js's patchDoctor) —
 * this is a second, defense-in-depth layer, not the primary guard, so it stays deliberately
 * generic (one shared message) rather than duplicating each field's specific wording.
 *
 * @param {object} body
 * @param {string[]} allowedFields
 * @param {string[]} [nonNullableFields] - subset of allowedFields that must never be set to null
 * @returns {object}
 */
const ApiError = require('./ApiError');

function pickPresentFields(body, allowedFields, nonNullableFields = []) {
  const picked = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      if (body[field] === null && nonNullableFields.includes(field)) {
        throw new ApiError(422, 'VALIDATION_ERROR', `${field} cannot be null.`, [
          { field, message: `${field} cannot be null.` },
        ]);
      }
      picked[field] = body[field];
    }
  }
  return picked;
}

module.exports = { pickPresentFields };
