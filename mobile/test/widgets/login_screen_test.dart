import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:connect_mobile/screens/auth/login_screen.dart';
import 'package:connect_mobile/state/auth_provider.dart';

/// LoginScreen reads the current [AuthProvider] via `context.read`/`context.watch` (see
/// state/auth_provider.dart) but only actually calls it — hitting the real backend through
/// ApiClient — once the form validates and `_submit`/`_handleGoogleSignIn` runs. None of the
/// tests below submit a validated form, so no real network call is ever made here; that keeps
/// this suite fast and deterministic without needing to fake ApiClient's singleton Dio instance
/// (which isn't swappable from outside lib/core/api_client.dart).
Widget _wrap(Widget child) {
  return ChangeNotifierProvider<AuthProvider>(
    create: (_) => AuthProvider(),
    child: MaterialApp(home: child),
  );
}

void main() {
  group('LoginScreen', () {
    testWidgets('renders the welcome header, both fields and the sign-in button', (tester) async {
      await tester.pumpWidget(_wrap(const LoginScreen()));

      expect(find.text('Welcome back'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Email address'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Password'), findsOneWidget);
      expect(find.widgetWithText(ElevatedButton, 'Sign in'), findsOneWidget);
      expect(find.text('Continue with Google'), findsOneWidget);
    });

    testWidgets('shows validation errors when the sign-in form is submitted empty', (tester) async {
      await tester.pumpWidget(_wrap(const LoginScreen()));

      await tester.tap(find.widgetWithText(ElevatedButton, 'Sign in'));
      await tester.pump();

      expect(find.text('Enter a valid email'), findsOneWidget);
      expect(find.text('Enter your password'), findsOneWidget);
    });

    testWidgets('shows only the email error when just the email is invalid', (tester) async {
      await tester.pumpWidget(_wrap(const LoginScreen()));

      await tester.enterText(find.widgetWithText(TextFormField, 'Email address'), 'not-an-email');
      await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'Some#Password1');
      await tester.tap(find.widgetWithText(ElevatedButton, 'Sign in'));
      await tester.pump();

      expect(find.text('Enter a valid email'), findsOneWidget);
      expect(find.text('Enter your password'), findsNothing);
    });

    testWidgets('toggles the password field between obscured and visible', (tester) async {
      await tester.pumpWidget(_wrap(const LoginScreen()));

      expect(find.byIcon(Icons.visibility_off_outlined), findsOneWidget);
      expect(find.byIcon(Icons.visibility_outlined), findsNothing);

      await tester.tap(find.byIcon(Icons.visibility_off_outlined));
      await tester.pump();

      expect(find.byIcon(Icons.visibility_outlined), findsOneWidget);
      expect(find.byIcon(Icons.visibility_off_outlined), findsNothing);
    });


    testWidgets('shows the forgot-password and create-account links', (tester) async {
      await tester.pumpWidget(_wrap(const LoginScreen()));

      expect(find.text('Forgot password?'), findsOneWidget);
      expect(find.text('New to BookMyDoctors? Create an account'), findsOneWidget);
      expect(find.text('Browse without logging in'), findsOneWidget);
    });
  });
}
