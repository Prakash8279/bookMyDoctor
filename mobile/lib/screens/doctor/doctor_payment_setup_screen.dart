import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

String _imageMimeType(String path) {
  final ext = path.toLowerCase().split('.').last;
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

/// COMPLETENESS FIX (mobile parity — client/src/pages/FeaturePages.jsx#DoctorPaymentSetup had no
/// mobile equivalent). No dedicated payment-setup endpoint exists, same as the web page — this
/// maps onto the general PATCH /clinics/:id (paymentCashEnabled/paymentUpiEnabled/paymentUpiId/
/// paymentQrUrl) and POST /media/qr for the QR image, against the doctor's own clinic
/// (GET /clinics?mine=true).
class DoctorPaymentSetupScreen extends StatefulWidget {
  const DoctorPaymentSetupScreen({super.key});

  @override
  State<DoctorPaymentSetupScreen> createState() => _DoctorPaymentSetupScreenState();
}

class _DoctorPaymentSetupScreenState extends State<DoctorPaymentSetupScreen> {
  bool _loading = true;
  String? _loadError;
  Clinic? _clinic;

  bool _cash = true;
  bool _upi = true;
  final _upiIdController = TextEditingController();
  String? _qrUrl;

  bool _uploadingQr = false;
  bool _saving = false;
  String? _saveError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _upiIdController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final res = await ApiClient.instance.get('/clinics', query: {'mine': true, 'pageSize': 20});
      final rows = res.list;
      if (rows.isEmpty) {
        setState(() {
          _clinic = null;
          _loading = false;
        });
        return;
      }
      final detail = await ApiClient.instance.get('/clinics/${rows.first['id']}');
      final clinic = Clinic.fromJson(detail.map);
      setState(() {
        _clinic = clinic;
        _cash = clinic.paymentCashEnabled;
        _upi = clinic.paymentUpiEnabled;
        _upiIdController.text = clinic.paymentUpiId ?? '';
        _qrUrl = clinic.paymentQrUrl;
        _loading = false;
      });
    } catch (err) {
      setState(() {
        _loadError = err.toString();
        _loading = false;
      });
    }
  }

  Future<void> _pickAndUploadQr() async {
    if (_clinic == null) return;
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1200, imageQuality: 90);
    if (picked == null || !mounted) return;
    setState(() => _uploadingQr = true);
    try {
      final res = await ApiClient.instance.uploadFile(
        '/media/qr',
        filePath: picked.path,
        mimeType: _imageMimeType(picked.path),
        extraFields: {'clinicId': _clinic!.id},
      );
      setState(() {
        _qrUrl = (res.map['url'] as String?) ?? _qrUrl;
        _uploadingQr = false;
      });
      if (mounted) showSuccessSnack(context, 'QR code uploaded');
    } catch (err) {
      setState(() => _uploadingQr = false);
      if (mounted) showErrorSnack(context, err);
    }
  }

  Future<void> _save() async {
    if (_clinic == null) return;
    setState(() {
      _saving = true;
      _saveError = null;
    });
    try {
      await ApiClient.instance.patch('/clinics/${_clinic!.id}', body: {
        'paymentCashEnabled': _cash,
        'paymentUpiEnabled': _upi,
        if (_upiIdController.text.trim().isNotEmpty) 'paymentUpiId': _upiIdController.text.trim(),
        if (_qrUrl != null) 'paymentQrUrl': _qrUrl,
      });
      if (mounted) showSuccessSnack(context, 'Payment setup saved');
    } catch (err) {
      setState(() => _saveError = err.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // No own Scaffold/AppBar — only ever embedded as a RoleScaffold nav-item body
    // (doctor_home_screen.dart), which already supplies the app bar.
    return Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Payment setup',
              subtitle: 'Choose how patients can pay at your clinic.',
            ),
          ),
          Expanded(
            child: _loading
          ? const LoadingView()
          : _loadError != null
              ? Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: _loadError!, onRetry: _load))
              : _clinic == null
                  ? const EmptyStateView(
                      icon: Icons.storefront_outlined,
                      title: 'No clinic found for your account yet',
                      subtitle: 'Add a clinic first from "My clinics" to set up payments.',
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        children: [
                          SectionCard(
                            title: 'Accepted payment methods',
                            child: Column(
                              children: [
                                SwitchListTile(
                                  contentPadding: EdgeInsets.zero,
                                  title: const Text('Accept cash'),
                                  value: _cash,
                                  onChanged: (v) => setState(() => _cash = v),
                                ),
                                SwitchListTile(
                                  contentPadding: EdgeInsets.zero,
                                  title: const Text('Accept UPI'),
                                  value: _upi,
                                  onChanged: (v) => setState(() => _upi = v),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          SectionCard(
                            title: 'UPI ID',
                            child: TextField(
                              controller: _upiIdController,
                              decoration: const InputDecoration(hintText: 'e.g. clinicname@upi'),
                            ),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          SectionCard(
                            title: 'Payment QR code',
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (_qrUrl != null && _qrUrl!.isNotEmpty)
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(8),
                                    child: CachedNetworkImage(imageUrl: _qrUrl!, width: 160, height: 160, fit: BoxFit.cover),
                                  )
                                else
                                  Container(
                                    width: 160,
                                    height: 160,
                                    decoration: BoxDecoration(
                                      color: AppColors.border.withOpacity(0.2),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: const Icon(Icons.qr_code_2_outlined, size: 48, color: AppColors.textSecondary),
                                  ),
                                const SizedBox(height: AppSpacing.sm),
                                OutlinedButton.icon(
                                  onPressed: _uploadingQr ? null : _pickAndUploadQr,
                                  icon: _uploadingQr
                                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                      : const Icon(Icons.upload_outlined, size: 18),
                                  label: Text(_qrUrl == null ? 'Upload QR image' : 'Replace QR image'),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          if (_saveError != null) ...[
                            ErrorBanner(error: _saveError!, onRetry: _save),
                            const SizedBox(height: AppSpacing.sm),
                          ],
                          PrimaryButton(label: 'Save payment setup', onPressed: _save, loading: _saving),
                        ],
                      ),
                    ),
          ),
        ],
      );
  }
}
