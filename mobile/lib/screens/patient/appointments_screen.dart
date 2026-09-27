import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../models/clinical_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/booking_slip_sheet.dart';
import '../../widgets/common_widgets.dart';
import 'payment_required_screen.dart';
import 'queue_tracker_screen.dart';
import 'package:provider/provider.dart';

// COMPLETENESS FIX (mobile parity audit, patient panel): ports web's per-row Paid/Due/displayFee
// computation (PatientPages.jsx#PatientAppointments, extensively commented there as the
// "PAID/DUE FIX"/"MIN-BOOKING-REMAINDER FIX"/"ONE-FEE-COLUMN FIX" rounds) — an appointment can be
// settled two ways: one online payment for the full fee, or the doctor's minimum booking amount
// online plus the remainder collected later at the clinic ("partial"). Mobile's card previously
// showed only a single flat "Fee: ₹X" with no Paid/Due split at all.
class _AppointmentMoney {
  final double fee;
  final double displayFee;
  final double paid;
  final double due;
  final String status; // pending|partial|paid
  final String mode;
  final String? transactionRef;
  _AppointmentMoney({
    required this.fee,
    required this.displayFee,
    required this.paid,
    required this.due,
    required this.status,
    required this.mode,
    this.transactionRef,
  });
}

_AppointmentMoney _computeMoney(Appointment appointment, List<PaymentItem> payments) {
  final appointmentPayments = payments.where((p) => p.appointment?.id == appointment.id).toList();
  final payment = appointmentPayments.isNotEmpty ? appointmentPayments.first : null;
  final fee = appointment.fees.totalAmount ?? payment?.fees.amount ?? appointment.fees.consultationFee ?? 0;
  final status = appointment.paymentStatus ?? payment?.status ?? 'pending';
  final paidFromRecords = appointmentPayments.fold<double>(0, (sum, p) => sum + (p.fees.amount ?? 0));
  final paid = appointmentPayments.isNotEmpty ? paidFromRecords : (status == 'paid' ? fee : paidFromRecords);
  final minRemainder = appointment.fees.minBookingRemainder;
  final due = status == 'paid'
      ? 0.0
      : status == 'partial' && minRemainder != null
          ? minRemainder
          : (fee - paid < 0 ? 0.0 : fee - paid);
  final minBookingAmount = appointment.fees.minBookingAmount;
  final feeMinimumPath = (minBookingAmount != null && minRemainder != null) ? minBookingAmount + minRemainder : null;
  final displayFee = status == 'partial' && feeMinimumPath != null ? feeMinimumPath : (status == 'paid' ? paid : fee);
  return _AppointmentMoney(
    fee: fee,
    displayFee: displayFee,
    paid: paid,
    due: due,
    status: status,
    mode: payment?.mode ?? appointment.paymentMethod ?? 'pay_at_clinic',
    transactionRef: payment?.transactionRef,
  );
}

// Ports client/src/lib/format.js's shortId() exactly — last 4 chars after an underscore split,
// prefixed with '#'. Used for the "Booking ID" a patient reads off the slip or quotes at the
// clinic counter (distinct from the on-screen row-position "ID", which is just #1, #2…).
String _shortId(String id) {
  final tail = id.contains('_') ? id.split('_').last : id;
  return '#${tail.length > 4 ? tail.substring(tail.length - 4) : tail}';
}

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

class _PatientAppointmentsData {
  final List<Appointment> appointments;
  final List<PaymentItem> payments;
  _PatientAppointmentsData({required this.appointments, required this.payments});
}

class _PatientAppointmentsScreenState extends State<PatientAppointmentsScreen> {
  String? _statusFilter;
  Future<_PatientAppointmentsData>? _future;

  @override
  void initState() {
    super.initState();
    if (widget.isHistory) {
      _statusFilter = 'completed';
    }
    _future = _fetch();
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<_PatientAppointmentsData> _fetch() async {
    final appointments = await _fetchAppointments();
    // COMPLETENESS FIX (mobile parity audit): needed to compute the real Paid/Due split per
    // appointment (see _computeMoney) — matches every payment row back to its appointment, same
    // as web's `data.payments` join.
    final payments = <PaymentItem>[];
    try {
      // BUG FIX (same root cause as the receptionist Reports/Patients directory bug — see
      // receptionist_reports_screen.dart's comment): pageSize over 100 gets rejected outright by
      // the backend's list-query validator (422 "Validation failed"), not clamped.
      final res = await ApiClient.instance.get('/payments', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: []));
      for (final item in res.list) {
        try {
          payments.add(PaymentItem.fromJson(item));
        } catch (_) {}
      }
    } catch (_) {}
    return _PatientAppointmentsData(appointments: appointments, payments: payments);
  }

  Future<List<Appointment>> _fetchAppointments() async {
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

  // COMPLETENESS FIX (mobile parity audit, patient panel): web's exact Export CSV header/row
  // shape for PatientAppointments (PatientPages.jsx's exportCsv call, ~line 553) — Booking ID via
  // _shortId(), Patient column falls back to the logged-in patient's own name when the booking is
  // for the patient themself (no familyMember set).
  Future<void> _exportCsv(List<Appointment> appointments, List<PaymentItem> payments) async {
    final me = context.read<AuthProvider>().user;
    await shareCsv(
      filename: widget.isHistory ? 'booking-history.csv' : 'appointments.csv',
      headers: const [
        'ID', 'Booking ID', 'Token', 'Date', 'Time', 'Doctor', 'Patient', 'Clinic', 'Status',
        'Payment', 'Payment method', 'Transaction', 'Fee', 'Paid', 'Due', 'Notes',
      ],
      rows: [
        for (var i = 0; i < appointments.length; i++)
          () {
            final appt = appointments[i];
            final money = _computeMoney(appt, payments);
            return [
              'DC${(i + 1).toString().padLeft(2, '0')}',
              _shortId(appt.id),
              appt.tokenNumber ?? '',
              appt.appointmentDate,
              appt.appointmentTime,
              appt.doctor?.name ?? '',
              appt.familyMember?.name ?? appt.patient?.name ?? me?.name ?? '',
              appt.clinic?.name ?? '',
              appt.status,
              money.status,
              money.mode,
              money.transactionRef ?? '',
              money.displayFee.toStringAsFixed(0),
              money.paid.toStringAsFixed(0),
              money.due.toStringAsFixed(0),
              appt.notes ?? appt.reason ?? '',
            ];
          }(),
      ],
    );
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
        'text': result['text'],
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
            // COMPLETENESS FIX (mobile parity audit): web's "Export CSV" action — see _exportCsv.
            action: FutureBuilder<_PatientAppointmentsData>(
              future: _future,
              builder: (context, snapshot) {
                final appointments = snapshot.data?.appointments ?? const <Appointment>[];
                final payments = snapshot.data?.payments ?? const <PaymentItem>[];
                return TextButton.icon(
                  onPressed: appointments.isEmpty ? null : () => _exportCsv(appointments, payments),
                  icon: const Icon(Icons.file_download_outlined, size: 16),
                  label: const Text('Export CSV'),
                );
              },
            ),
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
                _StatusChip(label: 'Upcoming / Active', selected: _statusFilter == 'upcoming', onTap: () => setState(() { _statusFilter = 'upcoming'; _load(); })),
                _StatusChip(label: 'Completed (History)', selected: _statusFilter == 'completed', onTap: () => setState(() { _statusFilter = 'completed'; _load(); })),
                _StatusChip(label: 'Cancelled', selected: _statusFilter == 'cancelled', onTap: () => setState(() { _statusFilter = 'cancelled'; _load(); })),
                _StatusChip(label: 'Pending payment', selected: _statusFilter == 'pending_payment', onTap: () => setState(() { _statusFilter = 'pending_payment'; _load(); })),
                _StatusChip(label: 'Confirmed', selected: _statusFilter == 'confirmed', onTap: () => setState(() { _statusFilter = 'confirmed'; _load(); })),
              ],
            ),
          ),
        ),
        Expanded(
          child: FutureBuilder<_PatientAppointmentsData>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
              if (snapshot.hasError) {
                return Padding(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  child: ErrorBanner(error: snapshot.error!, onRetry: _load),
                );
              }
              final appointments = snapshot.data?.appointments ?? const <Appointment>[];
              final payments = snapshot.data?.payments ?? const <PaymentItem>[];
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
                      money: _computeMoney(appt, payments),
                      onCancel: (appt.status == 'upcoming' || appt.status == 'confirmed' || appt.status == 'pending_payment')
                          ? () => _cancel(appt)
                          : null,
                      // PARITY FIX (mobile parity audit — Patient panel): web's review form is
                      // entirely absent from Booking History (`{!history && completed.length > 0
                      // && <form>...}`, PatientPages.jsx) — reviewing only ever happens from My
                      // Appointments. Mobile previously offered "Leave review" on both lists.
                      onReview: (!widget.isHistory && appt.status == 'completed') ? () => _leaveReview(appt) : null,
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
  final _AppointmentMoney money;
  final VoidCallback? onCancel;
  final VoidCallback? onReview;
  final VoidCallback? onTrackQueue;
  final VoidCallback? onPayNow;
  final VoidCallback onViewSlip;

  const _AppointmentCard({
    required this.appointment,
    required this.money,
    this.onCancel,
    this.onReview,
    this.onTrackQueue,
    this.onPayNow,
    required this.onViewSlip,
  });

  @override
  Widget build(BuildContext context) {
    final fee = money.displayFee;
    final paymentStatus = money.status;

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
                Expanded(
                  child: Text(
                    appointment.familyMember != null
                        ? 'For: ${appointment.familyMember!.name} (${appointment.familyMember!.relation})'
                        : 'For: Myself',
                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                  ),
                ),
                // COMPLETENESS FIX (mobile parity audit): booking ID a patient reads off the slip
                // or quotes at the clinic counter — ports web's shortId() (client/src/lib/format.js).
                Text(
                  'Booking ${_shortId(appointment.id)}',
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 4),
            // COMPLETENESS FIX (mobile parity audit): Paid/Due split replacing the old flat
            // "Fee: ₹X" line — see _computeMoney's doc comment for the partial-payment logic.
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Fee: ₹${fee.toStringAsFixed(0)}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                Text('Paid: ₹${money.paid.toStringAsFixed(0)}', style: const TextStyle(fontSize: 12, color: AppColors.success)),
                Text(
                  'Due: ₹${money.due.toStringAsFixed(0)}',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: money.due > 0 ? AppColors.danger : AppColors.textSecondary,
                  ),
                ),
              ],
            ),
            if (money.mode.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                money.transactionRef != null && money.transactionRef!.isNotEmpty
                    ? 'Payment: ${money.mode} · Txn ${money.transactionRef}'
                    : 'Payment: ${money.mode == 'pay_at_clinic' ? 'Pay at clinic' : money.mode}',
                style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
              ),
            ],
            if ((appointment.notes ?? appointment.reason) != null && (appointment.notes ?? appointment.reason)!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                'Note: ${appointment.notes ?? appointment.reason}',
                style: const TextStyle(fontSize: 11, color: AppColors.textSecondary, fontStyle: FontStyle.italic),
              ),
            ],
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

// PARITY FIX (mobile parity audit — Patient panel): web's review form
// (PatientPages.jsx, `!history && completed.length > 0` block) marks BOTH the rating select and
// the review textarea `required` — a patient must explicitly pick a rating and write something,
// there's no submitting with a default/blank rating or empty text. Mobile previously defaulted
// `_rating` to 5 (so a patient could submit a 5-star review without ever tapping a star) and made
// the text field explicitly "(optional)". Now the rating starts unset and Submit stays disabled
// until both a rating is chosen and the text is non-empty, with inline validation messages.
class _ReviewDialogState extends State<_ReviewDialog> {
  int? _rating;
  final _textController = TextEditingController();
  bool _touchedText = false;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  bool get _isValid => _rating != null && _textController.text.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Review ${widget.doctorName}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Rating', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(
              5,
              (i) => IconButton(
                icon: Icon(_rating != null && i < _rating! ? Icons.star : Icons.star_border, color: AppColors.warning),
                onPressed: () => setState(() => _rating = i + 1),
              ),
            ),
          ),
          if (_rating == null)
            const Padding(
              padding: EdgeInsets.only(bottom: 4),
              child: Text('Please select a rating', style: TextStyle(color: AppColors.danger, fontSize: 11)),
            ),
          TextField(
            controller: _textController,
            maxLines: 3,
            decoration: const InputDecoration(hintText: 'Share your experience'),
            onChanged: (_) => setState(() => _touchedText = true),
          ),
          if (_touchedText && _textController.text.trim().isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text('Please share a few words about your visit', style: TextStyle(color: AppColors.danger, fontSize: 11)),
            ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        TextButton(
          onPressed: _isValid
              ? () => Navigator.of(context).pop({'rating': _rating, 'text': _textController.text.trim()})
              : null,
          child: const Text('Submit'),
        ),
      ],
    );
  }
}
