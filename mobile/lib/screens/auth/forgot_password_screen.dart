import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../routing/app_router.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (audit Priority 3 #2 — mobile parity): there was no forgot/reset password
/// screen anywhere on mobile, for any role — a mobile-only user who forgot their password was
/// locked out with no self-service recovery, even though the backend
/// (POST /auth/forgot-password / POST /auth/reset-password) and the web app both already support
/// it. This mirrors web's PublicPages.jsx#ForgotPassword: same generic "if an account exists…"
/// copy, since the backend deliberately always responds 200 regardless of whether the email
/// belongs to a real account (enumeration avoidance — see auth.service.js#forgotPassword).
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  bool _submitting = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/auth/forgot-password', body: {
        'email': _emailController.text.trim(),
      });
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _sent = true;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = err is ApiException ? err.message : 'Could not send the reset link. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset your password')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.lock_reset_rounded, color: AppColors.primary, size: 48),
                  const SizedBox(height: AppSpacing.md),
                  const Text(
                    'We will email you a secure link to choose a new password.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  if (_sent) ...[
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.success.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AppColors.success.withOpacity(0.3)),
                      ),
                      child: Text(
                        'If an account exists for ${_emailController.text.trim()}, reset instructions have been sent. Check your inbox for the reset link and reset code.',
                        style: const TextStyle(color: AppColors.success),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    PrimaryButton(
                      label: 'I have a reset code',
                      onPressed: () => Navigator.of(context).pushNamed(Routes.resetPassword),
                    ),
                  ] else
                    Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (_error != null) ...[
                            ErrorBanner(error: _error!),
                            const SizedBox(height: AppSpacing.md),
                          ],
                          TextFormField(
                            controller: _emailController,
                            keyboardType: TextInputType.emailAddress,
                            decoration: const InputDecoration(labelText: 'Account email', hintText: 'you@example.com'),
                            validator: (v) => (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          PrimaryButton(label: 'Send reset link', onPressed: _submit, loading: _submitting),
                        ],
                      ),
                    ),
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
    );
  }
}
