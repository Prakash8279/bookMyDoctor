import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../routing/app_router.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Email-only password recovery, paired with [ForgotPasswordScreen]. The same six-digit OTP
/// contract is used by web and mobile; no SMS or phone verification is involved.
class ResetPasswordScreen extends StatefulWidget {
  final String initialEmail;

  const ResetPasswordScreen({super.key, this.initialEmail = ''});

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _emailController;
  final _otpController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _obscure = true;
  bool _submitting = false;
  bool _done = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _emailController = TextEditingController(text: widget.initialEmail);
  }

  @override
  void dispose() {
    _emailController.dispose();
    _otpController.dispose();
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
        'email': _emailController.text.trim(),
        'emailOtp': _otpController.text.trim(),
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
                            'Enter the 6-digit code from your email, then choose a new password.',
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
                            decoration: const InputDecoration(labelText: 'Account email'),
                            validator: (v) => (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
                          ),
                          const SizedBox(height: AppSpacing.md),
                          TextFormField(
                            controller: _otpController,
                            keyboardType: TextInputType.number,
                            autofillHints: const [AutofillHints.oneTimeCode],
                            maxLength: 6,
                            decoration: const InputDecoration(labelText: '6-digit reset code', counterText: ''),
                            validator: (v) => RegExp(r'^\d{6}$').hasMatch(v?.trim() ?? '')
                                ? null
                                : 'Enter the 6-digit code from your email',
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
