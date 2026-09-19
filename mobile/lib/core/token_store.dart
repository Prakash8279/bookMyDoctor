import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Holds the access/refresh token pair in the platform secure storage
/// (Android Keystore / iOS Keychain backed). Mirrors the web app's
/// `TOKEN_STORAGE_KEY` localStorage convention, but kept separate from any
/// app-data cache the same way the web client keeps tokens out of the
/// Zustand persisted blob.
class TokenPair {
  final String accessToken;
  final String refreshToken;

  const TokenPair({required this.accessToken, required this.refreshToken});

  factory TokenPair.fromJson(Map<String, dynamic> json) => TokenPair(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
      );
}

class TokenStore {
  TokenStore._internal();
  static final TokenStore instance = TokenStore._internal();

  static const _accessKey = 'connect_access_token';
  static const _refreshKey = 'connect_refresh_token';

  final _storage = const FlutterSecureStorage();

  TokenPair? _cached;

  /// Must be called once at app startup before any API call is made.
  Future<TokenPair?> load() async {
    final access = await _storage.read(key: _accessKey);
    final refresh = await _storage.read(key: _refreshKey);
    if (access != null && refresh != null) {
      _cached = TokenPair(accessToken: access, refreshToken: refresh);
    } else {
      _cached = null;
    }
    return _cached;
  }

  TokenPair? get current => _cached;

  Future<void> save(TokenPair tokens) async {
    _cached = tokens;
    await _storage.write(key: _accessKey, value: tokens.accessToken);
    await _storage.write(key: _refreshKey, value: tokens.refreshToken);
  }

  Future<void> clear() async {
    _cached = null;
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}
