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

  _PatientRow({
    required this.id,
    this.name,
    this.phone,
    required this.visits,
  });
}

/// Mirrors client/src/pages/PortalSectionPages.jsx#PortalPatients (plan §6.7): no dedicated
/// /patients endpoint exists, so — same as DoctorPatientsScreen and the web receptionist
/// portal page — this derives a distinct patient list from appointments already scoped
/// server-side to this receptionist's own clinicId (GET /appointments), rather than a
/// dedicated fetch. appointments.service.js#shapePatientRef deliberately never sends
/// gender/DOB/blood group/medical history to a receptionist caller, so only name/phone/visit
/// count are shown here — no "Patient info" line the way the doctor screen has one.
///
/// PARITY FIX (mobile parity audit — Receptionist panel, user request: "receptionist me jitna v
/// extra feature add hai website se oo sab hata do"): the search box and the "last status" badge
/// were removed — web's `PortalPatients` has neither; its table is just Patient / Phone /
/// Appointments, unfiltered. The explanatory note about this being a derived, not dedicated,
/// patient list (web's own dashed-border note) is now shown here too, matching web.
class ReceptionistPatientsScreen extends StatefulWidget {
  const ReceptionistPatientsScreen({super.key});

  @override
  State<ReceptionistPatientsScreen> createState() => _ReceptionistPatientsScreenState();
}

class _ReceptionistPatientsScreenState extends State<ReceptionistPatientsScreen> {
  Future<List<_PatientRow>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  // DIAGNOSTIC FIX (user report: "patient directory me patient nahi aa raha hai"): this used to
  // swallow EVERY fetch failure (network error, timeout, non-2xx response) into a silent empty
  // list via `.catchError((_) => ApiResponse(data: []))` plus an outer `catch (_) { return []; }`
  // — so a genuine failure and "this clinic truly has zero patients" were visually
  // indistinguishable (both just showed "No patients found"). Since the Appointments tab
  // (identical /appointments endpoint, same account) DOES show real patient-linked appointments,
  // this screen's silent-empty behavior was hiding whatever the real fetch error actually is.
  // Now a genuine fetch error propagates to the FutureBuilder's existing `snapshot.hasError`
  // branch (ErrorBanner) instead of being masked as "no patients" — only a per-item JSON parse
  // failure (a single malformed appointment) is still swallowed, same as every other screen.
  //
  // ROOT CAUSE FOUND (user confirmed the ErrorBanner from the fix above actually reads
  // "Validation failed"): the server's list-query validator caps `pageSize` at 100 (same rule as
  // admin.validation.js's `query('pageSize').optional().isInt({ min: 1, max: 100 })`). This
  // screen was sending `pageSize: 200`, which the validator rejects outright with a 422 before
  // the request ever reaches listAppointments — unlike pagination.js's own parsePagination(),
  // which merely clamps an out-of-range value instead of erroring; that lenient clamp only ever
  // runs for values that got past this earlier, stricter route-level check. The Appointments tab
  // (pageSize 100) always stayed within range — only this screen's 200 was out of bounds. Capped
  // to 100, the actual max.
  Future<List<_PatientRow>> _fetch() async {
    final res = await ApiClient.instance.get('/appointments', query: {'pageSize': 100});
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
        );
      } else {
        existing.visits += 1;
      }
    }
    return map.values.toList();
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
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppColors.border, style: BorderStyle.solid),
            ),
            child: const Text(
              'This list is built from appointments already loaded — the API has no dedicated patient directory.',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
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
              final patients = snapshot.data ?? [];
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
                            Text(patient.name ?? 'Patient', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
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
