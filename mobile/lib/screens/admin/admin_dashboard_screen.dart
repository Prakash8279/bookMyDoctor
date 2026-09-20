import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../models/clinical_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/role_scaffold.dart';
import 'admin_appointments_screen.dart';
import 'admin_clinics_screen.dart';
import 'admin_doctors_screen.dart';
import 'admin_geography_screen.dart';
import 'admin_patients_screen.dart';
import 'admin_revenue_reports_screen.dart';

/// Admin dashboard — 100% parity with web's AdminDashboard (AdminPages.jsx):
/// Header with "Review doctors" action, 4 StatCards (Verified doctors, Registered patients,
/// Today's bookings, Monthly revenue), "Recent live records" with Connected badge and DC sequence IDs,
/// and "Quick actions" (Doctors, Patients, Clinics, Cities & areas).
class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  Future<_AdminDashboardData>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<_AdminDashboardData> _fetch() async {
    final results = await Future.wait([
      ApiClient.instance.get('/admin/dashboard-stats').then((res) => DashboardStats.fromJson(res.map)),
      ApiClient.instance.get('/appointments', query: {'pageSize': 20}).catchError((_) => ApiResponse(data: [])),
    ]);
    final appointments = <Appointment>[];
    for (final item in (results[1] as ApiResponse).list) {
      try {
        appointments.add(Appointment.fromJson(item));
      } catch (_) {}
    }
    return _AdminDashboardData(
      stats: results[0] as DashboardStats,
      appointments: appointments,
    );
  }

  void _goToDoctors(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Doctors')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Doctors')), body: const AdminDoctorsScreen()),
    ));
  }

  void _goToPatients(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Patients')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Patients')), body: const AdminPatientsScreen()),
    ));
  }

  void _goToAppointments(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Appointments')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Appointments')), body: const AdminAppointmentsScreen()),
    ));
  }

  void _goToRevenue(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Revenue')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Revenue')), body: const AdminRevenueReportsScreen()),
    ));
  }

  void _goToClinics(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Clinics')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Clinics')), body: const AdminClinicsScreen()),
    ));
  }

  void _goToGeography(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Cities')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Cities & areas')), body: const AdminGeographyScreen(focusSpecializations: false)),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final firstName = (user != null && user.name.isNotEmpty) ? user.name.split(' ').first : 'Admin';

    return RefreshIndicator(
      onRefresh: () async => _load(),
      child: FutureBuilder<_AdminDashboardData>(
        future: _future,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final data = snapshot.data;
          final stats = data?.stats;
          final appointments = data?.appointments ?? [];
          final recentRecords = appointments.reversed.take(6).toList();

          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              // PageHeader with "Review doctors" action
              PageHeader(
                title: 'Welcome, $firstName.',
                subtitle: 'Your authenticated workspace is connected to live records.',
                action: ElevatedButton(
                  onPressed: () => _goToDoctors(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primaryDark,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: const Text('Review doctors', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                ),
              ),

              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),

              if (stats != null) ...[
                // Stat Cards (2x2 Grid)
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: 'VERIFIED DOCTORS',
                        value: '${stats.verifiedDoctorsCount}',
                        icon: Icons.medical_services_outlined,
                        onTap: () => _goToDoctors(context),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'REGISTERED PATIENTS',
                        value: '${stats.registeredPatientsCount}',
                        icon: Icons.people_outline,
                        onTap: () => _goToPatients(context),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: "TODAY'S BOOKINGS",
                        value: '${stats.todaysBookingsCount}',
                        icon: Icons.event_note_outlined,
                        onTap: () => _goToAppointments(context),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'MONTHLY REVENUE',
                        value: '₹${stats.monthlyRevenue.toStringAsFixed(0)}',
                        icon: Icons.receipt_long_outlined,
                        onTap: () => _goToRevenue(context),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),

                // Recent live records with Connected badge and DC sequence IDs
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Recent live records', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppColors.success.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: const Text('Connected', style: TextStyle(color: AppColors.success, fontWeight: FontWeight.w700, fontSize: 11)),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        if (recentRecords.isEmpty)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
                            child: Text('No live records yet. Consultations will appear here as they happen.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                          )
                        else
                          ...recentRecords.asMap().entries.map((entry) {
                            final index = entry.key;
                            final item = entry.value;
                            final seqId = 'DC${(index + 1).toString().padLeft(2, '0')}';
                            final timeStr = '${item.appointmentDate} ${item.appointmentTime}'.trim();
                            return Container(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              decoration: const BoxDecoration(
                                border: Border(bottom: BorderSide(color: Color(0xFFF3F0EC))),
                              ),
                              child: Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: AppColors.surface,
                                      borderRadius: BorderRadius.circular(4),
                                      border: Border.all(color: AppColors.border),
                                    ),
                                    child: Text('#$seqId', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 11, color: AppColors.primaryDark)),
                                  ),
                                  const SizedBox(width: AppSpacing.sm),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(item.patient?.name ?? 'Patient', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                                        Text(
                                          timeStr.isNotEmpty ? timeStr : 'Today',
                                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                        ),
                                      ],
                                    ),
                                  ),
                                  StatusBadge(status: item.status),
                                ],
                              ),
                            );
                          }),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                // Quick actions
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Quick actions', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: AppSpacing.sm),
                        _buildActionRow(
                          context,
                          icon: Icons.medical_services_outlined,
                          label: 'Doctors',
                          onTap: () => _goToDoctors(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.people_outline,
                          label: 'Patients',
                          onTap: () => _goToPatients(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.local_hospital_outlined,
                          label: 'Clinics',
                          onTap: () => _goToClinics(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.map_outlined,
                          label: 'Cities & areas',
                          onTap: () => _goToGeography(context),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _buildActionRow(BuildContext context, {required IconData icon, required String label, required VoidCallback onTap}) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border.withValues(alpha: 0.6)),
      ),
      child: ListTile(
        leading: Icon(icon, color: AppColors.primaryDark),
        title: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
        subtitle: const Text('Open live workspace', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        trailing: const Icon(Icons.chevron_right, color: AppColors.textSecondary),
        onTap: onTap,
      ),
    );
  }
}

class _AdminDashboardData {
  final DashboardStats stats;
  final List<Appointment> appointments;
  _AdminDashboardData({required this.stats, required this.appointments});
}
