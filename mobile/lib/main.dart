import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'routing/app_router.dart';
import 'state/auth_provider.dart';
import 'theme/app_theme.dart';

/// Crash reporting (Sentry) is entirely opt-in and OFF by default — mirrors
/// config/env.dart's own `String.fromEnvironment` pattern for build-time config rather than
/// adding a second way to configure the app. An empty value (the default — every build made in
/// this sandbox, which has no network access to Sentry anyway) means "don't initialize Sentry at
/// all"; the app must run exactly the same with or without it configured. Set a real one via
/// `--dart-define=SENTRY_DSN=https://your-key@oXXXXXX.ingest.sentry.io/XXXXXX` on a real build —
/// see README.md's "Crash reporting & connectivity" section. NEVER hardcode a real DSN value
/// here — a DSN is not a secret in the traditional sense (it's fine to ship inside an app binary,
/// same as GoogleAuthConfig.webClientId above), but this sandbox has no real Sentry project to
/// point it at, so there is nothing real to put here regardless.
const String _sentryDsn = String.fromEnvironment('SENTRY_DSN');

Future<void> main() async {
  if (_sentryDsn.isEmpty) {
    runApp(const BookMyDoctorsApp());
    return;
  }
  WidgetsFlutterBinding.ensureInitialized();
  await SentryFlutter.init(
    (options) {
      options.dsn = _sentryDsn;
      // Conservative default — matches Sentry's own "start small" guidance for
      // performance-tracing sample rate; not user-configurable from anywhere else yet.
      options.tracesSampleRate = 0.2;
    },
    appRunner: () => runApp(const BookMyDoctorsApp()),
  );
}

class BookMyDoctorsApp extends StatelessWidget {
  const BookMyDoctorsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AuthProvider()..bootstrap(),
      child: MaterialApp(
        title: 'BookMyDoctors',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light,
        builder: (context, child) {
          final mediaQuery = MediaQuery.of(context);
          // Clamp text scaling between 0.85 and 1.15 to ensure compatibility
          // across different phone screen sizes and OS accessibility font settings,
          // preventing RenderFlex overflows on devices with huge display scales.
          return MediaQuery(
            data: mediaQuery.copyWith(
              textScaler: mediaQuery.textScaler.clamp(
                minScaleFactor: 0.85,
                maxScaleFactor: 1.15,
              ),
            ),
            child: child ?? const SizedBox.shrink(),
          );
        },
        onGenerateRoute: onGenerateRoute,
        home: const AppRoot(),
      ),
    );
  }
}
