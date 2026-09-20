import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class _PatientRow {
  final String id;
  final String? name;
  final String? phone;
  final String? gender;
  final String? dateOfBirth;
  final String? bloodGroup;
  final String? medicalHistory;
  final String? emergencyContact;
  int visits;
  String lastStatus;

  _PatientRow({
    required this.id,
    this.name,
    this.phone,
    this.gender,
    this.dateOfBirth,
    this.bloodGroup,
    this.medicalHistory,
    this.emergencyContact,
    required this.visits,
    required this.lastStatus,
  });
}

int? _ageFromDob(String? dob) {
  if (dob == null || dob.isEmpty) return null;
  final parsed = DateTime.tryParse(dob);
  if (parsed == null) return null;
  final now = DateTime.now();
  var age = now.year - parsed.year;
  if (now.month < parsed.month || (now.month == parsed.month && now.day < parsed.day)) age--;
  return age;
}

String _vitals(_PatientRow patient) {
  final parts = <String>[];
  if (patient.gender != null && patient.gender!.isNotEmpty) parts.add(patient.gender!);
  final age = _ageFromDob(patient.dateOfBirth);
  if (age != null) parts.add('${age}y');
  if (patient.bloodGroup != null && patient.bloodGroup!.isNotEmpty) parts.add(patient.bloodGroup!);
  return parts.isEmpty ? '—' : parts.join(' · ');
}

String? _healthNotes(_PatientRow patient) {
  final parts = <String>[];
  if (patient.medicalHistory != null && patient.medicalHistory!.isNotEmpty) parts.add('History: ${patient.medicalHistory}');
  if (patient.emergencyContact != null && patient.emergencyContact!.isNotEmpty) parts.add('Emergency contact: ${patient.emergencyContact}');
  if (parts.isEmpty) return null;
  return parts.join(' · ');
}

/// COMPLETENESS FIX (mobile parity — client/src/pages/StaffPages.jsx#PatientHistory had no mobile
/// equivalent). No dedicated /patients endpoint exists anywhere in the API — same as the web
/// page, this derives a distinct patient list from the doctor's own already-fetched appointments
/// (GET /appointments) rather than a dedicated fetch.
class DoctorPatientsScreen extends StatefulWidget {
  const DoctorPatientsScreen({super.key});

  @override
  State<DoctorPatientsScreen> createState() => _DoctorPatientsScreenState();
}

class _DoctorPatientsScreenState extends State<DoctorPatientsScreen> {
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
            gender: patient.gender,
            dateOfBirth: patient.dateOfBirth,
            bloodGroup: patient.bloodGroup,
            medicalHistory: patient.medicalHistory,
            emergencyContact: patient.emergencyContact,
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
    // (doctor_home_screen.dart), which already supplies the app bar.
    return Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(title: 'Patient history'),
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
                      final notes = _healthNotes(patient);
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
                              Text(_vitals(patient)),
                              if (notes != null) ...[
                                const SizedBox(height: 4),
                                Text(notes, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13), maxLines: 2, overflow: TextOverflow.ellipsis),
                              ],
                              const SizedBox(height: AppSpacing.sm),
                              Text('${patient.visits} visit${patient.visits == 1 ? '' : 's'}', style: const TextStyle(fontWeight: FontWeight.w600)),
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
