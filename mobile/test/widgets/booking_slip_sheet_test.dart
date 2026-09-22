import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:connect_mobile/models/clinical_models.dart';
import 'package:connect_mobile/models/core_models.dart';
import 'package:connect_mobile/widgets/booking_slip_sheet.dart';

void main() {
  testWidgets('BookingSlipSheet renders complete booking slip with token, doctor, and patient details', (tester) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final appt = Appointment(
      id: 'appt_123456789',
      appointmentDate: '2026-09-25',
      appointmentTime: '10:30 AM',
      tokenNumber: '14',
      status: 'confirmed',
      source: 'online',
      isEmergency: false,
      paymentStatus: 'paid',
      doctor: DoctorRef(
        id: 'doc_1',
        name: 'Sharma',
        specialization: Specialization(id: 'sp_1', name: 'Cardiology'),
      ),
      clinic: NamedRef(id: 'cl_1', name: 'City Heart Clinic', address: '123 MG Road', phone: '9876543210'),
      patient: PatientRef(id: 'pat_1', name: 'Amit Kumar', phone: '9123456780'),
      fees: Fees(totalAmount: 600, consultationFee: 500),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BookingSlipSheet(appointment: appt),
        ),
      ),
    );

    expect(find.text('BookMyDoctors'), findsOneWidget);
    expect(find.textContaining('CLINIC BOOKING SLIP'), findsOneWidget);
    expect(find.text('#14'), findsOneWidget);
    expect(find.text('Dr. Sharma'), findsOneWidget);
    expect(find.text('Cardiology'), findsOneWidget);
    expect(find.text('City Heart Clinic'), findsOneWidget);
    expect(find.text('Amit Kumar'), findsOneWidget);
    expect(find.text('₹600'), findsWidgets);
    expect(find.text('Paid in Full'), findsOneWidget);
    // TEST FIX (production-readiness pass, Sept 2026 — CI caught this): the "Copy Slip"
    // button was renamed to just "Copy" (and a new "Download" share-sheet button added
    // alongside it) when the download/share feature was built; this assertion was never
    // updated to match.
    expect(find.text('Copy'), findsOneWidget);
    expect(find.text('Download'), findsOneWidget);
    expect(find.text('Done'), findsOneWidget);
  });

  testWidgets('PaymentReceiptSheet renders payment details and copy receipt action', (tester) async {
    // Same tall test viewport as the BookingSlipSheet test above: the sheet's own ListView
    // lazily builds only what's near its viewport, so the default (short) test window can leave
    // widgets near the bottom (the action buttons) never built, and find.text() would then fail
    // not because the UI is wrong but because that widget never entered the tree at all.
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final payment = PaymentItem(
      id: 'pay_987654321',
      receiptNumber: 'REC-0012',
      mode: 'cash',
      status: 'paid',
      createdAt: '2026-09-25T11:00:00Z',
      patient: NamedRef(id: 'pat_1', name: 'Sunita Devi'),
      doctor: NamedRef(id: 'doc_1', name: 'Verma'),
      clinic: NamedRef(id: 'cl_1', name: 'Metro Clinic'),
      fees: Fees(amount: 450, consultationFee: 450),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PaymentReceiptSheet(payment: payment),
        ),
      ),
    );

    expect(find.text('BookMyDoctors'), findsOneWidget);
    expect(find.textContaining('REC-0012'), findsWidgets);
    expect(find.text('₹450'), findsOneWidget);
    expect(find.text('CASH'), findsWidgets);
    expect(find.text('Sunita Devi'), findsOneWidget);
    expect(find.text('Dr. Verma'), findsOneWidget);
    expect(find.text('Metro Clinic'), findsOneWidget);
    // TEST FIX (same rename as BookingSlipSheet above): "Copy Receipt" -> "Copy", plus a
    // new "Download" share-sheet button.
    expect(find.text('Copy'), findsOneWidget);
    expect(find.text('Download'), findsOneWidget);
    expect(find.text('Done'), findsOneWidget);
  });
}
