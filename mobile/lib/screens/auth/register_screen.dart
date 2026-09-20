import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/google_auth_config.dart';
import '../../core/token_store.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Patient OR doctor self-registration, mirroring the website's Register page
/// (client/src/pages/PublicPages.jsx#Register): an "I'm a patient" / "I'm a
/// doctor" account-type toggle up top, common fields shared by both, and a
/// doctor-only field set (specialization/qualification/registration
/// number/experience/consultation fee) shown only for the doctor path.
///
/// Patient path posts to POST /auth/register via [AuthProvider.register]
/// (instant, active account). Doctor path posts directly to POST
/// /doctors/register (see doctors.controller.js#registerDoctor) — the
/// backend hard-codes doctorProfile.status:'pending' regardless of what's
/// sent, so a self-registered doctor lands in the same admin-verification
/// queue as an admin-created one and is invisible to patient search/booking
/// until approved, even though (like the patient path) the account can sign
/// in right away. [AuthProvider] has no doctor-registration method of its
/// own, so this screen saves the returned tokens via [TokenStore] directly
/// and calls [AuthProvider.bootstrap] to pick up the new session — the same
/// tokens-then-/me sequence [AuthProvider.register] performs internally.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _cityController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  // Doctor-only fields (client/src/pages/PublicPages.jsx#Register's `doctorForm`) —
  // only read/validated when _accountType == 'doctor'.
  final _qualificationController = TextEditingController();
  final _registrationNumberController = TextEditingController();
  final _experienceYearsController = TextEditingController();
  final _consultationFeeController = TextEditingController();
  String? _specializationId;
  List<Specialization> _specializations = [];
  bool _loadingSpecializations = false;

  String _accountType = 'patient';
  bool _obscure = true;
  bool _submitting = false;
  // GOOGLE SIGN-IN FEATURE — separate loading flag, same reasoning as login_screen.dart.
  bool _googleSubmitting = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _cityController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    _qualificationController.dispose();
    _registrationNumberController.dispose();
    _experienceYearsController.dispose();
    _consultationFeeController.dispose();
    super.dispose();
  }

  // Same data source/call shape as guest_home_screen.dart's specialization
  // dropdown (GET /geography/specializations) — fetched lazily, once, the
  // first time the doctor tab is opened.
  Future<void> _loadSpecializations() async {
    if (_loadingSpecializations || _specializations.isNotEmpty) return;
    setState(() => _loadingSpecializations = true);
    try {
      final res = await ApiClient.instance.get('/geography/specializations', query: {'pageSize': 100});
      final items = <Specialization>[];
      for (final item in res.list) {
        try {
          items.add(Specialization.fromJson(item));
        } catch (_) {}
      }
      if (!mounted) return;
      setState(() => _specializations = items);
    } catch (_) {
      // Left empty on failure — the dropdown's own validator still requires a
      // selection, so the user simply can't submit until this succeeds (they
      // can retry by leaving and re-entering the doctor tab).
    } finally {
      if (mounted) setState(() => _loadingSpecializations = false);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    // Website's Register form has a "Confirm password" field and blocks submission client-side
    // when it doesn't match (client/src/pages/PublicPages.jsx#Register: "Passwords do not
    // match.") — mobile had no confirm field at all, so a typo in the password was only caught
    // after the account was created with an unintended password.
    if (_passwordController.text != _confirmController.text) {
      setState(() => _error = 'Passwords do not match.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    final ok = _accountType == 'doctor' ? await _submitDoctor() : await _submitPatient();
    if (!mounted) return;
    setState(() => _submitting = false);
    if (!ok) {
      setState(() => _error ??= 'Registration failed. Please try again.');
    }
  }

  Future<bool> _submitPatient() async {
    final auth = context.read<AuthProvider>();
    final ok = await auth.register(
      name: _nameController.text.trim(),
      email: _emailController.text.trim(),
      password: _passwordController.text,
      phone: _phoneController.text.trim().isEmpty ? null : _phoneController.text.trim(),
      city: _cityController.text.trim().isEmpty ? null : _cityController.text.trim(),
    );
    if (!ok) _error = auth.lastError;
    return ok;
  }

  // POST /doctors/register — see doctors.validation.js#registerDoctor for the exact shape:
  // name/email/password required; phone/city/qualification/registrationNumber optional strings;
  // specializationId required UUID; experienceYears optional int 0-80; consultationFee required
  // non-negative number. verifyImmediately/verificationDocuments are admin-only fields the public
  // endpoint never reads, so they're omitted entirely here.
  Future<bool> _submitDoctor() async {
    try {
      final res = await ApiClient.instance.post('/doctors/register', body: {
        'name': _nameController.text.trim(),
        'email': _emailController.text.trim(),
        'password': _passwordController.text,
        if (_phoneController.text.trim().isNotEmpty) 'phone': _phoneController.text.trim(),
        if (_cityController.text.trim().isNotEmpty) 'city': _cityController.text.trim(),
        'specializationId': _specializationId,
        if (_qualificationController.text.trim().isNotEmpty) 'qualification': _qualificationController.text.trim(),
        if (_registrationNumberController.text.trim().isNotEmpty)
          'registrationNumber': _registrationNumberController.text.trim(),
        if (_experienceYearsController.text.trim().isNotEmpty)
          'experienceYears': int.tryParse(_experienceYearsController.text.trim()),
        'consultationFee': double.tryParse(_consultationFeeController.text.trim()) ?? 0,
      });
      final data = res.map;
      final tokens = TokenPair.fromJson(data);
      await TokenStore.instance.save(tokens);
      if (!mounted) return true;
      // AuthProvider has no doctor-specific register method — bootstrap() re-reads the tokens
      // just saved above and fetches /me, which is the same effect AuthProvider.register()
      // achieves for the patient path via its own post+save+_loadMe sequence.
      await context.read<AuthProvider>().bootstrap();
      return true;
    } catch (err) {
      _error = err.toString();
      return false;
    }
  }

  /// GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix kro") — same
  /// handler as login_screen.dart's `_handleGoogleSignIn`; kept as its own copy here (rather than
  /// a shared helper) since this screen's error/loading state and post-success navigation
  /// (there's no `Navigator.pop` — Register is a distinct route, not one you dismiss back into)
  /// already differ from Login's. Deliberately fires even from the "I'm a doctor" tab: Google
  /// sign-up always lands as a patient, same rule POST /auth/register already enforces for the
  /// email/password form (a doctor account can only ever be created via the dedicated "Submit
  /// for verification" doctor form above, never a generic sign-up shortcut).
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
        setState(() => _googleSubmitting = false);
        return;
      }
      final googleAuth = await account.authentication;
      final idToken = googleAuth.idToken;
      if (idToken == null) {
        throw Exception('Google did not return a usable sign-in token. Please try again.');
      }
      final auth = context.read<AuthProvider>();
      final ok = await auth.loginWithGoogle(idToken);
      if (!mounted) return;
      setState(() => _googleSubmitting = false);
      if (!ok) {
        setState(() => _error = auth.lastError ?? 'Google sign-in failed. Please try again.');
      }
      // On success there's nothing further to do here — AuthProvider's own status change flips
      // the app router over to the signed-in shell (same as the plain-email path's `_submit`,
      // which also never navigates explicitly).
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _googleSubmitting = false;
        _error = 'Google sign-in failed: $err';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDoctor = _accountType == 'doctor';
    return Scaffold(
      appBar: AppBar(title: const Text('Create an account')),
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
                    const Text(
                      'Join as a patient or healthcare professional.',
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(value: 'patient', label: Text("I'm a patient"), icon: Icon(Icons.person_outline)),
                        ButtonSegment(value: 'doctor', label: Text("I'm a doctor"), icon: Icon(Icons.medical_services_outlined)),
                      ],
                      selected: {_accountType},
                      onSelectionChanged: (selection) {
                        setState(() => _accountType = selection.first);
                        if (_accountType == 'doctor') _loadSpecializations();
                      },
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      isDoctor
                          ? 'Your account will be reviewed by an admin before you appear in patient search — you can sign in right away to check your status.'
                          : 'Registration creates a patient account, active immediately.',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    if (_error != null) ...[
                      ErrorBanner(error: _error!),
                      const SizedBox(height: AppSpacing.md),
                    ],
                    TextFormField(
                      controller: _nameController,
                      decoration: const InputDecoration(labelText: 'Full name'),
                      validator: (v) => (v == null || v.trim().isEmpty) ? 'Name is required' : null,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(labelText: 'Email address'),
                      validator: (v) => (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Phone (optional)'),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _cityController,
                      decoration: const InputDecoration(labelText: 'City (optional)'),
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
                      validator: (v) =>
                          (v == null || v.length < 8) ? 'Password must be at least 8 characters' : null,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _confirmController,
                      obscureText: _obscure,
                      decoration: const InputDecoration(labelText: 'Confirm password'),
                      validator: (v) => (v == null || v.length < 8) ? 'Confirm your password' : null,
                    ),
                    if (isDoctor) ...[
                      const SizedBox(height: AppSpacing.lg),
                      const Text('Professional details', style: TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: AppSpacing.md),
                      DropdownButtonFormField<String>(
                        value: _specializationId,
                        decoration: InputDecoration(
                          labelText: 'Specialization',
                          suffixIcon: _loadingSpecializations
                              ? const Padding(
                                  padding: EdgeInsets.all(12),
                                  child: SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  ),
                                )
                              : null,
                        ),
                        items: [
                          for (final s in _specializations) DropdownMenuItem(value: s.id, child: Text(s.name)),
                        ],
                        onChanged: (v) => setState(() => _specializationId = v),
                        validator: (v) => (v == null || v.isEmpty) ? 'Select a specialization' : null,
                      ),
                      const SizedBox(height: AppSpacing.md),
                      TextFormField(
                        controller: _qualificationController,
                        decoration: const InputDecoration(labelText: 'Qualification', hintText: 'e.g. MBBS, MD'),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      TextFormField(
                        controller: _registrationNumberController,
                        decoration: const InputDecoration(
                          labelText: 'Registration number',
                          hintText: 'Medical council registration no.',
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      TextFormField(
                        controller: _experienceYearsController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Years of experience', hintText: 'e.g. 5'),
                        validator: (v) {
                          if (v == null || v.trim().isEmpty) return null;
                          final n = int.tryParse(v.trim());
                          if (n == null || n < 0 || n > 80) return 'Enter a value between 0 and 80';
                          return null;
                        },
                      ),
                      const SizedBox(height: AppSpacing.md),
                      TextFormField(
                        controller: _consultationFeeController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(labelText: 'Consultation fee (₹)', hintText: 'e.g. 500'),
                        validator: (v) {
                          if (v == null || v.trim().isEmpty) return 'Consultation fee is required';
                          final n = double.tryParse(v.trim());
                          if (n == null || n < 0) return 'Enter a valid amount';
                          return null;
                        },
                      ),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    PrimaryButton(
                      label: isDoctor ? 'Submit for verification' : 'Create account',
                      onPressed: _submit,
                      loading: _submitting,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(children: const [
                      Expanded(child: Divider()),
                      Padding(padding: EdgeInsets.symmetric(horizontal: AppSpacing.sm), child: Text('or', style: TextStyle(color: AppColors.textSecondary))),
                      Expanded(child: Divider()),
                    ]),
                    const SizedBox(height: AppSpacing.sm),
                    // GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix
                    // kro") — mirrors the web app's "Continue with Google" button
                    // (client/src/pages/PublicPages.jsx#Register).
                    OutlinedButton.icon(
                      onPressed: _googleSubmitting ? null : _handleGoogleSignIn,
                      icon: _googleSubmitting
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('G', style: TextStyle(fontWeight: FontWeight.w800)),
                      label: Text(_googleSubmitting ? 'Signing in…' : 'Continue with Google'),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Center(
                      child: TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: const Text('Already have an account? Sign in'),
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
