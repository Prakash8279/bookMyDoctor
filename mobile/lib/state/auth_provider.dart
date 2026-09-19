import 'package:flutter/foundation.dart';

import '../core/api_client.dart';
import '../core/token_store.dart';
import '../models/core_models.dart';

enum AuthStatus { unknown, loggedOut, loggedIn }

/// Single source of truth for "who is logged in and as what role" — every
/// screen that needs the current user/role reads this via
/// `context.watch<AuthProvider>()`. Mirrors the web app's auth slice: login/
/// register hit the real backend, tokens are stored via [TokenStore], and a
/// 401 that survives refresh (handled inside ApiClient) calls [_onUnauthorized]
/// to force the app back to the login screen.
class AuthProvider extends ChangeNotifier {
  AuthStatus status = AuthStatus.unknown;
  AppUser? user;
  MeProfile? profile;
  String? lastError;

  final ApiClient _api = ApiClient.instance;

  AuthProvider() {
    _api.registerUnauthorizedHandler(_handleUnauthorized);
  }

  bool get isLoggedIn => status == AuthStatus.loggedIn && user != null;
  String get role => user?.role ?? '';

  /// Call once at app startup: loads any saved tokens and, if present,
  /// fetches the fresh profile to confirm the session is still valid.
  Future<void> bootstrap() async {
    final tokens = await TokenStore.instance.load();
    if (tokens == null) {
      status = AuthStatus.loggedOut;
      notifyListeners();
      return;
    }
    try {
      await _loadMe();
      status = AuthStatus.loggedIn;
    } catch (_) {
      await TokenStore.instance.clear();
      status = AuthStatus.loggedOut;
    }
    notifyListeners();
  }

  Future<void> _loadMe() async {
    final res = await _api.get('/me');
    final me = MeResponse.fromJson(res.map);
    user = me.user;
    profile = me.profile;
  }

  Future<bool> login(String email, String password) async {
    lastError = null;
    try {
      final res = await _api.post('/auth/login', body: {'email': email, 'password': password});
      final data = res.map;
      final tokens = TokenPair.fromJson(data);
      await TokenStore.instance.save(tokens);
      user = AppUser.fromJson(data['user'] as Map<String, dynamic>);
      await _loadMe();
      status = AuthStatus.loggedIn;
      notifyListeners();
      return true;
    } catch (err) {
      lastError = err.toString();
      notifyListeners();
      return false;
    }
  }

  /// GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix kro"). One backend
  /// call (POST /auth/google) covers login, first-time account-linking, and self-registration
  /// together — see the server's auth.service.js#googleAuth — so this is exactly [login] above,
  /// just posting the Google ID token the native picker returned instead of an email+password
  /// pair. [idToken] comes from `GoogleSignInAuthentication.idToken` — see login_screen.dart /
  /// register_screen.dart's `_handleGoogleSignIn`.
  Future<bool> loginWithGoogle(String idToken) async {
    lastError = null;
    try {
      final res = await _api.post('/auth/google', body: {'idToken': idToken});
      final data = res.map;
      final tokens = TokenPair.fromJson(data);
      await TokenStore.instance.save(tokens);
      user = AppUser.fromJson(data['user'] as Map<String, dynamic>);
      await _loadMe();
      status = AuthStatus.loggedIn;
      notifyListeners();
      return true;
    } catch (err) {
      lastError = err.toString();
      notifyListeners();
      return false;
    }
  }

  /// Patient self-registration only — the backend hard-codes role:'patient'
  /// server-side regardless of what's sent (see integration_plan.md §1.1).
  Future<bool> register({
    required String name,
    required String email,
    required String password,
    String? phone,
    String? city,
  }) async {
    lastError = null;
    try {
      final res = await _api.post('/auth/register', body: {
        'name': name,
        'email': email,
        'password': password,
        if (phone != null && phone.isNotEmpty) 'phone': phone,
        if (city != null && city.isNotEmpty) 'city': city,
      });
      final data = res.map;
      final tokens = TokenPair.fromJson(data);
      await TokenStore.instance.save(tokens);
      user = AppUser.fromJson(data['user'] as Map<String, dynamic>);
      await _loadMe();
      status = AuthStatus.loggedIn;
      notifyListeners();
      return true;
    } catch (err) {
      lastError = err.toString();
      notifyListeners();
      return false;
    }
  }

  Future<void> refreshProfile() async {
    try {
      await _loadMe();
      notifyListeners();
    } catch (_) {
      // Leave stale profile in place rather than crashing a screen over a
      // transient refresh failure; ApiClient's own 401 handling covers the
      // "session actually died" case via _handleUnauthorized.
    }
  }

  Future<void> logout() async {
    final tokens = TokenStore.instance.current;
    try {
      if (tokens != null) {
        await _api.post('/auth/logout', body: {'refreshToken': tokens.refreshToken});
      }
    } catch (_) {
      // Fire-and-forget per integration_plan.md §1.1 — logout must still
      // clear local state even if the network call fails.
    }
    await _resetLocal();
  }

  void _handleUnauthorized() {
    // Called from inside ApiClient when a refresh attempt fails — tokens are
    // already cleared by ApiClient itself, just reset local auth state.
    user = null;
    profile = null;
    status = AuthStatus.loggedOut;
    notifyListeners();
  }

  Future<void> _resetLocal() async {
    await TokenStore.instance.clear();
    user = null;
    profile = null;
    status = AuthStatus.loggedOut;
    notifyListeners();
  }
}
