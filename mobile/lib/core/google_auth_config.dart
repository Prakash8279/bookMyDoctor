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
/// sign-in works on a real device — Android's Google Sign-In matches by your app's package name
/// (applicationId) + your debug/release keystore's SHA-1 fingerprint, and its value is never
/// referenced directly anywhere in this app's Dart code (Google's Play Services layer looks it
/// up itself using those two things). BUT: this repo has no android/ folder yet (no `flutter
/// create .` has been run here in an environment with the Flutter SDK — see mobile/README.md's
/// Prerequisites section), so that Android registration step can only happen once that exists.
/// Until then, this whole feature can compile but cannot actually complete a sign-in on a device
/// or emulator.
class GoogleAuthConfig {
  static const String webClientId = 'REPLACE_WITH_YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

  static bool get isConfigured => !webClientId.startsWith('REPLACE_WITH_');
}
