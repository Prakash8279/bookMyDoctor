import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'book_appointment_screen.dart';

/// Finds a clinic by its registered phone number, then lets the patient book one of its doctors.
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
    final phone = _phoneController.text.trim();
    final query = _digitsOnly(phone);
    if (phone.isEmpty) {
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
        if (query.length >= 6 && _digitsOnly((row['phone'] as String?) ?? '').endsWith(query)) {
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
              subtitle: 'Find a clinic using its registered phone number.',
            ),
            SectionCard(
              title: 'Clinic registered number',
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
