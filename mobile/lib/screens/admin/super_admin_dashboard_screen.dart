import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/role_scaffold.dart';

class _SuperAdminDashboardData {
  final DashboardStats stats;
  final int totalClinics;
  final int pendingClinics;
  final int totalDoctors;
  final int totalReceptionists;
  final List<ActivityLogEntry> activity;

  const _SuperAdminDashboardData({
    required this.stats,
    required this.totalClinics,
    required this.pendingClinics,
    required this.totalDoctors,
    required this.totalReceptionists,
    required this.activity,
  });
}

/// Super Admin control center — 100% parity with web's SuperAdminDashboard (FeaturePages.jsx):
/// Stat cards (Doctors & clinics, Platform users, Monthly revenue), pending clinic reviews alert banner,
/// quick navigation cards (People & clinics, Payments & revenue, Platform charges, Cities, Clinic tenants,
/// Security & activity, Content & broadcasts, System settings), recent platform activity logs,
/// and role workspace shortcuts.
class SuperAdminDashboardScreen extends StatefulWidget {
  const SuperAdminDashboardScreen({super.key});

  @override
  State<SuperAdminDashboardScreen> createState() => _SuperAdminDashboardScreenState();
}

class _SuperAdminDashboardScreenState extends State<SuperAdminDashboardScreen> {
  Future<_SuperAdminDashboardData>? _future;

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

  Future<_SuperAdminDashboardData> _fetch() async {
    final results = await Future.wait([
      ApiClient.instance.get('/admin/dashboard-stats').then((res) => DashboardStats.fromJson(res.map)),
      ApiClient.instance.get('/clinics', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: [])),
      ApiClient.instance.get('/doctors', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: [])),
      ApiClient.instance.get('/receptionists', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: [])),
      ApiClient.instance.get('/admin/activity-log', query: {'pageSize': 10}).catchError((_) => ApiResponse(data: [])),
    ]);

    final stats = results[0] as DashboardStats;
    final clinicsRes = results[1] as ApiResponse;
    final doctorsRes = results[2] as ApiResponse;
    final receptionistsRes = results[3] as ApiResponse;
    final activityRes = results[4] as ApiResponse;

    int pendingClinics = 0;
    for (final item in clinicsRes.list) {
      try {
        if (item['approvalStatus'] == 'pending') pendingClinics++;
      } catch (_) {}
    }

    final activity = <ActivityLogEntry>[];
    for (final item in activityRes.list) {
      try {
        activity.add(ActivityLogEntry.fromJson(item));
      } catch (_) {}
    }

    return _SuperAdminDashboardData(
      stats: stats,
      totalClinics: clinicsRes.list.length,
      pendingClinics: pendingClinics,
      totalDoctors: doctorsRes.list.length,
      totalReceptionists: receptionistsRes.list.length,
      activity: activity,
    );
  }

  void _goTo(String label) {
    final nav = RoleScaffold.of(context);
    nav?.navigateToLabel(label);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_SuperAdminDashboardData>(
      future: _future,
      builder: (context, snapshot) {
        final loading = snapshot.connectionState != ConnectionState.done;
        final data = snapshot.data;
        final stats = data?.stats;
        final totalUsers = (stats?.registeredPatientsCount ?? 0) + (data?.totalDoctors ?? 0) + (data?.totalReceptionists ?? 0);
        final pendingClinics = data?.pendingClinics ?? 0;

        return RefreshIndicator(
          onRefresh: () async => _load(),
          child: ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              const PageHeader(
                title: 'Super Admin control center',
                subtitle: 'One clear place to manage the complete BookADoctors platform.',
              ),
              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),
              if (stats != null) ...[
                // Stat cards (Doctors & clinics, Platform users, Monthly revenue)
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: 'DOCTORS & CLINICS',
                        value: '${stats.verifiedDoctorsCount} / ${data?.totalClinics ?? 0}',
                        icon: Icons.local_hospital_outlined,
                        onTap: () => _goTo('People & clinics'),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'PLATFORM USERS',
                        value: '$totalUsers',
                        icon: Icons.people_outline,
                        onTap: () => _goTo('People & clinics'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                StatCard(
                  label: 'MONTHLY REVENUE',
                  value: '₹${stats.monthlyRevenue.toStringAsFixed(0)}',
                  icon: Icons.currency_rupee,
                  onTap: () => _goTo('Payments & revenue'),
                ),
                const SizedBox(height: AppSpacing.md),

                // Pending approvals alert banner
                if (pendingClinics > 0) ...[
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: AppColors.warning.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(AppRadius.card),
                      border: Border.all(color: AppColors.warning.withValues(alpha: 0.4)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.warning_amber_rounded, color: AppColors.warning, size: 28),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '$pendingClinics clinic approval${pendingClinics == 1 ? '' : 's'} waiting for review',
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                              ),
                              const SizedBox(height: 2),
                              const Text(
                                'Review clinic submissions before making them available.',
                                style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        ElevatedButton(
                          onPressed: () => _goTo('Clinic verification'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.primaryDark,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          ),
                          child: const Text('Review', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],

                // Superadmin quick links grid
                const Text('Management sections', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                const SizedBox(height: AppSpacing.sm),
                _buildQuickCard(
                  title: 'People & clinics',
                  subtitle: 'Create and control doctors, patients, receptionists, and clinics.',
                  icon: Icons.groups_outlined,
                  onTap: () => _goTo('People & clinics'),
                ),
                _buildQuickCard(
                  title: 'Payments & revenue',
                  subtitle: 'Review every saved payment and the platform total.',
                  icon: Icons.currency_rupee,
                  onTap: () => _goTo('Payments & revenue'),
                ),
                _buildQuickCard(
                  title: 'Platform charges',
                  subtitle: 'Set platform commission %, convenience fees, and GST.',
                  icon: Icons.percent_outlined,
                  onTap: () => _goTo('Platform charges'),
                ),
                _buildQuickCard(
                  title: 'Cities & service areas',
                  subtitle: 'Add supported cities, areas, and pincodes.',
                  icon: Icons.map_outlined,
                  onTap: () => _goTo('Cities & service areas'),
                ),
                _buildQuickCard(
                  title: 'Clinic tenants',
                  subtitle: 'Enable or disable clinics and emergency service.',
                  icon: Icons.apartment_outlined,
                  onTap: () => _goTo('Clinic tenants'),
                ),
                _buildQuickCard(
                  title: 'Security & activity',
                  subtitle: 'Review live platform audit log and system events.',
                  icon: Icons.shield_outlined,
                  onTap: () => _goTo('Security & activity'),
                ),
                _buildQuickCard(
                  title: 'Content & broadcasts',
                  subtitle: 'Send announcements visible to platform users.',
                  icon: Icons.campaign_outlined,
                  onTap: () => _goTo('Content & broadcasts'),
                ),
                _buildQuickCard(
                  title: 'System settings',
                  subtitle: 'Update platform identity and maintenance mode.',
                  icon: Icons.settings_outlined,
                  onTap: () => _goTo('System settings'),
                ),
                const SizedBox(height: AppSpacing.md),

                // Recent platform activity
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Recent activity', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                                SizedBox(height: 2),
                                Text('Latest platform actions.', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              ],
                            ),
                            TextButton(
                              onPressed: () => _goTo('Security & activity'),
                              child: const Text('View all', style: TextStyle(fontWeight: FontWeight.w700)),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        if (data != null && data.activity.isNotEmpty)
                          ...data.activity.take(5).map((item) => Padding(
                                padding: const EdgeInsets.symmetric(vertical: 4),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
                                  decoration: BoxDecoration(
                                    color: AppColors.surface,
                                    borderRadius: BorderRadius.circular(AppRadius.button),
                                  ),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          item.description?.isNotEmpty == true ? item.description! : item.actionType,
                                          style: const TextStyle(fontSize: 13),
                                        ),
                                      ),
                                      const SizedBox(width: AppSpacing.sm),
                                      Text(
                                        item.createdAt != null && item.createdAt!.contains('T')
                                            ? item.createdAt!.split('T').first
                                            : (item.createdAt ?? ''),
                                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                                      ),
                                    ],
                                  ),
                                ),
                              ))
                        else
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: AppSpacing.sm),
                            child: Text('No activity records found.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                // Role workspaces
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Role workspaces', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: 2),
                        const Text(
                          'Super Admin can inspect every role workspace without leaving this login.',
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Wrap(
                          spacing: AppSpacing.sm,
                          runSpacing: AppSpacing.sm,
                          children: [
                            OutlinedButton.icon(
                              icon: const Icon(Icons.dashboard_outlined, size: 16),
                              label: const Text('Admin operations'),
                              onPressed: () => _goTo('Dashboard'),
                            ),
                            OutlinedButton.icon(
                              icon: const Icon(Icons.medical_services_outlined, size: 16),
                              label: const Text('Doctor workspace'),
                              onPressed: () => _goTo('Doctors'),
                            ),
                            OutlinedButton.icon(
                              icon: const Icon(Icons.support_agent_outlined, size: 16),
                              label: const Text('Reception desk'),
                              onPressed: () => _goTo('Receptionists'),
                            ),
                            OutlinedButton.icon(
                              icon: const Icon(Icons.people_outline, size: 16),
                              label: const Text('Patient view'),
                              onPressed: () => _goTo('Patients'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _buildQuickCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.card),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.card),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(AppRadius.button),
                ),
                child: Icon(icon, color: AppColors.primaryDark, size: 20),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: AppColors.textSecondary, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}
