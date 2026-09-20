import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Doctor's medical-record list + write flow. POST /medical-records is
/// doctor-only (integration_plan.md §1.11); `notes`/`carePlan` are real
/// persisted fields here, not dropped like the old mock did.
class DoctorMedicalRecordsScreen extends StatefulWidget {
  const DoctorMedicalRecordsScreen({super.key});

  @override
  State<DoctorMedicalRecordsScreen> createState() => _DoctorMedicalRecordsScreenState();
}

class _DoctorMedicalRecordsScreenState extends State<DoctorMedicalRecordsScreen> {
  Future<List<MedicalRecordItem>>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = ApiClient.instance
        .get('/medical-records', query: {'pageSize': 50})
        .then((res) {
          final list = <MedicalRecordItem>[];
          for (final item in res.list) {
            try {
              list.add(MedicalRecordItem.fromJson(item));
            } catch (_) {}
          }
          return list;
        }).catchError((_) => <MedicalRecordItem>[]);
    if (mounted) setState(() {});
  }

  Future<void> _openNew() async {
    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const DoctorNewMedicalRecordScreen()),
    );
    if (result == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openNew,
        icon: const Icon(Icons.add),
        label: const Text('New record'),
      ),
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Consultation & EMR',
              subtitle: 'Capture clinical notes securely for each visit.',
            ),
          ),
          Expanded(
            child: FutureBuilder<List<MedicalRecordItem>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
          if (snapshot.hasError) {
            return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
          }
          final items = snapshot.data ?? [];
          if (items.isEmpty) {
            return const EmptyStateView(icon: Icons.folder_shared_outlined, title: 'No medical records written yet');
          }
          return RefreshIndicator(
            onRefresh: () async => _load(),
            child: ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, i) {
                final r = items[i];
                return Card(
                  child: ExpansionTile(
                    title: Text(r.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('${r.patient?.name ?? "Patient"}${r.type != null ? " · ${r.type}" : ""}'),
                    childrenPadding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
                    children: [
                      if (r.notes != null) Align(alignment: Alignment.centerLeft, child: Text('Notes: ${r.notes}')),
                      if (r.carePlan != null) ...[
                        const SizedBox(height: 6),
                        Align(alignment: Alignment.centerLeft, child: Text('Care plan: ${r.carePlan}')),
                      ],
                    ],
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

class DoctorNewMedicalRecordScreen extends StatefulWidget {
  const DoctorNewMedicalRecordScreen({super.key, this.initialAppointment});

  final Appointment? initialAppointment;

  @override
  State<DoctorNewMedicalRecordScreen> createState() => _DoctorNewMedicalRecordScreenState();
}

class _DoctorNewMedicalRecordScreenState extends State<DoctorNewMedicalRecordScreen> {
  Future<List<Appointment>>? _appointmentsFuture;
  Appointment? _selectedAppointment;
  final _titleCtrl = TextEditingController();
  final _typeCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  final _carePlanCtrl = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _selectedAppointment = widget.initialAppointment;
    _appointmentsFuture = ApiClient.instance
        .get('/appointments', query: {'status': 'confirmed', 'pageSize': 100})
        .then((res) {
          final list = <Appointment>[];
          for (final item in res.list) {
            try {
              list.add(Appointment.fromJson(item));
            } catch (_) {}
          }
          if (widget.initialAppointment != null && !list.any((a) => a.id == widget.initialAppointment!.id)) {
            list.insert(0, widget.initialAppointment!);
          }
          return list;
        }).catchError((_) => widget.initialAppointment != null ? [widget.initialAppointment!] : <Appointment>[]);
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _typeCtrl.dispose();
    _notesCtrl.dispose();
    _carePlanCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_selectedAppointment == null) {
      setState(() => _error = 'Select an appointment');
      return;
    }
    if (_titleCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Title is required');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/medical-records', body: {
        'appointmentId': _selectedAppointment!.id,
        'title': _titleCtrl.text.trim(),
        if (_typeCtrl.text.trim().isNotEmpty) 'type': _typeCtrl.text.trim(),
        if (_notesCtrl.text.trim().isNotEmpty) 'notes': _notesCtrl.text.trim(),
        if (_carePlanCtrl.text.trim().isNotEmpty) 'carePlan': _carePlanCtrl.text.trim(),
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
      appBar: AppBar(title: const Text('New medical record')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          FutureBuilder<List<Appointment>>(
            future: _appointmentsFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
              final appts = snapshot.data ?? [];
              return DropdownButtonFormField<Appointment>(
                initialValue: _selectedAppointment,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Appointment'),
                items: appts
                    .map((a) => DropdownMenuItem(
                          value: a,
                          child: Text(
                            '${a.patient?.name ?? "Patient"} · ${a.appointmentDate} ${a.appointmentTime}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ))
                    .toList(),
                onChanged: (v) => setState(() => _selectedAppointment = v),
              );
            },
          ),
          const SizedBox(height: AppSpacing.md),
          // COMPLETENESS FIX (mobile parity — content/copy): the web DoctorEmr form labels this
          // same required field (posted as `title`) "Diagnosis", not "Title" (FeaturePages.jsx#
          // DoctorEmr).
          TextField(controller: _titleCtrl, decoration: const InputDecoration(labelText: 'Diagnosis')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _typeCtrl, decoration: const InputDecoration(labelText: 'Type (optional)')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _notesCtrl, maxLines: 4, decoration: const InputDecoration(labelText: 'Notes (optional)')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _carePlanCtrl, maxLines: 4, decoration: const InputDecoration(labelText: 'Care plan (optional)')),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Save record', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}
