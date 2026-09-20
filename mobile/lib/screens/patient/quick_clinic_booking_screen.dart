import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'book_appointment_screen.dart';

/// COMPLETENESS FIX (mobile parity — client/src/pages/FeaturePages.jsx#QuickClinicBooking had no
/// mobile equivalent). The web version's "Scan clinic QR" option is itself only a placeholder —
/// its own code comment says "Camera access is unavailable in this local browser demo" — so this
/// mirrors only the real path: look a clinic up by its registered phone number, then book one of
/// its doctors.
class QuickClinicBookingScreen extends StatefulWidget {
  const QuickClinicBookingScreen({super.key});

  @override
  State<QuickClinicBookingScreen> createState() => _QuickClinicBookingScreenState();
}

class _QuickClinicBookingScreenState extends State<QuickClinicBookingScreen> {
  final _phoneController = TextEditingController();
  bool _searching = false;
  bool _searched = false;
  String? _error;
  Clinic? _clinic;

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  String _digitsOnly(String value) => value.replaceAll(RegExp(r'\D'), '');

  Future<void> _lookup() async {
    final query = _digitsOnly(_phoneController.text);
    if (query.isEmpty) {
      setState(() => _error = 'Enter the clinic\'s registered phone number.');
      return;
    }
    setState(() {
      _searching = true;
      _searched = true;
      _error = null;
      _clinic = null;
    });
    try {
      final listRes = await ApiClient.instance.get('/clinics', query: {'pageSize': 100});
      Map<String, dynamic> match = const {};
      for (final row in listRes.list) {
        if (_digitsOnly((row['phone'] as String?) ?? '').contains(query)) {
          match = row;
          break;
        }
      }
      if (match.isEmpty) {
        setState(() => _searching = false);
        return;
      }
      final detailRes = await ApiClient.instance.get('/clinics/${match['id']}');
      setState(() {
        _clinic = Clinic.fromJson(detailRes.map);
        _searching = false;
      });
    } catch (err) {
      setState(() {
        _error = err.toString();
        _searching = false;
      });
    }
  }

  Future<void> _bookDoctor(ClinicDoctorLink link) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );
    try {
      final doctorRes = await ApiClient.instance.get('/doctors/${link.doctorUserId}');
      final doctor = DoctorDirectoryItem.fromJson(doctorRes.map);
      if (!mounted) return;
      Navigator.of(context).pop();
      Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => BookAppointmentScreen(preselectedDoctor: doctor)),
      );
    } catch (err) {
      if (!mounted) return;
      Navigator.of(context).pop();
      showErrorSnack(context, err);
    }
  }

  @override
  Widget build(BuildContext context) {
    // No own Scaffold/AppBar — this screen is only ever embedded as a RoleScaffold nav-item body
    // (patient_home_screen.dart), which already supplies the app bar. The PageHeader below is the
    // in-body title/subtitle block, matching every other nav-item screen in the app.
    return SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const PageHeader(
              title: 'Quick clinic booking',
              subtitle: 'Scan a clinic QR code or enter its registered phone number.',
            ),
            // Web shows this as two side-by-side panels — "Option 1 · Scan clinic QR" and
            // "Option 2 · Clinic registered number" (FeaturePages.jsx#QuickClinicBooking) — mirrored
            // here as two SectionCards (stacked on a phone's narrow width, same as web's own
            // lg:grid-cols-2 falling back to one column below that breakpoint) instead of a single
            // flat form with no visual sign a QR option exists at all.
            SectionCard(
              title: 'Option 1 · Scan clinic QR',
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg, horizontal: AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.background,
                  borderRadius: BorderRadius.circular(AppRadius.button),
                  border: Border.all(color: AppColors.border),
                ),
                child: const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.qr_code_2, size: 40, color: AppColors.textSecondary),
                    SizedBox(height: AppSpacing.sm),
                    Text(
                      'Camera scanning isn\'t available in this app version — use the clinic\'s registered phone number below instead.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            SectionCard(
              title: 'Option 2 · Clinic registered number',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Enter a clinic\'s registered phone number to find it and book one of its doctors directly.',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  TextField(
                    controller: _phoneController,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Clinic phone number',
                      hintText: 'e.g. +91 22 4000 1111',
                      prefixIcon: Icon(Icons.phone_outlined),
                    ),
                    onSubmitted: (_) => _lookup(),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  PrimaryButton(label: 'Find clinic', onPressed: _lookup, loading: _searching),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            if (_error != null) ErrorBanner(error: _error!, onRetry: _lookup),
            if (_searched && !_searching && _error == null && _clinic == null)
              const Text(
                'No clinic matches that number. Double-check the registered phone number and try again.',
                style: TextStyle(color: AppColors.textSecondary),
              ),
            if (_clinic != null)
              SectionCard(
                title: _clinic!.name,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_clinic!.area != null || _clinic!.city != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.md),
                        child: Text(
                          [_clinic!.area?.name, _clinic!.city?.name].where((v) => v != null && v.isNotEmpty).join(', '),
                          style: const TextStyle(color: AppColors.textSecondary),
                        ),
                      ),
                    if (_clinic!.doctors.isEmpty)
                      const Text('No doctors are linked to this clinic yet.', style: TextStyle(color: AppColors.textSecondary))
                    else
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: _clinic!.doctors
                            .map((doctor) => OutlinedButton(
                                  onPressed: () => _bookDoctor(doctor),
                                  child: Text('Book ${doctor.name}'),
                                ))
                            .toList(),
                      ),
                  ],
                ),
              ),
          ],
        ),
      );
  }
}
