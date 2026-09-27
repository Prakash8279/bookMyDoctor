import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb, kReleaseMode;

/// Backend base URL configuration.
///
/// The mobile app talks to the SAME backend used by the web app
/// (server/src, running on port 4000) and the SAME PostgreSQL database.
/// No new backend/database is created for this app.
///
/// Default resolution order:
/// 1. `--dart-define=API_BASE_URL=http://192.168.x.x:4000` (recommended for a
///    real phone on the same Wi-Fi as your PC — see README.md for how to
///    find your PC's LAN IP).
/// 2. Android emulator special alias `10.0.2.2` which maps to the host
///    machine's `localhost` (Android emulators cannot reach `localhost`
///    directly — this is the standard Flutter/Android workaround).
/// 3. `localhost` for iOS simulator / desktop / web debug runs.
///
/// The emulator/localhost fallbacks above are plain `http://` — harmless for local dev (nothing
/// off-device can reach them), but a RELEASE build shipped without `--dart-define=API_BASE_URL`
/// would otherwise silently fall back to one of these instead of a real, HTTPS backend. It would
/// simply fail to connect rather than leak anything (no real server listens on a phone's own
/// `localhost`), but "fails silently to the wrong thing" is worse than "fails loudly and tells
/// you why" — so a release build with no API_BASE_URL throws immediately at first use instead.
class Env {
  Env._();

  static const String _fromDefine = String.fromEnvironment('API_BASE_URL');

  static String get apiBaseUrl {
    if (_fromDefine.isNotEmpty) return _fromDefine;

    // Default to the live AWS EC2 backend server
    return 'https://api.bookmydoctors.me';
  }
}
