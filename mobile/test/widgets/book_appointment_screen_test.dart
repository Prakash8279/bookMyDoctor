import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:connect_mobile/screens/patient/book_appointment_screen.dart';
import 'package:connect_mobile/widgets/common_widgets.dart';

/// BookAppointmentScreen kicks off 3 real ApiClient/dio calls (doctors, family members,
/// platform-charges) from `initState`'s `_loadOptions` (see
/// screens/patient/book_appointment_screen.dart) — there's no way to inject a fake ApiClient
/// from outside lib/core/api_client.dart, so these tests exercise the screen against the real
/// singleton exactly like integration_test/app_test.dart already does for GuestHomeScreen's own
/// startup fetches.
///
/// In a test environment there is no backend listening on `Env.apiBaseUrl` (localhost:4000), so
/// those calls fail fast with a connection error — `_loadOptions`'s own catch block turns that
/// into `_error` + `_loadingOptions = false`, and the screen still finishes loading and renders
/// (with empty doctor/family lists) either way, exactly as it does for the "backend is
/// unreachable" case described in the API client's own `_shape` fallback message.
///
/// `flutter test`'s default binding runs on a *fake* clock (unlike `integration_test`, which
/// runs live) — a real socket connection's completion doesn't arrive via a `Timer` the fake
/// clock can fast-forward, so `tester.runAsync` is used to briefly step out to the real event
/// loop and let that connection attempt actually resolve before pumping again.
void main() {
  group('BookAppointmentScreen', () {
    testWidgets('shows a loading indicator on the very first frame, before options have loaded', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: BookAppointmentScreen()));

      expect(find.byType(LoadingView), findsOneWidget);
      expect(find.widgetWithText(AppBar, 'Book an appointment'), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);

      // Drain the real _loadOptions() network calls kicked off in initState before this test
      // ends, same as the other two tests below do (see this file's doc comment on why
      // `runAsync` is needed). `_loadOptions` has no `mounted` check before either of its own
      // `setState` calls (unlike `_submit()`, which does check `mounted`) — without draining
      // here, that connection attempt would resolve only after flutter_test disposes this test's
      // widget tree at teardown and call setState on an already-disposed State object. Because
      // the underlying Future is real rather than fake-clock-driven, that failure could then
      // surface while a LATER test is running instead of this one.
      await tester.runAsync(() => Future.delayed(const Duration(seconds: 2)));
    });

    testWidgets('renders the booking form once loading settles, with the confirm button disabled', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: BookAppointmentScreen()));

      await tester.runAsync(() => Future.delayed(const Duration(seconds: 2)));
      await tester.pump();

      expect(find.byType(LoadingView), findsNothing);
      // No backend reachable in this environment -> _loadOptions's catch surfaces the failure via
      // the same ErrorBanner every other screen uses, rather than leaving the form half-drawn.
      expect(find.byType(ErrorBanner), findsOneWidget);

      // The form itself still renders (doctor list just ends up empty) so a patient always has
      // something on screen to retry from, rather than a dead end.
      expect(find.text('Reason for visit (optional)'), findsOneWidget);
      expect(find.text('Emergency booking'), findsOneWidget);
      // Defaults to today (see `_selectedDate = DateTime.now()`) rather than an unset placeholder
      // — the date-picker button always shows a formatted date, never "Select date".
      expect(find.byIcon(Icons.calendar_today), findsOneWidget);

      final confirmButton = tester.widget<ElevatedButton>(
        find.widgetWithText(ElevatedButton, 'Confirm booking'),
      );
      // Neither a doctor nor a "booking for" choice has been made yet -> `_canSubmit` is false.
      expect(confirmButton.onPressed, isNull);
    });

    testWidgets('toggling the emergency switch updates its own state without requiring a doctor first', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: BookAppointmentScreen()));
      await tester.runAsync(() => Future.delayed(const Duration(seconds: 2)));
      await tester.pump();

      final emergencySwitch = tester.widget<SwitchListTile>(find.byType(SwitchListTile));
      expect(emergencySwitch.value, isFalse);

      await tester.tap(find.byType(SwitchListTile));
      await tester.pump();

      final toggled = tester.widget<SwitchListTile>(find.byType(SwitchListTile));
      expect(toggled.value, isTrue);
    });
  });
}
