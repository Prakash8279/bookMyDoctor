import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'doctor_appointments_screen.dart';
import 'doctor_queue_screen.dart';

/// Doctor dashboard — today's appointment count + a live queue snapshot,
/// pulled from the same /appointments and /queue endpoints the dedicated
/// tabs use. Both are already hard-scoped server-side to this doctor (no
/// admin bypass, no doctorId query param needed) — integration_plan.md
/// §1.8/§1.9.
class DoctorDashboardScreen extends StatefulWidget {
  const DoctorDashboardScreen({super.key});

  @override
  State<DoctorDashboardScreen> createState() => _DoctorDashboardScreenState();
}

class _DoctorDashboardScreenState extends State<DoctorDashboardScreen> {
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
    final results = await Future.wait([
      ApiClient.instance.get('/appointments', query: {'date': today, 'pageSize': 100}),
      ApiClient.instance.get('/queue', query: {'date': today, 'pageSize': 100}),
    ]);
    return _DashboardData(
      appointments: results[0].list.map(Appointment.fromJson).toList(),
      queue: results[1].list.map(QueueTokenItem.fromJson).toList(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    final profile = auth.profile;

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
              // Mirrors the web app's DoctorDashboard `Page` header (StaffPages.jsx) —
              // same kicker + "Welcome, {name}." title + subtitle copy.
              PageHeader(
                kicker: 'Production database',
                title: 'Welcome, ${user?.name ?? ''}.',
                subtitle: 'Your authenticated workspace is connected to live records.',
              ),
              const SizedBox(height: AppSpacing.md),
              // Renamed from "Welcome, Dr. {name}" — the greeting is now shown once, by the
              // PageHeader above; this card is really the practice-details summary.
              SectionCard(
                title: 'Practice details',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Specialization: ${profile?.specialization?['name'] ?? '—'}'),
                    Text('Consultation fee: ₹${profile?.consultationFee?.toStringAsFixed(0) ?? '—'}'),
                    Text('Verification status: ${profile?.doctorStatus ?? '—'}'),
                    if (profile?.doctorStatus != null && profile?.doctorStatus != 'verified') ...[
                      const SizedBox(height: AppSpacing.sm),
                      const Text(
                        'Your account is not verified yet — patients cannot find or book you until admin verification is complete.',
                        style: TextStyle(color: AppColors.warning, fontSize: 12),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),
              if (data != null) ...[
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: "Today's appointments",
                        value: '${data.appointments.length}',
                        icon: Icons.event_note_outlined,
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(
                          // No AppBar title here — DoctorAppointmentsScreen's own PageHeader
                          // already shows "Appointments"; a title here would duplicate it.
                          builder: (_) => Scaffold(appBar: AppBar(), body: const DoctorAppointmentsScreen()),
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
                          builder: (_) => Scaffold(appBar: AppBar(title: const Text('Queue')), body: const DoctorQueueScreen()),
                        )),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                SectionCard(
                  title: "Today's queue",
                  child: data.queue.isEmpty
                      ? const Text('No queue tokens for today', style: TextStyle(color: AppColors.textSecondary))
                      : Column(
                          children: data.queue.take(5).map((q) {
                            return Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Row(
                                children: [
                                  Text('#${q.tokenNumber}', style: const TextStyle(fontWeight: FontWeight.w700)),
                                  const SizedBox(width: AppSpacing.sm),
                                  Expanded(child: Text(q.patient?.name ?? 'Patient')),
                                  StatusBadge(status: q.status),
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
  _DashboardData({required this.appointments, required this.queue});
}
