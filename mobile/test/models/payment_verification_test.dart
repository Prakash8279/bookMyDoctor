import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/payment_verification.dart';
import 'package:connect_mobile/models/clinical_models.dart';

Appointment booking(
        {String status = 'pending_payment',
        String? paymentStatus = 'pending',
        String? token}) =>
    Appointment(
      id: 'test-booking',
      appointmentDate: '2026-10-22',
      appointmentTime: '10:00',
      isEmergency: false,
      status: status,
      source: 'online',
      tokenNumber: token,
      paymentStatus: paymentStatus,
      fees: Fees(totalAmount: 500),
    );

void main() {
  test('a token or an upcoming status alone is not payment confirmation', () {
    expect(
        isConfirmedPayment(booking(status: 'upcoming', token: '1')), isFalse);
    expect(isConfirmedPayment(booking(paymentStatus: 'paid')), isFalse);
    expect(
        isConfirmedPayment(
            booking(status: 'confirmed', paymentStatus: 'paid', token: '1')),
        isTrue);
    expect(
        isConfirmedPayment(
            booking(status: 'cancelled', paymentStatus: 'paid', token: '1')),
        isFalse);
  });

  testWidgets(
      'independent status polling confirms when signed verification hangs',
      (tester) async {
    final signed = Completer<Appointment>();
    final confirmed = <Appointment>[];
    final controller = PaymentVerificationController(
      verify: () => signed.future,
      fetch: () async =>
          booking(status: 'confirmed', paymentStatus: 'paid', token: '1'),
      onConfirmed: confirmed.add,
    );
    controller.start();
    await tester.pump();
    expect(controller.phase, 'confirmed');
    expect(confirmed.single.tokenNumber, '1');
    controller.dispose();
    signed.complete(booking());
    await tester.pump();
  });

  testWidgets(
      'one-minute timeout is pending, not failed, and retry reuses the same operation',
      (tester) async {
    var now = DateTime.utc(2026, 10, 22);
    var verifies = 0;
    final controller = PaymentVerificationController(
      now: () => now,
      verify: () async {
        verifies++;
        return booking();
      },
      fetch: () async => booking(),
      onConfirmed: (_) => fail('An unpaid booking must not confirm'),
    );
    controller.start();
    await tester.pump();
    expect(controller.secondsLeft, 60);
    now = now.add(const Duration(seconds: 61));
    await tester.pump(const Duration(seconds: 1));
    expect(controller.phase, 'pending');
    expect(controller.secondsLeft, 0);
    controller.start();
    await tester.pump();
    expect(verifies, 2);
    expect(controller.phase, 'verifying');
    controller.dispose();
  });

  testWidgets('cancelled booking never produces a confirmed token',
      (tester) async {
    final controller = PaymentVerificationController(
      verify: () async => booking(status: 'cancelled'),
      fetch: () async => booking(),
      onConfirmed: (_) => fail('Cancelled booking must not confirm'),
    );
    controller.start();
    await tester.pump();
    expect(controller.phase, 'cancelled');
    controller.dispose();
  });

  testWidgets('late verification cannot update a disposed screen',
      (tester) async {
    final pending = Completer<Appointment>();
    final controller = PaymentVerificationController(
      verify: () => pending.future,
      fetch: () async => booking(),
      onConfirmed: (_) => fail('Disposed verification must not confirm'),
    );
    controller.start();
    controller.dispose();
    pending.complete(
        booking(status: 'confirmed', paymentStatus: 'paid', token: '1'));
    await tester.pump();
  });
}
