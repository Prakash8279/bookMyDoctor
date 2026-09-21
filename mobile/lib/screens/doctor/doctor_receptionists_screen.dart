import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Manage reception staff for the doctor's clinics. /receptionists is
/// authorized for doctor/admin/superadmin (integration_plan.md §1.7) — this
/// is the single real create-account endpoint (the old mock had two
/// inconsistent call sites; this converges on one, with required
/// email/password/clinicId).
class DoctorReceptionistsScreen extends StatefulWidget {
  const DoctorReceptionistsScreen({super.key});

  @override
  State<DoctorReceptionistsScreen> createState() => _DoctorReceptionistsScreenState();
}

class _DoctorReceptionistsScreenState extends State<DoctorReceptionistsScreen> {
  Future<List<ReceptionistRow>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<ReceptionistRow>> _fetch() async {
    try {
      final res = await ApiClient.instance
          .get('/receptionists', query: {'pageSize': 50})
          .catchError((_) => ApiResponse(data: []));
      final list = <ReceptionistRow>[];
      for (final item in res.list) {
        try {
          list.add(ReceptionistRow.fromJson(item));
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

  Future<void> _openForm() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _ReceptionistForm(),
    );
    if (result == true) _load();
  }

  // _toggleStatus removed (mobile parity audit round 2 — user request: "backend hai but website
  // me nahi hai to hata do app se backend v oo hata do"): PATCH /receptionists/:id/status is gone
  // from the server now (see receptionists.routes.js), matching web, which never had an
  // enable/disable control either (DoctorStaff/ManageReceptionists only ever create + list).

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(),
        icon: const Icon(Icons.add),
        label: const Text('Add receptionist'),
      ),
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Receptionist accounts',
              subtitle: 'Create clinic team logins and assignments.',
            ),
          ),
          Expanded(
            child: FutureBuilder<List<ReceptionistRow>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
          if (snapshot.hasError) {
            return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
          }
          final rows = snapshot.data ?? [];
          if (rows.isEmpty) {
            return const EmptyStateView(icon: Icons.support_agent_outlined, title: 'No receptionists yet');
          }
          return RefreshIndicator(
            onRefresh: () async => _load(),
            child: ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: rows.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, i) {
                final r = rows[i];
                return Card(
                  child: ListTile(
                    title: Text(r.name),
                    // COMPLETENESS FIX (mobile parity audit round 2, doctor panel): web's
                    // receptionist table has a "Since" (joined-date) column (FeaturePages.jsx's
                    // DoctorStaff DataTable) — was missing here.
                    subtitle: Text(
                      '${r.email}${r.clinicName != null ? " · ${r.clinicName}" : ""}'
                      '${r.since != null ? " · Since ${r.since!.split("T").first}" : ""}',
                    ),
                    // Edit + enable/disable buttons removed here too — read-only status badge only,
                    // matching web's DoctorStaff/ManageReceptionists (create + list only).
                    trailing: StatusBadge(status: r.status),
                  ),
                );
              },
            ),
          );
        },
            ),
          ),
        ],
      ),
    );
  }
}

// Edit-mode support removed here too (mobile parity audit round 2): PATCH /receptionists/:id is
// gone from the server now, matching web, which never had an edit form either — create + list
// only. This form is create-only.
class _ReceptionistForm extends StatefulWidget {
  const _ReceptionistForm();

  @override
  State<_ReceptionistForm> createState() => _ReceptionistFormState();
}

class _ReceptionistFormState extends State<_ReceptionistForm> {
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  Clinic? _selectedClinic;
  Future<List<Clinic>>? _clinicsFuture;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _clinicsFuture = ApiClient.instance
        .get('/clinics', query: {'mine': true, 'pageSize': 50})
        .then((res) {
          final list = <Clinic>[];
          for (final item in res.list) {
            try { list.add(Clinic.fromJson(item)); } catch (_) {}
          }
          return list;
        }).catchError((_) => <Clinic>[]);
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _phoneCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_nameCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Name is required');
      return;
    }
    if (_emailCtrl.text.trim().isEmpty || _passwordCtrl.text.trim().length < 8) {
      setState(() => _error = 'Email and an 8+ character password are required');
      return;
    }
    if (_selectedClinic == null) {
      setState(() => _error = 'Select a clinic');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/receptionists', body: {
        'name': _nameCtrl.text.trim(),
        'email': _emailCtrl.text.trim(),
        'password': _passwordCtrl.text,
        if (_phoneCtrl.text.trim().isNotEmpty) 'phone': _phoneCtrl.text.trim(),
        'clinicId': _selectedClinic!.id,
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
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Add receptionist', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: AppSpacing.md),
            if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
            TextField(controller: _nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
            const SizedBox(height: AppSpacing.md),
            TextField(controller: _emailCtrl, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email')),
            const SizedBox(height: AppSpacing.md),
            TextField(controller: _passwordCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'Password (min 8 chars)')),
            const SizedBox(height: AppSpacing.md),
            TextField(controller: _phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (optional)')),
            const SizedBox(height: AppSpacing.md),
            FutureBuilder<List<Clinic>>(
              future: _clinicsFuture,
              builder: (context, snapshot) {
                final clinics = snapshot.data ?? [];
                return DropdownButtonFormField<Clinic>(
                  initialValue: _selectedClinic != null && clinics.any((c) => c.id == _selectedClinic!.id) ? clinics.firstWhere((c) => c.id == _selectedClinic!.id) : null,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Clinic'),
                  items: clinics.map((c) => DropdownMenuItem(value: c, child: Text(c.name, overflow: TextOverflow.ellipsis))).toList(),
                  onChanged: (c) => setState(() => _selectedClinic = c),
                );
              },
            ),
            const SizedBox(height: AppSpacing.lg),
            PrimaryButton(label: 'Save', onPressed: _submit, loading: _submitting),
          ],
        ),
      ),
    );
  }
}
