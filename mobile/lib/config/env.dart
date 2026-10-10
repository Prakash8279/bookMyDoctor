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
/// The production fallback is HTTPS-only. A release can still override it with
/// `--dart-define=API_BASE_URL=https://...` for a staging or replacement API.
class Env {
  Env._();

  static const String _fromDefine = String.fromEnvironment('API_BASE_URL');

  static String get apiBaseUrl {
    if (_fromDefine.trim().isNotEmpty) return _fromDefine.trim();

    // Safe default for an installed build. Do not replace this with a plain
    // HTTP URL: Android release builds intentionally reject clear-text traffic.
    return 'https://api.bookadoctors.com';
  }
}
