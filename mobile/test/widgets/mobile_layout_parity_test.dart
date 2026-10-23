import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:connect_mobile/core/api_client.dart';
import 'package:connect_mobile/core/india_time.dart';
import 'package:connect_mobile/models/core_models.dart';
import 'package:connect_mobile/screens/admin/admin_home_screen.dart';
import 'package:connect_mobile/screens/guest/guest_home_screen.dart';
import 'package:connect_mobile/screens/doctor/doctor_home_screen.dart';
import 'package:connect_mobile/screens/doctor/doctor_appointments_screen.dart';
import 'package:connect_mobile/screens/patient/patient_home_screen.dart';
import 'package:connect_mobile/screens/receptionist/receptionist_home_screen.dart';
import 'package:connect_mobile/state/auth_provider.dart';
import 'package:connect_mobile/widgets/role_scaffold.dart';
import 'package:connect_mobile/theme/app_theme.dart';

class FixtureAdapter implements HttpClientAdapter {
  FixtureAdapter({this.filled = false});
  final bool filled;
  final requests = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    final Object data = switch (options.path) {
      '/platform-charges' => <String, dynamic>{},
      '/admin/dashboard-stats' => <String, dynamic>{},
      '/admin/system-settings' => <String, dynamic>{},
      '/admin/booking-rules' => <String, dynamic>{},
      '/reviews' when filled => [
          {
            'id': 'review-approved',
            'status': 'approved',
            'rating': 5,
            'text': 'Real approved patient review',
            'patient': {'id': 'patient-1', 'name': 'Patient A'}
          },
          {
            'id': 'review-pending',
            'status': 'pending',
            'rating': 5,
            'text': 'Unapproved review must stay hidden'
          }
        ],
      '/doctors' when filled => [
          {
            'id': 'doctor-1',
            'name': 'Dr. Priya Sharma Long Name',
            'consultationFee': 500,
            'city': 'Mumbai',
            'specialization': {
              'id': 'specialty-1',
              'name': 'General Physician'
            },
            'experienceYears': 8,
            'rating': 4.8,
            'status': 'verified',
            'scheduleSummary': 'Mon–Sat · 10:00–18:00',
            'clinics': [
              {
                'id': 'clinic-1',
                'name': 'BookADoctors Community Healthcare Clinic',
                'city': 'Mumbai'
              }
            ]
          }
        ],
      _ => <dynamic>[],
    };
    return ResponseBody.fromString(
        jsonEncode({
          'success': true,
          'data': data,
          'pagination': {
            'page': 1,
            'pageSize': 100,
            'total': data is List ? data.length : 0,
            'totalPages': 1
          }
        }),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json']
        });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    if (Platform.environment['MOBILE_QA_DIR'] != null) {
      final inter = FontLoader('Inter')
        ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
      await inter.load();
      final fallback = FontLoader('Ahem')
        ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
      await fallback.load();
      final roboto = FontLoader('Roboto')
        ..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
      await roboto.load();
      final icons = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await icons.load();
    }
  });
  setUp(() {
    final original = FlutterError.onError;
    FlutterError.onError = (details) {
      debugPrint(details.toString());
      original?.call(details);
    };
    addTearDown(() => FlutterError.onError = original);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('dev.fluttercommunity.plus/connectivity'),
            (call) async => ['wifi']);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel(
                'dev.fluttercommunity.plus/connectivity_status'),
            (call) async => null);
  });
  final portals = <String, Widget>{
    'patient': const PatientHomeScreen(),
    'doctor': const DoctorHomeScreen(),
    'receptionist': const ReceptionistHomeScreen(),
    'admin': const AdminHomeScreen(isSuperAdmin: false),
    'superadmin': const AdminHomeScreen(isSuperAdmin: true),
  };
  testWidgets('doctor appointments defaults to the current India visit date',
      (tester) async {
    final adapter = FixtureAdapter();
    ApiClient.instance.setHttpAdapterForTesting(adapter);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light, home: const DoctorAppointmentsScreen()));
    await tester.pumpAndSettle();
    final request = adapter.requests
        .firstWhere((request) => request.path == '/appointments');
    expect(request.queryParameters['date'], indiaToday());
    expect(find.text(indiaToday()), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('visit-today')));
    await tester.pumpAndSettle();
    expect(adapter.requests.last.queryParameters['date'], indiaToday());
  });
  for (final width in [320.0, 390.0]) {
    testWidgets('public page with doctor data fits $width at large font',
        (tester) async {
      final errorHandler = FlutterError.onError;
      FlutterError.onError = (details) {
        debugPrint(details.toString());
        errorHandler?.call(details);
      };
      addTearDown(() => FlutterError.onError = errorHandler);
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      ApiClient.instance.setHttpAdapterForTesting(FixtureAdapter(filled: true));
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light,
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.4)),
            child: child!),
        home: const GuestHomeScreen(),
      ));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull,
          reason: 'Public home initial layout');
      final scrollable = find.byType(Scrollable).first;
      var sawApprovedReview = false;
      for (var step = 0; step < 18; step++) {
        await tester.drag(scrollable, const Offset(0, -600));
        await tester.pumpAndSettle();
        sawApprovedReview = sawApprovedReview ||
            find.text('Real approved patient review').evaluate().isNotEmpty;
        expect(find.text('Unapproved review must stay hidden'), findsNothing);
        expect(tester.takeException(), isNull,
            reason: 'Public home section $step');
      }
      expect(sawApprovedReview, isTrue);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    });
  }
  for (final dark in [false, true]) {
    for (final role in portals.keys) {
      for (final width in [320.0, 360.0, 390.0, 600.0, 840.0]) {
        for (final scale in [1.0, 1.4]) {
          testWidgets(
              '${dark ? 'dark' : 'light'} $role portal fits width $width with text scale $scale',
              (tester) async {
            tester.view.physicalSize = Size(width, 900);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            ApiClient.instance.setHttpAdapterForTesting(FixtureAdapter());
            final auth = AuthProvider()
              ..status = AuthStatus.loggedIn
              ..user = AppUser(
                  id: 'fixture-$role',
                  name: 'Demo Account',
                  email: 'demo@example.test',
                  role: role);
            final boundaryKey = GlobalKey();
            await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>.value(
                value: auth,
                child: MaterialApp(
                  theme: dark ? AppTheme.dark : AppTheme.light,
                  builder: (context, child) => MediaQuery(
                      data: MediaQuery.of(context)
                          .copyWith(textScaler: TextScaler.linear(scale)),
                      child: child!),
                  home:
                      RepaintBoundary(key: boundaryKey, child: portals[role]!),
                )));
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull,
                reason:
                    'Initial $role dashboard overflow/error at $width/$scale');
            final state =
                tester.state<RoleScaffoldState>(find.byType(RoleScaffold));
            expect(state.bottomDestinations.length, greaterThanOrEqualTo(2));
            final shell = tester.widget<Scaffold>(find
                .descendant(
                    of: find.byType(RoleScaffold),
                    matching: find.byType(Scaffold))
                .first);
            expect(shell.drawer, isNull,
                reason: 'Mobile must not show a duplicate sidebar');
            expect(find.byTooltip('Open navigation menu'), findsNothing);
            if (width == 390 && scale == 1) {
              final shortcut = find
                  .descendant(
                      of: find.byType(PortalQuickActions),
                      matching: find.byType(InkWell))
                  .first;
              await tester.ensureVisible(shortcut);
              await tester.tap(shortcut);
              await tester.pumpAndSettle();
              expect(state.currentIndex, isNot(state.widget.initialIndex));
              await tester.binding.handlePopRoute();
              await tester.pumpAndSettle();
              expect(state.currentIndex, state.widget.initialIndex,
                  reason: 'Back returns to Home rather than closing the app');
            }
            // A second review walks every portal destination, rather than checking only the home.
            if (width == 320 && scale == 1.4) {
              for (var index = 0; index < state.widget.items.length; index++) {
                debugPrint('REVIEW $role: ${state.widget.items[index].label}');
                state.setIndex(index);
                await tester.pumpAndSettle();
                expect(tester.takeException(), isNull,
                    reason:
                        '${state.widget.items[index].label} overflow/error');
              }
              final profileIndex = state.widget.items
                  .indexWhere((item) => item.label == 'My profile');
              state.setIndex(profileIndex);
              await tester.pumpAndSettle();
              final signOut = find.byKey(const ValueKey('profile-sign-out'));
              for (var step = 0;
                  step < 25 && signOut.evaluate().isEmpty;
                  step++) {
                await tester.drag(
                    find.byType(Scrollable).first, const Offset(0, -450));
                await tester.pumpAndSettle();
              }
              expect(signOut, findsOneWidget,
                  reason: 'Sign out must remain reachable without a drawer');
              await tester.ensureVisible(signOut);
              await tester.tap(signOut);
              await tester.pumpAndSettle();
              expect(find.text('Sign out?'), findsOneWidget);
              await tester.tap(find.text('Cancel'));
              await tester.pumpAndSettle();
              expect(auth.status, AuthStatus.loggedIn);
              state.setIndex(state.widget.initialIndex);
              await tester.pumpAndSettle();
            }
            final qa = Platform.environment['MOBILE_QA_DIR'];
            if (qa != null && width == 390 && scale == 1) {
              final boundary = boundaryKey.currentContext!.findRenderObject()
                  as RenderRepaintBoundary;
              await tester.runAsync(() async {
                final image = await boundary.toImage(pixelRatio: 1);
                final bytes =
                    await image.toByteData(format: ui.ImageByteFormat.png);
                await Directory(qa).create(recursive: true);
                await File('$qa/${dark ? 'dark' : 'light'}-$role-dashboard.png')
                    .writeAsBytes(bytes!.buffer.asUint8List());
                image.dispose();
              });
            }
            await tester.pumpWidget(const SizedBox.shrink());
            await tester.pumpAndSettle();
            auth.dispose();
          });
        }
      }
    }
  }
  test('India dates and timestamp match the website across UTC midnight', () {
    expect(indiaToday(DateTime.parse('2026-10-21T18:30:00Z')), '2026-10-22');
    expect(indiaTimestamp('2026-10-21T20:40:05Z'), '22/10/2026 02:10:05 IST');
    expect(indiaTimestamp('2026-10-21'), 'Not recorded');
  });
}
