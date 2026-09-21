import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/role_scaffold.dart';

class _SuperAdminEntitiesData {
  final DashboardStats stats;
  final int totalDoctors;
  final int totalPatients;
  final int totalClinics;
  final int pendingClinics;
  final int totalReceptionists;

  const _SuperAdminEntitiesData({
    required this.stats,
    required this.totalDoctors,
    required this.totalPatients,
    required this.totalClinics,
    required this.pendingClinics,
    required this.totalReceptionists,
  });
}

/// Super Admin People & clinics screen — 100% parity with web's SuperAdminEntities (FeaturePages.jsx):
/// 4 Entity cards (Doctors, Patients, Clinics, Receptionists) with live counters and jump actions,
/// plus pending clinic approval queue status.
class SuperAdminEntitiesScreen extends StatefulWidget {
  const SuperAdminEntitiesScreen({super.key});

  @override
  State<SuperAdminEntitiesScreen> createState() => _SuperAdminEntitiesScreenState();
}

class _SuperAdminEntitiesScreenState extends State<SuperAdminEntitiesScreen> {
  Future<_SuperAdminEntitiesData>? _future;

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

  Future<_SuperAdminEntitiesData> _fetch() async {
    final results = await Future.wait([
      ApiClient.instance.get('/admin/dashboard-stats').then((res) => DashboardStats.fromJson(res.map)),
      ApiClient.instance.get('/clinics', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: [])),
      ApiClient.instance.get('/doctors', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: [])),
      ApiClient.instance.get('/receptionists', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: [])),
    ]);

    final stats = results[0] as DashboardStats;
    final clinicsRes = results[1] as ApiResponse;
    final doctorsRes = results[2] as ApiResponse;
    final receptionistsRes = results[3] as ApiResponse;

    int pendingClinics = 0;
    for (final item in clinicsRes.list) {
      try {
        if (item['approvalStatus'] == 'pending') pendingClinics++;
      } catch (_) {}
    }

    return _SuperAdminEntitiesData(
      stats: stats,
      totalDoctors: stats.verifiedDoctorsCount > 0 ? stats.verifiedDoctorsCount : doctorsRes.list.length,
      totalPatients: stats.registeredPatientsCount,
      totalClinics: clinicsRes.list.length,
      pendingClinics: pendingClinics,
      totalReceptionists: receptionistsRes.list.length,
    );
  }

  void _goTo(String label) {
    final nav = RoleScaffold.of(context);
    nav?.navigateToLabel(label);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_SuperAdminEntitiesData>(
      future: _future,
      builder: (context, snapshot) {
        final loading = snapshot.connectionState != ConnectionState.done;
        final data = snapshot.data;

        return RefreshIndicator(
          onRefresh: () async => _load(),
          child: ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              const PageHeader(
                title: 'People & clinics',
                subtitle: 'Choose what you want to manage.',
              ),
              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),
              if (data != null) ...[
                _buildEntityCard(
                  title: 'Doctors',
                  count: '${data.totalDoctors}',
                  description: 'Create accounts, verify profiles, and enable or disable access.',
                  actionLabel: 'Open doctors →',
                  icon: Icons.medical_services_outlined,
                  onTap: () => _goTo('Doctors'),
                ),
                _buildEntityCard(
                  title: 'Patients',
                  count: '${data.totalPatients}',
                  description: 'Review registered patients and account status.',
                  actionLabel: 'Open patients →',
                  icon: Icons.people_outline,
                  onTap: () => _goTo('Patients'),
                ),
                _buildEntityCard(
                  title: 'Clinics',
                  count: '${data.totalClinics}',
                  description: 'Control clinic availability and emergency services.',
                  actionLabel: 'Open clinics →',
                  icon: Icons.apartment_outlined,
                  onTap: () => _goTo('Clinic tenants'),
                ),
                _buildEntityCard(
                  title: 'Receptionists',
                  count: '${data.totalReceptionists}',
                  description: 'Manage front-desk staff linked to clinics.',
                  actionLabel: 'Open receptionists →',
                  icon: Icons.support_agent_outlined,
                  onTap: () => _goTo('Receptionists'),
                ),
                const SizedBox(height: AppSpacing.md),

                // Pending approvals section
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Pending approvals', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: 2),
                        const Text(
                          'New clinic requests stay separate until approved.',
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Row(
                          children: [
                            Expanded(
                              child: Container(
                                padding: const EdgeInsets.all(AppSpacing.md),
                                decoration: BoxDecoration(
                                  color: AppColors.surface,
                                  borderRadius: BorderRadius.circular(AppRadius.button),
                                ),
                                child: const Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Doctors waiting', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                                    SizedBox(height: 4),
                                    Text('Auto-verified', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: InkWell(
                                onTap: () => _goTo('Clinic verification'),
                                borderRadius: BorderRadius.circular(AppRadius.button),
                                child: Container(
                                  padding: const EdgeInsets.all(AppSpacing.md),
                                  decoration: BoxDecoration(
                                    color: AppColors.surface,
                                    borderRadius: BorderRadius.circular(AppRadius.button),
                                    border: data.pendingClinics > 0
                                        ? Border.all(color: AppColors.warning.withValues(alpha: 0.5))
                                        : null,
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('Clinics waiting', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                                      const SizedBox(height: 4),
                                      Text(
                                        '${data.pendingClinics}',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w700,
                                          fontSize: 22,
                                          color: data.pendingClinics > 0 ? AppColors.warning : AppColors.textPrimary,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (data.pendingClinics > 0) ...[
                          const SizedBox(height: AppSpacing.md),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: () => _goTo('Clinic verification'),
                              icon: const Icon(Icons.verified_outlined, size: 16),
                              label: const Text('Review pending clinics'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.primaryDark,
                                foregroundColor: Colors.white,
                              ),
                            ),
                          ),
                        ],
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

  Widget _buildEntityCard({
    required String title,
    required String count,
    required String description,
    required String actionLabel,
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(icon, color: AppColors.primaryDark, size: 22),
                      const SizedBox(width: AppSpacing.sm),
                      Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.primaryLight,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      count,
                      style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w700, fontSize: 14),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(description, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4)),
              const SizedBox(height: AppSpacing.sm),
              Text(actionLabel, style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w700, fontSize: 13)),
            ],
          ),
        ),
      ),
    );
  }
}
