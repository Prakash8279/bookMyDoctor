import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'admin_doctors_screen.dart';

/// GET /admin/dashboard-stats — the real, server-computed numbers
/// (integration_plan.md §1.18), not client-derived guesses.
class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  Future<DashboardStats>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() {
      _future = ApiClient.instance.get('/admin/dashboard-stats').then((res) => DashboardStats.fromJson(res.map));
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final firstName = (user != null && user.name.isNotEmpty) ? user.name.split(' ').first : 'Admin';
    return RefreshIndicator(
      onRefresh: () async => _load(),
      child: FutureBuilder<DashboardStats>(
        future: _future,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final stats = snapshot.data;
          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              // Mirrors the web app's AdminDashboard `Page` header (AdminPages.jsx) —
              // same "Welcome, {firstName}." title + subtitle copy.
              PageHeader(
                title: 'Welcome, $firstName.',
                subtitle: 'Your authenticated workspace is connected to live records.',
              ),
              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),
              if (stats != null) ...[
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: 'Verified doctors',
                        value: '${stats.verifiedDoctorsCount}',
                        icon: Icons.medical_services_outlined,
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => Scaffold(appBar: AppBar(title: const Text('Doctors')), body: const AdminDoctorsScreen()),
                        )),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(child: StatCard(label: 'Registered patients', value: '${stats.registeredPatientsCount}', icon: Icons.people_outline)),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(child: StatCard(label: "Today's bookings", value: '${stats.todaysBookingsCount}', icon: Icons.event_note_outlined)),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(child: StatCard(label: 'Monthly revenue', value: '₹${stats.monthlyRevenue.toStringAsFixed(0)}', icon: Icons.currency_rupee)),
                  ],
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}
