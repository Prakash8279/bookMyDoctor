const { isClinicPaymentComplete, clinicPaymentWhere } = require('../../../src/utils/clinicPaymentGate');

describe('clinic payment admission', () => {
  test.each(['pending','partial','refunded'])('does not admit %s paid appointments with a balance', paymentStatus => {
    expect(isClinicPaymentComplete({paymentStatus,totalAmount:500})).toBe(false);
  });
  test('admits fully settled and genuinely free appointments only', () => {
    expect(isClinicPaymentComplete({paymentStatus:'paid',totalAmount:500})).toBe(true);
    expect(isClinicPaymentComplete({paymentStatus:'pending',totalAmount:0})).toBe(true);
    expect(isClinicPaymentComplete({paymentStatus:'refunded',totalAmount:0})).toBe(false);
    expect(isClinicPaymentComplete({paymentStatus:'pending'})).toBe(false);
    expect(isClinicPaymentComplete(null)).toBe(false);
  });
  test('the database filter admits paid or zero-total visits, never refunds', () => {
    expect(clinicPaymentWhere()).toEqual({paymentStatus:{not:'refunded'},OR:[{paymentStatus:'paid'},{totalAmount:{lte:0}}]});
  });
});
