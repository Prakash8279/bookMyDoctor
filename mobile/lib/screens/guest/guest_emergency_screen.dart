import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../patient/doctor_detail_screen.dart';

/// COMPLETENESS FIX (mobile parity — client/src/pages/PublicPages.jsx#EmergencyPage, the public
/// "Doctors and clinics available now" page at web's /emergency, had no mobile equivalent). GET
/// /doctors?emergencyAvailable=true is optionalAuthenticate, so this works signed out. Tapping a
/// doctor opens the normal doctor profile — DoctorDetailScreen already prompts login before
/// booking, so a guest can browse this list and read profiles without an account, same as web.
class GuestEmergencyScreen extends StatefulWidget {
  const GuestEmergencyScreen({super.key});

  @override
  State<GuestEmergencyScreen> createState() => _GuestEmergencyScreenState();
}

class _GuestEmergencyScreenState extends State<GuestEmergencyScreen> {
  Future<List<DoctorDirectoryItem>>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() {
      _future = ApiClient.instance
          .get('/doctors', query: {'emergencyAvailable': true, 'pageSize': 100})
          .then((res) => res.list.map(DoctorDirectoryItem.fromJson).toList());
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Emergency care')),
      body: Column(
        children: [
          // Mirrors the web app's public emergency page — client/src/pages/PublicPages.jsx#
          // EmergencyPage renders an "Emergency care" badge over "Doctors and clinics available
          // now" — via the same kicker+title PageHeader block used across the app.
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              kicker: 'Emergency care',
              title: 'Doctors and clinics available now',
            ),
          ),
          Container(
            width: double.infinity,
            color: AppColors.danger.withOpacity(0.08),
            padding: const EdgeInsets.all(AppSpacing.md),
            child: const Text(
              'For life-threatening emergencies, contact local emergency services immediately. This platform is not an emergency helpline.',
              style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<DoctorDirectoryItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: ErrorBanner(error: snapshot.error!, onRetry: _load),
                  );
                }
                final doctors = snapshot.data ?? [];
                if (doctors.isEmpty) {
                  return const EmptyStateView(
                    icon: Icons.local_hospital_outlined,
                    title: 'No emergency doctors available right now',
                    subtitle: 'Emergency-ready doctors will appear here when marked available.',
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: doctors.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final doctor = doctors[i];
                      return Card(
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: BorderSide(color: AppColors.danger.withOpacity(0.3)),
                        ),
                        child: ListTile(
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => DoctorDetailScreen(doctorId: doctor.id)),
                          ),
                          title: Text(doctor.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text(
                            '${doctor.specialization?.name ?? 'General practice'}${doctor.clinics.isNotEmpty ? " · ${doctor.clinics.first.name}" : ""}',
                          ),
                          trailing: const Icon(Icons.chevron_right),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
