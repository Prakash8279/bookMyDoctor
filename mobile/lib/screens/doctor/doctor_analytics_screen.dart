import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class DoctorAnalyticsScreen extends StatefulWidget {
  const DoctorAnalyticsScreen({super.key});

  @override
  State<DoctorAnalyticsScreen> createState() => _DoctorAnalyticsScreenState();
}

class _DoctorAnalyticsScreenState extends State<DoctorAnalyticsScreen> {
  late Future<Map<String, dynamic>> _future = _load();

  Future<Map<String, dynamic>> _load() async {
    final results = await Future.wait([
      ApiClient.instance.get('/appointments', query: {'pageSize': 100}),
      ApiClient.instance.get('/payments', query: {'pageSize': 100}),
    ]);
    final appointments = results[0].list;
    final payments = results[1].list;
    final completed = appointments.where((row) => row['status'] == 'completed').length;
    final cancelled = appointments.where((row) => row['status'] == 'cancelled').length;
    final revenue = payments.where((row) => row['status'] == 'paid').fold<double>(0, (sum, row) => sum + (num.tryParse((row['reportAmount'] ?? row['amount'] ?? 0).toString()) ?? 0).toDouble());
    return {'appointments': appointments.length, 'completed': completed, 'cancelled': cancelled, 'revenue': revenue};
  }

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(AppSpacing.md), children: [
        const PageHeader(title: 'Practice analytics', subtitle: 'Live totals derived from your appointments and payments.'),
        FutureBuilder<Map<String, dynamic>>(future: _future, builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) return ErrorBanner(error: snapshot.error!, onRetry: () => setState(() => _future = _load()));
          final value = snapshot.data!;
          final total = value['appointments'] as int;
          final completed = value['completed'] as int;
          final rate = total == 0 ? 0 : ((completed / total) * 100).round();
          return Wrap(spacing: AppSpacing.sm, runSpacing: AppSpacing.sm, children: [
            _AnalyticsCard(label: 'Appointments', value: '$total', icon: Icons.event_note_outlined),
            _AnalyticsCard(label: 'Completion rate', value: '$rate%', icon: Icons.task_alt),
            _AnalyticsCard(label: 'Cancelled', value: '${value['cancelled']}', icon: Icons.event_busy_outlined),
            _AnalyticsCard(label: 'Revenue', value: '₹${(value['revenue'] as double).toStringAsFixed(0)}', icon: Icons.currency_rupee),
          ]);
        }),
      ]);
}

class _AnalyticsCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  const _AnalyticsCard({required this.label, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) => Container(
        width: 155,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(AppRadius.card), border: Border.all(color: AppColors.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(icon, color: AppColors.primaryDark), const SizedBox(height: 10), Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)), Text(label, style: const TextStyle(color: AppColors.textSecondary))]),
      );
}
