/**
 * Shared date-only helpers, extracted from appointments.service.js/queue.service.js
 * (`formatDateOnly`) and appointments.service.js/queue.service.js/admin.service.js
 * (`todayUTCDateOnly`), which each independently defined byte-identical copies —
 * found during the duplication audit (2026-09-05). Calendar-day and wall-clock decisions use
 * the configured business time zone; database DATE values remain represented as UTC midnight.
 */
const env = require('../config/env');

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
function zonedParts(date = new Date(), timeZone = env.businessTimeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function businessDateOnly(date = new Date(), timeZone = env.businessTimeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function currentBusinessTimeHHMM(date = new Date(), timeZone = env.businessTimeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

function todayBusinessDateOnly(date = new Date(), timeZone = env.businessTimeZone) {
  return new Date(`${businessDateOnly(date, timeZone)}T00:00:00.000Z`);
}

// Kept as a compatibility alias for existing callers. The returned Date is still UTC midnight,
// but the calendar date is now derived from the configured business time zone.
const todayUTCDateOnly = todayBusinessDateOnly;

function timeZoneOffsetMs(instant, timeZone) {
  const parts = zonedParts(instant, timeZone);
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return representedAsUtc - instant.getTime();
}

function businessDateTimeToUtc(dateStr, timeStr, timeZone = env.businessTimeZone) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const [hour, minute] = String(timeStr).split(':').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let result = new Date(wallClockAsUtc - timeZoneOffsetMs(new Date(wallClockAsUtc), timeZone));
  // Re-evaluate once at the candidate instant so DST-offset transitions are handled correctly.
  result = new Date(wallClockAsUtc - timeZoneOffsetMs(result, timeZone));
  return result;
}

module.exports = {
  formatDateOnly,
  businessDateOnly,
  currentBusinessTimeHHMM,
  todayBusinessDateOnly,
  todayUTCDateOnly,
  businessDateTimeToUtc,
};
