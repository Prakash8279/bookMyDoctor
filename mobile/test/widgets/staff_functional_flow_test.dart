import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:connect_mobile/core/api_client.dart';
import 'package:connect_mobile/core/india_time.dart';
import 'package:connect_mobile/models/core_models.dart';
import 'package:connect_mobile/screens/receptionist/receptionist_checkin_screen.dart';
import 'package:connect_mobile/screens/receptionist/receptionist_payments_screen.dart';
import 'package:connect_mobile/screens/doctor/doctor_clinic_hours_screen.dart';
import 'package:connect_mobile/state/auth_provider.dart';
import 'package:connect_mobile/theme/app_theme.dart';
import 'patient_functional_flow_test.dart' show FlowAdapter, mount;

class StaffAdapter extends FlowAdapter {
  bool arrived = false;
  bool paymentCandidates = false;
  int minutes = 5;
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (options.path == '/appointments') {
      requests.add(options);
      final active = {
        ...appointment,
        'id': 'active',
        'paymentStatus': paymentCandidates ? 'partial' : 'paid',
        'clinicPaymentComplete': !paymentCandidates,
        'checkedInAt':
            arrived ? DateTime.now().toUtc().toIso8601String() : null,
        'fees': {'consultationFee': 500, 'due': paymentCandidates ? 300 : 0}
      };
      return ok([
        active,
        {
          ...active,
          'id': 'cancelled',
          'status': 'cancelled',
          'paymentStatus': 'pending'
        },
        {
          ...active,
          'id': 'refunded',
          'paymentStatus': 'refunded',
          'clinicPaymentComplete': false
        },
        {
          ...active,
          'id': 'tomorrow',
          'appointmentDate': '2099-01-01',
          'paymentStatus': 'paid'
        },
        {
          ...active,
          'id': 'unpaid',
          'paymentStatus': 'pending',
          'clinicPaymentComplete': false,
          'fees': {'due': 0, 'consultationFee': 500}
        },
      ]);
    }
    if (options.path == '/appointments/active/check-in') {
      requests.add(options);
      arrived = true;
      return ok({
        ...appointment,
        'checkedInAt': DateTime.now().toUtc().toIso8601String()
      });
    }
    if (options.path == '/clinics') {
      requests.add(options);
      return ok([
        {'id': 'clinic', 'name': 'Test Clinic', 'approvalStatus': 'approved'}
      ]);
    }
    if (options.path == '/clinics/clinic/hours') {
      requests.add(options);
      if (options.method == 'PUT') return ok({});
      return ok([
        {
          'id': 'hours',
          'doctorUserId': 'doctor',
          'clinicId': 'clinic',
          'weekday': 1,
          'startTime': '10:00',
          'endTime': '18:00',
          'slotMinutes': minutes,
          'status': 'active'
        }
      ]);
    }
    return super.fetch(options, requestStream, cancelFuture);
  }
}

void main() {
  testWidgets(
      'today paid patient can check in; unpaid, cancelled and future arrivals are excluded',
      (tester) async {
    final adapter = StaffAdapter();
    await mount(tester, const ReceptionistCheckinScreen(), adapter);
    expect(find.byKey(const ValueKey('check-in-active')), findsOneWidget);
    for (final id in ['cancelled', 'refunded', 'tomorrow', 'unpaid']) {
      expect(find.byKey(ValueKey('check-in-$id')), findsNothing);
    }
    await tester.tap(find.byKey(const ValueKey('check-in-active')));
    await tester.pumpAndSettle();
    expect(find.text('Checked in'), findsOneWidget);
    expect(
        adapter.requests
            .where((request) =>
                request.path.endsWith('/check-in') && request.method == 'POST')
            .length,
        1);
    expect(
        adapter.requests
            .firstWhere((request) => request.path == '/appointments')
            .queryParameters['date'],
        indiaToday());
  });
  testWidgets(
      'clinic collection includes partial balance and excludes cancelled/refunded/zero-due bookings',
      (tester) async {
    final adapter = StaffAdapter()..paymentCandidates = true;
    await mount(tester, const ReceptionistPaymentsScreen(), adapter);
    await tester.tap(find.text('Record payment'));
    await tester.pumpAndSettle();
    final picker = find.byKey(const ValueKey('unpaid-appointment-picker'));
    await tester.tap(picker);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('payment-appointment-active')),
        findsOneWidget);
    expect(find.textContaining('cancelled'), findsNothing);
    expect(find.textContaining('refunded'), findsNothing);
    final search = find.byType(TextField).first;
    for (final query in ['Test Patient', 'active', '1']) {
      await tester.enterText(search, query);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('payment-appointment-active')),
          findsOneWidget);
    }
    await tester.tap(find.byKey(const ValueKey('payment-appointment-active')));
    await tester.pumpAndSettle();
    final save = find.widgetWithText(ElevatedButton, 'Record payment');
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    final request = adapter.requests.singleWhere(
        (request) => request.path == '/payments' && request.method == 'POST');
    expect(request.data['appointmentId'], 'active');
    expect(request.data['mode'], 'cash');
    expect(tester.takeException(), isNull);
  });
  testWidgets('non-cash collection can be saved without an optional UTR',
      (tester) async {
    final adapter = StaffAdapter()..paymentCandidates = true;
    await mount(tester, const ReceptionistPaymentsScreen(), adapter);
    await tester.tap(find.text('Record payment'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('unpaid-appointment-picker')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('payment-appointment-active')));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('UPI').last);
    await tester.pumpAndSettle();
    final save = find.widgetWithText(ElevatedButton, 'Record payment');
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    final request = adapter.requests.singleWhere(
        (request) => request.path == '/payments' && request.method == 'POST');
    expect(request.data['mode'], 'upi');
    expect(request.data.containsKey('transactionRef'), isFalse);
    expect(tester.takeException(), isNull);
  });
  for (final minutes in [5, 7]) {
    testWidgets(
        'OPD can edit and save an existing $minutes-minute schedule; Refresh refetches API data',
        (tester) async {
      final adapter = StaffAdapter()..minutes = minutes;
      ApiClient.instance.setHttpAdapterForTesting(adapter);
      final auth = AuthProvider()
        ..status = AuthStatus.loggedIn
        ..user = AppUser(
            id: 'doctor',
            name: 'Doctor',
            email: 'doctor@example.test',
            role: 'doctor');
      await tester.pumpWidget(ChangeNotifierProvider.value(
          value: auth,
          child: MaterialApp(
              theme: AppTheme.light, home: const DoctorClinicHoursScreen())));
      await tester.pumpAndSettle();
      final monday = find.widgetWithText(ListTile, 'Monday');
      await tester.ensureVisible(monday);
      await tester.tap(find.descendant(
          of: monday, matching: find.byIcon(Icons.edit_outlined)));
      await tester.pumpAndSettle();
      expect(find.byType(DropdownButtonFormField<int>), findsOneWidget);
      expect(tester.takeException(), isNull);
      final save = find.widgetWithText(ElevatedButton, 'Save');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pumpAndSettle();
      final request =
          adapter.requests.singleWhere((request) => request.method == 'PUT');
      expect(request.data['slotMinutes'], minutes);
      expect(request.data['weekday'], 1);
      final previous = adapter.requests
          .where((request) => request.path == '/clinics')
          .length;
      await tester.ensureVisible(find.text('Refresh'));
      await tester.tap(find.text('Refresh'));
      await tester.pumpAndSettle();
      expect(
          adapter.requests
              .where((request) => request.path == '/clinics')
              .length,
          greaterThan(previous));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      auth.dispose();
    });
  }
}
