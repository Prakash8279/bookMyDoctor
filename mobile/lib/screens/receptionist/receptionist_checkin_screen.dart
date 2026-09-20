import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (mobile parity audit): ports web's `CheckIn` (StaffPages.jsx, route
/// /receptionist/check-in) — a purely READ-ONLY view. `checkedInAt` is a genuinely dead/read-only
/// column server-side (appointments.service.js only ever selects and returns it; nothing anywhere
/// in the backend ever writes it), so — same as the web page — this screen has no buttons or
/// manual toggle, just an honest display of today's upcoming/confirmed appointments and whatever
/// check-in status the API happens to report.
class ReceptionistCheckinScreen extends StatefulWidget {
  const ReceptionistCheckinScreen({super.key});

  @override
  State<ReceptionistCheckinScreen> createState() => _ReceptionistCheckinScreenState();
}

class _ReceptionistCheckinScreenState extends State<ReceptionistCheckinScreen> {
  Future<List<Appointment>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<Appointment>> _fetch() async {
    try {
      final res = await ApiClient.instance.get('/appointments', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: []));
      final list = <Appointment>[];
      for (final item in res.list) {
        try {
          final a = Appointment.fromJson(item);
          if (a.status == 'upcoming' || a.status == 'confirmed') list.add(a);
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

  @override
  Widget build(BuildContext context) {
    // No own Scaffold/AppBar — only ever embedded as a RoleScaffold nav-item body.
    return RefreshIndicator(
      onRefresh: () async => _load(),
      child: FutureBuilder<List<Appointment>>(
        future: _future,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final appts = snapshot.data ?? [];
          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              const PageHeader(title: 'Check-in / check-out'),
              const Text(
                'Check-in status is set automatically by the booking/queue system — the current API '
                'has no manual check-in endpoint.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.md),
              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),
              if (!loading && !snapshot.hasError)
                appts.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.only(top: AppSpacing.xl),
                        child: EmptyStateView(icon: Icons.how_to_reg_outlined, title: 'No upcoming/confirmed appointments'),
                      )
                    : Column(
                        children: [
                          for (var i = 0; i < appts.length; i++) ...[
                            if (i > 0) const Divider(height: 1),
                            _CheckinRow(appointment: appts[i]),
                          ],
                        ],
                      ),
            ],
          );
        },
      ),
    );
  }
}

class _CheckinRow extends StatelessWidget {
  final Appointment appointment;
  const _CheckinRow({required this.appointment});

  @override
  Widget build(BuildContext context) {
    final checkedIn = appointment.checkedInAt != null && appointment.checkedInAt!.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Dr. ${appointment.doctor?.name ?? "—"}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                const SizedBox(height: 2),
                Text(
                  '${appointment.appointmentTime.isNotEmpty ? appointment.appointmentTime : "—"} · Token: ${appointment.tokenNumber ?? "—"}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          checkedIn
              ? const StatusBadge(status: 'completed')
              : const Text('Not checked in', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ],
      ),
    );
  }
}
