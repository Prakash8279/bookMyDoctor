import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

const _weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/// Read-only doctor availability lookup for the front desk — the doctors
/// linked to this receptionist's own clinic (from GET /clinics/:id —
/// integration_plan.md §1.5) plus each one's weekly OPD hours. Receptionists
/// have no endpoint to edit a doctor's profile or hours themselves.
class ReceptionistDoctorsScreen extends StatefulWidget {
  const ReceptionistDoctorsScreen({super.key});

  @override
  State<ReceptionistDoctorsScreen> createState() => _ReceptionistDoctorsScreenState();
}

class _ReceptionistDoctorsScreenState extends State<ReceptionistDoctorsScreen> {
  Future<Clinic?>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final clinicId = context.read<AuthProvider>().profile?.clinicId;
    setState(() {
      _future = (clinicId == null || clinicId.isEmpty)
          ? Future.value(null)
          : ApiClient.instance.get('/clinics/$clinicId').then((res) => Clinic.fromJson(res.map));
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(title: 'Assigned doctors'),
        ),
        Expanded(
          child: FutureBuilder<Clinic?>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
              if (snapshot.hasError) {
                return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
              }
              final clinic = snapshot.data;
              if (clinic == null) {
                return const EmptyStateView(icon: Icons.local_hospital_outlined, title: 'No clinic assignment on file');
              }
              if (clinic.doctors.isEmpty) {
                return const EmptyStateView(icon: Icons.medical_services_outlined, title: 'No doctors linked to this clinic yet');
              }
              return RefreshIndicator(
                onRefresh: () async => _load(),
                child: ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: clinic.doctors.length,
            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
            itemBuilder: (context, i) {
              final d = clinic.doctors[i];
              return Card(
                child: ExpansionTile(
                  title: Text(d.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                  // Mirrors the web app's ReceptionAvailability page, which shows this same
                  // on/off flag as a StatusPill rather than plain text.
                  subtitle: Align(
                    alignment: Alignment.centerLeft,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: StatusBadge(status: d.onlineBooking ? 'active' : 'paused'),
                    ),
                  ),
                  childrenPadding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
                  children: [
                    FutureBuilder<ApiResponse>(
                      future: ApiClient.instance.get('/clinics/${clinic.id}/hours', query: {'doctorId': d.doctorUserId, 'pageSize': 20}),
                      builder: (context, hSnap) {
                        if (hSnap.connectionState != ConnectionState.done) {
                          return const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: LoadingView());
                        }
                        final rawList = hSnap.data?.list ?? [];
                        final hours = <ClinicHours>[];
                        for (final item in rawList) {
                          try { hours.add(ClinicHours.fromJson(item)); } catch (_) {}
                        }
                        hours.sort((a, b) => a.weekday.compareTo(b.weekday));
                        if (hours.isEmpty) {
                          return const Align(
                            alignment: Alignment.centerLeft,
                            child: Text('No OPD hours set at this clinic', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                          );
                        }
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: hours
                              .map((h) => Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 2),
                                    child: Text(
                                      '${_weekdayShort[h.weekday]}: ${h.startTime} – ${h.endTime}${h.status != 'active' ? " (${h.status})" : ""}',
                                      style: const TextStyle(fontSize: 13),
                                    ),
                                  ))
                              .toList(),
                        );
                      },
                    ),
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
    );
  }
}
