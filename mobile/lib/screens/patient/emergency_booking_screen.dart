import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'book_appointment_screen.dart';

/// COMPLETENESS FIX (mobile parity — client/src/pages/FeaturePages.jsx#PatientEmergencyBooking
/// had no mobile equivalent). Lists clinics flagged `emergencyAvailable` with a call button and a
/// button that lands on BookAppointmentScreen with the emergency toggle already on — same two
/// actions the web page offers, since this platform is not itself an emergency helpline.
class EmergencyBookingScreen extends StatefulWidget {
  const EmergencyBookingScreen({super.key});

  @override
  State<EmergencyBookingScreen> createState() => _EmergencyBookingScreenState();
}

class _EmergencyBookingScreenState extends State<EmergencyBookingScreen> {
  Future<List<Clinic>>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() {
      _future = ApiClient.instance
          .get('/clinics', query: {'emergencyAvailable': true, 'pageSize': 100})
          .then((res) => res.list.map(Clinic.fromJson).toList());
    });
  }

  Future<void> _call(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'\s'), ''));
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  @override
  Widget build(BuildContext context) {
    // No own Scaffold — this screen is only ever embedded as a RoleScaffold nav-item body
    // (patient_home_screen.dart), which already supplies the app bar; a nested bodyless Scaffold
    // here added nothing and broke from every sibling nav-item screen's pattern.
    return Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Emergency booking',
              subtitle: 'For life-threatening emergencies, contact local emergency services immediately.',
            ),
          ),
          Expanded(
            child: FutureBuilder<List<Clinic>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: ErrorBanner(error: snapshot.error!, onRetry: _load),
                  );
                }
                final clinics = snapshot.data ?? [];
                if (clinics.isEmpty) {
                  return const EmptyStateView(
                    icon: Icons.local_hospital_outlined,
                    title: 'No emergency clinics listed right now',
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: clinics.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final clinic = clinics[i];
                      return Card(
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: BorderSide(color: AppColors.danger.withOpacity(0.3)),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(clinic.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                              if (clinic.address != null) ...[
                                const SizedBox(height: 4),
                                Text(clinic.address!, style: const TextStyle(color: AppColors.textSecondary)),
                              ],
                              const SizedBox(height: AppSpacing.md),
                              Row(
                                children: [
                                  if (clinic.phone != null)
                                    Expanded(
                                      child: OutlinedButton.icon(
                                        style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger, side: const BorderSide(color: AppColors.danger)),
                                        onPressed: () => _call(clinic.phone!),
                                        icon: const Icon(Icons.call, size: 16),
                                        label: const Text('Call now'),
                                      ),
                                    ),
                                  if (clinic.phone != null) const SizedBox(width: AppSpacing.sm),
                                  Expanded(
                                    child: ElevatedButton(
                                      onPressed: () => Navigator.of(context).push(
                                        MaterialPageRoute(builder: (_) => const BookAppointmentScreen(initialEmergency: true)),
                                      ),
                                      child: const Text('Book urgent visit'),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      );
  }
}
