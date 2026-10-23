import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:connect_mobile/core/api_client.dart';
import 'package:connect_mobile/core/india_time.dart';
import 'package:connect_mobile/models/core_models.dart';
import 'package:connect_mobile/screens/receptionist/receptionist_walkin_booking_screen.dart';
import 'package:connect_mobile/screens/receptionist/receptionist_reports_screen.dart';
import 'package:connect_mobile/screens/doctor/doctor_clinics_screen.dart';
import 'package:connect_mobile/screens/doctor/doctor_analytics_screen.dart';
import 'package:connect_mobile/screens/patient/reviews_screen.dart';
import 'package:connect_mobile/state/auth_provider.dart';
import 'package:connect_mobile/theme/app_theme.dart';
import 'package:connect_mobile/widgets/common_widgets.dart';
import 'patient_functional_flow_test.dart' show FlowAdapter, mount;

class WorkflowAdapter extends FlowAdapter {
  bool registered = false;
  bool missingVisit = false;
  bool paginated = false;
  bool report = false;
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (options.path == failPath) {
      return super.fetch(options, requestStream, cancelFuture);
    }
    if (report && options.path == '/appointments') {
      requests.add(options);
      return ok([
        {...appointment, 'id': 'walkin', 'source': 'walk_in'},
        {
          ...appointment,
          'id': 'cancelled',
          'source': 'walk_in',
          'status': 'cancelled'
        },
        {...appointment, 'id': 'online', 'source': 'online'},
      ]);
    }
    if (report && options.path == '/payments') {
      requests.add(options);
      return ok([
        for (final status in ['paid', 'refunded', 'pending', 'failed'])
          {
            'id': status,
            'receiptNumber': status,
            'createdAt': DateTime.now().toUtc().toIso8601String(),
            'mode': 'cash',
            'status': status,
            'fees': {'consultationFee': 500}
          },
      ]);
    }
    if (options.path == '/clinics') {
      requests.add(options);
      return ok([
        {'id': 'clinic', 'name': 'Test Clinic'}
      ]);
    }
    if (options.path == '/clinics/clinic') {
      requests.add(options);
      return ok({
        'id': 'clinic',
        'name': 'Test Clinic',
        'doctors': [
          {'doctorUserId': 'doctor', 'name': 'Dr. Test', 'isOwner': true}
        ]
      });
    }
    if (options.path == '/appointments/booking-status/job') {
      requests.add(options);
      return ok({
        'jobId': 'job',
        'status': 'confirmed',
        if (!missingVisit)
          'appointment': {
            ...appointment,
            'paymentStatus': 'pending',
            'clinicPaymentComplete': false,
            'tokenNumber': null
          }
      });
    }
    if (options.path == '/appointments' && options.method == 'POST') {
      registered = true;
    }
    if (options.path == '/appointments' &&
        options.method == 'GET' &&
        !paginated) {
      requests.add(options);
      return ok(registered ? [appointment] : []);
    }
    if (paginated &&
        (options.path == '/appointments' || options.path == '/payments')) {
      requests.add(options);
      final page = options.queryParameters['page'] as int? ?? 1;
      // Explicit two-page response, including a paid/refunded pair on separate pages.
      final response = ok(options.path == '/appointments'
          ? [
              {
                ...appointment,
                'id': 'visit-$page',
                'status': page == 1 ? 'completed' : 'cancelled'
              }
            ]
          : [
              {
                'id': 'payment-$page',
                'status': page == 1 ? 'paid' : 'refunded',
                'reportAmount': 500,
                'createdAt': DateTime.now().toUtc().toIso8601String(),
              }
            ]);
      return ResponseBody.fromString(
          (await response.stream.toList())
              .expand((bytes) => bytes)
              .map(String.fromCharCode)
              .join()
              .replaceFirst('"success":true',
                  '"pagination":{"page":$page,"totalPages":2,"total":2},"success":true'),
          200,
          headers: {
            Headers.contentTypeHeader: ['application/json']
          });
    }
    return super.fetch(options, requestStream, cancelFuture);
  }
}

Future<void> mountWalkIn(WidgetTester tester, WorkflowAdapter adapter) async {
  ApiClient.instance.setHttpAdapterForTesting(adapter);
  final auth = AuthProvider()..profile = MeProfile(clinicId: 'clinic');
  await tester.pumpWidget(ChangeNotifierProvider.value(
      value: auth,
      child: MaterialApp(
          theme: AppTheme.light,
          home: const Scaffold(body: ReceptionistWalkInBookingScreen()))));
  await tester.pumpAndSettle();
}

Future<void> fillWalkIn(WidgetTester tester) async {
  final fields = find.byType(TextField);
  await tester.enterText(fields.at(0), 'New Patient');
  await tester.enterText(fields.at(1), '9000000000');
  final dropdown = find.byType(DropdownButtonFormField<ClinicDoctorLink>);
  await tester.ensureVisible(dropdown);
  await tester.pumpAndSettle();
  await tester.tap(dropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Dr. Test').last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
      'walk-in defaults to today, uses real visit, explains payment gate, refreshes recent bookings',
      (tester) async {
    final adapter = WorkflowAdapter();
    await mountWalkIn(tester, adapter);
    await fillWalkIn(tester);
    final save =
        find.widgetWithText(ElevatedButton, 'Book walk-in appointment');
    await tester.ensureVisible(save);
    await tester.pumpAndSettle();
    await tester.tap(save);
    await tester.pumpAndSettle();
    final post = adapter.requests
        .singleWhere((r) => r.method == 'POST' && r.path == '/appointments');
    expect(post.data['appointmentDate'], indiaToday());
    expect(post.data.containsKey('appointmentTime'), isFalse);
    expect(find.text('Appointment Booked'), findsOneWidget);
    expect(find.textContaining('Collect the full remaining payment'),
        findsOneWidget);
    expect(find.text('Token #—'), findsOneWidget);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(
        adapter.requests
            .where((r) => r.path == '/appointments' && r.method == 'GET')
            .length,
        2);
    await tester.drag(find.byType(ListView).first, const Offset(0, -700));
    await tester.pumpAndSettle();
    expect(find.text('Test Patient'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('missing visit does not fabricate a booking slip or token',
      (tester) async {
    final adapter = WorkflowAdapter()..missingVisit = true;
    await mountWalkIn(tester, adapter);
    await fillWalkIn(tester);
    final save =
        find.widgetWithText(ElevatedButton, 'Book walk-in appointment');
    await tester.ensureVisible(save);
    await tester.pumpAndSettle();
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(find.text('Appointment Booked'), findsNothing);
    expect(find.text('View Slip'), findsNothing);
    await tester.drag(find.byType(ListView).first, const Offset(0, 800));
    await tester.pumpAndSettle();
    expect(find.textContaining('Check Appointments before registering again'),
        findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('analytics loads every page and excludes refunded revenue',
      (tester) async {
    final adapter = WorkflowAdapter()..paginated = true;
    await mount(tester, const DoctorAnalyticsScreen(), adapter);
    expect(find.text('2'), findsAtLeastNWidgets(1));
    expect(find.text('50%'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -500));
    await tester.pumpAndSettle();
    expect(find.text('₹500'), findsOneWidget);
    expect(find.text('Revenue'), findsOneWidget);
    for (final path in ['/appointments', '/payments']) {
      expect(
          adapter.requests
              .where((r) => r.path == path)
              .map((r) => r.queryParameters['page']),
          [1, 2]);
    }
  });

  test('analytics trends use India dates and ignore old or refunded rows', () {
    final now = DateTime.utc(2026, 10, 21, 20); // 22 October in India.
    final analytics = buildDoctorAnalytics([
      {'appointmentDate': '2026-10-22', 'status': 'completed'},
      {'appointmentDate': '2026-10-21', 'status': 'cancelled'},
      {'appointmentDate': '2020-01-01', 'status': 'completed'},
    ], [
      {
        'createdAt': '2026-10-21T19:00:00Z', // 22 October IST.
        'status': 'paid',
        'reportAmount': 600
      },
      {
        'createdAt': '2026-10-21T20:00:00Z',
        'status': 'refunded',
        'reportAmount': 900
      },
      {'createdAt': '2020-01-01T00:00:00Z', 'status': 'paid', 'amount': 500},
    ], now: now);
    expect(analytics['appointments'], 3);
    expect(analytics['completed'], 2);
    expect(analytics['cancelled'], 1);
    expect((analytics['appointmentTrend'] as List).last, 1);
    expect((analytics['revenueTrend'] as List).last, 600);
  });

  testWidgets('clinic detail error is visible and retry recovers clinic',
      (tester) async {
    final adapter = WorkflowAdapter()..failPath = '/clinics/clinic';
    await mount(
        tester,
        ChangeNotifierProvider(
            create: (_) => AuthProvider(), child: const DoctorClinicsScreen()),
        adapter);
    expect(
        find.textContaining('Service temporarily unavailable'), findsOneWidget);
    adapter.failPath = null;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Test Clinic'), findsOneWidget);
  });

  testWidgets('review load failure is not shown as no completed visits',
      (tester) async {
    await mount(tester, const PatientReviewsScreen(),
        WorkflowAdapter()..failPath = '/appointments');
    expect(
        find.textContaining('Service temporarily unavailable'), findsOneWidget);
    expect(find.text('No completed visits yet'), findsNothing);
  });

  testWidgets(
      'reports count actual walk-ins and only paid collections, keeping refund history',
      (tester) async {
    final adapter = WorkflowAdapter()..report = true;
    await mount(tester, const ReceptionistReportsScreen(), adapter);
    expect(find.text('1'), findsOneWidget);
    final cashCard = find.ancestor(
        of: find.text('Cash collected'), matching: find.byType(StatCard));
    expect(find.descendant(of: cashCard, matching: find.text('₹500')),
        findsOneWidget);
    expect(adapter.requests.where((r) => r.path == '/queue'), isEmpty);
    await tester.drag(find.byType(ListView).first, const Offset(0, -750));
    await tester.pumpAndSettle();
    expect(find.text('Receipt: refunded'), findsOneWidget);
    expect(find.text('refunded'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  for (final width in [320.0, 390.0]) {
    for (final dark in [false, true]) {
      testWidgets('staff workflows fit $width dark=$dark at large text',
          (tester) async {
        tester.view.physicalSize = Size(width, 780);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final adapter = WorkflowAdapter()..report = true;
        ApiClient.instance.setHttpAdapterForTesting(adapter);
        final auth = AuthProvider()..profile = MeProfile(clinicId: 'clinic');
        for (final screen in [
          const ReceptionistReportsScreen(),
          const ReceptionistWalkInBookingScreen()
        ]) {
          await tester.pumpWidget(const SizedBox());
          await tester.pumpWidget(ChangeNotifierProvider.value(
              value: auth,
              child: MaterialApp(
                  theme: dark ? AppTheme.dark : AppTheme.light,
                  builder: (context, child) => MediaQuery(
                      data: MediaQuery.of(context)
                          .copyWith(textScaler: const TextScaler.linear(1.4)),
                      child: child!),
                  home: Scaffold(body: screen))));
          await tester.pumpAndSettle();
          for (var i = 0; i < 5; i++) {
            expect(tester.takeException(), isNull);
            await tester.drag(
                find.byType(ListView).first, const Offset(0, -380));
            await tester.pumpAndSettle();
          }
          expect(tester.takeException(), isNull);
        }
      });
    }
  }
}
