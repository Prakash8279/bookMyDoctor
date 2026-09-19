import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
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
  const PatientAppointmentsScreen({super.key});

  @override
  State<PatientAppointmentsScreen> createState() => _PatientAppointmentsScreenState();
}

class _PatientAppointmentsScreenState extends State<PatientAppointmentsScreen> {
  String? _statusFilter;
  Future<List<Appointment>>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<List<Appointment>> _fetch() async {
    final res = await ApiClient.instance.get('/appointments', query: {
      'pageSize': 50,
      if (_statusFilter != null) 'status': _statusFilter,
    });
    return res.list.map(Appointment.fromJson).toList();
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
        const Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(
            title: 'My appointments',
            subtitle: 'View upcoming bookings, download slips, and review completed consultations.',
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
                      onCancel: (appt.status == 'upcoming' || appt.status == 'confirmed') ? () => _cancel(appt) : null,
                      onReview: appt.status == 'completed' ? () => _leaveReview(appt) : null,
                      onTrackQueue: (appt.status == 'upcoming' || appt.status == 'confirmed')
                          ? () => Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => QueueTrackerScreen(appointmentId: appt.id)),
                              )
                          : null,
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
  const _AppointmentCard({required this.appointment, this.onCancel, this.onReview, this.onTrackQueue});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    appointment.doctor?.name ?? 'Doctor',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                  ),
                ),
                StatusBadge(status: appointment.status),
              ],
            ),
            if (appointment.doctor?.specialization != null)
              Text(appointment.doctor!.specialization!.name, style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(Icons.calendar_today, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 4),
                Text('${appointment.appointmentDate} · ${appointment.appointmentTime}'),
              ],
            ),
            if (appointment.clinic?.name != null) ...[
              const SizedBox(height: 2),
              Row(
                children: [
                  const Icon(Icons.location_on_outlined, size: 14, color: AppColors.textSecondary),
                  const SizedBox(width: 4),
                  Expanded(child: Text(appointment.clinic!.name!)),
                ],
              ),
            ],
            if (appointment.tokenNumber != null) ...[
              const SizedBox(height: 2),
              Text('Token: ${appointment.tokenNumber}', style: const TextStyle(fontWeight: FontWeight.w600)),
            ],
            if (appointment.familyMember != null) ...[
              const SizedBox(height: 2),
              Text('For: ${appointment.familyMember!.name} (${appointment.familyMember!.relation})'),
            ],
            if (appointment.fees.consultationFee != null) ...[
              const SizedBox(height: 2),
              Text('Consultation: ₹${appointment.fees.consultationFee!.toStringAsFixed(0)}'),
            ],
            if (appointment.fees.totalAmount != null)
              Text('Total: ₹${appointment.fees.totalAmount!.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w600)),
            if (onCancel != null || onReview != null || onTrackQueue != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  if (onTrackQueue != null)
                    TextButton.icon(onPressed: onTrackQueue, icon: const Icon(Icons.timelapse, size: 16), label: const Text('Track queue')),
                  if (onReview != null)
                    TextButton.icon(onPressed: onReview, icon: const Icon(Icons.star_outline, size: 16), label: const Text('Leave review')),
                  const Spacer(),
                  if (onCancel != null)
                    TextButton(
                      onPressed: onCancel,
                      style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                      child: const Text('Cancel'),
                    ),
                ],
              ),
            ],
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
