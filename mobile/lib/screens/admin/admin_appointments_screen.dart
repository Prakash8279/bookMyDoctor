import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

String _shortId(String id) {
  if (id.isEmpty || id == '—') return '—';
  final tail = id.contains('_') ? id.split('_').last : id;
  return '#${tail.length > 4 ? tail.substring(tail.length - 4) : tail}';
}

/// Platform-wide appointments registry — mirrors the web admin portal's
/// `PortalAppointments(role: 'admin')` (PortalSectionPages.jsx):
/// Filter by city, doctor, date range, and status. Displays sequence #DC01,
/// Booking ID, Token, Doctor, Patient, Clinic, Status, Payment, Fee, and Actions.
class AdminAppointmentsScreen extends StatefulWidget {
  const AdminAppointmentsScreen({super.key});

  @override
  State<AdminAppointmentsScreen> createState() => _AdminAppointmentsScreenState();
}

class _AdminAppointmentsScreenState extends State<AdminAppointmentsScreen> {
  String? _statusFilter;
  String? _cityId;
  String? _doctorId;
  DateTime? _dateFrom;
  DateTime? _dateTo;

  Future<List<Appointment>>? _future;
  Future<List<City>>? _citiesFuture;
  Future<List<DoctorDirectoryItem>>? _doctorsFuture;
  String? _busyId;

  static const _filters = <(String?, String)>[
    (null, 'All'),
    ('upcoming', 'Upcoming'),
    ('confirmed', 'Confirmed'),
    ('completed', 'Completed'),
    ('cancelled', 'Cancelled'),
    ('no_show', 'No-show'),
  ];

  @override
  void initState() {
    super.initState();
    _citiesFuture = ApiClient.instance
        .get('/geography/cities', query: {'pageSize': 100})
        .then((res) {
          final list = <City>[];
          for (final item in res.list) {
            try {
              list.add(City.fromJson(item));
            } catch (_) {}
          }
          return list;
        })
        .catchError((_) => <City>[]);

    _doctorsFuture = ApiClient.instance
        .get('/doctors', query: {'pageSize': 100})
        .then((res) {
          final list = <DoctorDirectoryItem>[];
          for (final item in res.list) {
            try {
              list.add(DoctorDirectoryItem.fromJson(item));
            } catch (_) {}
          }
          return list;
        })
        .catchError((_) => <DoctorDirectoryItem>[]);

    _future = _fetch();
  }

  Future<List<Appointment>> _fetch() async {
    try {
      final query = <String, dynamic>{
        'pageSize': 100,
        if (_statusFilter != null) 'status': _statusFilter,
        if (_cityId != null && _cityId!.isNotEmpty) 'cityId': _cityId,
        if (_doctorId != null && _doctorId!.isNotEmpty) 'doctorId': _doctorId,
        if (_dateFrom != null) 'dateFrom': DateFormat('yyyy-MM-dd').format(_dateFrom!),
        if (_dateTo != null) 'dateTo': DateFormat('yyyy-MM-dd').format(_dateTo!),
      };
      final res = await ApiClient.instance
          .get('/appointments', query: query)
          .catchError((_) => ApiResponse(data: []));
      final list = <Appointment>[];
      for (final item in res.list) {
        try {
          list.add(Appointment.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  void _clearFilters() {
    setState(() {
      _cityId = null;
      _doctorId = null;
      _dateFrom = null;
      _dateTo = null;
      _statusFilter = null;
    });
    _load();
  }

  bool get _hasActiveFilters =>
      _cityId != null || _doctorId != null || _dateFrom != null || _dateTo != null || _statusFilter != null;

  Future<void> _pickDateFrom() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateFrom ?? DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 730)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() => _dateFrom = picked);
      _load();
    }
  }

  Future<void> _pickDateTo() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateTo ?? (_dateFrom ?? DateTime.now()),
      firstDate: DateTime.now().subtract(const Duration(days: 730)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() => _dateTo = picked);
      _load();
    }
  }

  List<String> _legalTargets(String status) {
    switch (status) {
      case 'upcoming':
        return const ['confirmed', 'completed', 'cancelled', 'no_show'];
      case 'confirmed':
        return const ['completed', 'cancelled', 'no_show'];
      default:
        return const [];
    }
  }

  Future<void> _setStatus(Appointment appt, String status) async {
    setState(() => _busyId = appt.id);
    try {
      await ApiClient.instance.patch('/appointments/${appt.id}/status', body: {'status': status});
      if (mounted) showSuccessSnack(context, 'Marked ${status.replaceAll('_', ' ')}');
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  // Mirrors doctor/receptionist screens' confirm-before-cancel: cancelling
  // releases the queue token and can't be reversed, so this always confirms
  // first (matches the web AppointmentTable's useDeleteWithConfirm prompt).
  Future<void> _confirmCancel(Appointment appt) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Cancel appointment?'),
        content: Text(
          'Cancel the appointment for ${appt.patient?.name ?? appt.familyMember?.name ?? "this patient"}'
          '${appt.tokenNumber != null ? " (token #${appt.tokenNumber})" : ""}? This cannot be undone.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep appointment')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Cancel appointment')),
        ],
      ),
    );
    if (confirmed == true) _setStatus(appt, 'cancelled');
  }

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('dd MMM yyyy');
    final invalidDateRange = _dateFrom != null && _dateTo != null && _dateFrom!.isAfter(_dateTo!);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const PageHeader(
                title: 'Appointments registry',
                subtitle: 'Manage every booking in the platform.',
              ),
              if (invalidDateRange)
                Container(
                  margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.danger.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
                  ),
                  child: const Text(
                    'From date must be before To date.',
                    style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                ),
              // City and Doctor filter dropdowns
              Row(
                children: [
                  Expanded(
                    child: FutureBuilder<List<City>>(
                      future: _citiesFuture,
                      builder: (context, snapshot) {
                        final cities = snapshot.data ?? [];
                        return DropdownButtonFormField<String>(
                          initialValue: _cityId,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'City',
                            contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                          ),
                          items: [
                            const DropdownMenuItem(value: null, child: Text('All cities', style: TextStyle(fontSize: 13))),
                            ...cities.map((c) => DropdownMenuItem(
                                  value: c.id,
                                  child: Text(c.name, style: const TextStyle(fontSize: 13), overflow: TextOverflow.ellipsis),
                                )),
                          ],
                          onChanged: (val) {
                            setState(() => _cityId = val);
                            _load();
                          },
                        );
                      },
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: FutureBuilder<List<DoctorDirectoryItem>>(
                      future: _doctorsFuture,
                      builder: (context, snapshot) {
                        final doctors = snapshot.data ?? [];
                        return DropdownButtonFormField<String>(
                          initialValue: _doctorId,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Doctor',
                            contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                          ),
                          items: [
                            const DropdownMenuItem(value: null, child: Text('All doctors', style: TextStyle(fontSize: 13))),
                            ...doctors.map((d) => DropdownMenuItem(
                                  value: d.id,
                                  child: Text(d.name, style: const TextStyle(fontSize: 13), overflow: TextOverflow.ellipsis),
                                )),
                          ],
                          onChanged: (val) {
                            setState(() => _doctorId = val);
                            _load();
                          },
                        );
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              // Date From & Date To filter buttons
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _pickDateFrom,
                      icon: const Icon(Icons.calendar_today_outlined, size: 14),
                      label: Text(
                        _dateFrom == null ? 'From date' : dateFormat.format(_dateFrom!),
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _pickDateTo,
                      icon: const Icon(Icons.calendar_today_outlined, size: 14),
                      label: Text(
                        _dateTo == null ? 'To date' : dateFormat.format(_dateTo!),
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                  ),
                  if (_hasActiveFilters) ...[
                    const SizedBox(width: 6),
                    IconButton(
                      tooltip: 'Clear filters',
                      onPressed: _clearFilters,
                      icon: const Icon(Icons.clear, size: 18),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
        // Status chips
        SizedBox(
          height: 44,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 2),
            itemCount: _filters.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, i) {
              final (value, label) = _filters[i];
              final selected = _statusFilter == value;
              return ChoiceChip(
                label: Text(label, style: const TextStyle(fontSize: 12)),
                selected: selected,
                onSelected: (_) {
                  setState(() => _statusFilter = value);
                  _load();
                },
              );
            },
          ),
        ),
        Expanded(
          child: FutureBuilder<List<Appointment>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
              if (snapshot.hasError) {
                return Padding(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  child: ErrorBanner(error: snapshot.error!, onRetry: _load),
                );
              }
              final appts = snapshot.data ?? [];
              if (appts.isEmpty) {
                return const EmptyStateView(icon: Icons.event_note_outlined, title: 'No appointments found');
              }
              return RefreshIndicator(
                onRefresh: () async => _load(),
                child: ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: appts.length,
                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, i) {
                    final a = appts[i];
                    final seqId = 'DC${(i + 1).toString().padLeft(2, '0')}';
                    final targets = _legalTargets(a.status);
                    final busy = _busyId == a.id;
                    final totalFee = (a.fees.totalAmount ?? a.fees.consultationFee ?? 0);

                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Top row: Sequence ID + Booking ID Badge + Status Badge
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppColors.surface,
                                    borderRadius: BorderRadius.circular(4),
                                    border: Border.all(color: AppColors.border),
                                  ),
                                  child: Text(
                                    '#$seqId',
                                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 11, color: AppColors.primaryDark),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                InkWell(
                                  onTap: () {
                                    Clipboard.setData(ClipboardData(text: a.id));
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text('Booking ID copied: ${a.id}'),
                                        duration: const Duration(seconds: 2),
                                      ),
                                    );
                                  },
                                  borderRadius: BorderRadius.circular(4),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: AppColors.primaryLight,
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          'Booking ${_shortId(a.id)}',
                                          style: const TextStyle(
                                            color: AppColors.primaryDark,
                                            fontSize: 11,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                        const SizedBox(width: 3),
                                        const Icon(Icons.copy, size: 10, color: AppColors.primaryDark),
                                      ],
                                    ),
                                  ),
                                ),
                                if (a.tokenNumber != null) ...[
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: AppColors.surface,
                                      borderRadius: BorderRadius.circular(4),
                                      border: Border.all(color: AppColors.border),
                                    ),
                                    child: Text(
                                      'Token #${a.tokenNumber}',
                                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
                                    ),
                                  ),
                                ],
                                const Spacer(),
                                StatusBadge(status: a.status),
                              ],
                            ),
                            const SizedBox(height: 8),
                            // Patient name
                            Text(
                              a.patient?.name ?? a.familyMember?.name ?? 'Patient',
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                            ),
                            const SizedBox(height: 3),
                            // Date & Time
                            Row(
                              children: [
                                const Icon(Icons.calendar_today_outlined, size: 13, color: AppColors.textSecondary),
                                const SizedBox(width: 4),
                                Text(
                                  '${a.appointmentDate} · ${a.appointmentTime}',
                                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                ),
                              ],
                            ),
                            // Doctor & Clinic
                            if (a.doctor?.name != null || a.clinic?.name != null) ...[
                              const SizedBox(height: 3),
                              Row(
                                children: [
                                  const Icon(Icons.medical_services_outlined, size: 13, color: AppColors.textSecondary),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      [
                                        if (a.doctor?.name != null) 'Dr. ${a.doctor!.name}',
                                        if (a.clinic?.name != null) a.clinic!.name!,
                                      ].join(' · '),
                                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                            // Phone & vitals
                            if (a.patient?.phone != null || a.patient?.vitalsSummary != null) ...[
                              const SizedBox(height: 3),
                              Text(
                                [a.patient?.phone, a.patient?.vitalsSummary].whereType<String>().join(' · '),
                                style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                              ),
                            ],
                            if (a.patient?.hasHealthNotes ?? false) ...[
                              const SizedBox(height: 3),
                              Text(
                                a.patient!.healthNotesSummary!,
                                style: const TextStyle(fontSize: 11, fontStyle: FontStyle.italic),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                            if (a.reason != null && a.reason!.isNotEmpty) ...[
                              const SizedBox(height: 3),
                              Text('Notes: ${a.reason}', style: const TextStyle(fontSize: 12)),
                            ],
                            const SizedBox(height: 6),
                            const Divider(height: 1),
                            const SizedBox(height: 6),
                            // Fee & Payment row
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Row(
                                  children: [
                                    const Text('Fee: ', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                                    Text('₹${totalFee.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                    if (a.isEmergency)
                                      const Text(' (Emergency)', style: TextStyle(color: AppColors.danger, fontSize: 11, fontWeight: FontWeight.w600)),
                                  ],
                                ),
                                Row(
                                  children: [
                                    const Text('Payment: ', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                                    StatusBadge(status: a.paymentStatus ?? 'pending'),
                                    if (a.paymentMethod != null && a.paymentMethod!.isNotEmpty) ...[
                                      const SizedBox(width: 4),
                                      Text('(${a.paymentMethod})', style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                                    ],
                                  ],
                                ),
                              ],
                            ),
                            // Action buttons
                            if (busy) ...[
                              const SizedBox(height: AppSpacing.sm),
                              const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
                            ] else if (targets.isNotEmpty || a.status == 'pending_payment') ...[
                              const SizedBox(height: AppSpacing.sm),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  if (a.status == 'pending_payment')
                                    ElevatedButton(
                                      onPressed: () => _confirmCancel(a),
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: AppColors.danger,
                                        foregroundColor: Colors.white,
                                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                      ),
                                      child: const Text('Cancel', style: TextStyle(fontSize: 12)),
                                    )
                                  else ...[
                                    if (a.status != 'confirmed')
                                      ElevatedButton(
                                        onPressed: () => _setStatus(a, 'confirmed'),
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: AppColors.primaryDark,
                                          foregroundColor: Colors.white,
                                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                        ),
                                        child: const Text('Confirm', style: TextStyle(fontSize: 12)),
                                      ),
                                    ElevatedButton(
                                      onPressed: () => _setStatus(a, 'completed'),
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: AppColors.primary,
                                        foregroundColor: Colors.white,
                                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                      ),
                                      child: const Text('Complete', style: TextStyle(fontSize: 12)),
                                    ),
                                    OutlinedButton(
                                      onPressed: () => _confirmCancel(a),
                                      style: OutlinedButton.styleFrom(
                                        foregroundColor: AppColors.danger,
                                        side: const BorderSide(color: AppColors.danger),
                                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                      ),
                                      child: const Text('Cancel', style: TextStyle(fontSize: 12)),
                                    ),
                                  ],
                                ],
                              ),
                            ],
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
