/**
 * Unit tests for utils/minBookingAmount.js#resolvePaymentRowFeeSplit — the EXACT-BREAKDOWN FIX
 * (user request: "receptionest and doctor admin ye sab me ye payment thik kro payment system
 * sahi ho"). Pure number math, no Prisma/DB involved — see the function's own header comment for
 * the full rationale (double-counted doctor revenue for staff, fictional ratio-scaled commission
 * for admin) and payments.service.test.js for the same fix exercised end-to-end through
 * shapePaymentFees.
 *
 * Worked example used throughout: consultationFee 400, convenienceFee 25, emergencyFee 0,
 * doctor's minimum booking advance 100 -> implied GST rate 3% (gstAmount 12.75 on the full
 * payment's 425 subtotal) -> minBookingAmount 128 (100 + 25 + 3% of 100), minBookingRemainder
 * 300 (400 - 100). The three real payment-row shapes for this appointment are: full (amount
 * 437.75), online minimum advance (amount 128), and clinic-collected remainder (amount 300).
 */
const { resolvePaymentRowFeeSplit } = require('../../../src/utils/minBookingAmount');

const WORKED_EXAMPLE = { consultationFee: 400, convenienceFee: 25, emergencyFee: 0, gstAmount: 12.75, minBookingAdvanceAmount: 100 };

describe('resolvePaymentRowFeeSplit', () => {
  test('online minimum-advance row (amount 128): consultationFee is the doctor\'s EXACT minimum (100), convenienceFee is the FULL platform charge (25, never prorated), gstAmount is the exact 3 left over', () => {
    const split = resolvePaymentRowFeeSplit({ ...WORKED_EXAMPLE, amount: 128 });
    expect(split).toEqual({ consultationFee: 100, convenienceFee: 25, emergencyFee: 0, gstAmount: 3 });
    expect(split.consultationFee + split.convenienceFee + split.emergencyFee + split.gstAmount).toBeCloseTo(128, 2);
  });

  test('clinic-collected remainder row (amount 300): entirely consultationFee — no platform charge or GST (already settled online)', () => {
    const split = resolvePaymentRowFeeSplit({ ...WORKED_EXAMPLE, amount: 300 });
    expect(split).toEqual({ consultationFee: 300, convenienceFee: 0, emergencyFee: 0, gstAmount: 0 });
  });

  test('full payment (amount 437.75): the appointment\'s normal breakdown, unchanged (ratio is exactly 1)', () => {
    const split = resolvePaymentRowFeeSplit({ ...WORKED_EXAMPLE, amount: 437.75 });
    expect(split).toEqual({ consultationFee: 400, convenienceFee: 25, emergencyFee: 0, gstAmount: 12.75 });
  });

  test('summing the minimum-advance row and the remainder row reconstructs the doctor\'s true fee exactly once (100 + 300 = 400), never double-counted (100 + 400 or 400 + 400)', () => {
    const advance = resolvePaymentRowFeeSplit({ ...WORKED_EXAMPLE, amount: 128 });
    const remainder = resolvePaymentRowFeeSplit({ ...WORKED_EXAMPLE, amount: 300 });
    expect(advance.consultationFee + remainder.consultationFee).toBe(400);
  });

  test('no minimum booking option configured (minBookingAdvanceAmount null): falls back to proportional scaling for a partial amount', () => {
    // consultationFee 500, convenienceFee 20, gstAmount 70 -> implied total 590; this row only
    // collected 200 of it (ratio 200/590).
    const split = resolvePaymentRowFeeSplit({
      consultationFee: 500,
      convenienceFee: 20,
      emergencyFee: 0,
      gstAmount: 70,
      minBookingAdvanceAmount: null,
      amount: 200,
    });
    expect(split.consultationFee).toBeCloseTo(169.49, 1);
    expect(split.convenienceFee).toBeCloseTo(6.78, 1);
    expect(split.gstAmount).toBeCloseTo(23.73, 1);
    expect(split.consultationFee + split.convenienceFee + split.emergencyFee + split.gstAmount).toBeCloseTo(200, 1);
  });

  test('an amount that matches neither the minimum-advance nor the remainder figure falls back to proportional scaling even when a minimum IS configured (older/unrecognized row shape)', () => {
    const split = resolvePaymentRowFeeSplit({ ...WORKED_EXAMPLE, amount: 200 });
    // impliedTotal 437.75, ratio 200/437.75 ≈ 0.4569 — same proportional math as the no-minimum
    // case above, not the exact minimum-advance/remainder figures (128/100 or 300).
    expect(split.consultationFee).toBeCloseTo(182.74, 1);
    expect(split.consultationFee).not.toBe(100);
    expect(split.consultationFee).not.toBe(300);
  });

  test('zero implied total (all fee fields zero) never divides by zero', () => {
    const split = resolvePaymentRowFeeSplit({ consultationFee: 0, convenienceFee: 0, emergencyFee: 0, gstAmount: 0, minBookingAdvanceAmount: null, amount: 0 });
    expect(split).toEqual({ consultationFee: 0, convenienceFee: 0, emergencyFee: 0, gstAmount: 0 });
  });
});
