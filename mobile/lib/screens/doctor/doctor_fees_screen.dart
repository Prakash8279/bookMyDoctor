import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Doctor fee management — maps to web DoctorFees page in FeaturePages.jsx.
/// Saves consultation & emergency fees via PATCH /doctors/:id (same as profile update).
class DoctorFeesScreen extends StatefulWidget {
  const DoctorFeesScreen({super.key});

  @override
  State<DoctorFeesScreen> createState() => _DoctorFeesScreenState();
}

class _DoctorFeesScreenState extends State<DoctorFeesScreen> {
  bool _loading = true;
  String? _loadError;
  final _consultationController = TextEditingController();
  final _emergencyController = TextEditingController();
  bool _saving = false;
  String? _saveError;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _loadFees();
  }

  Future<void> _loadFees() async {
    try {
      final res = await ApiClient.instance.get('/auth/me');
      final profile = res.data?['profile'] as Map<String, dynamic>?;
      final consultation = profile?['consultationFee'];
      final emergency = profile?['emergencyFee'];
      if (mounted) {
        _consultationController.text = consultation?.toString() ?? '';
        _emergencyController.text = emergency?.toString() ?? '';
      }
    } catch (e) {
      if (mounted) setState(() => _loadError = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    final consultation = double.tryParse(_consultationController.text.trim()) ?? 0;
    final emergency = double.tryParse(_emergencyController.text.trim()) ?? 0;
    setState(() {
      _saving = true;
      _saveError = null;
      _saved = false;
    });
    try {
      await ApiClient.instance.patch('/doctors/me', body: {
        'consultationFee': consultation,
        'emergencyFee': emergency,
      });
      if (mounted) setState(() => _saved = true);
    } catch (e) {
      if (mounted) setState(() => _saveError = e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _consultationController.dispose();
    _emergencyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const PageHeader(
            title: 'Fee management',
            subtitle: 'Set your consultation and emergency consultation fees.',
          ),
          const SizedBox(height: AppSpacing.md),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (_loadError != null)
            ErrorBanner(error: _loadError!)
          else
            Card(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: _consultationController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'Consultation fee (₹)',
                        prefixText: '₹ ',
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextField(
                      controller: _emergencyController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'Emergency consultation fee (₹)',
                        prefixText: '₹ ',
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    if (_saveError != null) ...[
                      ErrorBanner(error: _saveError!),
                      const SizedBox(height: AppSpacing.sm),
                    ],
                    if (_saved) ...[
                      const Text('Fee schedule saved.', style: TextStyle(color: AppColors.success, fontWeight: FontWeight.w600)),
                      const SizedBox(height: AppSpacing.sm),
                    ],
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _saving ? null : _save,
                        child: Text(_saving ? 'Saving…' : 'Save fee schedule'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
