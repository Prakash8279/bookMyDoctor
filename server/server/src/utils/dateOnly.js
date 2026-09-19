/**
 * Shared date-only helpers, extracted from appointments.service.js/queue.service.js
 * (`formatDateOnly`) and appointments.service.js/queue.service.js/admin.service.js
 * (`todayUTCDateOnly`), which each independently defined byte-identical copies —
 * found during the duplication audit (2026-09-05). Pure functions, no dependencies.
 */

/**
 * Formats a Date (or date-like value) as a UTC "YYYY-MM-DD" string, or null if given a falsy
 * value.
 * @param {Date|string|null|undefined} d
 * @returns {string|null}
 */
function formatDateOnly(d) {
  if (!d) return null;
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Returns today's date at 00:00:00.000 UTC, as a Date object — the canonical "day boundary" used
 * for date-only comparisons (e.g. "is this booking today").
 * @returns {Date}
 */
function todayUTCDateOnly() {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

module.exports = { formatDateOnly, todayUTCDateOnly };
