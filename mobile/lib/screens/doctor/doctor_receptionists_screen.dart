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
    _load();
  }

  void _load() {
    setState(() {
      _future = ApiClient.instance
          .get('/receptionists', query: {'pageSize': 50})
          .then((res) => res.list.map(ReceptionistRow.fromJson).toList());
    });
  }

  Future<void> _openForm({ReceptionistRow? existing}) async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ReceptionistForm(existing: existing),
    );
    if (result == true) _load();
  }

  Future<void> _toggleStatus(ReceptionistRow r) async {
    final next = r.status == 'active' ? 'disabled' : 'active';
    try {
      await ApiClient.instance.patch('/receptionists/${r.id}/status', body: {'status': next});
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

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
                    subtitle: Text('${r.email}${r.clinicName != null ? " · ${r.clinicName}" : ""}'),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        StatusBadge(status: r.status),
                        IconButton(icon: const Icon(Icons.edit_outlined, size: 20), onPressed: () => _openForm(existing: r)),
                        IconButton(
                          icon: Icon(r.status == 'active' ? Icons.block : Icons.check_circle_outline, size: 20),
                          onPressed: () => _toggleStatus(r),
                        ),
                      ],
                    ),
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

class _ReceptionistForm extends StatefulWidget {
  final ReceptionistRow? existing;
  const _ReceptionistForm({this.existing});

  @override
  State<_ReceptionistForm> createState() => _ReceptionistFormState();
}

class _ReceptionistFormState extends State<_ReceptionistForm> {
  late final _nameCtrl = TextEditingController(text: widget.existing?.name ?? '');
  late final _emailCtrl = TextEditingController(text: widget.existing?.email ?? '');
  late final _phoneCtrl = TextEditingController(text: widget.existing?.phone ?? '');
  final _passwordCtrl = TextEditingController();
  Clinic? _selectedClinic;
  Future<List<Clinic>>? _clinicsFuture;
  bool _submitting = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _clinicsFuture = ApiClient.instance.get('/clinics', query: {'mine': true, 'pageSize': 50}).then((res) => res.list.map(Clinic.fromJson).toList());
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
    if (!_isEdit && (_emailCtrl.text.trim().isEmpty || _passwordCtrl.text.trim().length < 8)) {
      setState(() => _error = 'Email and an 8+ character password are required');
      return;
    }
    if (!_isEdit && _selectedClinic == null && widget.existing?.clinicId == null) {
      setState(() => _error = 'Select a clinic');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      if (_isEdit) {
        await ApiClient.instance.patch('/receptionists/${widget.existing!.id}', body: {
          'name': _nameCtrl.text.trim(),
          if (_phoneCtrl.text.trim().isNotEmpty) 'phone': _phoneCtrl.text.trim(),
          if (_selectedClinic != null) 'clinicId': _selectedClinic!.id,
        });
      } else {
        await ApiClient.instance.post('/receptionists', body: {
          'name': _nameCtrl.text.trim(),
          'email': _emailCtrl.text.trim(),
          'password': _passwordCtrl.text,
          if (_phoneCtrl.text.trim().isNotEmpty) 'phone': _phoneCtrl.text.trim(),
          'clinicId': _selectedClinic!.id,
        });
      }
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
            Text(_isEdit ? 'Edit receptionist' : 'Add receptionist', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: AppSpacing.md),
            if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
            TextField(controller: _nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
            const SizedBox(height: AppSpacing.md),
            if (!_isEdit) ...[
              TextField(controller: _emailCtrl, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email')),
              const SizedBox(height: AppSpacing.md),
              TextField(controller: _passwordCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'Password (min 8 chars)')),
              const SizedBox(height: AppSpacing.md),
            ],
            TextField(controller: _phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (optional)')),
            const SizedBox(height: AppSpacing.md),
            FutureBuilder<List<Clinic>>(
              future: _clinicsFuture,
              builder: (context, snapshot) {
                final clinics = snapshot.data ?? [];
                return DropdownButtonFormField<Clinic>(
                  value: _selectedClinic != null && clinics.any((c) => c.id == _selectedClinic!.id) ? clinics.firstWhere((c) => c.id == _selectedClinic!.id) : null,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: _isEdit ? 'Reassign clinic (optional)' : 'Clinic'),
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
