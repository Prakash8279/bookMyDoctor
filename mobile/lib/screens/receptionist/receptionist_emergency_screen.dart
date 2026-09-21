import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (mobile parity audit): ports web's `ReceptionEmergency`
/// (FeaturePages.jsx, route /receptionist/emergency) — a read-only, derived view. The queue-token
/// schema itself has no `isEmergency` flag, so this cross-references the already-loaded
/// appointments list (isEmergency) against today's queue tokens (by appointmentId), same as web.
/// No actions here — not even the Call/Start/Complete buttons the regular Queue screen has; this
/// is purely a filtered visibility view for the front desk to see which walk-ins are flagged urgent.
class ReceptionistEmergencyScreen extends StatefulWidget {
  const ReceptionistEmergencyScreen({super.key});

  @override
  State<ReceptionistEmergencyScreen> createState() => _ReceptionistEmergencyScreenState();
}

class _ReceptionistEmergencyScreenState extends State<ReceptionistEmergencyScreen> {
  Future<List<QueueTokenItem>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<QueueTokenItem>> _fetch() async {
    try {
      final results = await Future.wait([
        ApiClient.instance.get('/appointments', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: [])),
        ApiClient.instance.get('/queue', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: [])),
      ]);
      final emergencyAppointmentIds = <String>{};
      for (final item in results[0].list) {
        try {
          final a = Appointment.fromJson(item);
          if (a.isEmergency) emergencyAppointmentIds.add(a.id);
        } catch (_) {}
      }
      final tokens = <QueueTokenItem>[];
      for (final item in results[1].list) {
        try {
          final t = QueueTokenItem.fromJson(item);
          if (t.status != 'completed' && emergencyAppointmentIds.contains(t.appointmentId)) tokens.add(t);
        } catch (_) {}
      }
      return tokens;
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
      child: FutureBuilder<List<QueueTokenItem>>(
        future: _future,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final tokens = snapshot.data ?? [];
          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              const PageHeader(
                title: 'Emergency queue',
                subtitle: 'Urgent walk-ins are prioritised and visible to the assigned doctor.',
              ),
              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),
              if (!loading && !snapshot.hasError)
                tokens.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.only(top: AppSpacing.xl),
                        child: EmptyStateView(icon: Icons.warning_amber_outlined, title: 'No emergency tokens waiting'),
                      )
                    : Column(
                        children: [
                          for (var i = 0; i < tokens.length; i++)
                            Card(
                              color: const Color(0xFFFEF2F2),
                              margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                              child: Padding(
                                padding: const EdgeInsets.all(AppSpacing.md),
                                child: Row(
                                  children: [
                                    CircleAvatar(
                                      backgroundColor: AppColors.danger.withValues(alpha: 0.12),
                                      child: Text(
                                        '#${tokens[i].tokenNumber}',
                                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12, color: AppColors.danger),
                                      ),
                                    ),
                                    const SizedBox(width: AppSpacing.md),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(tokens[i].patient?.name ?? '—', style: const TextStyle(fontWeight: FontWeight.w700)),
                                          const SizedBox(height: 2),
                                          Text('Ahead in queue: ${tokens[i].patientsAhead}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                                        ],
                                      ),
                                    ),
                                    StatusBadge(status: tokens[i].status),
                                  ],
                                ),
                              ),
                            ),
                        ],
                      ),
            ],
          );
        },
      ),
    );
  }
}
