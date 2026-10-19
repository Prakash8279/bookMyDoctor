const ApiError = require('./ApiError');

// Compare business-local calendar dates, never the server machine's timezone.
function assertPlatformBookingHours(rules, date, today, nowHHMM) {
  if (!rules) return;
  const sameDay = date === today;
  const start = sameDay ? rules.onlineBookingWindowStart : rules.advanceBookingWindowStart;
  const end = sameDay ? rules.onlineBookingWindowEnd : rules.advanceBookingWindowEnd;
  if (start && end && (nowHHMM < start || nowHHMM >= end)) {
    throw new ApiError(403, 'ONLINE_BOOKING_WINDOW_CLOSED',
      `${sameDay ? 'Today' : 'Advance'} booking is available from ${start} to ${end} IST for all doctors. Please try again during these hours.`);
  }
}

module.exports = { assertPlatformBookingHours };
