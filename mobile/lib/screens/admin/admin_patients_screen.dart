import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

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
      final res = await ApiClient.instance.get('/admin/patients', query: {
        'pageSize': 100,
        if (_searchController.text.trim().isNotEmpty) 'search': _searchController.text.trim(),
      }).catchError((_) => ApiResponse(data: []));
      final list = <PatientDirectoryItem>[];
      for (final item in res.list) {
        try {
          list.add(PatientDirectoryItem.fromJson(item));
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

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _load);
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
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Patient management',
              subtitle: 'Every registered patient account — not just ones seen in a booking or payment.',
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
                      ].join(' · ');
                      final busy = _busyId == p.id;
                      return Card(
                        child: ListTile(
                          title: Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text(
                            [
                              if (p.email != null) p.email!,
                              if (p.phone != null) p.phone!,
                              if (details.isNotEmpty) details,
                            ].join('\n'),
                          ),
                          isThreeLine: true,
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
