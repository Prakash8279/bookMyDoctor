import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/admin_period.dart';
import 'package:connect_mobile/core/india_time.dart';
import 'package:connect_mobile/screens/receptionist/receptionist_payments_screen.dart';
import 'package:connect_mobile/screens/receptionist/receptionist_reports_screen.dart';
import 'package:connect_mobile/theme/app_theme.dart';
import 'package:connect_mobile/widgets/admin_period_filter.dart';
import 'package:connect_mobile/widgets/common_widgets.dart';
import 'patient_functional_flow_test.dart' show FlowAdapter, mount;

class ReceptionDateAdapter extends FlowAdapter {
  final today = indiaToday();
  late final yesterday = DateTime.parse(today)
      .subtract(const Duration(days: 1))
      .toIso8601String()
      .substring(0, 10);
  late final tomorrow = DateTime.parse(today)
      .add(const Duration(days: 1))
      .toIso8601String()
      .substring(0, 10);
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (options.path == '/payments') {
      requests.add(options);
      return ok([
        for (final entry in [
          ('today', '${today}T00:30:00+05:30', 100, 'paid'),
          ('yesterday', '${yesterday}T23:59:00+05:30', 200, 'paid'),
          ('tomorrow', '${tomorrow}T00:00:00+05:30', 400, 'paid'),
          ('refunded', '${today}T12:00:00+05:30', 800, 'refunded'),
          ('undated', null, 1600, 'paid'),
        ])
          {
            'id': entry.$1,
            'receiptNumber': entry.$1,
            'patient': {'id': entry.$1, 'name': entry.$1},
            'createdAt': entry.$2,
            'mode': 'cash',
            'status': entry.$4,
            'appointment': {'id': 'old-visit'},
            'fees': {'consultationFee': entry.$3}
          },
      ]);
    }
    if (options.path == '/appointments') {
      requests.add(options);
      return ok([
        {
          ...appointment,
          'id': 'today',
          'source': 'walk_in',
          'checkedInAt': '${today}T10:00:00+05:30'
        },
        {
          ...appointment,
          'id': 'old-visit',
          'source': 'walk_in',
          'appointmentDate': yesterday,
          'checkedInAt': '${yesterday}T10:00:00+05:30',
          'fees': {'consultationFee': 999}
        },
        {
          ...appointment,
          'id': 'arrived-today',
          'source': 'online',
          'appointmentDate': yesterday,
          'checkedInAt': '${today}T00:01:00+05:30'
        },
      ]);
    }
    return super.fetch(options, requestStream, cancelFuture);
  }
}

void period(WidgetTester tester, AdminPeriod value) => tester
    .widget<AdminPeriodFilter>(find.byType(AdminPeriodFilter))
    .onChanged(value);

Finder stat(String label, String value) => find.descendant(
    of: find.ancestor(of: find.text(label), matching: find.byType(StatCard)),
    matching: find.text(value));

void main() {
  testWidgets(
      'payments default today; range, all, invalid range, and Today update list and totals',
      (tester) async {
    final adapter = ReceptionDateAdapter();
    await mount(tester, const ReceptionistPaymentsScreen(), adapter);
    expect(stat('CASH COLLECTED AT CLINIC', '₹100'), findsOneWidget);
    expect(find.text('today'), findsOneWidget);
    expect(find.text('yesterday'), findsNothing);
    expect(find.text('undated'), findsNothing);
    period(tester, AdminPeriod(adapter.yesterday, adapter.today));
    await tester.pumpAndSettle();
    expect(stat('CASH COLLECTED AT CLINIC', '₹300'), findsOneWidget);
    await tester.tap(find.text('All dates'));
    await tester.pumpAndSettle();
    expect(stat('CASH COLLECTED AT CLINIC', '₹2300'), findsOneWidget);
    period(tester, AdminPeriod(adapter.tomorrow, adapter.today));
    await tester.pumpAndSettle();
    expect(
        find.text('Start date must be on or before end date.'), findsOneWidget);
    expect(find.byType(StatCard), findsNothing);
    await tester.tap(find.text('Today'));
    await tester.pumpAndSettle();
    expect(stat('CASH COLLECTED AT CLINIC', '₹100'), findsOneWidget);
    // Filtering does not send unsupported date parameters to the payments endpoint.
    expect(adapter.requests.where((r) => r.path == '/payments').length, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'reports filter collections by payment date, visits by visit date, arrivals by actual arrival',
      (tester) async {
    final adapter = ReceptionDateAdapter();
    await mount(tester, const ReceptionistReportsScreen(), adapter);
    expect(stat('Cash collected', '₹100'), findsOneWidget);
    expect(stat('Walk-ins', '1'), findsOneWidget);
    expect(stat('Check-ins', '2'), findsOneWidget);
    period(tester, AdminPeriod(adapter.yesterday, adapter.today));
    await tester.pumpAndSettle();
    expect(stat('Cash collected', '₹300'), findsOneWidget);
    expect(stat('Walk-ins', '2'), findsOneWidget);
    expect(stat('Check-ins', '3'), findsOneWidget);
    period(tester, const AdminPeriod.all());
    await tester.pumpAndSettle();
    expect(stat('Cash collected', '₹2300'), findsOneWidget);
    period(tester, AdminPeriod(adapter.tomorrow, adapter.today));
    await tester.pumpAndSettle();
    expect(
        find.text('Start date must be on or before end date.'), findsOneWidget);
    expect(find.byType(StatCard), findsNothing);
    await tester.tap(find.text('Today'));
    await tester.pumpAndSettle();
    expect(stat('Cash collected', '₹100'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'payment filter stays available for an empty date and opens a real date picker',
      (tester) async {
    final adapter = ReceptionDateAdapter();
    await mount(tester, const ReceptionistPaymentsScreen(), adapter);
    period(tester, const AdminPeriod('2000-01-01', '2000-01-01'));
    await tester.pumpAndSettle();
    expect(find.text('No payments in selected dates'), findsOneWidget);
    await tester.tap(find.text('From: 2000-01-01'));
    await tester.pumpAndSettle();
    expect(find.byType(DatePickerDialog), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All dates'));
    await tester.pumpAndSettle();
    expect(stat('CASH COLLECTED AT CLINIC', '₹2300'), findsOneWidget);
  });

  for (final dark in [false, true]) {
    testWidgets('reception date filters fit 320px large text dark=$dark',
        (tester) async {
      tester.view.physicalSize = const Size(320, 780);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final screen in [
        const ReceptionistPaymentsScreen(),
        const ReceptionistReportsScreen()
      ]) {
        await tester.pumpWidget(const SizedBox());
        await mount(
            tester,
            Theme(
                data: dark ? AppTheme.dark : AppTheme.light,
                child: MediaQuery(
                    data: const MediaQueryData(
                        size: Size(320, 780),
                        textScaler: TextScaler.linear(1.4)),
                    child: screen)),
            ReceptionDateAdapter());
        expect(find.text('Today'), findsOneWidget);
        for (var i = 0; i < 5; i++) {
          expect(tester.takeException(), isNull);
          final list = find.byType(ListView);
          if (list.evaluate().isNotEmpty) {
            await tester.drag(list.first, const Offset(0, -350));
            await tester.pumpAndSettle();
          }
        }
        expect(tester.takeException(), isNull);
      }
    });
  }
}
