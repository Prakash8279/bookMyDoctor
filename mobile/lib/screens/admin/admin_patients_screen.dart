import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../models/admin_models.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

// COMPLETENESS FIX (mobile parity audit): matches web's `formatDate` (client/src/lib/format.js) —
// "DD Mon YYYY", or an em dash for a falsy/invalid value.
String _formatDate(String? value) {
  if (value == null || value.isEmpty) return '—';
  final parsed = DateTime.tryParse(value);
  return parsed == null ? value : DateFormat('dd MMM yyyy').format(parsed);
}

/// COMPLETENESS FIX (audit Priority 3 #5 — mobile parity): real backend endpoint
/// (GET /admin/patients), real web page (AdminPages.jsx#ManagePatients) — no mobile screen
/// existed for it at all. Directory + search, mirroring the web page's search box
/// (name/email/phone, server-side via the `search` query param — admin.service.js#listPatients).
/// COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
/// also has the account-level login enable/disable action (PATCH /admin/patients/:id/status) —
/// no longer read-only.
class AdminPatientsScreen extends StatefulWidget {
  const AdminPatientsScreen({super.key});

  @override
  State<AdminPatientsScreen> createState() => _AdminPatientsScreenState();
}

class _AdminPatientsScreenState extends State<AdminPatientsScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  Future<List<PatientDirectoryItem>>? _future;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<List<PatientDirectoryItem>> _fetch() async {
    try {
      final results = await Future.wait([
        ApiClient.instance.get('/admin/patients', query: {
          'pageSize': 100,
          if (_searchController.text.trim().isNotEmpty) 'search': _searchController.text.trim(),
        }).catchError((_) => ApiResponse(data: [])),
        // COMPLETENESS FIX (mobile parity audit): web's ManagePatients "Health notes" column
        // (AdminPages.jsx#ManagePatients) comes from a `clinicalMap` built out of GET
        // /appointments's already-loaded `patient` sub-object, NOT the plain directory endpoint
        // above (which never carries medicalHistory/emergencyContact) — an admin caller to
        // GET /appointments gets the full clinical view (appointments.service.js#shapePatientRef).
        ApiClient.instance.get('/appointments', query: {'pageSize': 200}).catchError((_) => ApiResponse(data: [])),
      ]);
      final list = <PatientDirectoryItem>[];
      for (final item in results[0].list) {
        try {
          list.add(PatientDirectoryItem.fromJson(item));
        } catch (_) {}
      }
      final clinicalById = <String, PatientRef>{};
      for (final item in results[1].list) {
        try {
          final appointment = Appointment.fromJson(item);
          final patient = appointment.patient;
          if (patient != null && patient.id.isNotEmpty && !clinicalById.containsKey(patient.id)) {
            clinicalById[patient.id] = patient;
          }
        } catch (_) {}
      }
      return [
        for (final p in list)
          clinicalById.containsKey(p.id)
              ? p.mergedWithHealthNotes(
                  medicalHistory: clinicalById[p.id]!.medicalHistory,
                  emergencyContact: clinicalById[p.id]!.emergencyContact,
                )
              : p,
      ];
    } catch (_) {
      return [];
    }
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _load);
  }

  // COMPLETENESS FIX (mobile parity audit): web's "Export CSV" action (AdminPages.jsx
  // ManagePatients#exportCsv) had no mobile equivalent. Same header/column order/values.
  Future<void> _exportCsv(List<PatientDirectoryItem> patients) async {
    await shareCsv(
      filename: 'patients.csv',
      headers: const ['Id', 'Name', 'Email', 'Phone', 'City', 'Registered', 'Status'],
      rows: [
        for (final p in patients)
          [p.id, p.name, p.email ?? '', p.phone ?? '', p.city ?? '', _formatDate(p.registeredAt), p.status],
      ],
    );
  }

  // COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
  // this screen was read-only until now — PATCH /admin/patients/:id/status is the new
  // account-level login enable/disable endpoint (admin.service.js#updatePatientStatus).
  Future<void> _toggleStatus(PatientDirectoryItem p) async {
    final next = p.status == 'active' ? 'disabled' : 'active';
    setState(() => _busyId = p.id);
    try {
      await ApiClient.instance.patch('/admin/patients/${p.id}/status', body: {'status': next});
      if (mounted) showSuccessSnack(context, next == 'disabled' ? 'Login disabled' : 'Login re-enabled');
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          // Mirrors the web app's ManagePatients `Page` header (AdminPages.jsx) —
          // same title + subtitle copy.
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Patient management',
              subtitle: 'Every registered patient account — not just ones seen in a booking or payment.',
              // COMPLETENESS FIX (mobile parity audit): web's "Export CSV" action — see _exportCsv.
              action: FutureBuilder<List<PatientDirectoryItem>>(
                future: _future,
                builder: (context, snapshot) {
                  final patients = snapshot.data ?? const <PatientDirectoryItem>[];
                  return TextButton.icon(
                    onPressed: patients.isEmpty ? null : () => _exportCsv(patients),
                    icon: const Icon(Icons.file_download_outlined, size: 16),
                    label: const Text('Export CSV'),
                  );
                },
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search by name, email, or phone',
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<PatientDirectoryItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: ErrorBanner(error: snapshot.error!, onRetry: _load),
                  );
                }
                final patients = snapshot.data ?? [];
                if (patients.isEmpty) {
                  return const EmptyStateView(icon: Icons.people_outline, title: 'No patients found');
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: patients.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final p = patients[i];
                      final details = [
                        if (p.gender != null) p.gender,
                        if (p.bloodGroup != null) p.bloodGroup,
                        if (p.city != null) p.city,
                        // COMPLETENESS FIX (mobile parity audit): web's ManagePatients table shows
                        // a "Registered" column (formatDate(item.registeredAt)) — mobile parsed
                        // this field already but never displayed it.
                        'Registered: ${_formatDate(p.registeredAt)}',
                      ].join(' · ');
                      final busy = _busyId == p.id;
                      return Card(
                        child: ListTile(
                          title: Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                [
                                  if (p.email != null) p.email!,
                                  if (p.phone != null) p.phone!,
                                  if (details.isNotEmpty) details,
                                ].join('\n'),
                              ),
                              // COMPLETENESS FIX (mobile parity audit): web's "Health notes"
                              // column — see _fetch()'s clinicalMap merge above.
                              if (p.healthNotesSummary != null) ...[
                                const SizedBox(height: 4),
                                Text(
                                  p.healthNotesSummary!,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 11, color: AppColors.textSecondary, fontStyle: FontStyle.italic),
                                ),
                              ],
                            ],
                          ),
                          trailing: busy
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                              : Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    StatusBadge(status: p.status),
                                    IconButton(
                                      icon: Icon(p.status == 'active' ? Icons.block : Icons.check_circle_outline, size: 20),
                                      tooltip: p.status == 'active' ? 'Disable login' : 'Enable login',
                                      onPressed: () => _toggleStatus(p),
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
