import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Platform charges + system settings + booking rules — three independent
/// singleton-row resources, each a full-replace PUT with every field
/// required every call (integration_plan.md §1.13, §1.18). Grouped on one
/// screen since they're all "platform configuration" and each is tiny.
class AdminPlatformSettingsScreen extends StatefulWidget {
  const AdminPlatformSettingsScreen({super.key});

  @override
  State<AdminPlatformSettingsScreen> createState() => _AdminPlatformSettingsScreenState();
}

class _AdminPlatformSettingsScreenState extends State<AdminPlatformSettingsScreen> {
  Future<PlatformCharges>? _chargesFuture;
  Future<SystemSettings>? _settingsFuture;
  Future<BookingRules>? _rulesFuture;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  void _loadAll() {
    setState(() {
      _chargesFuture = ApiClient.instance.get('/platform-charges').then((res) => PlatformCharges.fromJson(res.map));
      _settingsFuture = ApiClient.instance.get('/admin/system-settings').then((res) => SystemSettings.fromJson(res.map));
      _rulesFuture = ApiClient.instance.get('/admin/booking-rules').then((res) => BookingRules.fromJson(res.map));
    });
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => _loadAll(),
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          // Mirrors the web app's PlatformSettings `Page` header (AdminPages.jsx) —
          // same title + subtitle copy; this screen additionally folds in platform
          // charges (web's separate PlatformCharges page) as its own section below.
          const PageHeader(
            title: 'Settings',
            subtitle: 'Persist platform identity, fees, and maintenance status.',
          ),
          SectionCard(
            title: 'Platform charges',
            child: FutureBuilder<PlatformCharges>(
              future: _chargesFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) return ErrorBanner(error: snapshot.error!, onRetry: _loadAll);
                return _ChargesForm(initial: snapshot.data!, onSaved: _loadAll);
              },
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          SectionCard(
            title: 'System settings',
            child: FutureBuilder<SystemSettings>(
              future: _settingsFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) return ErrorBanner(error: snapshot.error!, onRetry: _loadAll);
                return _SettingsForm(initial: snapshot.data!, onSaved: _loadAll);
              },
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          SectionCard(
            title: 'Booking rules',
            child: FutureBuilder<BookingRules>(
              future: _rulesFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) return ErrorBanner(error: snapshot.error!, onRetry: _loadAll);
                return _RulesForm(initial: snapshot.data!, onSaved: _loadAll);
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _ChargesForm extends StatefulWidget {
  final PlatformCharges initial;
  final VoidCallback onSaved;
  const _ChargesForm({required this.initial, required this.onSaved});

  @override
  State<_ChargesForm> createState() => _ChargesFormState();
}

class _ChargesFormState extends State<_ChargesForm> {
  late final _commissionCtrl = TextEditingController(text: widget.initial.commissionPercent?.toString() ?? '0');
  late final _convenienceCtrl = TextEditingController(text: widget.initial.patientConvenienceFee.toString());
  late final _emergencyCtrl = TextEditingController(text: widget.initial.emergencyFee.toString());
  late final _gstCtrl = TextEditingController(text: widget.initial.gstPercent.toString());
  late bool _applyConvenience = widget.initial.applyConvenienceFee;
  late bool _applyEmergency = widget.initial.applyEmergencyFee;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _commissionCtrl.dispose();
    _convenienceCtrl.dispose();
    _emergencyCtrl.dispose();
    _gstCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final commission = double.tryParse(_commissionCtrl.text.trim());
    final convenience = double.tryParse(_convenienceCtrl.text.trim());
    final emergency = double.tryParse(_emergencyCtrl.text.trim());
    final gst = double.tryParse(_gstCtrl.text.trim());
    if (commission == null || convenience == null || emergency == null || gst == null) {
      setState(() => _error = 'Enter valid numbers for all fields');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.put('/platform-charges', body: {
        'commissionPercent': commission,
        'patientConvenienceFee': convenience,
        'emergencyFee': emergency,
        'gstPercent': gst,
        'applyConvenienceFee': _applyConvenience,
        'applyEmergencyFee': _applyEmergency,
      });
      if (mounted) showSuccessSnack(context, 'Platform charges saved');
      widget.onSaved();
    } catch (err) {
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.sm)],
        Row(
          children: [
            Expanded(child: TextField(controller: _commissionCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Commission %'))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _gstCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Transaction charge %'))),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: [
            Expanded(child: TextField(controller: _convenienceCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Platform charge ₹'))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _emergencyCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Emergency fee ₹'))),
          ],
        ),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Apply platform charge'), value: _applyConvenience, onChanged: (v) => setState(() => _applyConvenience = v)),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Apply emergency fee'), value: _applyEmergency, onChanged: (v) => setState(() => _applyEmergency = v)),
        const SizedBox(height: AppSpacing.sm),
        PrimaryButton(label: 'Save charges', onPressed: _submit, loading: _submitting),
      ],
    );
  }
}

class _SettingsForm extends StatefulWidget {
  final SystemSettings initial;
  final VoidCallback onSaved;
  const _SettingsForm({required this.initial, required this.onSaved});

  @override
  State<_SettingsForm> createState() => _SettingsFormState();
}

class _SettingsFormState extends State<_SettingsForm> {
  late final _nameCtrl = TextEditingController(text: widget.initial.platformName);
  late final _emailCtrl = TextEditingController(text: widget.initial.supportEmail ?? '');
  late final _phoneCtrl = TextEditingController(text: widget.initial.supportPhone ?? '');
  late bool _maintenance = widget.initial.maintenanceMode;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_nameCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Platform name is required');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      // `bookingFee` deliberately not sent (product decision, mirrors the web app's
      // PlatformSettings form — admin.validation.js#updateSystemSettings): "Platform
      // charges" above is now the single pricing-config surface for admin/superadmin.
      await ApiClient.instance.put('/admin/system-settings', body: {
        'platformName': _nameCtrl.text.trim(),
        if (_emailCtrl.text.trim().isNotEmpty) 'supportEmail': _emailCtrl.text.trim(),
        if (_phoneCtrl.text.trim().isNotEmpty) 'supportPhone': _phoneCtrl.text.trim(),
        'maintenanceMode': _maintenance,
      });
      if (mounted) showSuccessSnack(context, 'System settings saved');
      widget.onSaved();
    } catch (err) {
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.sm)],
        TextField(controller: _nameCtrl, decoration: const InputDecoration(labelText: 'Platform name')),
        const SizedBox(height: AppSpacing.sm),
        TextField(controller: _emailCtrl, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Support email (optional)')),
        const SizedBox(height: AppSpacing.sm),
        TextField(controller: _phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Support phone (optional)')),
        const SizedBox(height: AppSpacing.sm),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Maintenance mode'), value: _maintenance, onChanged: (v) => setState(() => _maintenance = v)),
        const SizedBox(height: AppSpacing.sm),
        PrimaryButton(label: 'Save settings', onPressed: _submit, loading: _submitting),
      ],
    );
  }
}

class _RulesForm extends StatefulWidget {
  final BookingRules initial;
  final VoidCallback onSaved;
  const _RulesForm({required this.initial, required this.onSaved});

  @override
  State<_RulesForm> createState() => _RulesFormState();
}

class _RulesFormState extends State<_RulesForm> {
  late final _cancellationCtrl = TextEditingController(text: widget.initial.cancellationWindowHours.toString());
  late final _maxBookingsCtrl = TextEditingController(text: widget.initial.maxBookingsPerPatient.toString());
  late final _slotCtrl = TextEditingController(text: widget.initial.defaultSlotMinutes.toString());
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _cancellationCtrl.dispose();
    _maxBookingsCtrl.dispose();
    _slotCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final cancellation = int.tryParse(_cancellationCtrl.text.trim());
    final maxBookings = int.tryParse(_maxBookingsCtrl.text.trim());
    final slot = int.tryParse(_slotCtrl.text.trim());
    if (cancellation == null || maxBookings == null || slot == null) {
      setState(() => _error = 'Enter valid whole numbers for all fields');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.put('/admin/booking-rules', body: {
        'cancellationWindowHours': cancellation,
        'maxBookingsPerPatient': maxBookings,
        'defaultSlotMinutes': slot,
      });
      if (mounted) showSuccessSnack(context, 'Booking rules saved');
      widget.onSaved();
    } catch (err) {
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.sm)],
        TextField(controller: _cancellationCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Cancellation window (hours, 0-720)')),
        const SizedBox(height: AppSpacing.sm),
        TextField(controller: _maxBookingsCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Max bookings per patient (1-100)')),
        const SizedBox(height: AppSpacing.sm),
        TextField(controller: _slotCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Default slot length (minutes, 5-120)')),
        const SizedBox(height: AppSpacing.sm),
        PrimaryButton(label: 'Save rules', onPressed: _submit, loading: _submitting),
      ],
    );
  }
}
