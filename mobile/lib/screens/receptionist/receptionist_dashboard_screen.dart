import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'receptionist_appointments_screen.dart';
import 'receptionist_queue_screen.dart';

/// Receptionist dashboard — clinic name + today's appointment/queue
/// snapshot. /appointments and /queue are already hard-scoped server-side
/// to the receptionist's own `clinicId` (empty list if unassigned) —
/// integration_plan.md §1.8/§1.9.
class ReceptionistDashboardScreen extends StatefulWidget {
  const ReceptionistDashboardScreen({super.key});

  @override
  State<ReceptionistDashboardScreen> createState() => _ReceptionistDashboardScreenState();
}

class _ReceptionistDashboardScreenState extends State<ReceptionistDashboardScreen> {
  Future<_DashboardData>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() => _future = _fetch());
  }

  Future<_DashboardData> _fetch() async {
    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    final clinicId = context.read<AuthProvider>().profile?.clinicId;
    final futures = <Future<ApiResponse>>[
      ApiClient.instance.get('/appointments', query: {'date': today, 'pageSize': 100}),
      ApiClient.instance.get('/queue', query: {'date': today, 'pageSize': 100}),
    ];
    final results = await Future.wait(futures);
    Clinic? clinic;
    if (clinicId != null && clinicId.isNotEmpty) {
      try {
        final res = await ApiClient.instance.get('/clinics/$clinicId');
        clinic = Clinic.fromJson(res.map);
      } catch (_) {
        // Non-fatal — dashboard still shows counts even if clinic detail fails.
      }
    }
    return _DashboardData(
      appointments: results[0].list.map(Appointment.fromJson).toList(),
      queue: results[1].list.map(QueueTokenItem.fromJson).toList(),
      clinic: clinic,
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;

    return RefreshIndicator(
      onRefresh: () async => _load(),
      child: FutureBuilder<_DashboardData>(
        future: _future,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final data = snapshot.data;
          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              PageHeader(
                kicker: 'Production database',
                title: 'Welcome, ${user?.name ?? ''}.',
                subtitle: 'Your authenticated workspace is connected to live records.',
              ),
              SectionCard(
                title: 'Clinic',
                child: Text(
                  data?.clinic != null ? 'Clinic: ${data!.clinic!.name}' : (loading ? 'Loading clinic…' : 'No clinic assignment on file'),
                  style: const TextStyle(color: AppColors.textSecondary),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),
              if (data != null)
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: "Today's appointments",
                        value: '${data.appointments.length}',
                        icon: Icons.event_note_outlined,
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(
                          // No AppBar title here — ReceptionistAppointmentsScreen's own PageHeader
                          // already shows "Appointments"; a title here would duplicate it.
                          builder: (_) => Scaffold(appBar: AppBar(), body: const ReceptionistAppointmentsScreen()),
                        )),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'In queue now',
                        value: '${data.queue.where((q) => q.status != 'completed').length}',
                        icon: Icons.people_alt_outlined,
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => Scaffold(appBar: AppBar(title: const Text('Queue')), body: const ReceptionistQueueScreen()),
                        )),
                      ),
                    ),
                  ],
                ),
              // Mirrors the web app's ReceptionDashboard "Assigned doctors" section
              // (StaffPages.jsx) — the same clinic-scoped `clinic.doctors` list already
              // fetched above for the "Clinic" card, not the platform-wide directory.
              if (data?.clinic != null) ...[
                const SizedBox(height: AppSpacing.md),
                SectionCard(
                  title: 'Assigned doctors',
                  child: data!.clinic!.doctors.isEmpty
                      ? const Text('No doctors assigned', style: TextStyle(color: AppColors.textSecondary))
                      : Column(
                          children: data.clinic!.doctors.map((doc) {
                            return Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Row(
                                children: [
                                  Expanded(child: Text(doc.name)),
                                  StatusBadge(status: doc.onlineBooking ? 'active' : 'paused'),
                                ],
                              ),
                            );
                          }).toList(),
                        ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _DashboardData {
  final List<Appointment> appointments;
  final List<QueueTokenItem> queue;
  final Clinic? clinic;
  _DashboardData({required this.appointments, required this.queue, this.clinic});
}
