/// GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix kro") — configuration
/// for "Continue with Google" on screens/auth/login_screen.dart and register_screen.dart.
///
/// [webClientId] must be the exact SAME "Web application" OAuth Client ID the backend verifies
/// against (server/server/.env's GOOGLE_CLIENT_ID) and the website uses (client/.env's
/// VITE_GOOGLE_CLIENT_ID) — see server/server/.env.example's comment for the full step-by-step
/// to create one. It is passed to `GoogleSignIn(serverClientId: ...)` (see auth_provider.dart)
/// so the idToken it returns has an audience our own backend can actually verify — WITHOUT this,
/// `GoogleSignIn` still lets someone pick an account, but the idToken it returns would be null.
/// This value is a public identifier, not a secret — it's fine that it ships inside the app.
///
/// A SEPARATE "Android" OAuth Client ID must also exist in the same Google Cloud project before
/// sign-in works on a real device — Android's Google Sign-In matches by this app's package name
/// (`com.bookmydoctor24.app`) plus the debug/release signing certificate's SHA-1 fingerprint.
/// That client ID is not referenced in Dart: Google Play services resolves it from the installed
/// app's package and certificate. Configure both debug and release SHA-1 values in Google Cloud
/// before testing or publishing Google sign-in.
class GoogleAuthConfig {
  // Allows a client-ID rotation or a staging OAuth project without changing source code. The
  // default is intentionally the verified production Web client ID, so normal builds remain
  // zero-config. This is a public identifier, not an OAuth secret.
  static const String webClientId = String.fromEnvironment(
    'GOOGLE_WEB_CLIENT_ID',
    defaultValue: '855429506806-s2rgkfeae3k9j14gjbgcg07sni4lrvgi.apps.googleusercontent.com',
  );

  static bool get isConfigured {
    final clientId = webClientId.trim();
    return clientId.isNotEmpty && !clientId.startsWith('REPLACE_WITH_');
  }
}
