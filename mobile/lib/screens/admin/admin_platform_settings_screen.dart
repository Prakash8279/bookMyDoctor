import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

enum AdminSettingsSection { all, charges, settings, bookingRules }

String _formatMoney(num value) {
  final fmt = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);
  return fmt.format(value);
}

/// Platform charges + system settings + booking rules — exact 100% parity with
/// Web frontend (`client/src/pages/PlatformCharges.jsx` and `AdminPages.jsx#PlatformSettings`).
///
/// Handles:
/// 1. Platform Charges (`/super-admin/charges` & `/admin/platform-fee`):
///    - Global pricing rules (patient convenience fee, emergency fee, transaction charge %).
///    - Switches: apply platform charge, apply emergency fee.
///    - Live Example Patient Bill card with interactive emergency booking toggle and real-time math.
///    - Full 6-field PUT payload preserving commission rate.
/// 2. System Settings (`/admin/settings` & `/super-admin/settings`):
///    - Platform name, support email, support phone, maintenance mode.
/// 3. Booking Rules (`/admin/booking-rules`):
///    - Cancellation window (0-720h), max bookings per patient (1-100), slot length (5-120 min).
///    - Online booking hours (round the clock toggle, open from / open until with time picker).
///    - Advance booking max days limit.
class AdminPlatformSettingsScreen extends StatefulWidget {
  final AdminSettingsSection focusSection;
  const AdminPlatformSettingsScreen({
    super.key,
    this.focusSection = AdminSettingsSection.all,
  });

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
    final showCharges = widget.focusSection == AdminSettingsSection.charges;
    final showSettings = widget.focusSection == AdminSettingsSection.all || widget.focusSection == AdminSettingsSection.settings;
    final showRules = widget.focusSection == AdminSettingsSection.all || widget.focusSection == AdminSettingsSection.bookingRules;

    String pageTitle = 'Settings';
    String pageSubtitle = 'Persist platform identity, fees, and maintenance status.';
    if (widget.focusSection == AdminSettingsSection.charges) {
      pageTitle = 'Platform charges';
      pageSubtitle = 'Set the global pricing rules used across every clinic and online booking.';
    } else if (widget.focusSection == AdminSettingsSection.settings) {
      pageTitle = 'System settings';
      pageSubtitle = 'Persist platform identity, fees, and maintenance status.';
    } else if (widget.focusSection == AdminSettingsSection.bookingRules) {
      pageTitle = 'Booking rules';
      pageSubtitle = 'Cancellation limits and advance booking windows.';
    }

    return RefreshIndicator(
      onRefresh: () async => _loadAll(),
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          PageHeader(
            title: pageTitle,
            subtitle: pageSubtitle,
          ),
          if (showCharges) ...[
            FutureBuilder<PlatformCharges>(
              future: _chargesFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView());
                }
                if (snapshot.hasError) return ErrorBanner(error: snapshot.error!, onRetry: _loadAll);
                return _ChargesForm(initial: snapshot.data!, onSaved: _loadAll);
              },
            ),
          ],
          if (showSettings) ...[
            FutureBuilder<SystemSettings>(
              future: _settingsFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView());
                }
                if (snapshot.hasError) return ErrorBanner(error: snapshot.error!, onRetry: _loadAll);
                return _SettingsForm(initial: snapshot.data!, onSaved: _loadAll);
              },
            ),
            if (showRules) const SizedBox(height: AppSpacing.lg),
          ],
          if (showRules) ...[
            FutureBuilder<BookingRules>(
              future: _rulesFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView());
                }
                if (snapshot.hasError) return ErrorBanner(error: snapshot.error!, onRetry: _loadAll);
                return _RulesForm(initial: snapshot.data!, onSaved: _loadAll);
              },
            ),
          ],
        ],
      ),
    );
  }
}

/// Platform charges form matching Web's `client/src/pages/PlatformCharges.jsx`
class _ChargesForm extends StatefulWidget {
  final PlatformCharges initial;
  final VoidCallback onSaved;
  const _ChargesForm({required this.initial, required this.onSaved});

  @override
  State<_ChargesForm> createState() => _ChargesFormState();
}

class _ChargesFormState extends State<_ChargesForm> {
  late final _convenienceCtrl = TextEditingController(text: widget.initial.patientConvenienceFee.toString());
  late final _emergencyCtrl = TextEditingController(text: widget.initial.emergencyFee.toString());
  late final _gstCtrl = TextEditingController(text: widget.initial.gstPercent.toString());
  late bool _applyConvenience = widget.initial.applyConvenienceFee;
  late bool _applyEmergency = widget.initial.applyEmergencyFee;

  // Live bill preview state matching Web
  bool _previewEmergency = false;
  bool _submitting = false;
  bool _saved = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _convenienceCtrl.addListener(_onFieldChanged);
    _emergencyCtrl.addListener(_onFieldChanged);
    _gstCtrl.addListener(_onFieldChanged);
  }

  void _onFieldChanged() {
    if (mounted) {
      setState(() {
        _saved = false;
      });
    }
  }

  @override
  void dispose() {
    _convenienceCtrl.removeListener(_onFieldChanged);
    _emergencyCtrl.removeListener(_onFieldChanged);
    _gstCtrl.removeListener(_onFieldChanged);
    _convenienceCtrl.dispose();
    _emergencyCtrl.dispose();
    _gstCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final convenience = double.tryParse(_convenienceCtrl.text.trim());
    final emergency = double.tryParse(_emergencyCtrl.text.trim());
    final gst = double.tryParse(_gstCtrl.text.trim());

    if (convenience == null || convenience < 0) {
      setState(() => _error = 'Enter a valid platform charge (₹0 or more)');
      return;
    }
    if (emergency == null || emergency < 0) {
      setState(() => _error = 'Enter a valid emergency booking fee (₹0 or more)');
      return;
    }
    if (gst == null || gst < 0 || gst > 100) {
      setState(() => _error = 'Enter a valid transaction charge percentage (0-100%)');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
      _saved = false;
    });

    try {
      // PUT /platform-charges is a full-replace of all 6 fields.
      // Retain loaded commissionPercent untouched (matches Web's PlatformCharges.jsx:76-83).
      await ApiClient.instance.put('/platform-charges', body: {
        'commissionPercent': widget.initial.commissionPercent ?? 10.0,
        'patientConvenienceFee': convenience,
        'emergencyFee': emergency,
        'gstPercent': gst,
        'applyConvenienceFee': _applyConvenience,
        'applyEmergencyFee': _applyEmergency,
      });

      if (mounted) {
        showSuccessSnack(context, 'Platform charges saved and connected to future bookings.');
        setState(() => _saved = true);
      }
      widget.onSaved();
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Live bill calculation matching Web's PlatformCharges.jsx:94-103
    const consultation = 900.0;
    final convenienceVal = double.tryParse(_convenienceCtrl.text.trim()) ?? 0.0;
    final emergencyVal = double.tryParse(_emergencyCtrl.text.trim()) ?? 0.0;
    final gstRate = (double.tryParse(_gstCtrl.text.trim()) ?? 0.0) / 100.0;

    final convenienceFee = (!_previewEmergency && _applyConvenience) ? convenienceVal : 0.0;
    final emergencyFee = (_previewEmergency && _applyEmergency) ? emergencyVal : 0.0;
    final subtotal = consultation + convenienceFee + emergencyFee;
    final gstAmount = subtotal * gstRate;
    final total = subtotal + gstAmount;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Charge configuration card
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
                        Text(
                          'Charge configuration',
                          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'These values apply to every future booking platform-wide.',
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                        ),
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: const Text(
                        'Global rules',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontWeight: FontWeight.w700,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                if (_error != null) ...[
                  ErrorBanner(error: _error!),
                  const SizedBox(height: AppSpacing.sm),
                ],
                TextField(
                  controller: _convenienceCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Platform charge (₹)',
                    hintText: '25.00',
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: _emergencyCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Emergency booking fee (₹)',
                    hintText: '50.00',
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: _gstCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Transaction charge (%)',
                    hintText: '18.00',
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                // Explanatory note matching Web verbatim
                Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(AppRadius.button),
                  ),
                  child: const Text(
                    'Transaction charge applies only to the portion of a doctor\'s fee paid online through the website — a walk-in payment collected in cash/card/UPI at the clinic counter is never charged it. Platform charge and emergency fee never stack on the same booking — an emergency booking pays the emergency fee instead of the platform charge.',
                    style: TextStyle(fontSize: 12, color: AppColors.textSecondary, height: 1.4),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Apply platform charge to online bookings', style: TextStyle(fontSize: 14)),
                  value: _applyConvenience,
                  onChanged: (v) => setState(() {
                    _applyConvenience = v;
                    _saved = false;
                  }),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Apply emergency fee to urgent bookings', style: TextStyle(fontSize: 14)),
                  value: _applyEmergency,
                  onChanged: (v) => setState(() {
                    _applyEmergency = v;
                    _saved = false;
                  }),
                ),
                const SizedBox(height: AppSpacing.md),
                PrimaryButton(
                  label: _submitting ? 'Saving…' : 'Save platform charges',
                  onPressed: _submit,
                  loading: _submitting,
                ),
                if (_saved) ...[
                  const SizedBox(height: AppSpacing.sm),
                  const Text(
                    'Charges saved and connected to future bookings.',
                    style: TextStyle(color: AppColors.success, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.md),

        // Live example patient bill card matching Web
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(AppRadius.card),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.15),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'LIVE EXAMPLE PATIENT BILL',
                style: TextStyle(
                  color: Colors.white70,
                  fontWeight: FontWeight.w800,
                  fontSize: 11,
                  letterSpacing: 1.1,
                ),
              ),
              const SizedBox(height: 2),
              const Text(
                'Based on a ₹900 consultation',
                style: TextStyle(color: Colors.white60, fontSize: 12),
              ),
              const SizedBox(height: AppSpacing.sm),
              InkWell(
                onTap: () => setState(() => _previewEmergency = !_previewEmergency),
                borderRadius: BorderRadius.circular(AppRadius.button),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Checkbox(
                        value: _previewEmergency,
                        onChanged: (v) => setState(() => _previewEmergency = v ?? false),
                        activeColor: AppColors.primary,
                        side: const BorderSide(color: Colors.white60),
                      ),
                      const Text(
                        'This is an emergency booking',
                        style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              const Divider(color: Colors.white24),
              const SizedBox(height: AppSpacing.xs),
              _billRow('Consultation', _formatMoney(consultation)),
              const SizedBox(height: 8),
              _billRow('Platform charge', _formatMoney(convenienceFee)),
              const SizedBox(height: 8),
              _billRow('Emergency fee', _formatMoney(emergencyFee)),
              const SizedBox(height: 8),
              _billRow('Transaction charge (${_gstCtrl.text.trim()}%)', _formatMoney(gstAmount)),
              const SizedBox(height: AppSpacing.sm),
              const Divider(color: Colors.white24),
              const SizedBox(height: AppSpacing.xs),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Patient total',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                  Text(
                    _formatMoney(total),
                    style: const TextStyle(
                      color: Color(0xFFFBBF24), // Gold accent
                      fontWeight: FontWeight.w900,
                      fontSize: 18,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _billRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 13)),
        Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
      ],
    );
  }
}

/// System settings form matching Web's `PlatformSettings` Form 1
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
  bool _saved = false;
  String? _error;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Platform name is required');
      return;
    }
    if (name.length > 200) {
      setState(() => _error = 'Platform name must be at most 200 characters');
      return;
    }

    final email = _emailCtrl.text.trim();
    if (email.isNotEmpty && !email.contains('@')) {
      setState(() => _error = 'Enter a valid support email address');
      return;
    }

    final phone = _phoneCtrl.text.trim();
    if (phone.length > 30) {
      setState(() => _error = 'Support phone must be at most 30 characters');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
      _saved = false;
    });

    try {
      await ApiClient.instance.put('/admin/system-settings', body: {
        'platformName': name,
        if (email.isNotEmpty) 'supportEmail': email,
        if (phone.isNotEmpty) 'supportPhone': phone,
        'maintenanceMode': _maintenance,
      });

      if (mounted) {
        showSuccessSnack(context, 'System settings saved');
        setState(() => _saved = true);
      }
      widget.onSaved();
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'System settings',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
            ),
            const SizedBox(height: 2),
            const Text(
              'Persist platform identity and maintenance status.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: AppSpacing.md),
            if (_error != null) ...[
              ErrorBanner(error: _error!),
              const SizedBox(height: AppSpacing.sm),
            ],
            TextField(
              controller: _nameCtrl,
              decoration: const InputDecoration(labelText: 'Platform name'),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _emailCtrl,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Support email (optional)'),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _phoneCtrl,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Support phone (optional)'),
            ),
            const SizedBox(height: AppSpacing.sm),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Maintenance mode', style: TextStyle(fontSize: 14)),
              value: _maintenance,
              onChanged: (v) => setState(() {
                _maintenance = v;
                _saved = false;
              }),
            ),
            const SizedBox(height: AppSpacing.md),
            PrimaryButton(
              label: _submitting ? 'Saving…' : 'Save settings',
              onPressed: _submit,
              loading: _submitting,
            ),
            if (_saved) ...[
              const SizedBox(height: AppSpacing.sm),
              const Text(
                'Settings saved.',
                style: TextStyle(color: AppColors.success, fontWeight: FontWeight.w600, fontSize: 13),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Booking rules form matching Web's `PlatformSettings` Form 2
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
  late final _startTimeCtrl = TextEditingController(text: widget.initial.onlineBookingWindowStart ?? '09:00');
  late final _endTimeCtrl = TextEditingController(text: widget.initial.onlineBookingWindowEnd ?? '21:00');
  late final _advanceDaysCtrl = TextEditingController(
    text: widget.initial.onlineBookingMaxAdvanceDays?.toString() ?? '',
  );

  late bool _alwaysOpen = widget.initial.onlineBookingWindowStart == null || widget.initial.onlineBookingWindowStart!.isEmpty;

  bool _submitting = false;
  bool _saved = false;
  String? _error;

  @override
  void dispose() {
    _cancellationCtrl.dispose();
    _maxBookingsCtrl.dispose();
    _slotCtrl.dispose();
    _startTimeCtrl.dispose();
    _endTimeCtrl.dispose();
    _advanceDaysCtrl.dispose();
    super.dispose();
  }

  bool _isValidHHMM(String s) {
    final reg = RegExp(r'^([01]\d|2[0-3]):[0-5]\d$');
    return reg.hasMatch(s);
  }

  int _toMinutes(String s) {
    final p = s.split(':');
    return int.parse(p[0]) * 60 + int.parse(p[1]);
  }

  Future<void> _pickTime(TextEditingController ctrl) async {
    TimeOfDay initial = const TimeOfDay(hour: 9, minute: 0);
    final parts = ctrl.text.trim().split(':');
    if (parts.length == 2) {
      final h = int.tryParse(parts[0]);
      final m = int.tryParse(parts[1]);
      if (h != null && m != null && h >= 0 && h < 24 && m >= 0 && m < 60) {
        initial = TimeOfDay(hour: h, minute: m);
      }
    }
    final picked = await showTimePicker(
      context: context,
      initialTime: initial,
    );
    if (picked != null) {
      final h = picked.hour.toString().padLeft(2, '0');
      final m = picked.minute.toString().padLeft(2, '0');
      setState(() {
        ctrl.text = '$h:$m';
        _saved = false;
      });
    }
  }

  Future<void> _submit() async {
    final cancellation = int.tryParse(_cancellationCtrl.text.trim());
    final maxBookings = int.tryParse(_maxBookingsCtrl.text.trim());
    final slot = int.tryParse(_slotCtrl.text.trim());

    if (cancellation == null || cancellation < 0 || cancellation > 720) {
      setState(() => _error = 'Cancellation window must be a number between 0 and 720 hours');
      return;
    }
    if (maxBookings == null || maxBookings < 1 || maxBookings > 100) {
      setState(() => _error = 'Max bookings per patient must be a number between 1 and 100');
      return;
    }
    if (slot == null || slot < 5 || slot > 120) {
      setState(() => _error = 'Default slot length must be between 5 and 120 minutes');
      return;
    }

    String? start;
    String? end;
    if (!_alwaysOpen) {
      final s = _startTimeCtrl.text.trim();
      final e = _endTimeCtrl.text.trim();
      if (!_isValidHHMM(s)) {
        setState(() => _error = 'Open from time must be in 24-hour HH:MM format (e.g. 09:00)');
        return;
      }
      if (!_isValidHHMM(e)) {
        setState(() => _error = 'Open until time must be in 24-hour HH:MM format (e.g. 21:00)');
        return;
      }
      if (_toMinutes(s) >= _toMinutes(e)) {
        setState(() => _error = 'Open until time must be strictly after Open from time');
        return;
      }
      start = s;
      end = e;
    }

    int? maxDays;
    final advanceText = _advanceDaysCtrl.text.trim();
    if (advanceText.isNotEmpty) {
      final parsed = int.tryParse(advanceText);
      if (parsed == null || parsed < 0 || parsed > 365) {
        setState(() => _error = 'Max advance days must be a whole number between 0 and 365, or blank');
        return;
      }
      maxDays = parsed;
    }

    setState(() {
      _submitting = true;
      _error = null;
      _saved = false;
    });

    try {
      await ApiClient.instance.put('/admin/booking-rules', body: {
        'cancellationWindowHours': cancellation,
        'maxBookingsPerPatient': maxBookings,
        'defaultSlotMinutes': slot,
        'onlineBookingWindowStart': start,
        'onlineBookingWindowEnd': end,
        'onlineBookingMaxAdvanceDays': maxDays,
      });

      if (mounted) {
        showSuccessSnack(context, 'Booking rules saved');
        setState(() => _saved = true);
      }
      widget.onSaved();
    } catch (err) {
      if (mounted) setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Booking rules',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
            ),
            const SizedBox(height: 2),
            const Text(
              'Global rules controlling cancellations, slot lengths, and booking windows.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: AppSpacing.md),
            if (_error != null) ...[
              ErrorBanner(error: _error!),
              const SizedBox(height: AppSpacing.sm),
            ],
            TextField(
              controller: _cancellationCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Cancellation window (hours)',
                hintText: '2',
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _maxBookingsCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Max bookings per patient',
                hintText: '5',
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _slotCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Default slot length (minutes)',
                hintText: '15',
              ),
            ),
            const SizedBox(height: AppSpacing.md),

            // Online booking hours section matching Web
            const Divider(),
            const SizedBox(height: AppSpacing.xs),
            const Text(
              'Online booking hours',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
            ),
            const SizedBox(height: 2),
            const Text(
              'Platform-wide — controls when PATIENTS can make an online booking. Walk-ins registered by staff at the clinic are never affected.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.3),
            ),
            const SizedBox(height: AppSpacing.xs),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text(
                'Accept online bookings around the clock (full time)',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
              ),
              value: _alwaysOpen,
              onChanged: (v) => setState(() {
                _alwaysOpen = v;
                _saved = false;
              }),
            ),
            if (!_alwaysOpen) ...[
              const SizedBox(height: AppSpacing.xs),
              Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: () => _pickTime(_startTimeCtrl),
                      child: IgnorePointer(
                        child: TextField(
                          controller: _startTimeCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Open from (HH:MM)',
                            suffixIcon: Icon(Icons.access_time, size: 18),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: InkWell(
                      onTap: () => _pickTime(_endTimeCtrl),
                      child: IgnorePointer(
                        child: TextField(
                          controller: _endTimeCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Open until (HH:MM)',
                            suffixIcon: Icon(Icons.access_time, size: 18),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],

            // Advance booking window cap section matching Web
            const SizedBox(height: AppSpacing.md),
            const Divider(),
            const SizedBox(height: AppSpacing.xs),
            TextField(
              controller: _advanceDaysCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Online booking allowed up to how many days ahead',
                hintText: 'No platform-wide limit',
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Platform-wide cap on ONLINE bookings only. Enter 0 to allow only today\'s date. Leave blank for no platform-wide limit (each doctor\'s own advance-booking setting still applies). Always the stricter of this and a doctor\'s own setting wins.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.3),
            ),
            const SizedBox(height: AppSpacing.md),
            PrimaryButton(
              label: _submitting ? 'Saving…' : 'Save booking rules',
              onPressed: _submit,
              loading: _submitting,
            ),
            if (_saved) ...[
              const SizedBox(height: AppSpacing.sm),
              const Text(
                'Booking rules saved.',
                style: TextStyle(color: AppColors.success, fontWeight: FontWeight.w600, fontSize: 13),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
