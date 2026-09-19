import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../routing/app_router.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (audit Priority 3 #2 — mobile parity), paired with ForgotPasswordScreen. The
/// web app reads the reset token from a `?token=` query param on a link the backend emails/logs
/// (see auth.service.js#forgotPassword and PublicPages.jsx#ResetPassword) — mobile has no
/// universal-links/deep-linking set up in this pass, so the token is a field the user pastes in
/// themselves from that same link/email, same idea as a mobile OTP-entry screen.
class ResetPasswordScreen extends StatefulWidget {
  const ResetPasswordScreen({super.key});

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _tokenController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _obscure = true;
  bool _submitting = false;
  bool _done = false;
  String? _error;

  @override
  void dispose() {
    _tokenController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/auth/reset-password', body: {
        'token': _tokenController.text.trim(),
        'newPassword': _passwordController.text,
      });
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _done = true;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = err is ApiException ? err.message : 'Could not reset your password. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choose a new password')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: _done
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 48),
                        const SizedBox(height: AppSpacing.md),
                        const Text(
                          'Your password has been reset. Sign in with your new password.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppColors.textSecondary),
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        PrimaryButton(
                          label: 'Back to sign in',
                          onPressed: () => Navigator.of(context).pushNamedAndRemoveUntil(Routes.login, (route) => false),
                        ),
                      ],
                    )
                  : Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text(
                            'Paste the reset code from your email, then choose a new password.',
                            style: TextStyle(color: AppColors.textSecondary),
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          if (_error != null) ...[
                            ErrorBanner(error: _error!),
                            const SizedBox(height: AppSpacing.md),
                          ],
                          TextFormField(
                            controller: _tokenController,
                            decoration: const InputDecoration(labelText: 'Reset code'),
                            validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter the reset code from your email' : null,
                          ),
                          const SizedBox(height: AppSpacing.md),
                          TextFormField(
                            controller: _passwordController,
                            obscureText: _obscure,
                            decoration: InputDecoration(
                              labelText: 'New password',
                              suffixIcon: IconButton(
                                icon: Icon(_obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                                onPressed: () => setState(() => _obscure = !_obscure),
                              ),
                            ),
                            validator: (v) =>
                                (v == null || v.length < 8) ? 'Password must be at least 8 characters' : null,
                          ),
                          const SizedBox(height: AppSpacing.md),
                          TextFormField(
                            controller: _confirmController,
                            obscureText: _obscure,
                            decoration: const InputDecoration(labelText: 'Confirm new password'),
                            validator: (v) =>
                                (v != _passwordController.text) ? 'Passwords do not match' : null,
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          PrimaryButton(label: 'Reset password', onPressed: _submit, loading: _submitting),
                          const SizedBox(height: AppSpacing.md),
                          Center(
                            child: TextButton(
                              onPressed: () => Navigator.of(context).pushNamedAndRemoveUntil(Routes.login, (route) => false),
                              child: const Text('Return to sign in'),
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
