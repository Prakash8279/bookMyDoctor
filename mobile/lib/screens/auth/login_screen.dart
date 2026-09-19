import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

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
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
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
    }
  }

  void _fillDemo(String email, String password) {
    _emailController.text = email;
    _passwordController.text = password;
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
                    Center(
                      child: TextButton(
                        onPressed: () => Navigator.of(context).pushNamed(Routes.forgotPassword),
                        child: const Text('Forgot password?'),
                      ),
                    ),
                    Center(
                      child: TextButton(
                        onPressed: () => Navigator.of(context).pushNamed(Routes.register),
                        child: const Text('New to BookMyDoctor24? Create an account'),
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
                    // SECURITY: demo-account quick-fill chips are a real, live login shortcut —
                    // they fill in the actual seeded accounts' credentials, admin/superadmin
                    // included. Compiled out of any non-debug build (kDebugMode is a compile-time
                    // constant, so `flutter build` for release/profile strips this whole block)
                    // so a shipped/installed app never exposes one-tap admin access. Found by
                    // codebase audit — previously shown unconditionally to every user.
                    if (kDebugMode) ...[
                      const SizedBox(height: AppSpacing.lg),
                      const Divider(),
                      const SizedBox(height: AppSpacing.sm),
                      const Text('Demo accounts (debug builds only)', style: TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: AppSpacing.sm),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _DemoChip(
                            label: 'Patient',
                            onTap: () => _fillDemo('patient@connectdoctor.test', 'Patient#DC2026!Test'),
                          ),
                          _DemoChip(
                            label: 'Doctor',
                            onTap: () => _fillDemo('doctor@connectdoctor.test', 'Doctor#DC2026!Test'),
                          ),
                          _DemoChip(
                            label: 'Receptionist',
                            onTap: () => _fillDemo('receptionist@connectdoctor.test', 'Reception#DC2026!Test'),
                          ),
                          _DemoChip(
                            label: 'Admin',
                            onTap: () => _fillDemo('admin@connectdoctor.test', 'Admin#DC2026!Test'),
                          ),
                          _DemoChip(
                            label: 'Superadmin',
                            onTap: () => _fillDemo('superadmin@connectdoctor.test', 'Super#DC2026!Test'),
                          ),
                        ],
                      ),
                    ],
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

class _DemoChip extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _DemoChip({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ActionChip(label: Text(label), onPressed: onTap);
  }
}
