import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:connect_mobile/models/clinical_models.dart';
import 'package:connect_mobile/screens/patient/payment_required_screen.dart';
import 'package:connect_mobile/widgets/common_widgets.dart';

/// PaymentRequiredScreen's `initState` constructs a real `Razorpay()` (razorpay_flutter), and its
/// `dispose()` calls `_razorpay.clear()` on it — that invokes the plugin's own
/// `razorpay_flutter` MethodChannel with no native implementation registered in a widget test.
/// With no handler stubbed here, flutter_test tears this screen down between tests (disposing
/// State objects to catch leaked timers/subscriptions) and that `clear()` call throws an
/// unhandled MissingPluginException — fire-and-forget, so it isn't caught by anything in
/// PaymentRequiredScreen itself, and typically surfaces as a failure on whichever test happens to
/// run next rather than the one that actually triggered it. Stub the channel so `open()`/`clear()`
/// resolve harmlessly, exactly like a real Razorpay Checkout SDK would from the plugin's own
/// point of view (this repo doesn't actually open the native Checkout UI in these tests either —
/// `_payNow`'s own `POST /payments/razorpay/order` call fails first, before `_razorpay.open` is
/// ever reached, since no backend is reachable in this environment).
const MethodChannel _razorpayChannel = MethodChannel('razorpay_flutter');

Appointment _appointment({required String status, String? tokenNumber, double totalAmount = 500}) {
  return Appointment(
    id: 'appt-1',
    doctor: DoctorRef(id: 'doc-1', name: 'Dr. Asha Rao'),
    appointmentDate: '2026-09-25',
    appointmentTime: '10:00',
    isEmergency: false,
    status: status,
    source: 'online',
    tokenNumber: tokenNumber,
    fees: Fees(totalAmount: totalAmount),
  );
}

void main() {
  group('PaymentRequiredScreen', () {
    setUp(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        _razorpayChannel,
        (MethodCall methodCall) async => null,
      );
    });

    tearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
        _razorpayChannel,
        null,
      );
    });

    testWidgets('shows the payment-required card and Pay button for a pending_payment appointment', (tester) async {
      final appointment = _appointment(status: 'pending_payment');

      await tester.pumpWidget(MaterialApp(home: PaymentRequiredScreen(appointment: appointment)));
      await tester.pump();

      expect(find.text('Payment required'), findsOneWidget);
      expect(find.textContaining('Dr. Asha Rao'), findsOneWidget);
      expect(find.widgetWithText(ElevatedButton, 'Pay ₹500 now'), findsOneWidget);
      expect(find.text('Booking confirmed'), findsNothing);
    });

    testWidgets('shows the confirmed state with the token number once the appointment is already paid', (tester) async {
      final appointment = _appointment(status: 'confirmed', tokenNumber: 'A12');

      await tester.pumpWidget(MaterialApp(home: PaymentRequiredScreen(appointment: appointment)));
      await tester.pump();

      expect(find.text('Booking confirmed'), findsOneWidget);
      expect(find.textContaining('A12'), findsOneWidget);
      expect(find.widgetWithText(ElevatedButton, 'Done'), findsOneWidget);
      expect(find.text('Payment required'), findsNothing);
    });

    testWidgets('tapping Pay shows a loading state, then an error banner once the network call fails', (tester) async {
      final appointment = _appointment(status: 'pending_payment');

      await tester.pumpWidget(MaterialApp(home: PaymentRequiredScreen(appointment: appointment)));
      await tester.pump();

      final payButton = find.widgetWithText(ElevatedButton, 'Pay ₹500 now');
      await tester.tap(payButton);
      await tester.pump();

      // `_payingNow` flips to true synchronously (before the POST /payments/razorpay/order call
      // even starts), so PrimaryButton's own loading spinner shows immediately.
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // No backend is reachable in this environment, so the order request fails fast with a
      // connection error inside `_payNow`'s catch block — well before the real Razorpay Checkout
      // SDK (whose platform channel isn't available in a widget test anyway) would ever open.
      // See book_appointment_screen_test.dart's doc comment for why `runAsync` is needed here.
      await tester.runAsync(() => Future.delayed(const Duration(seconds: 2)));
      await tester.pump();

      expect(find.byType(ErrorBanner), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  });
}
