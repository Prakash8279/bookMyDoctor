import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'contact_support_screen.dart';
import 'delete_account_screen.dart';

/// COMPLETENESS FIX (audit Priority 3 #8 — mobile parity): maps a picked image's extension to
/// one of the exact mimetypes services/fileUploadService.js's IMAGE_MIME_EXTENSIONS allowlist
/// accepts — image_picker doesn't expose a reliable cross-platform mimetype itself, but it always
/// saves through one of these three encoders, so the extension is a safe proxy. Falls back to
/// jpeg (image_picker's most common camera output) rather than sending something the multer
/// fileFilter would 400 on outright.
String _imageMimeType(String path) {
  final ext = path.toLowerCase().split('.').last;
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

/// Shared across all 4 roles. Which fields are editable follows
/// integration_plan.md §1.2 PATCH /me exactly: base fields for everyone,
/// patient-only fields, doctor-only fields (note: onlineBooking/
/// allowRebooking/maxDaysAdvance are NOT editable here — those go through
/// PATCH /doctors/:id, a separate "booking settings" concern owned by the
/// doctor portal, not this shared screen), receptionist/admin have no
/// profile-editable fields beyond the base ones.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  // me.validation.js only enforces `isString` + a max length for gender (30) and
  // bloodGroup (10) — there is no backend enum. These are just the curated options
  // this form offers; a profile whose value doesn't appear here (set via another
  // client, or historical data) must still be shown, so it's appended dynamically
  // in _dropdownItems below rather than silently dropped or crashing the dropdown.
  static const _genderOptions = <String, String>{
    'male': 'Male',
    'female': 'Female',
    'other': 'Other',
  };
  static const _bloodGroupOptions = <String, String>{
    'A+': 'A+',
    'A-': 'A-',
    'B+': 'B+',
    'B-': 'B-',
    'AB+': 'AB+',
    'AB-': 'AB-',
    'O+': 'O+',
    'O-': 'O-',
  };

  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _cityController = TextEditingController();

  // Patient fields
  final _addressController = TextEditingController();
  final _emergencyContactController = TextEditingController();
  final _medicalHistoryController = TextEditingController();
  final _aboutController = TextEditingController();
  // COMPLETENESS FIX (mobile parity — web's PortalProfile has a "Date of birth" field for
  // patients (PATCH /me's dateOfBirth, patient-only per me.service.js's PROFILE_EDITABLE_FIELDS)
  // that this shared screen was missing entirely.
  DateTime? _dateOfBirth;
  String? _gender;
  String? _bloodGroup;

  // Doctor fields
  final _qualificationController = TextEditingController();
  final _bioController = TextEditingController();
  final _feeController = TextEditingController();
  final _emergencyFeeController = TextEditingController();
  final _languagesController = TextEditingController();
  // COMPLETENESS FIX (mobile parity — web's DoctorProfileEdit had these but this shared screen
  // didn't): registration number, years of experience, specialization, minimum booking amount,
  // and the emergency-availability toggle. See PATCH /me's field list in me.validation.js — all
  // of these are real, already-accepted fields; only the mobile form was missing them.
  final _registrationNumberController = TextEditingController();
  final _experienceController = TextEditingController();
  final _minBookingAmountController = TextEditingController();
  String? _specializationId;
  bool _emergencyAvailable = false;
  List<Specialization> _specializations = [];

  bool _initialized = false;
  bool _saving = false;
  String? _error;
  bool _uploadingPhoto = false;
  bool _uploadingDocument = false;

  void _initFromAuth(AuthProvider auth) {
    if (_initialized) return;
    _initialized = true;
    final user = auth.user;
    final profile = auth.profile;
    _nameController.text = user?.name ?? '';
    _phoneController.text = user?.phone ?? '';
    _cityController.text = user?.city ?? '';
    _addressController.text = profile?.address ?? '';
    _emergencyContactController.text = profile?.emergencyContact ?? '';
    _medicalHistoryController.text = profile?.medicalHistory ?? '';
    _aboutController.text = profile?.about ?? '';
    _dateOfBirth = profile?.dateOfBirth != null ? DateTime.tryParse(profile!.dateOfBirth!) : null;
    _gender = profile?.gender;
    _bloodGroup = profile?.bloodGroup;
    _qualificationController.text = profile?.qualification ?? '';
    _bioController.text = profile?.bio ?? '';
    _feeController.text = profile?.consultationFee?.toStringAsFixed(0) ?? '';
    _emergencyFeeController.text = profile?.emergencyFee?.toStringAsFixed(0) ?? '';
    _languagesController.text = profile?.languages?.join(', ') ?? '';
    _registrationNumberController.text = profile?.registrationNumber ?? '';
    _experienceController.text = profile?.experienceYears?.toString() ?? '';
    _minBookingAmountController.text = profile?.minBookingAdvanceAmount?.toStringAsFixed(0) ?? '';
    _specializationId = profile?.specializationId;
    _emergencyAvailable = profile?.emergencyAvailable ?? false;
    if (user?.role == 'doctor') _loadSpecializations();
  }

  Future<void> _pickDateOfBirth() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateOfBirth ?? DateTime(now.year - 30),
      firstDate: DateTime(1900),
      lastDate: now,
    );
    if (picked != null) setState(() => _dateOfBirth = picked);
  }

  Future<void> _loadSpecializations() async {
    try {
      final res = await ApiClient.instance.get('/geography/specializations', query: {'pageSize': 100});
      final list = <Specialization>[];
      for (final item in res.list) {
        try { list.add(Specialization.fromJson(item)); } catch (_) {}
      }
      if (mounted) setState(() => _specializations = list);
    } catch (_) {
      // Non-fatal — the dropdown just won't have options if this fails; the rest of the form
      // (and saving it) still works.
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _cityController.dispose();
    _addressController.dispose();
    _emergencyContactController.dispose();
    _medicalHistoryController.dispose();
    _aboutController.dispose();
    _qualificationController.dispose();
    _bioController.dispose();
    _feeController.dispose();
    _emergencyFeeController.dispose();
    _languagesController.dispose();
    _registrationNumberController.dispose();
    _experienceController.dispose();
    _minBookingAmountController.dispose();
    super.dispose();
  }

  /// Builds dropdown items from [options], appending [current] as an extra item when it's
  /// non-null but not one of the known options — otherwise a stored value the backend
  /// accepted but this curated list doesn't know about would crash the dropdown.
  List<DropdownMenuItem<String>> _dropdownItems(Map<String, String> options, String? current) {
    return [
      for (final entry in options.entries) DropdownMenuItem(value: entry.key, child: Text(entry.value)),
      if (current != null && !options.containsKey(current)) DropdownMenuItem(value: current, child: Text(current)),
    ];
  }

  /// Rejects non-numeric/negative fee input instead of silently sending null to the server.
  String? _validateFee(String? value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return null;
    final parsed = num.tryParse(text);
    if (parsed == null || parsed < 0) return 'Enter a valid fee amount';
    return null;
  }

  Future<void> _save(AuthProvider auth) async {
    if (_formKey.currentState?.validate() == false) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    final role = auth.role;
    final body = <String, dynamic>{
      'name': _nameController.text.trim(),
      'phone': _phoneController.text.trim(),
      'city': _cityController.text.trim(),
    };
    if (role == 'patient') {
      body.addAll({
        if (_dateOfBirth != null) 'dateOfBirth': DateFormat('yyyy-MM-dd').format(_dateOfBirth!),
        if (_gender != null) 'gender': _gender,
        if (_bloodGroup != null) 'bloodGroup': _bloodGroup,
        'emergencyContact': _emergencyContactController.text.trim(),
        'address': _addressController.text.trim(),
        'medicalHistory': _medicalHistoryController.text.trim(),
        'about': _aboutController.text.trim(),
      });
    } else if (role == 'doctor') {
      body.addAll({
        'qualification': _qualificationController.text.trim(),
        'bio': _bioController.text.trim(),
        if (_feeController.text.trim().isNotEmpty) 'consultationFee': num.tryParse(_feeController.text.trim()),
        if (_emergencyFeeController.text.trim().isNotEmpty)
          'emergencyFee': num.tryParse(_emergencyFeeController.text.trim()),
        'languages': _languagesController.text.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
        if (_specializationId != null) 'specializationId': _specializationId,
        'registrationNumber': _registrationNumberController.text.trim(),
        if (_experienceController.text.trim().isNotEmpty)
          'experienceYears': int.tryParse(_experienceController.text.trim()),
        // Empty clears it (offers no minimum-pay option) — mirrors the web form's placeholder
        // "No minimum-pay option" behavior exactly.
        'minBookingAdvanceAmount':
            _minBookingAmountController.text.trim().isEmpty ? null : num.tryParse(_minBookingAmountController.text.trim()),
        'emergencyAvailable': _emergencyAvailable,
      });
    }
    try {
      await ApiClient.instance.patch('/me', body: body);
      await auth.refreshProfile();
      if (mounted) showSuccessSnack(context, 'Profile updated');
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// COMPLETENESS FIX (audit Priority 3 #8 — mobile parity): POST /media/photo (multipart,
  /// field 'file') — any authenticated role, always writes to the caller's own `users.photo_url`
  /// (uploads.service.js#savePhoto). Mirrors web's `uploadPhoto` store action (useAppStore.js).
  Future<void> _pickAndUploadPhoto(AuthProvider auth) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take a photo'), onTap: () => Navigator.of(context).pop(ImageSource.camera)),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose from gallery'), onTap: () => Navigator.of(context).pop(ImageSource.gallery)),
          ],
        ),
      ),
    );
    if (source == null) return;
    final picked = await ImagePicker().pickImage(source: source, maxWidth: 1600, imageQuality: 85);
    if (picked == null || !mounted) return;
    setState(() => _uploadingPhoto = true);
    try {
      await ApiClient.instance.uploadFile('/media/photo', filePath: picked.path, mimeType: _imageMimeType(picked.path));
      await auth.refreshProfile();
      if (mounted) showSuccessSnack(context, 'Photo updated');
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  /// COMPLETENESS FIX (audit Priority 3 #8 — mobile parity): POST /media/document — doctor-only,
  /// appends to the caller's own doctor_profiles.verification_documents (mobile has no client for
  /// this at all today, unlike photo which at least existed conceptually on web). Image-only from
  /// mobile (camera/gallery) — the backend also accepts a PDF, but that needs a general file
  /// picker package this app doesn't otherwise need; photographing a certificate covers the
  /// common case and keeps this feature to the one new dependency (image_picker) already added.
  Future<void> _pickAndUploadDocument(AuthProvider auth) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Photograph a document'), onTap: () => Navigator.of(context).pop(ImageSource.camera)),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose from gallery'), onTap: () => Navigator.of(context).pop(ImageSource.gallery)),
          ],
        ),
      ),
    );
    if (source == null) return;
    final picked = await ImagePicker().pickImage(source: source, maxWidth: 2000, imageQuality: 90);
    if (picked == null || !mounted) return;
    final name = await showDialog<String>(
      context: context,
      builder: (_) {
        final ctrl = TextEditingController();
        return AlertDialog(
          title: const Text('Document name'),
          content: TextField(controller: ctrl, decoration: const InputDecoration(labelText: 'e.g. Registration certificate', hintText: 'Optional')),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(''), child: const Text('Skip')),
            TextButton(onPressed: () => Navigator.of(context).pop(ctrl.text.trim()), child: const Text('Upload')),
          ],
        );
      },
    );
    if (name == null || !mounted) return;
    setState(() => _uploadingDocument = true);
    try {
      await ApiClient.instance.uploadFile(
        '/media/document',
        filePath: picked.path,
        mimeType: _imageMimeType(picked.path),
        extraFields: name.isNotEmpty ? {'name': name} : null,
      );
      await auth.refreshProfile();
      if (mounted) showSuccessSnack(context, 'Document uploaded');
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _uploadingDocument = false);
    }
  }

  Future<void> _openChangePassword() async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _ChangePasswordForm(),
    );
    if (done == true && mounted) {
      // Per integration_plan.md §1.2: a successful password change revokes
      // ALL refresh tokens including the current session — force logout.
      await context.read<AuthProvider>().logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    _initFromAuth(auth);
    final role = auth.role;

    return Scaffold(
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.md),
          children: [
            // Website splits this by role: patient/receptionist/admin/superadmin land on
            // PortalProfile ("My profile" / "Manage personal, contact, and account security
            // information." — PortalSectionPages.jsx), but doctor has its own DoctorProfileEdit
            // page instead, with a different subtitle describing what it actually edits
            // (StaffPages.jsx: "My profile" / "Update qualifications, expertise, fees, photo,
            // and biography.").
            PageHeader(
              title: 'My profile',
              subtitle: role == 'doctor'
                  ? 'Update qualifications, expertise, fees, photo, and biography.'
                  : 'Manage personal, contact, and account security information.',
            ),
            if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
            // COMPLETENESS FIX (audit Priority 3 #8 — mobile parity): see _pickAndUploadPhoto —
            // POST /media/photo had no mobile client at all before this.
            Center(
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  CircleAvatar(
                    radius: 44,
                    backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                    backgroundImage: auth.user?.photoUrl != null ? CachedNetworkImageProvider(auth.user!.photoUrl!) : null,
                    // Website's PortalProfile/DoctorProfileEdit fall back to the user's own
                    // initials (up to 2 letters) rather than a generic person icon.
                    child: auth.user?.photoUrl == null
                        ? Text(
                            (auth.user?.name ?? '').trim().isEmpty
                                ? 'U'
                                : (auth.user!.name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).take(2).map((p) => p[0].toUpperCase()).join()),
                            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.primary),
                          )
                        : null,
                  ),
                  Positioned(
                    right: -4,
                    bottom: -4,
                    child: Material(
                      color: AppColors.primary,
                      shape: const CircleBorder(),
                      child: InkWell(
                        customBorder: const CircleBorder(),
                        onTap: _uploadingPhoto ? null : () => _pickAndUploadPhoto(auth),
                        child: Padding(
                          padding: const EdgeInsets.all(6),
                          child: _uploadingPhoto
                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.camera_alt_outlined, size: 16, color: Colors.white),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            // Website's PortalProfile titles this card "Account information" for a patient and
            // "Profile details" for every other role (PortalSectionPages.jsx#PortalProfile).
            SectionCard(
              title: role == 'patient' ? 'Account information' : 'Profile details',
              child: Column(
                children: [
                  TextField(controller: _nameController, decoration: const InputDecoration(labelText: 'Name')),
                  const SizedBox(height: AppSpacing.md),
                  Text(auth.user?.email ?? '', style: const TextStyle(color: AppColors.textSecondary)),
                  const SizedBox(height: AppSpacing.md),
                  TextField(controller: _phoneController, decoration: const InputDecoration(labelText: 'Phone')),
                  const SizedBox(height: AppSpacing.md),
                  TextField(controller: _cityController, decoration: const InputDecoration(labelText: 'City')),
                ],
              ),
            ),
            if (role == 'patient') ...[
              const SizedBox(height: AppSpacing.md),
              SectionCard(
                title: 'Health profile',
                child: Column(
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        onPressed: _pickDateOfBirth,
                        icon: const Icon(Icons.cake_outlined, size: 18),
                        label: Text(_dateOfBirth == null ? 'Date of birth' : DateFormat('dd MMM yyyy').format(_dateOfBirth!)),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    DropdownButtonFormField<String>(
                      initialValue: _gender,
                      decoration: const InputDecoration(labelText: 'Gender'),
                      items: _dropdownItems(_genderOptions, _gender),
                      onChanged: (v) => setState(() => _gender = v),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    DropdownButtonFormField<String>(
                      initialValue: _bloodGroup,
                      decoration: const InputDecoration(labelText: 'Blood group'),
                      items: _dropdownItems(_bloodGroupOptions, _bloodGroup),
                      onChanged: (v) => setState(() => _bloodGroup = v),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextField(controller: _emergencyContactController, decoration: const InputDecoration(labelText: 'Emergency contact')),
                    const SizedBox(height: AppSpacing.md),
                    TextField(controller: _addressController, decoration: const InputDecoration(labelText: 'Address'), maxLines: 2),
                    const SizedBox(height: AppSpacing.md),
                    TextField(
                      controller: _medicalHistoryController,
                      decoration: const InputDecoration(labelText: 'Medical history'),
                      maxLines: 3,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextField(controller: _aboutController, decoration: const InputDecoration(labelText: 'About'), maxLines: 2),
                  ],
                ),
              ),
            ],
            if (role == 'doctor') ...[
              const SizedBox(height: AppSpacing.md),
              SectionCard(
                title: 'Professional details',
                child: Column(
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: _specializationId,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'Specialization'),
                      items: [
                        for (final s in _specializations) DropdownMenuItem(value: s.id, child: Text(s.name)),
                        // A specialization already set (via another client) but not in the
                        // fetched list yet must still show — never silently drop it.
                        if (_specializationId != null && _specializations.every((s) => s.id != _specializationId))
                          DropdownMenuItem(value: _specializationId, child: Text(auth.profile?.specialization?['name'] as String? ?? 'Current')),
                      ],
                      onChanged: (v) => setState(() => _specializationId = v),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextField(controller: _qualificationController, decoration: const InputDecoration(labelText: 'Qualification')),
                    const SizedBox(height: AppSpacing.md),
                    TextField(controller: _registrationNumberController, decoration: const InputDecoration(labelText: 'Registration number')),
                    const SizedBox(height: AppSpacing.md),
                    TextField(
                      controller: _experienceController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Experience (years)'),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _feeController,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(labelText: 'Consultation fee (₹)'),
                            validator: _validateFee,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: TextFormField(
                            controller: _emergencyFeeController,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(labelText: 'Emergency fee (₹)'),
                            validator: _validateFee,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextFormField(
                      controller: _minBookingAmountController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Minimum booking amount (₹, optional)',
                        helperText: 'Let patients pay just this much online; the rest is collected at the clinic. Leave blank for full payment only.',
                        helperMaxLines: 3,
                      ),
                      validator: _validateFee,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextField(
                      controller: _languagesController,
                      decoration: const InputDecoration(labelText: 'Languages (comma separated)'),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextField(controller: _bioController, decoration: const InputDecoration(labelText: 'Bio'), maxLines: 3),
                    const SizedBox(height: AppSpacing.md),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Available for emergency care'),
                      value: _emergencyAvailable,
                      onChanged: (v) => setState(() => _emergencyAvailable = v),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              // COMPLETENESS FIX (audit Priority 3 #8 — mobile parity): see
              // _pickAndUploadDocument — POST /media/document had no mobile client at all.
              SectionCard(
                title: 'Verification documents',
                trailing: TextButton.icon(
                  onPressed: _uploadingDocument ? null : () => _pickAndUploadDocument(auth),
                  icon: _uploadingDocument
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.upload_file_outlined, size: 16),
                  label: const Text('Upload'),
                ),
                child: (auth.profile?.verificationDocuments ?? const <VerificationDocument>[]).isEmpty
                    ? const Text('No documents uploaded yet', style: TextStyle(color: AppColors.textSecondary, fontSize: 13))
                    : Column(
                        children: auth.profile!.verificationDocuments
                            .map((doc) => ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: const Icon(Icons.description_outlined, color: AppColors.textSecondary),
                                  title: Text(doc.name, style: const TextStyle(fontSize: 13)),
                                  subtitle: doc.uploadedAt != null ? Text(doc.uploadedAt!, style: const TextStyle(fontSize: 11)) : null,
                                ))
                            .toList(),
                      ),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            PrimaryButton(label: 'Save changes', onPressed: () => _save(auth), loading: _saving),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton(onPressed: _openChangePassword, child: const Text('Change password')),
            const SizedBox(height: AppSpacing.md),
            // COMPLETENESS FIX (audit Priority 3 #7 — mobile parity): see contact_support_screen.dart
            // and delete_account_screen.dart — mobile previously had no way to submit a contact
            // request or an account-deletion request from any role.
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ContactSupportScreen())),
              icon: const Icon(Icons.support_agent_outlined, size: 18),
              label: const Text('Contact support'),
            ),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger, side: const BorderSide(color: AppColors.danger)),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const DeleteAccountScreen())),
              icon: const Icon(Icons.delete_forever_outlined, size: 18),
              label: const Text('Delete my account'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChangePasswordForm extends StatefulWidget {
  const _ChangePasswordForm();

  @override
  State<_ChangePasswordForm> createState() => _ChangePasswordFormState();
}

class _ChangePasswordFormState extends State<_ChangePasswordForm> {
  final _currentController = TextEditingController();
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_newController.text != _confirmController.text) {
      setState(() => _error = 'New password and confirmation do not match');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.patch('/me/password', body: {
        'currentPassword': _currentController.text,
        'newPassword': _newController.text,
        'confirmPassword': _confirmController.text,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _submitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Change password', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: AppSpacing.sm),
          const Text(
            'Changing your password signs you out of this device — you will need to log in again.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          TextField(
            controller: _currentController,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Current password'),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _newController, obscureText: true, decoration: const InputDecoration(labelText: 'New password')),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _confirmController,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Confirm new password'),
          ),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Change password', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}
