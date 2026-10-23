import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/api_client.dart';
import 'package:connect_mobile/models/core_models.dart';
import 'package:connect_mobile/theme/app_theme.dart';
import 'package:connect_mobile/screens/patient/book_appointment_screen.dart';
import 'package:connect_mobile/screens/patient/doctor_detail_screen.dart';
import 'package:connect_mobile/widgets/booking_member_form.dart';
import 'patient_functional_flow_test.dart' show FlowAdapter, mount;

class BookingAdapter extends FlowAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (options.path == '/family-members' && options.method == 'POST') {
      requests.add(options);
      return ok({'id': 'new-member', ...options.data as Map<String, dynamic>});
    }
    if (options.path == '/appointments/availability' &&
        options.queryParameters['doctorId'] == null) {
      requests.add(options);
      return ok([
        for (final id in ['doctor-1', 'doctor-2'])
          {
            'doctorUserId': id,
            'clinicId': 'clinic',
            'totalSlots': 50,
            'availableSlots': 16,
            'closed': false
          }
      ]);
    }
    return super.fetch(options, requestStream, cancelFuture);
  }
}

Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async {
    if (Platform.environment['MOBILE_QA_DIR'] != null) {
      for (final family in ['Inter', 'Ahem', 'Roboto']) {
        await (FontLoader(family)
              ..addFont(rootBundle.load('assets/fonts/Inter.ttf')))
            .load();
      }
      await (FontLoader('MaterialIcons')
            ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf')))
          .load();
    }
  });
  testWidgets(
      'website two-step flow: compact filters, doctor cards, Profile and Book, Change doctor',
      (tester) async {
    final adapter = BookingAdapter();
    await mount(tester, const BookAppointmentScreen(), adapter);
    expect(find.text('Confirm booking'), findsNothing);
    expect(find.byType(DropdownButtonFormField<DoctorDirectoryItem>),
        findsNothing);
    expect(find.text('Doctor name / Clinic name'), findsNothing);
    expect(find.text('Slot 50, Avl 16'), findsNWidgets(2));
    final profile = find.byKey(const ValueKey('booking-profile-doctor-1'));
    final book = find.byKey(const ValueKey('booking-select-doctor-1'));
    expect(tester.getCenter(profile).dy, tester.getCenter(book).dy);
    await tapVisible(tester, profile);
    expect(find.byType(DoctorDetailScreen), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tapVisible(
        tester, find.byKey(const ValueKey('booking-filters-toggle')));
    final search = find.widgetWithText(TextField, 'Doctor name / Clinic name');
    await tester.enterText(search, 'doctor-2');
    await tester.pumpAndSettle();
    await tapVisible(tester, find.text('Apply filters'));
    expect(find.text('Doctor name / Clinic name'), findsNothing);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -250));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('booking-select-doctor-1')), findsNothing);
    expect(
        find.byKey(const ValueKey('booking-select-doctor-2')), findsOneWidget);
    await tapVisible(
        tester, find.byKey(const ValueKey('booking-select-doctor-2')));
    expect(find.text('Appointment Details'), findsOneWidget);
    expect(find.text('Matching Doctors (1)'), findsNothing);
    expect(find.text('Booking with Doctor doctor-2'), findsOneWidget);
    await tapVisible(tester, find.text('Change doctor'));
    expect(find.text('Matching Doctors (1)'), findsOneWidget);
    expect(
        adapter.requests.where((request) => request.method == 'POST'), isEmpty);
  });
  testWidgets(
      'Add member is inline, required, saves and selects the new complete member',
      (tester) async {
    final adapter = BookingAdapter();
    await mount(
        tester,
        BookAppointmentScreen(
            preselectedDoctor:
                DoctorDirectoryItem.fromJson(adapter.doctor('doctor-1'))),
        adapter);
    await tapVisible(tester, find.text('Add member'));
    expect(find.byType(BookingMemberForm), findsOneWidget);
    expect(find.byType(BottomSheet), findsNothing);
    await tapVisible(tester, find.text('Save member'));
    expect(find.text('Required'), findsWidgets);
    expect(
        adapter.requests.where((request) => request.method == 'POST'), isEmpty);
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Member name *'), 'New Patient');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Relationship *'), 'Self');
    await tapVisible(tester, find.text('Member date of birth *'));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    final gender = find.byWidgetPredicate((widget) =>
        widget is DropdownButtonFormField<String> &&
        widget.decoration.labelText == 'Member gender *');
    await tapVisible(tester, gender);
    await tester.tap(find.text('Other').last);
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Member blood group *'), 'Unknown');
    await tapVisible(tester, find.text('Save member'));
    expect(find.byType(BookingMemberForm), findsNothing);
    final request = adapter.requests.singleWhere((request) =>
        request.path == '/family-members' && request.method == 'POST');
    expect(request.data['name'], 'New Patient');
    expect(request.data['relation'], 'Self');
    expect(request.data['bloodGroup'], 'Unknown');
    final confirm = find.widgetWithText(ElevatedButton, 'Confirm booking');
    expect(tester.widget<ElevatedButton>(confirm).onPressed, isNotNull);
    await tapVisible(tester, confirm);
    expect(
        adapter.requests
            .singleWhere((request) =>
                request.path == '/appointments' && request.method == 'POST')
            .data['familyMemberId'],
        'new-member');
    expect(find.text('Booking confirmed'), findsOneWidget);
  });
  for (final dark in [false, true]) {
    for (final width in [320.0, 390.0, 700.0]) {
      testWidgets(
          'booking list and selected form fit $width, dark=$dark at large text',
          (tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final adapter = BookingAdapter();
        ApiClient.instance.setHttpAdapterForTesting(adapter);
        final boundary = GlobalKey();
        await tester.pumpWidget(MaterialApp(
            theme: dark ? AppTheme.dark : AppTheme.light,
            builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: const TextScaler.linear(1.4)),
                child: child!),
            home: RepaintBoundary(
                key: boundary, child: const BookAppointmentScreen())));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final directory = Platform.environment['MOBILE_QA_DIR'];
        Future<void> capture(String step) async {
          if (directory == null || width != 390) return;
          final render = boundary.currentContext!.findRenderObject()
              as RenderRepaintBoundary;
          await tester.runAsync(() async {
            final bitmap = await render.toImage();
            final bytes =
                await bitmap.toByteData(format: ui.ImageByteFormat.png);
            await Directory(directory).create(recursive: true);
            await File(
                    '$directory/booking-${dark ? 'dark' : 'light'}-$step.png')
                .writeAsBytes(bytes!.buffer.asUint8List());
            bitmap.dispose();
          });
        }

        await capture('doctors');
        await tapVisible(
            tester, find.byKey(const ValueKey('booking-select-doctor-1')));
        await capture('confirm');
        final scroll = find.byType(Scrollable).first;
        for (var index = 0; index < 6; index++) {
          await tester.drag(scroll, const Offset(0, -350));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }
        await tapVisible(tester, find.text('Add member'));
        for (var index = 0; index < 4; index++) {
          await tester.drag(scroll, const Offset(0, -300));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }
        await tester.pumpWidget(const SizedBox.shrink());
      });
    }
  }
}
