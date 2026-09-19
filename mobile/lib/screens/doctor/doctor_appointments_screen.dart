import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Doctor's full appointment list with status-lifecycle actions.
/// integration_plan.md §1.8: doctor may set any of the 4 terminal/interim
/// targets (confirmed/completed/cancelled/no_show); the state machine only
/// allows `upcoming` -> any of the 4, and `confirmed` -> completed/cancelled/
/// no_show — completed/cancelled/no_show are terminal (no actions shown).
class DoctorAppointmentsScreen extends StatefulWidget {
  const DoctorAppointmentsScreen({super.key});

  @override
  State<DoctorAppointmentsScreen> createState() => _DoctorAppointmentsScreenState();
}

class _DoctorAppointmentsScreenState extends State<DoctorAppointmentsScreen> {
  String? _statusFilter;
  Future<List<Appointment>>? _future;
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
    _load();
  }

  void _load() {
    setState(() {
      _future = ApiClient.instance
          .get('/appointments', query: {if (_statusFilter != null) 'status': _statusFilter, 'pageSize': 100})
          .then((res) => res.list.map(Appointment.fromJson).toList());
    });
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

  // COMPLETENESS FIX (mobile parity): the web AppointmentTable only ever cancels after a confirm
  // prompt (useDeleteWithConfirm — "This cannot be undone.") since cancelling releases the queue
  // token and can't be reversed; this screen let the doctor tap "cancelled" with no confirmation.
  Future<void> _confirmCancel(Appointment appt) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Cancel appointment?'),
        content: Text(
          'Cancel the appointment for ${appt.patient?.name ?? "this patient"}'
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
    return Scaffold(
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Appointments',
              subtitle: 'Manage scheduled patients and consultation status.',
            ),
          ),
          SizedBox(
            height: 48,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 4),
              itemCount: _filters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final (value, label) = _filters[i];
                final selected = _statusFilter == value;
                return ChoiceChip(
                  label: Text(label),
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
                      final targets = _legalTargets(a.status);
                      final busy = _busyId == a.id;
                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(a.patient?.name ?? 'Patient', style: const TextStyle(fontWeight: FontWeight.w700)),
                                  ),
                                  StatusBadge(status: a.status),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text('${a.appointmentDate} · ${a.appointmentTime}', style: const TextStyle(color: AppColors.textSecondary)),
                              if (a.clinic?.name != null)
                                Text(a.clinic!.name!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              // Phone + clinical vitals (gender/age/blood group) are only ever
                              // present here for a doctor/admin caller — appointments.service.js
                              // #shapePatientRef never sends them to anyone else — so this block
                              // simply doesn't render for a role that doesn't get the data.
                              if (a.patient?.phone != null || a.patient?.vitalsSummary != null) ...[
                                const SizedBox(height: 4),
                                Text(
                                  [a.patient?.phone, a.patient?.vitalsSummary].whereType<String>().join(' · '),
                                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                                ),
                              ],
                              if (a.patient?.hasHealthNotes ?? false) ...[
                                const SizedBox(height: 4),
                                Text(a.patient!.healthNotesSummary!, style: const TextStyle(fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
                              ],
                              if (a.reason != null && a.reason!.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Text('Reason: ${a.reason}'),
                              ],
                              const SizedBox(height: 4),
                              Text(
                                'Token: ${a.tokenNumber ?? "—"} · Fee: ${a.fees.consultationFee != null ? "₹${a.fees.consultationFee!.toStringAsFixed(0)}" : "—"}${a.isEmergency ? " · Emergency" : ""}',
                                style: const TextStyle(fontSize: 12),
                              ),
                              // COMPLETENESS FIX (mobile parity): the web AppointmentTable shows a
                              // dedicated Payment (status) + Payment method column per row
                              // (StaffPages.jsx#AppointmentTable) — the model already parses both
                              // fields but this card never rendered them.
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  const Text('Payment: ', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                                  StatusBadge(status: a.paymentStatus ?? 'pending'),
                                  if (a.paymentMethod != null) ...[
                                    const SizedBox(width: 6),
                                    Text(a.paymentMethod!, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                                  ],
                                ],
                              ),
                              if (busy) ...[
                                const SizedBox(height: AppSpacing.sm),
                                const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                              ] else if (targets.isNotEmpty) ...[
                                const SizedBox(height: AppSpacing.sm),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: targets
                                      .map((s) => OutlinedButton(
                                            onPressed: () => s == 'cancelled' ? _confirmCancel(a) : _setStatus(a, s),
                                            child: Text(s.replaceAll('_', ' ')),
                                          ))
                                      .toList(),
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
      ),
    );
  }
}
