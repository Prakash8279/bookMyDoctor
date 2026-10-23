import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/payment_visibility.dart';
import 'package:connect_mobile/models/clinical_models.dart';

void main() {
  PaymentItem payment(String status, double amount, {double? doctorFee}) =>
      PaymentItem(
        id: 'receipt',
        mode: 'online',
        status: status,
        fees: Fees(amount: amount, consultationFee: doctorFee),
      );
  test('revenue only includes paid positive amounts', () {
    expect(isRevenuePayment(payment('paid', 500)), isTrue);
    for (final status in ['refunded', 'failed', 'pending']) {
      expect(isRevenuePayment(payment(status, 500)), isFalse);
    }
    expect(isRevenuePayment(payment('paid', 0)), isFalse);
    expect(isRevenuePayment(payment('paid', -1)), isFalse);
    expect(isRevenuePayment(payment('paid', double.nan)), isFalse);
  });
  test('doctor revenue never substitutes a platform amount for a missing fee',
      () {
    expect(isRevenuePayment(payment('paid', 500), doctorOnly: true), isFalse);
    expect(
        isRevenuePayment(payment('paid', 500, doctorFee: 0), doctorOnly: true),
        isFalse);
    expect(
        isRevenuePayment(payment('paid', 500, doctorFee: 450),
            doctorOnly: true),
        isTrue);
  });
}
