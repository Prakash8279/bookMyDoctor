const { assertPlatformBookingHours } = require('../../src/utils/platformBookingHours');
const { validationResult } = require('express-validator');
const { updateBookingRules } = require('../../src/modules/admin/admin.validation');

const rules = { onlineBookingWindowStart: '07:00', onlineBookingWindowEnd: '12:00',
  advanceBookingWindowStart: '15:00', advanceBookingWindowEnd: '21:00' };
test.each([
  ['2026-10-20', '06:59', false], ['2026-10-20', '07:00', true],
  ['2026-10-20', '11:59', true], ['2026-10-20', '12:00', false],
  ['2026-10-20', '16:00', false], ['2026-10-21', '12:00', false],
  ['2026-10-21', '15:00', true], ['2026-10-21', '20:59', true],
  ['2026-10-21', '21:00', false], ['2026-11-01', '07:00', false],
])('%s at %s allowed=%s', (date, time, allowed) => {
  const run = () => assertPlatformBookingHours(rules, date, '2026-10-20', time);
  if (allowed) expect(run).not.toThrow();
  else expect(run).toThrow(expect.objectContaining({ code: 'ONLINE_BOOKING_WINDOW_CLOSED' }));
});
test('no configured hours means full time, independently for each category', () => {
  expect(() => assertPlatformBookingHours(null, '2026-10-20', '2026-10-20', '00:00')).not.toThrow();
  expect(() => assertPlatformBookingHours({ ...rules, advanceBookingWindowStart: null, advanceBookingWindowEnd: null }, '2026-10-21', '2026-10-20', '00:00')).not.toThrow();
  expect(() => assertPlatformBookingHours({ ...rules, onlineBookingWindowStart: null, onlineBookingWindowEnd: null }, '2026-10-20', '2026-10-20', '23:59')).not.toThrow();
});
test.each([
  ['09:00', '20:00', true], [null, null, true], ['09:00', null, false],
  [null, '20:00', false], ['20:00', '09:00', false], ['09:00', '09:00', false],
  ['25:00', '26:00', false], ['9:00', '20:00', false],
])('validates advance hours %s-%s valid=%s', async (start, end, valid) => {
  const req = { body: { cancellationWindowHours: 2, maxBookingsPerPatient: 5, defaultSlotMinutes: 15,
    advanceBookingWindowStart: start, advanceBookingWindowEnd: end } };
  for (const chain of updateBookingRules) await chain.run(req);
  expect(validationResult(req).isEmpty()).toBe(valid);
});
