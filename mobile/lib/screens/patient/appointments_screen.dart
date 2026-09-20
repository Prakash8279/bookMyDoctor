import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/booking_slip_sheet.dart';
import '../../widgets/common_widgets.dart';
import 'payment_required_screen.dart';
import 'queue_tracker_screen.dart';

/// GET /appointments (server-scoped to the caller — a patient only ever
/// sees their own, no query param can widen that) + PATCH /appointments/:id/status
/// for cancel (patient may ONLY set 'cancelled', and only within the
/// cancellation window — integration_plan.md §1.8). Live queue position/ETA
/// (patientsAhead/estimatedWaitMinutes) IS available to a patient via
/// GET /queue/mine/:appointmentId (queue.service.js#getMyQueueStatus,
/// patient-only, scoped to one of their own appointments) — see
/// [QueueTrackerScreen], pushed from the "Track queue" action below on an
/// upcoming/confirmed appointment (the only statuses that can have an active
/// queue token: a token is created when the appointment is checked in/paid
/// for and is done once the appointment is completed/cancelled/no_show).
class PatientAppointmentsScreen extends StatefulWidget {
  final bool isHistory;
  const PatientAppointmentsScreen({super.key, this.isHistory = false});

  @override
  State<PatientAppointmentsScreen> createState() => _PatientAppointmentsScreenState();
}

class _PatientAppointmentsScreenState extends State<PatientAppointmentsScreen> {
  String? _statusFilter;
  Future<List<Appointment>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<List<Appointment>> _fetch() async {
    try {
      final res = await ApiClient.instance.get('/appointments', query: {
        'pageSize': 50,
        if (_statusFilter != null) 'status': _statusFilter,
      }).catchError((_) => ApiResponse(data: []));
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

  Future<void> _cancel(Appointment appt) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Cancel appointment?'),
        content: const Text('This cannot be undone. Cancellation may not be allowed too close to the appointment time.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('No')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Yes, cancel')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await ApiClient.instance.patch('/appointments/${appt.id}/status', body: {'status': 'cancelled'});
      if (mounted) {
        showSuccessSnack(context, 'Appointment cancelled');
        _load();
      }
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

  Future<void> _leaveReview(Appointment appt) async {
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _ReviewDialog(doctorName: appt.doctor?.name ?? 'the doctor'),
    );
    if (result == null) return;
    try {
      await ApiClient.instance.post('/reviews', body: {
        'appointmentId': appt.id,
        'rating': result['rating'],
        if ((result['text'] as String).isNotEmpty) 'text': result['text'],
      });
      if (mounted) showSuccessSnack(context, 'Thanks for your review!');
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(
            title: widget.isHistory ? 'Booking history' : 'My appointments',
            subtitle: widget.isHistory
                ? 'Review every clinic visit and view/download booking slips.'
                : 'View upcoming bookings, download slips, and review completed consultations.',
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: SizedBox(
            height: 36,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                _StatusChip(label: 'All', selected: _statusFilter == null, onTap: () => setState(() { _statusFilter = null; _load(); })),
                _StatusChip(label: 'Upcoming', selected: _statusFilter == 'upcoming', onTap: () => setState(() { _statusFilter = 'upcoming'; _load(); })),
                _StatusChip(label: 'Pending payment', selected: _statusFilter == 'pending_payment', onTap: () => setState(() { _statusFilter = 'pending_payment'; _load(); })),
                _StatusChip(label: 'Confirmed', selected: _statusFilter == 'confirmed', onTap: () => setState(() { _statusFilter = 'confirmed'; _load(); })),
                _StatusChip(label: 'Completed', selected: _statusFilter == 'completed', onTap: () => setState(() { _statusFilter = 'completed'; _load(); })),
                _StatusChip(label: 'Cancelled', selected: _statusFilter == 'cancelled', onTap: () => setState(() { _statusFilter = 'cancelled'; _load(); })),
              ],
            ),
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
              final appointments = snapshot.data ?? [];
              if (appointments.isEmpty) {
                return const EmptyStateView(icon: Icons.event_busy, title: 'No appointments here');
              }
              return RefreshIndicator(
                onRefresh: () async => _load(),
                child: ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: appointments.length,
                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, i) {
                    final appt = appointments[i];
                    return _AppointmentCard(
                      appointment: appt,
                      onCancel: (appt.status == 'upcoming' || appt.status == 'confirmed' || appt.status == 'pending_payment')
                          ? () => _cancel(appt)
                          : null,
                      onReview: appt.status == 'completed' ? () => _leaveReview(appt) : null,
                      onTrackQueue: (appt.status == 'upcoming' || appt.status == 'confirmed')
                          ? () => Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => QueueTrackerScreen(appointmentId: appt.id)),
                              )
                          : null,
                      onPayNow: appt.status == 'pending_payment'
                          ? () async {
                              final updated = await Navigator.of(context).push<Appointment>(
                                MaterialPageRoute(builder: (_) => PaymentRequiredScreen(appointment: appt)),
                              );
                              if (updated != null && mounted) _load();
                            }
                          : null,
                      onViewSlip: () => _showBookingSlip(context, appt),
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

  void _showBookingSlip(BuildContext context, Appointment appt) {
    showBookingSlipSheet(context, appt);
  }
}

class _StatusChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _StatusChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(label: Text(label), selected: selected, onSelected: (_) => onTap()),
    );
  }
}

class _AppointmentCard extends StatelessWidget {
  final Appointment appointment;
  final VoidCallback? onCancel;
  final VoidCallback? onReview;
  final VoidCallback? onTrackQueue;
  final VoidCallback? onPayNow;
  final VoidCallback onViewSlip;

  const _AppointmentCard({
    required this.appointment,
    this.onCancel,
    this.onReview,
    this.onTrackQueue,
    this.onPayNow,
    required this.onViewSlip,
  });

  @override
  Widget build(BuildContext context) {
    final fee = appointment.fees.totalAmount ?? appointment.fees.consultationFee ?? 0;
    final paymentStatus = appointment.paymentStatus ?? (appointment.status == 'pending_payment' ? 'pending' : 'pending');

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        appointment.doctor?.name ?? 'Doctor',
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                      ),
                      if (appointment.doctor?.specialization != null)
                        Text(
                          appointment.doctor!.specialization!.name,
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                        ),
                    ],
                  ),
                ),
                Wrap(
                  spacing: 6,
                  children: [
                    StatusBadge(status: appointment.status),
                    StatusBadge(status: paymentStatus),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.calendar_today, size: 14, color: AppColors.textSecondary),
                            const SizedBox(width: 6),
                            Text(
                              '${appointment.appointmentDate} · ${appointment.appointmentTime}',
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
                            ),
                          ],
                        ),
                        if (appointment.clinic?.name != null) ...[
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              const Icon(Icons.location_on_outlined, size: 14, color: AppColors.textSecondary),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  appointment.clinic!.name!,
                                  style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (appointment.tokenNumber != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
                      ),
                      child: Column(
                        children: [
                          const Text('TOKEN', style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppColors.primaryDark)),
                          Text(
                            '#${appointment.tokenNumber}',
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.primaryDark),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  appointment.familyMember != null
                      ? 'For: ${appointment.familyMember!.name} (${appointment.familyMember!.relation})'
                      : 'For: Myself',
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
                Text(
                  'Fee: ₹${fee.toStringAsFixed(0)}',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                ),
              ],
            ),
            const Divider(height: 18),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                OutlinedButton.icon(
                  onPressed: onViewSlip,
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  icon: const Icon(Icons.remove_red_eye_outlined, size: 15),
                  label: const Text('View slip'),
                ),
                if (onTrackQueue != null)
                  ElevatedButton.icon(
                    onPressed: onTrackQueue,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.charcoal,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                    icon: const Icon(Icons.timelapse, size: 15),
                    label: const Text('Track queue'),
                  ),
                if (onPayNow != null)
                  ElevatedButton(
                    onPressed: onPayNow,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                    child: Text('Pay ₹${fee.toStringAsFixed(0)} now'),
                  ),
                if (onReview != null)
                  TextButton.icon(
                    onPressed: onReview,
                    icon: const Icon(Icons.star_outline, size: 15, color: AppColors.warning),
                    label: const Text('Leave review', style: TextStyle(color: AppColors.warning, fontSize: 12)),
                  ),
                if (onCancel != null)
                  TextButton(
                    onPressed: onCancel,
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.danger,
                      textStyle: const TextStyle(fontSize: 12),
                    ),
                    child: const Text('Cancel'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}



class _ReviewDialog extends StatefulWidget {
  final String doctorName;
  const _ReviewDialog({required this.doctorName});

  @override
  State<_ReviewDialog> createState() => _ReviewDialogState();
}

class _ReviewDialogState extends State<_ReviewDialog> {
  int _rating = 5;
  final _textController = TextEditingController();

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Review ${widget.doctorName}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(
              5,
              (i) => IconButton(
                icon: Icon(i < _rating ? Icons.star : Icons.star_border, color: AppColors.warning),
                onPressed: () => setState(() => _rating = i + 1),
              ),
            ),
          ),
          TextField(
            controller: _textController,
            maxLines: 3,
            decoration: const InputDecoration(hintText: 'Share your experience (optional)'),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        TextButton(
          onPressed: () => Navigator.of(context).pop({'rating': _rating, 'text': _textController.text.trim()}),
          child: const Text('Submit'),
        ),
      ],
    );
  }
}
