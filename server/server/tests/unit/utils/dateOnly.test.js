const {
  businessDateOnly,
  currentBusinessTimeHHMM,
  todayBusinessDateOnly,
  businessDateTimeToUtc,
} = require('../../../src/utils/dateOnly');

describe('dateOnly business-time-zone helpers', () => {
  const INDIA = 'Asia/Kolkata';

  test('uses the business calendar day rather than the server UTC day', () => {
    const instant = new Date('2026-10-10T20:00:00.000Z');

    expect(businessDateOnly(instant, INDIA)).toBe('2026-10-11');
    expect(currentBusinessTimeHHMM(instant, INDIA)).toBe('01:30');
    expect(todayBusinessDateOnly(instant, INDIA).toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });

  test('converts a business-local appointment time to the real UTC instant', () => {
    expect(businessDateTimeToUtc('2026-10-11', '09:30', INDIA).toISOString()).toBe('2026-10-11T04:00:00.000Z');
  });
});
