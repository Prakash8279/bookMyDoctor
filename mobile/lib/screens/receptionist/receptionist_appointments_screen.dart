import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Clinic's appointment list with status-lifecycle actions. Server-scoped
/// to the receptionist's own clinic (integration_plan.md §1.8); a
/// receptionist has the same status-setting rights as a doctor (any of the
/// 4 legal targets, state-machine gated).
///
/// PARITY FIX (mobile parity audit — Receptionist panel, user request:
/// "receptionist me jitna v extra feature add hai website se oo sab hata
/// do"): the status-filter chip row and the "View slip" button were removed
/// — web's shared AppointmentTable (StaffPages.jsx, used by both doctor and
/// receptionist) has neither: it always lists every row, and its only
/// per-row actions are Confirm/Complete/No-show/Cancel. Booking ID is now
/// shown on each card (web's table has a dedicated "Booking ID" column) and
/// Cancel now asks for confirmation first, matching web's
/// `useDeleteWithConfirm` prompt exactly.
class ReceptionistAppointmentsScreen extends StatefulWidget {
  const ReceptionistAppointmentsScreen({super.key});

  @override
  State<ReceptionistAppointmentsScreen> createState() => _ReceptionistAppointmentsScreenState();
}

class _ReceptionistAppointmentsScreenState extends State<ReceptionistAppointmentsScreen> {
  Future<List<Appointment>>? _future;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  String _shortId(String id) => id.length > 8 ? id.substring(0, 8) : id;

  Future<List<Appointment>> _fetch() async {
    try {
      final res = await ApiClient.instance
          .get('/appointments', query: {'pageSize': 100})
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
    if (status == 'cancelled') {
      final patientName = appt.patient?.name ?? appt.familyMember?.name ?? 'this patient';
      final tokenPart = appt.tokenNumber != null ? ' (token #${appt.tokenNumber})' : '';
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogCtx) => AlertDialog(
          title: const Text('Cancel appointment?'),
          content: Text('Cancel the appointment for $patientName$tokenPart? This cannot be undone.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(dialogCtx).pop(false), child: const Text('Back')),
            TextButton(
              onPressed: () => Navigator.of(dialogCtx).pop(true),
              child: const Text('Cancel appointment', style: TextStyle(color: AppColors.danger)),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }
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

  @override
  Widget build(BuildContext context) {
    // No own Scaffold/AppBar — reached only as a RoleScaffold nav-item body
    // (receptionist_home_screen.dart) or pushed from the dashboard already
    // wrapped in its own Scaffold+AppBar (receptionist_dashboard_screen.dart);
    // either way an outer Scaffold/AppBar already exists, so one here would
    // just duplicate the title bar.
    return Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Appointments',
              subtitle: 'Manage scheduled and walk-in visits.',
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
                              const SizedBox(height: 2),
                              // COMPLETENESS FIX (mobile parity audit — Receptionist panel): web's
                              // shared AppointmentTable has a dedicated "Booking ID" column
                              // (StaffPages.jsx's "BOOKING-ID VISIBILITY FIX") — this card never
                              // showed it anywhere.
                              Text('Booking ID: #${_shortId(a.id)}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                              const SizedBox(height: 4),
                              Text('${a.appointmentDate} · ${a.appointmentTime}', style: const TextStyle(color: AppColors.textSecondary)),
                              if (a.doctor?.name != null)
                                Text('Dr. ${a.doctor!.name}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              // BUG FIX (mobile parity audit): web's AppointmentTable (StaffPages.jsx)
                              // shows Clinic and Fee/Due columns — this card never rendered either
                              // even though both were already parsed onto the Appointment/Fees models.
                              if (a.clinic?.name != null)
                                Text('Clinic: ${a.clinic!.name}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              // Front-desk data only — appointments.service.js#shapePatientRef
                              // deliberately never sends gender/DOB/blood group/medical history
                              // to a receptionist caller (only phone, to call the patient), so
                              // there's no clinical "vitals"/"health notes" block on this screen.
                              if (a.patient?.phone != null) ...[
                                const SizedBox(height: 4),
                                Text(a.patient!.phone!, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                              ],
                              if (a.reason != null && a.reason!.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Text('Reason: ${a.reason}'),
                              ],
                              const SizedBox(height: 4),
                              Text(
                                'Token: ${a.tokenNumber ?? "—"} · Source: ${a.source} · Payment: ${a.paymentStatus ?? "—"}${a.isEmergency ? " · Emergency" : ""}',
                                style: const TextStyle(fontSize: 12),
                              ),
                              if (a.fees.consultationFee != null || a.fees.due != null) ...[
                                const SizedBox(height: 2),
                                Text(
                                  'Fee: ${a.fees.consultationFee != null ? "₹${a.fees.consultationFee!.toStringAsFixed(2)}" : "—"}'
                                  '   ·   Due: ${a.fees.due != null ? "₹${a.fees.due!.toStringAsFixed(2)}" : "—"}',
                                  style: const TextStyle(fontSize: 12),
                                ),
                              ],
                              if (busy) ...[
                                const SizedBox(height: AppSpacing.sm),
                                const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                              ] else ...[
                                const SizedBox(height: AppSpacing.sm),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    ...targets.map((s) => OutlinedButton(
                                          onPressed: () => _setStatus(a, s),
                                          child: Text(s.replaceAll('_', ' ')),
                                        )),
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
