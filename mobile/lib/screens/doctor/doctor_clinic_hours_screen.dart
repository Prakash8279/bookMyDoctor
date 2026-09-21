import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

const _weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/// OPD schedule management — the real destination for the old mock's single
/// `opdEntries` array, now split into two backend resources
/// (integration_plan.md §1.5): weekly recurring hours (upsert by
/// doctorUserId+clinicId+weekday via PUT) and one-off closed dates (upsert-
/// like via POST). A clinic must be selected first since both resources are
/// scoped under /clinics/:clinicId/....
class DoctorClinicHoursScreen extends StatefulWidget {
  const DoctorClinicHoursScreen({super.key});

  @override
  State<DoctorClinicHoursScreen> createState() => _DoctorClinicHoursScreenState();
}

class _DoctorClinicHoursScreenState extends State<DoctorClinicHoursScreen> {
  Future<List<Clinic>>? _clinicsFuture;
  Clinic? _selectedClinic;
  Future<_HoursData>? _hoursFuture;
  // COMPLETENESS FIX (mobile parity audit round 2, doctor panel): web's header shows a
  // "Live · {time}" indicator with a manual Refresh button (StaffPages.jsx:766-769) — this just
  // updates the shown timestamp (there's no separate refetch on web either; pull-to-refresh
  // below already keeps the actual data current).
  String _refreshedAt = DateFormat('h:mm a').format(DateTime.now());

  void _refresh() => setState(() => _refreshedAt = DateFormat('h:mm a').format(DateTime.now()));

  @override
  void initState() {
    super.initState();
    _clinicsFuture = _fetchClinics();
  }

  Future<List<Clinic>> _fetchClinics() async {
    try {
      final res = await ApiClient.instance
          .get('/clinics', query: {'mine': true, 'pageSize': 50})
          .catchError((_) => ApiResponse(data: []));
      final list = <Clinic>[];
      for (final item in res.list) {
        try {
          list.add(Clinic.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  void _selectClinic(Clinic clinic) {
    setState(() {
      _selectedClinic = clinic;
      _hoursFuture = _loadHours(clinic.id);
    });
  }

  Future<_HoursData> _loadHours(String clinicId) async {
    final selfId = context.read<AuthProvider>().user?.id ?? '';
    final results = await Future.wait([
      ApiClient.instance
          .get('/clinics/$clinicId/hours', query: {'doctorId': selfId, 'pageSize': 20})
          .catchError((_) => ApiResponse(data: [])),
      ApiClient.instance
          .get('/clinics/$clinicId/closures', query: {'doctorId': selfId, 'pageSize': 50})
          .catchError((_) => ApiResponse(data: [])),
    ]);
    final hours = <ClinicHours>[];
    for (final item in results[0].list) {
      try {
        hours.add(ClinicHours.fromJson(item));
      } catch (_) {}
    }
    final closures = <ClinicClosure>[];
    for (final item in results[1].list) {
      try {
        closures.add(ClinicClosure.fromJson(item));
      } catch (_) {}
    }
    return _HoursData(
      hours: hours,
      closures: closures,
    );
  }

  void _refreshHours() {
    if (_selectedClinic != null) {
      setState(() => _hoursFuture = _loadHours(_selectedClinic!.id));
    }
  }

  Future<void> _editWeekday(int weekday, ClinicHours? existing) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _HoursForm(clinicId: _selectedClinic!.id, weekday: weekday, existing: existing),
    );
    if (saved == true) _refreshHours();
  }

  Future<void> _deleteHours(ClinicHours h) async {
    try {
      await ApiClient.instance.delete('/clinics/${_selectedClinic!.id}/hours/${h.id}');
      _refreshHours();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

  Future<void> _addClosure() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ClosureForm(clinicId: _selectedClinic!.id),
    );
    if (saved == true) _refreshHours();
  }

  Future<void> _deleteClosure(ClinicClosure c) async {
    try {
      await ApiClient.instance.delete('/clinics/${_selectedClinic!.id}/closures/${c.id}');
      _refreshHours();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

  // BUG FIX (mobile parity audit): ports web's `opdEntryCsv`/exportCsv (StaffPages.jsx#ClinicSchedule)
  // — combines weekly-hours rows and closed-date rows into one CSV, same 7 columns and row shape.
  Future<void> _exportCsv() async {
    final data = await _hoursFuture;
    if (data == null || _selectedClinic == null) return;
    final clinicName = _selectedClinic!.name;
    var displayId = 0;
    final rows = <List<dynamic>>[
      for (final h in data.hours)
        [++displayId, 'weekly OPD', clinicName, _weekdayNames[h.weekday], '${h.startTime}-${h.endTime}', '${h.slotMinutes} min', h.status],
      for (final c in data.closures) [++displayId, 'closing date', clinicName, c.closedDate, c.reason ?? '', '', 'closed'],
    ];
    await shareCsv(
      filename: 'opd-schedule.csv',
      headers: const ['Id', 'Type', 'Clinic', 'Day/Date', 'Hours/Reason', 'Patient time', 'Status'],
      rows: rows,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              kicker: 'Production database',
              title: 'OPD schedule',
              subtitle: "Set each clinic's day-wise hours, patient duration, future-booking window, and closing dates.",
              // COMPLETENESS FIX (mobile parity audit): web's "Export CSV" action had no mobile
              // equivalent; the "Live · {time}"/Refresh pair (round 2 audit) was also missing.
              action: Wrap(
                spacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(color: AppColors.success.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(999)),
                    child: Text('Live · $_refreshedAt', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.success)),
                  ),
                  OutlinedButton(
                    onPressed: _refresh,
                    style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8), textStyle: const TextStyle(fontSize: 11)),
                    child: const Text('Refresh'),
                  ),
                  if (_selectedClinic != null)
                    TextButton.icon(onPressed: _exportCsv, icon: const Icon(Icons.file_download_outlined, size: 16), label: const Text('Export CSV')),
                ],
              ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: _BookingWindowCard(),
          ),
          Expanded(
            child: FutureBuilder<List<Clinic>>(
        future: _clinicsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
          if (snapshot.hasError) return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!));
          final clinics = snapshot.data ?? [];
          if (clinics.isEmpty) {
            return const EmptyStateView(
              icon: Icons.local_hospital_outlined,
              title: 'No clinics linked yet',
              subtitle: 'Ask an admin to link you to a clinic, or add one from "My Clinics"',
            );
          }
          _selectedClinic ??= clinics.first;
          _hoursFuture ??= _loadHours(_selectedClinic!.id);

          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              DropdownButtonFormField<Clinic>(
                initialValue: clinics.firstWhere((c) => c.id == _selectedClinic!.id, orElse: () => clinics.first),
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Clinic'),
                items: clinics.map((c) => DropdownMenuItem(value: c, child: Text(c.name, overflow: TextOverflow.ellipsis))).toList(),
                onChanged: (c) {
                  if (c != null) _selectClinic(c);
                },
              ),
              const SizedBox(height: AppSpacing.md),
              FutureBuilder<_HoursData>(
                future: _hoursFuture,
                builder: (context, hSnap) {
                  if (hSnap.connectionState != ConnectionState.done) {
                    return const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView());
                  }
                  if (hSnap.hasError) return ErrorBanner(error: hSnap.error!, onRetry: _refreshHours);
                  final data = hSnap.data!;
                  final byWeekday = {for (final h in data.hours) h.weekday: h};
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SectionCard(
                        title: 'Weekly hours',
                        child: Column(
                          children: List.generate(7, (weekday) {
                            final h = byWeekday[weekday];
                            return ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(_weekdayNames[weekday]),
                              subtitle: h == null
                                  ? const Text('Not set', style: TextStyle(color: AppColors.textSecondary))
                                  : Text('${h.startTime} – ${h.endTime} · ${h.slotMinutes} min slots · ${h.status}'),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  IconButton(icon: const Icon(Icons.edit_outlined, size: 20), onPressed: () => _editWeekday(weekday, h)),
                                  if (h != null)
                                    IconButton(icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.danger), onPressed: () => _deleteHours(h)),
                                ],
                              ),
                            );
                          }),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      SectionCard(
                        title: 'Closed dates',
                        trailing: TextButton.icon(onPressed: _addClosure, icon: const Icon(Icons.add, size: 18), label: const Text('Add')),
                        child: data.closures.isEmpty
                            ? const Text('No closures scheduled', style: TextStyle(color: AppColors.textSecondary))
                            : Column(
                                children: data.closures.map((c) {
                                  return ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    title: Text(c.closedDate),
                                    subtitle: c.reason != null ? Text(c.reason!) : null,
                                    trailing: IconButton(
                                      icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.danger),
                                      onPressed: () => _deleteClosure(c),
                                    ),
                                  );
                                }).toList(),
                              ),
                      ),
                    ],
                  );
                },
              ),
            ],
          );
        },
            ),
          ),
        ],
      ),
    );
  }
}

class _HoursData {
  final List<ClinicHours> hours;
  final List<ClinicClosure> closures;
  _HoursData({required this.hours, required this.closures});
}

/// Mirrors the web's ClinicSchedule "Patient booking window" form
/// (client/src/pages/StaffPages.jsx) — a per-doctor policy, not per-clinic,
/// so it lives outside the clinic-hours FutureBuilder above and is always
/// visible regardless of which clinic (or whether any clinic) is selected.
/// Saved via PATCH /doctors/:id (doctors.validation.js#patchDoctor), which
/// requires onlineBooking/allowRebooking/maxDaysAdvance together on every
/// call — onlineBooking isn't collected on this form, so the doctor's
/// current value is carried through unchanged, same as the web form does.
class _BookingWindowCard extends StatefulWidget {
  const _BookingWindowCard();

  @override
  State<_BookingWindowCard> createState() => _BookingWindowCardState();
}

class _BookingWindowCardState extends State<_BookingWindowCard> {
  late final TextEditingController _maxDaysCtrl;
  late final TextEditingController _maxOnlineCtrl;
  late bool _allowRebooking;
  // COMPLETENESS FIX (mobile parity — web's ClinicSchedule "Token numbering for queue" selector,
  // client/src/pages/StaffPages.jsx#savePolicy): one of 'sequential', 'alternate_odd',
  // 'alternate_even' — the latter two both map to tokenNumberingMode:'alternate' on submit, just
  // with a different onlineTokenParity, mirroring the web form's single 3-option select exactly.
  late String _tokenMode;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final profile = context.read<AuthProvider>().profile;
    _maxDaysCtrl = TextEditingController(text: '${profile?.maxDaysAdvance ?? 7}');
    _maxOnlineCtrl = TextEditingController(text: profile?.maxOnlineBookingsPerDay?.toString() ?? '');
    _allowRebooking = profile?.allowRebooking != false;
    _tokenMode = profile?.tokenNumberingMode != 'alternate'
        ? 'sequential'
        : (profile?.onlineTokenParity == 'even' ? 'alternate_even' : 'alternate_odd');
  }

  @override
  void dispose() {
    _maxDaysCtrl.dispose();
    _maxOnlineCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final auth = context.read<AuthProvider>();
    final doctorId = auth.user?.id;
    if (doctorId == null) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final maxOnlineText = _maxOnlineCtrl.text.trim();
      await ApiClient.instance.patch('/doctors/$doctorId', body: {
        'onlineBooking': auth.profile?.onlineBooking ?? true,
        'allowRebooking': _allowRebooking,
        'maxDaysAdvance': int.tryParse(_maxDaysCtrl.text.trim()) ?? 1,
        'maxOnlineBookingsPerDay': maxOnlineText.isEmpty ? null : int.tryParse(maxOnlineText),
        'tokenNumberingMode': _tokenMode == 'sequential' ? 'sequential' : 'alternate',
        'onlineTokenParity': _tokenMode == 'alternate_even' ? 'even' : 'odd',
      });
      await auth.refreshProfile();
      if (mounted) showSuccessSnack(context, 'Booking window saved');
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Patient booking window',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Control how far ahead patients can book and whether same-day rebooking is allowed.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          TextField(
            controller: _maxDaysCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Days patients can book in advance'),
          ),
          const SizedBox(height: AppSpacing.sm),
          SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            title: const Text('Allow same-day rebooking'),
            value: _allowRebooking,
            onChanged: (v) => setState(() => _allowRebooking = v),
          ),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            controller: _maxOnlineCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Max online bookings per day (optional)',
              hintText: 'No limit',
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          const Text(
            "Caps only patients' own online bookings each day — leave blank for no limit. "
            'Walk-ins your receptionist registers at the desk are never counted or blocked by this.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: AppSpacing.sm),
          DropdownButtonFormField<String>(
            initialValue: _tokenMode,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Token numbering for queue'),
            items: const [
              DropdownMenuItem(value: 'sequential', child: Text('Sequential')),
              DropdownMenuItem(value: 'alternate_odd', child: Text('Odd / even — online gets odd numbers')),
              DropdownMenuItem(value: 'alternate_even', child: Text('Odd / even — online gets even numbers')),
            ],
            onChanged: (v) => setState(() => _tokenMode = v ?? 'sequential'),
          ),
          const SizedBox(height: AppSpacing.xs),
          const Text(
            'Sequential gives every booking the next number in one queue. The odd/even options split '
            'online and walk-in bookings into their own alternating sequences — pick whichever parity '
            'you want your OWN online patients to get; walk-ins always get the other one. Helps your '
            'queue display tell them apart at a glance.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: AppSpacing.md),
          PrimaryButton(label: 'Save booking window', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}

class _HoursForm extends StatefulWidget {
  final String clinicId;
  final int weekday;
  final ClinicHours? existing;
  const _HoursForm({required this.clinicId, required this.weekday, this.existing});

  @override
  State<_HoursForm> createState() => _HoursFormState();
}

class _HoursFormState extends State<_HoursForm> {
  TimeOfDay _start = const TimeOfDay(hour: 9, minute: 0);
  TimeOfDay _end = const TimeOfDay(hour: 17, minute: 0);
  int _slotMinutes = 15;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _start = _parseTime(e.startTime);
      _end = _parseTime(e.endTime);
      _slotMinutes = e.slotMinutes;
    }
  }

  TimeOfDay _parseTime(String hhmm) {
    final parts = hhmm.split(':');
    return TimeOfDay(hour: int.tryParse(parts[0]) ?? 9, minute: int.tryParse(parts.length > 1 ? parts[1] : '0') ?? 0);
  }

  String _fmt(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  Future<void> _submit() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      // status removed from this form (mobile parity audit round 2 — user request: "backend hai
      // but website me nahi hai to hata do app se backend v oo hata do"): website's OPD table only
      // ever displays status (StatusPill), it never has a control to set it — so the app's own
      // Active/Inactive dropdown here was the only place that could set it. Server now always
      // keeps existing rows' status untouched and defaults new ones to 'active'.
      await ApiClient.instance.put('/clinics/${widget.clinicId}/hours', body: {
        'weekday': widget.weekday,
        'startTime': _fmt(_start),
        'endTime': _fmt(_end),
        'slotMinutes': _slotMinutes,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      setState(() {
        _error = err.toString();
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_weekdayNames[widget.weekday], style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: AppSpacing.md),
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () async {
                    final picked = await showTimePicker(context: context, initialTime: _start);
                    if (picked != null) setState(() => _start = picked);
                  },
                  child: Text('Start: ${_fmt(_start)}'),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: OutlinedButton(
                  onPressed: () async {
                    final picked = await showTimePicker(context: context, initialTime: _end);
                    if (picked != null) setState(() => _end = picked);
                  },
                  child: Text('End: ${_fmt(_end)}'),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          DropdownButtonFormField<int>(
            initialValue: _slotMinutes,
            decoration: const InputDecoration(labelText: 'Slot length (minutes)'),
            items: const [10, 15, 20, 30, 45, 60].map((m) => DropdownMenuItem(value: m, child: Text('$m min'))).toList(),
            onChanged: (v) => setState(() => _slotMinutes = v ?? 15),
          ),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Save', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}

class _ClosureForm extends StatefulWidget {
  final String clinicId;
  const _ClosureForm({required this.clinicId});

  @override
  State<_ClosureForm> createState() => _ClosureFormState();
}

class _ClosureFormState extends State<_ClosureForm> {
  DateTime? _date;
  final _reasonCtrl = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_date == null) {
      setState(() => _error = 'Pick a date');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/clinics/${widget.clinicId}/closures', body: {
        'closedDate': DateFormat('yyyy-MM-dd').format(_date!),
        if (_reasonCtrl.text.trim().isNotEmpty) 'reason': _reasonCtrl.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      setState(() {
        _error = err.toString();
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Add closed date', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: AppSpacing.md),
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          OutlinedButton.icon(
            onPressed: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: DateTime.now(),
                firstDate: DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (picked != null) setState(() => _date = picked);
            },
            icon: const Icon(Icons.event_outlined, size: 16),
            label: Text(_date == null ? 'Pick a date' : DateFormat('dd MMM yyyy').format(_date!)),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _reasonCtrl, decoration: const InputDecoration(labelText: 'Reason (optional)')),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Save', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}
