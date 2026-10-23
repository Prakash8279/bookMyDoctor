import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../core/india_time.dart';
import '../../core/admin_period.dart';
import '../../widgets/admin_period_filter.dart';
import '../../widgets/paged_record_list.dart';
import '../../models/admin_models.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Platform-wide receptionist management. /receptionists authorizes
/// admin/superadmin too (integration_plan.md §1.7) — unlike a doctor caller
/// (clinic-scoped to their own), admin sees every receptionist across every
/// clinic when no `clinicId` filter is applied.
class AdminReceptionistsScreen extends StatefulWidget {
  const AdminReceptionistsScreen({super.key});

  @override
  State<AdminReceptionistsScreen> createState() =>
      _AdminReceptionistsScreenState();
}

class _AdminReceptionistsScreenState extends State<AdminReceptionistsScreen> {
  AdminPeriod _period = AdminPeriod.today();
  List<ReceptionistRow> _visible(List<ReceptionistRow> items) =>
      items.where((item) => _period.includes(item.createdAt)).toList();

  Future<List<ReceptionistRow>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<ReceptionistRow>> _fetch() async {
    final res = await ApiClient.instance
        .getAll('/receptionists', query: {'pageSize': 100});
    final list = <ReceptionistRow>[];
    for (final item in res.list) {
      try {
        list.add(ReceptionistRow.fromJson(item));
      } catch (_) {}
    }
    return list;
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<void> _openForm({ReceptionistRow? existing}) async {
    final result = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        builder: (_) => _ReceptionistForm(existing: existing));
    if (result == true) _load();
  }

  Future<void> _export(List<ReceptionistRow> rows) async {
    try {
      await shareCsv(
          filename:
              'receptionists-${_period.from ?? 'all'}-to-${_period.to ?? 'all'}.csv',
          headers: const [
            'ID',
            'Name',
            'Email',
            'Phone',
            'Clinic',
            'Registered on (IST)',
            'Status'
          ],
          rows: [
            for (final r in rows)
              [
                r.id,
                r.name,
                r.email,
                r.phone,
                r.clinicName,
                indiaTimestamp(r.createdAt),
                r.status
              ]
          ]);
    } catch (error) {
      if (mounted) showErrorSnack(context, error);
    }
  }

  Future<void> _toggleStatus(ReceptionistRow r) async {
    final next = r.status == 'active' ? 'disabled' : 'active';
    try {
      await ApiClient.instance
          .patch('/receptionists/${r.id}/status', body: {'status': next});
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
          label: const Text('Add receptionist')),
      body: Column(
        children: [
          // Mirrors the web app's ManageReceptionists `Page` header (AdminPages.jsx) —
          // same title (no subtitle on web for this page).
          const Padding(
            padding: EdgeInsets.fromLTRB(
                AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(title: 'Manage receptionists'),
          ),
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: AdminPeriodFilter(
                  value: _period,
                  onChanged: (period) => setState(() => _period = period))),
          FutureBuilder<List<ReceptionistRow>>(
              future: _future,
              builder: (context, snapshot) {
                final rows = _visible(snapshot.data ?? []);
                return Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                        onPressed:
                            snapshot.connectionState == ConnectionState.done &&
                                    !snapshot.hasError &&
                                    rows.isNotEmpty
                                ? () => _export(rows)
                                : null,
                        icon: const Icon(Icons.download_outlined),
                        label: const Text('Export CSV')));
              }),
          Expanded(
            child: FutureBuilder<List<ReceptionistRow>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const LoadingView();
                }
                if (snapshot.hasError) {
                  return Padding(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      child:
                          ErrorBanner(error: snapshot.error!, onRetry: _load));
                }
                final rows = _visible(snapshot.data ?? []);
                if (rows.isEmpty) {
                  return const EmptyStateView(
                      icon: Icons.support_agent_outlined,
                      title: 'No receptionists yet');
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: PagedRecordList<ReceptionistRow>(
                    key: ValueKey(_period.label),
                    items: rows,
                    itemBuilder: (context, r, i) {
                      return Card(
                        child: Material(
                            type: MaterialType.transparency,
                            child: ListTile(
                              title: Text(
                                  '${r.receptionistNumber == null ? "DCR—" : "DCR${r.receptionistNumber}"} · ${r.name}'),
                              subtitle: Text(
                                  '${r.email}${r.clinicName != null ? " · ${r.clinicName}" : ""}'),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  StatusBadge(status: r.status),
                                  IconButton(
                                      icon: const Icon(Icons.edit_outlined,
                                          size: 20),
                                      onPressed: () => _openForm(existing: r)),
                                  IconButton(
                                      icon: Icon(
                                          r.status == 'active'
                                              ? Icons.block
                                              : Icons.check_circle_outline,
                                          size: 20),
                                      onPressed: () => _toggleStatus(r)),
                                ],
                              ),
                            )),
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
  late final _nameCtrl =
      TextEditingController(text: widget.existing?.name ?? '');
  late final _emailCtrl =
      TextEditingController(text: widget.existing?.email ?? '');
  late final _phoneCtrl =
      TextEditingController(text: widget.existing?.phone ?? '');
  final _passwordCtrl = TextEditingController();
  Clinic? _selectedClinic;
  Future<List<Clinic>>? _clinicsFuture;
  bool _submitting = false;
  String? _error;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    // BUG FIX (same root cause as the receptionist Reports/Patients directory bug — see
    // receptionist_reports_screen.dart's comment): the backend's list-query validator rejects
    // any pageSize over 100 with a 422 "Validation failed" instead of clamping it, so 200 here
    // silently emptied this dropdown's clinic list.
    _clinicsFuture = ApiClient.instance
        .getAll('/clinics', query: {'pageSize': 100}).then((res) {
      final list = <Clinic>[];
      for (final item in res.list) {
        try {
          list.add(Clinic.fromJson(item));
        } catch (_) {}
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
    if (!_isEdit &&
        (_emailCtrl.text.trim().isEmpty ||
            _passwordCtrl.text.trim().length < 8)) {
      setState(
          () => _error = 'Email and an 8+ character password are required');
      return;
    }
    if (!_isEdit && _selectedClinic == null) {
      setState(() => _error = 'Select a clinic');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      if (_isEdit) {
        await ApiClient.instance
            .patch('/receptionists/${widget.existing!.id}', body: {
          'name': _nameCtrl.text.trim(),
          if (_phoneCtrl.text.trim().isNotEmpty)
            'phone': _phoneCtrl.text.trim(),
          if (_selectedClinic != null) 'clinicId': _selectedClinic!.id,
        });
      } else {
        await ApiClient.instance.post('/receptionists', body: {
          'name': _nameCtrl.text.trim(),
          'email': _emailCtrl.text.trim(),
          'password': _passwordCtrl.text,
          if (_phoneCtrl.text.trim().isNotEmpty)
            'phone': _phoneCtrl.text.trim(),
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
          bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_isEdit ? 'Edit receptionist' : 'Add receptionist',
                style:
                    const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: AppSpacing.md),
            if (_error != null) ...[
              ErrorBanner(error: _error!),
              const SizedBox(height: AppSpacing.md)
            ],
            TextField(
                controller: _nameCtrl,
                decoration: const InputDecoration(labelText: 'Name')),
            const SizedBox(height: AppSpacing.md),
            if (!_isEdit) ...[
              TextField(
                  controller: _emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Email')),
              const SizedBox(height: AppSpacing.md),
              TextField(
                  controller: _passwordCtrl,
                  obscureText: true,
                  decoration: const InputDecoration(
                      labelText: 'Password (min 8 chars)')),
              const SizedBox(height: AppSpacing.md),
            ],
            TextField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration:
                    const InputDecoration(labelText: 'Phone (optional)')),
            const SizedBox(height: AppSpacing.md),
            FutureBuilder<List<Clinic>>(
              future: _clinicsFuture,
              builder: (context, snapshot) {
                final clinics = snapshot.data ?? [];
                return DropdownButtonFormField<Clinic>(
                  initialValue: _selectedClinic != null &&
                          clinics.any((c) => c.id == _selectedClinic!.id)
                      ? clinics.firstWhere((c) => c.id == _selectedClinic!.id)
                      : null,
                  isExpanded: true,
                  decoration: InputDecoration(
                      labelText:
                          _isEdit ? 'Reassign clinic (optional)' : 'Clinic'),
                  items: clinics
                      .map((c) => DropdownMenuItem(
                          value: c,
                          child: Text(c.name, overflow: TextOverflow.ellipsis)))
                      .toList(),
                  onChanged: (c) => setState(() => _selectedClinic = c),
                );
              },
            ),
            const SizedBox(height: AppSpacing.lg),
            PrimaryButton(
                label: 'Save', onPressed: _submit, loading: _submitting),
          ],
        ),
      ),
    );
  }
}
