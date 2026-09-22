// End-to-end integration test for the BookMyDoctors mobile app.
//
// This drives the REAL widget tree (package:connect_mobile/main.dart's
// BookMyDoctorsApp) inside a real Flutter engine on a real device via the
// `integration_test` package — it is NOT a mocked widget-test harness.
//
// HOW TO RUN (this file is UNEXECUTED — there is no Flutter/Dart SDK in the
// environment that authored it):
//   flutter pub get
//   flutter test integration_test/app_test.dart -d <device-id>
//
// NETWORK CAVEAT — read before changing any assertion below:
// GuestHomeScreen (the screen a signed-out user boots straight into — see
// lib/routing/app_router.dart's AppRoot.build) makes real GET calls through
// ApiClient/dio to the backend configured in lib/config/env.dart
// (specializations, doctors, clinics).
// When this suite runs on a device with no reachable backend, those calls
// fail or time out (ApiClient's dio instance uses a 20s connect/receive
// timeout — see lib/core/api_client.dart). GuestHomeScreen already wraps
// each fetch in its own try/catch and falls back to an empty list / a 0
// count (see _fetchSpecializations / _fetchDoctors / _fetchClinicsCount in
// lib/screens/guest/guest_home_screen.dart), so the screen always finishes
// loading and renders either way — it just may render empty
// specialization/doctor sections if the backend wasn't reachable.
//
// Because of that, this test deliberately asserts ONLY on static UI that is
// present regardless of network outcome — AppBar titles, headline copy, and
// the fact that navigation actually happened — and never on doctor counts,
// specialization names, or any other value that depends on a live API
// response actually returning data.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:connect_mobile/main.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'app boots straight to the guest home screen and reaches doctor search',
    (WidgetTester tester) async {
      // 1. Boot the real app widget tree, exactly as main() does.
      await tester.pumpWidget(const BookMyDoctorsApp());

      // AuthProvider.bootstrap() is kicked off inside BookMyDoctorsApp's
      // ChangeNotifierProvider.create (see lib/main.dart). It only makes a
      // network call (GET /me) when TokenStore.load() finds a saved
      // access+refresh token pair (see lib/state/auth_provider.dart and
      // lib/core/token_store.dart's TokenStore.load()). A freshly installed
      // app / fresh test run has nothing in secure storage yet, so load()
      // resolves with null almost immediately and bootstrap() goes straight
      // to AuthStatus.loggedOut without ever touching the network. That
      // makes this pumpAndSettle safe — it will not hang waiting on a real
      // HTTP round trip.
      //
      // GuestHomeScreen's own initState() fires 3 parallel GET requests
      // (specializations/doctors/clinics) as soon as it mounts, each
      // individually capped at dio's 20s connect/receive timeout. Give
      // pumpAndSettle enough real time for all three to resolve —
      // successfully or via their own caught failure — before the
      // FutureBuilder settles.
      await tester.pumpAndSettle(const Duration(seconds: 30));

      // 2. AppRoot renders AuthStatus.loggedOut as GuestHomeScreen directly
      // (see lib/routing/app_router.dart's AppRoot.build — this mirrors the
      // real website's "/" being the public landing page, not a login form;
      // login is one tap away from here via GuestHomeScreen's own AppBar
      // action / footer link, not the app's boot screen). There is no
      // separate LoginScreen-first step or "Browse without logging in" tap
      // to drive through any more.
      //
      // 3. Verify GuestHomeScreen rendered. Static chrome + headline copy
      // only (see NETWORK CAVEAT above) — never doctor/specialization data.
      expect(find.widgetWithText(AppBar, 'BookMyDoctors'), findsOneWidget);
      // The hero headline is rendered as Text.rich('Care without the ' +
      // 'waiting room.'); textContaining matches on the combined plain text
      // of a Text widget's textSpan, so this works even though the string
      // is split across two TextSpans for two-tone styling.
      expect(find.textContaining('waiting room.'), findsOneWidget);
      final searchButton = find.widgetWithText(ElevatedButton, 'Search');
      expect(searchButton, findsOneWidget);

      // 4. Tap the hero "Search" button — pushes GuestDoctorSearchScreen.
      await tester.tap(searchButton);
      await tester.pumpAndSettle(const Duration(seconds: 10));

      // 5. Verify we reached the doctor search screen via its own static
      // AppBar title and PageHeader title — again, not fetched data.
      expect(find.widgetWithText(AppBar, 'Find doctors'), findsOneWidget);
      expect(find.text('Find your doctor'), findsOneWidget);
    },
  );
}
