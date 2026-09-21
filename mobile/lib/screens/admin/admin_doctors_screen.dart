import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Doctor onboarding + management.
///
/// An admin/superadmin caller to `GET /doctors` gets EVERY doctor back
/// regardless of `doctorProfile.status` (pending/verified/disabled) — see
/// doctors.service.js#listDoctors — so this screen fetches once and splits
/// the result client-side into a "Pending verification" section (mirroring
/// the web app's DoctorVerification component in AdminPages.jsx) and an
/// "All doctors" section below it. Verifying, disabling, and re-marking a
/// doctor pending all go through the same `PATCH /doctors/:id/status`
/// endpoint (body `{status}`), which is also how `POST /doctors`'s
/// `verifyImmediately` toggle is followed up on later.
class AdminDoctorsScreen extends StatefulWidget {
  const AdminDoctorsScreen({super.key});

  @override
  State<AdminDoctorsScreen> createState() => _AdminDoctorsScreenState();
}

class _AdminDoctorsScreenState extends State<AdminDoctorsScreen> {
  Future<List<DoctorDirectoryItem>>? _future;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<DoctorDirectoryItem>> _fetch() async {
    try {
      final res = await ApiClient.instance
          .get('/doctors', query: {'pageSize': 100, 'sortBy': 'rating', 'sortOrder': 'desc'})
          .catchError((_) => ApiResponse(data: []));
      final list = <DoctorDirectoryItem>[];
      for (final item in res.list) {
        try {
          list.add(DoctorDirectoryItem.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<void> _setStatus(DoctorDirectoryItem d, String status) async {
    // Verifying is a one-tap action (it's the whole point of the "Pending
    // verification" section — no need to make admins confirm it twice), but
    // disabling a doctor or bouncing a verified one back to pending removes
    // them from public booking immediately, so confirm before doing either.
    if (status != 'verified') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(status == 'disabled' ? 'Disable Dr. ${d.name}?' : 'Mark Dr. ${d.name} pending re-verification?'),
          content: Text(
            status == 'disabled'
                ? 'Dr. ${d.name} will be removed from the public directory and can no longer receive bookings until re-verified.'
                : 'Dr. ${d.name} will move back to "Pending verification" and be removed from the public directory until re-verified.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Continue')),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    setState(() => _busyId = d.id);
    try {
      await ApiClient.instance.patch('/doctors/${d.id}/status', body: {'status': status});
      if (mounted) showSuccessSnack(context, 'Updated');
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  // COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
  // account-level login enable/disable (users.status), a distinct action from _setStatus above
  // (doctor_profiles.status, verification lifecycle) — unlike that one, disabling login does NOT
  // remove the doctor from this list (GET /doctors's admin filter only looks at
  // doctorProfile.status, not users.status), so no "will disappear" warning is needed here.
  Future<void> _setAccountStatus(DoctorDirectoryItem d, String status) async {
    setState(() => _busyId = d.id);
    try {
      await ApiClient.instance.patch('/doctors/${d.id}/account-status', body: {'status': status});
      if (mounted) showSuccessSnack(context, status == 'disabled' ? 'Login disabled' : 'Login re-enabled');
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _openAdd() async {
    final result = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const _AddDoctorScreen()));
    if (result == true) _load();
  }

  // COMPLETENESS FIX (mobile parity audit): web's "Export CSV" action (AdminPages.jsx
  // DoctorVerification#exportCsv) had no mobile equivalent. Same header/column order/values.
  Future<void> _exportCsv(List<DoctorDirectoryItem> doctors) async {
    await shareCsv(
      filename: 'doctors.csv',
      headers: const ['Id', 'Doctor', 'Registration', 'Experience', 'Fee', 'Rating', 'Status'],
      rows: [
        for (final d in doctors)
          [
            d.id,
            d.name,
            d.registrationNumber ?? '',
            '${d.experienceYears ?? 0} years',
            d.consultationFee,
            d.rating,
            d.doctorStatus ?? '',
          ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(onPressed: _openAdd, icon: const Icon(Icons.add), label: const Text('Add doctor')),
      body: Column(
        children: [
          // Mirrors the web app's DoctorVerification `Page` header (AdminPages.jsx) —
          // same kicker + title + subtitle copy.
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              kicker: 'Production database',
              title: 'Doctor management',
              subtitle: 'Create, verify, enable, and disable doctor accounts.',
              // COMPLETENESS FIX (mobile parity audit): web's "Export CSV" action — see _exportCsv.
              action: FutureBuilder<List<DoctorDirectoryItem>>(
                future: _future,
                builder: (context, snapshot) {
                  final doctors = snapshot.data ?? const <DoctorDirectoryItem>[];
                  return TextButton.icon(
                    onPressed: doctors.isEmpty ? null : () => _exportCsv(doctors),
                    icon: const Icon(Icons.file_download_outlined, size: 16),
                    label: const Text('Export CSV'),
                  );
                },
              ),
            ),
          ),
          Container(
            width: double.infinity,
            margin: const EdgeInsets.all(AppSpacing.md),
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
            child: const Text(
              'An admin sees every doctor here, including those awaiting verification — see "Pending verification" below. New doctors are onboarded via "Add doctor" below (with an option to verify immediately).',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<DoctorDirectoryItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
                }
                final doctors = snapshot.data ?? [];
                if (doctors.isEmpty) {
                  return const EmptyStateView(icon: Icons.medical_services_outlined, title: 'No doctors yet');
                }
                // Mirrors the web app's DoctorVerification split (AdminPages.jsx) — the same
                // fetch (an admin caller gets every doctorProfile.status back in one call) is
                // partitioned client-side into a "Pending verification" queue shown first, and
                // the full "All doctors" list below it.
                final pendingDoctors = doctors.where((d) => (d.doctorStatus ?? 'verified') == 'pending').toList();
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
                    children: [
                      if (pendingDoctors.isNotEmpty) ...[
                        _SectionHeading(title: 'Pending verification', count: pendingDoctors.length),
                        const SizedBox(height: AppSpacing.sm),
                        for (int i = 0; i < pendingDoctors.length; i++) ...[
                          _buildDoctorCard(pendingDoctors[i], i),
                          const SizedBox(height: AppSpacing.sm),
                        ],
                        const SizedBox(height: AppSpacing.md),
                      ],
                      _SectionHeading(title: 'All doctors', count: doctors.length),
                      const SizedBox(height: AppSpacing.sm),
                      for (int i = 0; i < doctors.length; i++) ...[
                        _buildDoctorCard(doctors[i], i),
                        const SizedBox(height: AppSpacing.sm),
                      ],
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDoctorCard(DoctorDirectoryItem d, [int? index]) {
    final busy = _busyId == d.id;
    final accountStatus = d.accountStatus ?? 'active';
    final doctorStatus = d.doctorStatus ?? 'verified';
    final isPending = doctorStatus == 'pending';
    final seqId = index != null ? 'DCD${(index + 1).toString().padLeft(2, '0')}' : null;

    return Card(
      child: ListTile(
        title: Row(
          children: [
            if (seqId != null) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(color: AppColors.border),
                ),
                child: Text('#$seqId', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 11, color: AppColors.primaryDark)),
              ),
              const SizedBox(width: 8),
            ],
            Expanded(child: Text(d.name, style: const TextStyle(fontWeight: FontWeight.w700))),
            StatusBadge(status: doctorStatus),
          ],
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 2),
            Text(
              '${d.specialization?.name ?? "—"} · ₹${d.consultationFee.toStringAsFixed(0)} · ${d.city ?? "—"}',
              style: const TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 2),
            Text(
              [
                if (d.registrationNumber != null && d.registrationNumber!.isNotEmpty) 'Reg: ${d.registrationNumber}',
                if (d.experienceYears != null) '${d.experienceYears} yrs exp',
                if (d.rating > 0) '★ ${d.rating.toStringAsFixed(1)}',
                if (accountStatus == 'disabled') 'Login disabled',
              ].join(' · '),
              style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
            ),
          ],
        ),
        trailing: busy
            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : PopupMenuButton<String>(
                onSelected: (value) {
                  if (value == 'account_disabled' || value == 'account_active') {
                    _setAccountStatus(d, value == 'account_disabled' ? 'disabled' : 'active');
                  } else {
                    _setStatus(d, value);
                  }
                },
                itemBuilder: (context) => [
                  // Verify — the action this screen was missing entirely: an admin previously
                  // had no way to move a pending doctor to 'verified' from mobile at all.
                  if (isPending) const PopupMenuItem(value: 'verified', child: Text('Verify')),
                  const PopupMenuItem(value: 'disabled', child: Text('Disable account')),
                  const PopupMenuItem(value: 'pending', child: Text('Mark pending re-verification')),
                  const PopupMenuDivider(),
                  // COMPLETENESS FIX (audit Priority 4): account-level login
                  // enable/disable — see _setAccountStatus's doc comment.
                  PopupMenuItem(
                    value: accountStatus == 'active' ? 'account_disabled' : 'account_active',
                    child: Text(accountStatus == 'active' ? 'Disable login' : 'Enable login'),
                  ),
                ],
              ),
      ),
    );
  }
}

/// Small "Title    N record(s)" row used to head each of the two doctor
/// sections below — mirrors the web app's DoctorVerification section
/// headers (AdminPages.jsx), just laid out for a narrower screen.
class _SectionHeading extends StatelessWidget {
  final String title;
  final int count;
  const _SectionHeading({required this.title, required this.count});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        Text(
          '$count record${count == 1 ? '' : 's'}',
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textSecondary, letterSpacing: 0.4),
        ),
      ],
    );
  }
}

class _AddDoctorScreen extends StatefulWidget {
  const _AddDoctorScreen();

  @override
  State<_AddDoctorScreen> createState() => _AddDoctorScreenState();
}

class _AddDoctorScreenState extends State<_AddDoctorScreen> {
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _cityCtrl = TextEditingController();
  final _qualificationCtrl = TextEditingController();
  final _registrationCtrl = TextEditingController();
  final _experienceCtrl = TextEditingController();
  final _feeCtrl = TextEditingController();
  final _emergencyFeeCtrl = TextEditingController();
  final _bioCtrl = TextEditingController();
  Specialization? _selectedSpecialization;
  Future<List<Specialization>>? _specializationsFuture;
  bool _verifyImmediately = true;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _specializationsFuture = ApiClient.instance
        .get('/geography/specializations', query: {'pageSize': 100})
        .then((res) {
          final list = <Specialization>[];
          for (final item in res.list) {
            try {
              list.add(Specialization.fromJson(item));
            } catch (_) {}
          }
          return list;
        })
        .catchError((_) => <Specialization>[]);
  }

  @override
  void dispose() {
    for (final c in [
      _nameCtrl,
      _emailCtrl,
      _passwordCtrl,
      _phoneCtrl,
      _cityCtrl,
      _qualificationCtrl,
      _registrationCtrl,
      _experienceCtrl,
      _feeCtrl,
      _emergencyFeeCtrl,
      _bioCtrl,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_nameCtrl.text.trim().isEmpty || _emailCtrl.text.trim().isEmpty || _passwordCtrl.text.trim().length < 8) {
      setState(() => _error = 'Name, email and an 8+ character password are required');
      return;
    }
    if (_selectedSpecialization == null) {
      setState(() => _error = 'Select a specialization');
      return;
    }
    final fee = double.tryParse(_feeCtrl.text.trim());
    if (fee == null) {
      setState(() => _error = 'Enter a valid consultation fee');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/doctors', body: {
        'name': _nameCtrl.text.trim(),
        'email': _emailCtrl.text.trim(),
        'password': _passwordCtrl.text,
        if (_phoneCtrl.text.trim().isNotEmpty) 'phone': _phoneCtrl.text.trim(),
        if (_cityCtrl.text.trim().isNotEmpty) 'city': _cityCtrl.text.trim(),
        'specializationId': _selectedSpecialization!.id,
        if (_qualificationCtrl.text.trim().isNotEmpty) 'qualification': _qualificationCtrl.text.trim(),
        if (_registrationCtrl.text.trim().isNotEmpty) 'registrationNumber': _registrationCtrl.text.trim(),
        if (int.tryParse(_experienceCtrl.text.trim()) != null) 'experienceYears': int.parse(_experienceCtrl.text.trim()),
        'consultationFee': fee,
        if (double.tryParse(_emergencyFeeCtrl.text.trim()) != null) 'emergencyFee': double.parse(_emergencyFeeCtrl.text.trim()),
        if (_bioCtrl.text.trim().isNotEmpty) 'bio': _bioCtrl.text.trim(),
        'verifyImmediately': _verifyImmediately,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      setState(() {
        _error = err.toString();
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add doctor')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          TextField(controller: _nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _emailCtrl, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _passwordCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'Password (min 8 chars)')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (optional)')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _cityCtrl, decoration: const InputDecoration(labelText: 'City (display only, optional)')),
          const SizedBox(height: AppSpacing.md),
          FutureBuilder<List<Specialization>>(
            future: _specializationsFuture,
            builder: (context, snapshot) {
              final items = snapshot.data ?? [];
              return DropdownButtonFormField<Specialization>(
                initialValue: _selectedSpecialization,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Specialization'),
                items: items.map((s) => DropdownMenuItem(value: s, child: Text(s.name))).toList(),
                onChanged: (s) => setState(() => _selectedSpecialization = s),
              );
            },
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _qualificationCtrl, decoration: const InputDecoration(labelText: 'Qualification (optional)')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _registrationCtrl, decoration: const InputDecoration(labelText: 'Registration number (optional)')),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _experienceCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Experience (years, optional)'),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: TextField(
                  controller: _feeCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Consultation fee'),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _emergencyFeeCtrl,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Emergency fee (optional)'),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _bioCtrl, maxLines: 3, decoration: const InputDecoration(labelText: 'Bio (optional)')),
          const SizedBox(height: AppSpacing.md),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Verify immediately'),
            subtitle: const Text('If off, the doctor stays pending until verified via status update', style: TextStyle(fontSize: 12)),
            value: _verifyImmediately,
            onChanged: (v) => setState(() => _verifyImmediately = v),
          ),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Create doctor account', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}
