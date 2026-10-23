import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/api_client.dart';
import 'package:connect_mobile/core/india_time.dart';
import 'package:connect_mobile/models/core_models.dart';
import 'package:connect_mobile/screens/patient/book_appointment_screen.dart';
import 'package:connect_mobile/screens/patient/family_members_screen.dart';
import 'package:connect_mobile/screens/patient/patient_search_screen.dart';
import 'package:connect_mobile/screens/patient/appointments_screen.dart';
import 'package:connect_mobile/screens/patient/payments_screen.dart';
import 'package:connect_mobile/screens/patient/queue_tracker_screen.dart';
import 'package:connect_mobile/screens/shared/notifications_screen.dart';
import 'package:connect_mobile/widgets/common_widgets.dart';
import 'package:connect_mobile/theme/app_theme.dart';

class FlowAdapter implements HttpClientAdapter {
  String? failPath;
  bool closed = false;
  int available = 5;
  bool pending = false;
  bool refunded = false;
  List<Map<String, dynamic>>? appointmentRows;
  Completer<ResponseBody>? firstAvailability;
  final requests = <RequestOptions>[];
  Map<String, dynamic> doctor(String id) => {
        'id': id,
        'name': 'Doctor $id',
        'onlineBooking': true,
        'maxDaysAdvance': 0,
        'consultationFee': 500,
        'clinics': [
          {'id': 'clinic', 'name': 'Test Clinic'}
        ],
      };
  Map<String, dynamic> get appointment => {
        'id': 'booking',
        'appointmentDate': indiaToday(),
        'appointmentTime': '10:05',
        'status': refunded
            ? 'cancelled'
            : pending
                ? 'pending_payment'
                : 'confirmed',
        'paymentStatus': refunded
            ? 'refunded'
            : pending
                ? 'pending'
                : 'paid',
        'tokenNumber': pending ? null : '1',
        'source': 'online',
        'doctor': {'id': 'doctor-1', 'name': 'Test Doctor'},
        'clinic': {'id': 'clinic', 'name': 'Test Clinic'},
        'patient': {'id': 'patient', 'name': 'Test Patient'},
        'fees': {'totalAmount': 500},
        'createdAt': DateTime.now().toUtc().toIso8601String(),
      };
  ResponseBody ok(dynamic data) =>
      ResponseBody.fromString(jsonEncode({'success': true, 'data': data}), 200,
          headers: {
            Headers.contentTypeHeader: ['application/json']
          });
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    if (options.path == failPath) {
      return ResponseBody.fromString(
          jsonEncode({
            'success': false,
            'error': {
              'code': 'SERVICE_UNAVAILABLE',
              'message': 'Service temporarily unavailable'
            }
          }),
          503,
          headers: {
            Headers.contentTypeHeader: ['application/json']
          });
    }
    if (options.path == '/doctors') {
      return ok([doctor('doctor-1'), doctor('doctor-2')]);
    }
    if (options.path.startsWith('/doctors/')) {
      return ok(doctor(options.path.split('/').last));
    }
    if (options.path == '/family-members') {
      return ok([
        {
          'id': 'member',
          'name': 'Test Patient',
          'relation': 'Self',
          'dateOfBirth': '2000-01-01',
          'gender': 'Other',
          'bloodGroup': 'Unknown'
        }
      ]);
    }
    if (options.path == '/platform-charges') return ok({});
    if (options.path == '/appointments/availability') {
      if (options.queryParameters['doctorId'] == 'doctor-1' &&
          firstAvailability != null) {
        return firstAvailability!.future;
      }
      return ok([
        {
          'doctorUserId': options.queryParameters['doctorId'],
          'clinicId': 'clinic',
          'date': options.queryParameters['date'],
          'totalSlots': 5,
          'availableSlots': available,
          'bookedSlots': 5 - available,
          'closed': closed
        }
      ]);
    }
    if (options.path == '/appointments' && options.method == 'POST') {
      return ok({'jobId': 'job'});
    }
    if (options.path == '/appointments/booking-status/job') {
      return ok(
          {'jobId': 'job', 'status': 'confirmed', 'appointment': appointment});
    }
    if (options.path == '/appointments') {
      return ok(appointmentRows ?? [appointment]);
    }
    if (options.path == '/payments') {
      return ok(refunded
          ? [
              {
                'id': 'payment',
                'appointment': {'id': 'booking'},
                'mode': 'online',
                'status': 'refunded',
                'fees': {'amount': 500}
              }
            ]
          : []);
    }
    if (options.path == '/queue/mine/booking') {
      return ok({
        'token': 1,
        'status': 'waiting',
        'patientsAhead': 0,
        'nowServing': 1,
        'estimatedWaitMinutes': 0
      });
    }
    return ok([]);
  }

  @override
  void close({bool force = false}) {}
}

Future<void> mount(
    WidgetTester tester, Widget screen, FlowAdapter adapter) async {
  ApiClient.instance.setHttpAdapterForTesting(adapter);
  await tester.pumpWidget(
      MaterialApp(theme: AppTheme.light, home: Scaffold(body: screen)));
  await tester.pumpAndSettle();
}

Future<void> choosePatient(WidgetTester tester) async {
  final picker = find.byWidgetPredicate((widget) =>
      widget is DropdownButtonFormField<String> &&
      widget.decoration.labelText == 'Patient');
  await tester.ensureVisible(picker);
  await tester.pumpAndSettle();
  await tester.tap(picker);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Test Patient · Self').last);
  await tester.pumpAndSettle();
}

Finder get confirm => find.widgetWithText(ElevatedButton, 'Confirm booking');

void main() {
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('razorpay_flutter'), (_) async => null);
  });
  for (final row in <(String, Widget)>[
    ('/notifications', const NotificationsScreen()),
    ('/family-members', const FamilyMembersScreen()),
    ('/doctors', const PatientSearchScreen()),
    ('/appointments', const PatientAppointmentsScreen()),
    ('/payments', const PatientPaymentsScreen()),
  ]) {
    testWidgets('${row.$1} failures show an error rather than fake empty data',
        (tester) async {
      await mount(tester, row.$2, FlowAdapter()..failPath = row.$1);
      expect(find.byType(ErrorBanner), findsOneWidget);
      expect(find.text('Service temporarily unavailable'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
  testWidgets(
      'same-day-only doctor booking submits today and the selected family member',
      (tester) async {
    final adapter = FlowAdapter();
    await mount(
        tester,
        BookAppointmentScreen(
            preselectedDoctor:
                DoctorDirectoryItem.fromJson(adapter.doctor('doctor-1'))),
        adapter);
    await choosePatient(tester);
    expect(tester.widget<ElevatedButton>(confirm).onPressed, isNotNull);
    await tester.ensureVisible(confirm);
    await tester.pumpAndSettle();
    await tester.tap(confirm);
    await tester.pumpAndSettle();
    final request = adapter.requests.singleWhere((request) =>
        request.path == '/appointments' && request.method == 'POST');
    expect(request.data['appointmentDate'], indiaToday());
    expect(request.data['familyMemberId'], 'member');
    expect(find.text('Booking confirmed'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  for (final situation in ['closed', 'full', 'failure']) {
    testWidgets('booking cannot submit when availability is $situation',
        (tester) async {
      final adapter = FlowAdapter()
        ..closed = situation == 'closed'
        ..available = situation == 'full' ? 0 : 5
        ..failPath =
            situation == 'failure' ? '/appointments/availability' : null;
      await mount(
          tester,
          BookAppointmentScreen(
              preselectedDoctor:
                  DoctorDirectoryItem.fromJson(adapter.doctor('doctor-1'))),
          adapter);
      await choosePatient(tester);
      expect(tester.widget<ElevatedButton>(confirm).onPressed, isNull);
      if (situation == 'failure') {
        expect(find.byType(ErrorBanner), findsOneWidget);
      }
      expect(adapter.requests.where((request) => request.method == 'POST'),
          isEmpty);
    });
  }
  testWidgets('returning from unpaid checkout does not pop the booking root',
      (tester) async {
    final adapter = FlowAdapter()..pending = true;
    await mount(
        tester,
        BookAppointmentScreen(
            preselectedDoctor:
                DoctorDirectoryItem.fromJson(adapter.doctor('doctor-1'))),
        adapter);
    await choosePatient(tester);
    await tester.ensureVisible(confirm);
    await tester.pumpAndSettle();
    await tester.tap(confirm);
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.byType(BookAppointmentScreen), findsOneWidget);
    expect(find.text('Booking confirmed'), findsNothing);
    expect(
        adapter.requests
            .where((request) =>
                request.method == 'POST' && request.path == '/appointments')
            .length,
        1);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets(
      'refunded appointment is not displayed as money paid or money due',
      (tester) async {
    await mount(tester, const PatientAppointmentsScreen(),
        FlowAdapter()..refunded = true);
    expect(find.text('Paid: ₹0'), findsOneWidget);
    expect(find.text('Due: ₹0'), findsOneWidget);
  });
  testWidgets(
      'queue resolves a token for today instead of an arbitrary old appointment',
      (tester) async {
    final adapter = FlowAdapter();
    adapter.appointmentRows = [
      {...adapter.appointment, 'id': 'old', 'appointmentDate': '2020-01-01'},
      {...adapter.appointment, 'id': 'future', 'appointmentDate': '2099-01-01'},
      {
        ...adapter.appointment,
        'id': 'unpaid',
        'status': 'pending_payment',
        'tokenNumber': null
      },
      adapter.appointment,
    ];
    await mount(tester, const QueueTrackerScreen(embedded: true), adapter);
    expect(find.text('#1'), findsOneWidget);
    expect(
        adapter.requests
            .firstWhere((request) => request.path == '/appointments')
            .queryParameters['date'],
        indiaToday());
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets(
      'options retry clears the old error and restores booking eligibility',
      (tester) async {
    final adapter = FlowAdapter()..failPath = '/family-members';
    await mount(
        tester,
        BookAppointmentScreen(
            preselectedDoctor:
                DoctorDirectoryItem.fromJson(adapter.doctor('doctor-1'))),
        adapter);
    expect(find.byType(ErrorBanner), findsOneWidget);
    adapter.failPath = null;
    final retry = find.descendant(
        of: find.byType(ErrorBanner), matching: find.text('Retry'));
    await tester.ensureVisible(retry);
    await tester.tap(retry);
    await tester.pumpAndSettle();
    expect(find.byType(ErrorBanner), findsNothing);
    await choosePatient(tester);
    expect(tester.widget<ElevatedButton>(confirm).onPressed, isNotNull);
  });
  testWidgets(
      'late availability for the previous doctor cannot replace the new doctor slots',
      (tester) async {
    final adapter = FlowAdapter()
      ..available = 0
      ..firstAvailability = Completer<ResponseBody>();
    await mount(tester, const BookAppointmentScreen(), adapter);
    final first = find.byKey(const ValueKey('booking-select-doctor-1'));
    await tester.ensureVisible(first);
    await tester.tap(first);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.ensureVisible(find.text('Back to all doctors'));
    await tester.tap(find.text('Back to all doctors'));
    await tester.pump(const Duration(milliseconds: 400));
    final second = find.byKey(const ValueKey('booking-select-doctor-2'));
    await tester.ensureVisible(second);
    await tester.tap(second);
    await tester.pumpAndSettle();
    adapter.firstAvailability!.complete(adapter.ok([
      {
        'doctorUserId': 'doctor-1',
        'clinicId': 'clinic',
        'date': indiaToday(),
        'totalSlots': 99,
        'availableSlots': 99,
        'bookedSlots': 0,
        'closed': false
      }
    ]));
    await tester.pumpAndSettle();
    expect(find.text('Available 0'), findsOneWidget);
    expect(find.text('Available 99'), findsNothing);
    await choosePatient(tester);
    expect(tester.widget<ElevatedButton>(confirm).onPressed, isNull);
    expect(tester.takeException(), isNull);
  });
}
