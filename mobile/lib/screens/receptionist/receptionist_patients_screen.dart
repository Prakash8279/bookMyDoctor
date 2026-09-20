import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class _PatientRow {
  final String id;
  final String? name;
  final String? phone;
  int visits;
  String lastStatus;

  _PatientRow({
    required this.id,
    this.name,
    this.phone,
    required this.visits,
    required this.lastStatus,
  });
}

/// Mirrors client/src/pages/PortalSectionPages.jsx#PortalPatients (plan §6.7): no dedicated
/// /patients endpoint exists, so — same as DoctorPatientsScreen and the web receptionist
/// portal page — this derives a distinct patient list from appointments already scoped
/// server-side to this receptionist's own clinicId (GET /appointments), rather than a
/// dedicated fetch. appointments.service.js#shapePatientRef deliberately never sends
/// gender/DOB/blood group/medical history to a receptionist caller, so only name/phone/visit
/// count are shown here — no "Patient info" line the way the doctor screen has one.
class ReceptionistPatientsScreen extends StatefulWidget {
  const ReceptionistPatientsScreen({super.key});

  @override
  State<ReceptionistPatientsScreen> createState() => _ReceptionistPatientsScreenState();
}

class _ReceptionistPatientsScreenState extends State<ReceptionistPatientsScreen> {
  Future<List<_PatientRow>>? _future;
  final _searchController = TextEditingController();
  String _search = '';

  @override
  void initState() {
    super.initState();
    _future = _fetch();
    _searchController.addListener(() => setState(() => _search = _searchController.text.trim().toLowerCase()));
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<List<_PatientRow>> _fetch() async {
    try {
      final res = await ApiClient.instance
          .get('/appointments', query: {'pageSize': 200})
          .catchError((_) => ApiResponse(data: []));
      final appointments = <Appointment>[];
      for (final item in res.list) {
        try {
          appointments.add(Appointment.fromJson(item));
        } catch (_) {}
      }
      final map = <String, _PatientRow>{};
      for (final appointment in appointments) {
        final patient = appointment.patient;
        if (patient == null || patient.id.isEmpty) continue;
        final existing = map[patient.id];
        if (existing == null) {
          map[patient.id] = _PatientRow(
            id: patient.id,
            name: patient.name,
            phone: patient.phone,
            visits: 1,
            lastStatus: appointment.status,
          );
        } else {
          existing.visits += 1;
          existing.lastStatus = appointment.status;
        }
      }
      return map.values.toList();
    } catch (_) {
      return [];
    }
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  @override
  Widget build(BuildContext context) {
    // No own Scaffold/AppBar — only ever embedded as a RoleScaffold nav-item body
    // (receptionist_home_screen.dart), which already supplies the app bar.
    return Column(
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(
            title: 'Patient directory',
            subtitle: 'View patients connected to this clinic.',
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: TextField(
            controller: _searchController,
            decoration: const InputDecoration(
              hintText: 'Search by name or mobile number',
              prefixIcon: Icon(Icons.search),
            ),
          ),
        ),
        Expanded(
          child: FutureBuilder<List<_PatientRow>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
              if (snapshot.hasError) {
                return Padding(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  child: ErrorBanner(error: snapshot.error!, onRetry: _load),
                );
              }
              var patients = snapshot.data ?? [];
              if (_search.isNotEmpty) {
                patients = patients
                    .where((p) => '${p.name ?? ''} ${p.phone ?? ''}'.toLowerCase().contains(_search))
                    .toList();
              }
              if (patients.isEmpty) {
                return const EmptyStateView(
                  icon: Icons.people_outline,
                  title: 'No patients found',
                );
              }
              return RefreshIndicator(
                onRefresh: () async => _load(),
                child: ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: patients.length,
                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, i) {
                    final patient = patients[i];
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(patient.name ?? 'Patient', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                                ),
                                StatusBadge(status: patient.lastStatus),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(patient.phone ?? '—', style: const TextStyle(color: AppColors.textSecondary)),
                            const SizedBox(height: AppSpacing.sm),
                            Text('${patient.visits} appointment${patient.visits == 1 ? '' : 's'}', style: const TextStyle(fontWeight: FontWeight.w600)),
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
    );
  }
}
