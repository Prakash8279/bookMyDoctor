import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:provider/provider.dart';

import '../../core/google_auth_config.dart';
import '../../routing/app_router.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../guest/guest_home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscure = true;
  bool _submitting = false;
  // GOOGLE SIGN-IN FEATURE — separate loading flag from `_submitting` (the email/password form's
  // own submit state) so the two buttons never show each other's spinner.
  bool _googleSubmitting = false;
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  /// GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix kro"). Opens the
  /// native Google account picker, then hands the resulting ID token to
  /// AuthProvider.loginWithGoogle (POST /auth/google — same backend endpoint covers login,
  /// first-time account-linking, and self-registration together). `serverClientId` MUST be set
  /// (see GoogleAuthConfig's own doc comment) or Google never returns an idToken our backend can
  /// verify — checked up front here so that misconfiguration shows a clear message instead of a
  /// confusing null-idToken failure after the picker closes.
  Future<void> _handleGoogleSignIn() async {
    if (!GoogleAuthConfig.isConfigured) {
      setState(() => _error = 'Google sign-in is not configured for this app yet.');
      return;
    }
    setState(() {
      _googleSubmitting = true;
      _error = null;
    });
    try {
      final googleSignIn = GoogleSignIn(serverClientId: GoogleAuthConfig.webClientId);
      final account = await googleSignIn.signIn();
      if (account == null) {
        // User closed the picker without choosing an account — not an error worth showing.
        setState(() => _googleSubmitting = false);
        return;
      }
      final googleAuth = await account.authentication;
      final idToken = googleAuth.idToken;
      if (idToken == null) {
        throw Exception('Google did not return a usable sign-in token. Please try again.');
      }
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      final ok = await auth.loginWithGoogle(idToken);
      if (!mounted) return;
      setState(() => _googleSubmitting = false);
      if (!ok) {
        setState(() => _error = auth.lastError ?? 'Google sign-in failed. Please try again.');
      } else if (Navigator.of(context).canPop()) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _googleSubmitting = false;
        _error = 'Google sign-in failed: $err';
      });
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    final auth = context.read<AuthProvider>();
    final ok = await auth.login(_emailController.text.trim(), _passwordController.text);
    if (!mounted) return;
    setState(() => _submitting = false);
    if (!ok) {
      setState(() => _error = auth.lastError ?? 'Login failed. Please try again.');
    } else {
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // COMPLETENESS FIX (brand consistency): the actual brand mark — same image as
                    // the web favicon/sidebar and this app's own launcher icon — instead of a
                    // generic placeholder icon. See splash_screen.dart's doc comment.
                    const Image(image: AssetImage('assets/branding/app_icon.png'), width: 64, height: 64),
                    const SizedBox(height: AppSpacing.md),
                    const Text(
                      'Welcome back',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    const Text(
                      'Sign in to manage appointments, queues, and health records.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    if (_error != null) ...[
                      ErrorBanner(error: _error!),
                      const SizedBox(height: AppSpacing.md),
                    ],
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(labelText: 'Email address', hintText: 'you@example.com'),
                      validator: (v) => (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: _obscure,
                      decoration: InputDecoration(
                        labelText: 'Password',
                        suffixIcon: IconButton(
                          icon: Icon(_obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    PrimaryButton(label: 'Sign in', onPressed: _submit, loading: _submitting),
                    const SizedBox(height: AppSpacing.sm),
                    const Row(children: [
                      Expanded(child: Divider()),
                      Padding(padding: EdgeInsets.symmetric(horizontal: AppSpacing.sm), child: Text('or', style: TextStyle(color: AppColors.textSecondary))),
                      Expanded(child: Divider()),
                    ]),
                    const SizedBox(height: AppSpacing.sm),
                    // GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix
                    // kro") — mirrors the web app's "Continue with Google" button
                    // (client/src/pages/PublicPages.jsx#Login).
                    OutlinedButton.icon(
                      onPressed: _googleSubmitting ? null : _handleGoogleSignIn,
                      icon: _googleSubmitting
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('G', style: TextStyle(fontWeight: FontWeight.w800)),
                      label: Text(_googleSubmitting ? 'Signing in…' : 'Continue with Google'),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Center(
                      child: TextButton(
                        onPressed: () => Navigator.of(context).pushNamed(Routes.forgotPassword),
                        child: const Text('Forgot password?'),
                      ),
                    ),
                    Center(
                      child: TextButton(
                        onPressed: () => Navigator.of(context).pushNamed(Routes.register),
                        child: const Text('New to BookMyDoctors? Create an account'),
                      ),
                    ),
                    // COMPLETENESS FIX (mobile parity): the web app has a whole public/signed-out
                    // surface (home landing, /search, /clinics, /doctors/:id, /emergency) — a
                    // signed-out mobile user previously had no way to look around at all before
                    // creating an account. See guest_home_screen.dart's doc comment.
                    //
                    // ROUTING FIX: GuestHomeScreen is now the app's default signed-out screen (see
                    // app_router.dart), so this screen is normally REACHED from there via its "Log
                    // in" button/link — in that case the right "browse without logging in" action
                    // is simply going back (pop), not pushing a second GuestHomeScreen on top of
                    // the first. Falls back to pushing one only if there's nothing to pop to (e.g.
                    // Login was opened directly, such as via the /login named route).
                    const SizedBox(height: AppSpacing.sm),
                    Center(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).canPop()
                            ? Navigator.of(context).pop()
                            : Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const GuestHomeScreen())),
                        child: const Text('Browse without logging in'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
