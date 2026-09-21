import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../core/payment_visibility.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

// COMPLETENESS FIX (mobile parity audit — Patient panel): pairs each payment with the full
// Appointment it belongs to. GET /payments only ever returns `appointment: {id}` (see
// payments.service.js#shapePayment — PAYMENT_SELECT's appointment sub-select is id-only), so web's
// Payments page (PatientPages.jsx) separately fetches the patient's own appointments and joins by
// id client-side (`data.appointments.find(item => item.id === payment.appointment?.id)`) to get
// token number, time, emergency flag, and — for the receipt's exact fee breakdown — the
// appointment's own minBookingAmount/minBookingRemainder. Mobile previously never did this join at
// all, so none of that context (or the fee breakdown) was ever shown.
class _PatientPaymentsData {
  final List<PaymentItem> payments;
  final Map<String, Appointment> appointmentsById;
  _PatientPaymentsData({required this.payments, required this.appointmentsById});
}

class PatientPaymentsScreen extends StatelessWidget {
  const PatientPaymentsScreen({super.key});

  Future<_PatientPaymentsData> _load() async {
    final paymentsRes = await ApiClient.instance
        .get('/payments', query: {'pageSize': 50})
        .catchError((_) => ApiResponse(data: []));
    final payments = <PaymentItem>[];
    for (final item in paymentsRes.list) {
      try {
        payments.add(PaymentItem.fromJson(item));
      } catch (_) {}
    }
    final appointmentsById = <String, Appointment>{};
    try {
      // BUG FIX (same root cause as the receptionist Reports/Patients directory bug — see
      // receptionist_reports_screen.dart's comment): pageSize over 100 gets rejected outright by
      // the backend's list-query validator (422 "Validation failed"), not clamped.
      final apptRes = await ApiClient.instance.get('/appointments', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: []));
      for (final item in apptRes.list) {
        try {
          final appt = Appointment.fromJson(item);
          appointmentsById[appt.id] = appt;
        } catch (_) {}
      }
    } catch (_) {}
    return _PatientPaymentsData(payments: payments, appointmentsById: appointmentsById);
  }

  void _showReceipt(BuildContext context, PaymentItem item, Appointment? appointment) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _PaymentReceiptSheet(payment: item, appointment: appointment),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(
            title: 'Payment history',
            subtitle: 'Review clinic receipts and payment status.',
          ),
        ),
        Expanded(
          child: AsyncScreen<_PatientPaymentsData>(
            load: _load,
            isEmpty: (data) => data.payments.isEmpty,
            emptyIcon: Icons.receipt_long_outlined,
            emptyTitle: 'No payments yet',
            emptySubtitle: 'Payments are recorded by the clinic reception after your visit',
            builder: (context, data) {
              final payments = data.payments;
              final pendingCount = payments.where((p) => p.status == 'pending').length;

              return ListView(
                padding: const EdgeInsets.all(AppSpacing.md),
                children: [
                  // Payment status overview card (matching web's section)
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.border),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.03),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Payment status',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.primaryDark),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Pending clinic payments',
                          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          pendingCount > 0
                              ? '$pendingCount visit${pendingCount == 1 ? "" : "s"} awaiting payment'
                              : 'No pending payments',
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textSecondary),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Payments are collected and recorded by clinic staff at your visit — online self-payment is only for advance booking. This list updates once staff record a payment for a booking.',
                          style: TextStyle(fontSize: 12, color: AppColors.textSecondary, height: 1.4),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Live records',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
                      ),
                      Text(
                        '${payments.length} record(s)',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textSecondary),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  for (final p in payments) ...[
                    _buildPaymentCard(context, p, p.appointment?.id != null ? data.appointmentsById[p.appointment!.id] : null),
                    const SizedBox(height: AppSpacing.sm),
                  ],
                ],
              );
            },
          ),
        ),
      ],
    );
  }

  // COMPLETENESS FIX (mobile parity audit — Patient panel): now takes the cross-referenced
  // Appointment (see _load()/_PatientPaymentsData above) so the card can show Token/Time/Purpose/
  // Appointment status alongside the payment fields — mirrors web's Payments table/list rows
  // (PatientPages.jsx's `rows`), which previously had no mobile equivalent at all.
  Widget _buildPaymentCard(BuildContext context, PaymentItem p, Appointment? appt) {
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
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        p.doctor?.name ?? p.clinic?.name ?? 'Consultation Payment',
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                      ),
                      if (p.clinic?.name != null && p.doctor?.name != null)
                        Text(
                          p.clinic!.name!,
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                        ),
                    ],
                  ),
                ),
                StatusBadge(status: p.status),
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
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Receipt #${p.receiptNumber ?? (p.id.length > 8 ? p.id.substring(0, 8) : p.id)}',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Mode: ${p.mode.toUpperCase()}${p.createdAt != null ? " · ${p.createdAt!.split("T").first}" : ""}',
                            style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
                          ),
                          // COMPLETENESS FIX (mobile parity audit): web's
                          // PaymentSourceBadge — see payment_visibility.dart.
                          const SizedBox(width: 6),
                          PaymentSourceBadge(payment: p),
                        ],
                      ),
                    ],
                  ),
                  Text(
                    '₹${(p.fees.amount ?? 0).toStringAsFixed(0)}',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                  ),
                ],
              ),
            ),
            // PARITY FIX (mobile parity audit — Patient panel): web's Payments rows show Booking
            // ID/Token/Time/Purpose/Appointment status alongside the payment itself (PatientPages.jsx's
            // `rows`) — omitted here entirely when the cross-referenced appointment isn't available.
            if (appt != null) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 4,
                children: [
                  if (appt.tokenNumber != null)
                    _MiniFact(label: 'Token', value: '#${appt.tokenNumber}'),
                  _MiniFact(label: 'Visit', value: '${appt.appointmentDate} · ${appt.appointmentTime}'),
                  _MiniFact(label: 'Purpose', value: appt.isEmergency ? 'Emergency consultation' : 'Consultation'),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  const Text('Appointment status: ', style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                  StatusBadge(status: appt.status),
                ],
              ),
            ],
            const Divider(height: 18),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                if (p.transactionRef != null && p.transactionRef!.isNotEmpty)
                  Expanded(
                    child: Text(
                      'Ref: ${p.transactionRef}',
                      style: const TextStyle(fontSize: 11, fontFamily: 'monospace', color: AppColors.textSecondary),
                      overflow: TextOverflow.ellipsis,
                    ),
                  )
                else
                  const Text('Paid at clinic', style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                OutlinedButton.icon(
                  onPressed: () => _showReceipt(context, p, appt),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  icon: const Icon(Icons.remove_red_eye_outlined, size: 14),
                  label: const Text('View receipt'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniFact extends StatelessWidget {
  final String label;
  final String value;
  const _MiniFact({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return RichText(
      text: TextSpan(
        style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
        children: [
          TextSpan(text: '$label: '),
          TextSpan(text: value, style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}

// PARITY FIX (mobile parity audit — Patient panel): ports the EXACT-BREAKDOWN business rule from
// client/src/lib/receiptPdf.js#buildPatientReceiptSections (see that file's own long comment for
// the worked example/rationale) — a payment's `fees.amount` alone doesn't say whether this was the
// doctor's online minimum-booking advance, the remaining balance collected later at the clinic, or
// a single full payment, and naively showing the appointment's full fee breakdown on every payment
// row would misstate partial payments. Matches against the cross-referenced appointment's
// minBookingAmount/minBookingRemainder (patient-safe fields from appointments.service.js#shapeFees)
// to pick the correct case; falls back to ratio-based scaling exactly as the web version does for a
// full payment or an unrecognized shape.
class _ReceiptBreakdown {
  final List<MapEntry<String, String>> rows;
  final double amountPaid;
  _ReceiptBreakdown(this.rows, this.amountPaid);
}

_ReceiptBreakdown _computeReceiptBreakdown(PaymentItem payment, Appointment? appointment) {
  final fees = payment.fees;
  final paidAmount = fees.amount ?? 0;
  final consultationFeeFull = fees.consultationFee ?? 0;
  final convenienceFeeFull = fees.convenienceFee ?? 0;
  final emergencyFeeFull = fees.emergencyFee ?? 0;
  final gstAmountFull = fees.gstAmount ?? 0;
  final impliedTotal = consultationFeeFull + convenienceFeeFull + emergencyFeeFull + gstAmountFull;
  bool closeTo(double a, double b) => (a - b).abs() < 0.01;

  final apptFees = appointment?.fees;
  final minBookingAmount = apptFees?.minBookingAmount;
  final minBookingRemainder = apptFees?.minBookingRemainder;
  final apptConsultationFee = apptFees?.consultationFee;

  final rows = <MapEntry<String, String>>[];
  if (minBookingAmount != null && closeTo(paidAmount, minBookingAmount)) {
    final platformCharge = convenienceFeeFull + emergencyFeeFull;
    final minAdvance = apptConsultationFee != null && minBookingRemainder != null
        ? apptConsultationFee - minBookingRemainder
        : (paidAmount - platformCharge).clamp(0, double.infinity);
    final transactionCharge = (paidAmount - minAdvance - platformCharge).clamp(0, double.infinity);
    rows.add(MapEntry('Consultation fee (minimum booking amount)', '₹${minAdvance.toStringAsFixed(0)}'));
    if (platformCharge > 0) rows.add(MapEntry('Platform charge', '₹${platformCharge.toStringAsFixed(0)}'));
    if (transactionCharge > 0) rows.add(MapEntry('Transaction charge', '₹${transactionCharge.toStringAsFixed(0)}'));
  } else if (minBookingRemainder != null && closeTo(paidAmount, minBookingRemainder)) {
    rows.add(MapEntry('Consultation fee (remaining balance)', '₹${paidAmount.toStringAsFixed(0)}'));
  } else {
    final shareRatio = impliedTotal > 0 ? paidAmount / impliedTotal : 1.0;
    rows.add(MapEntry('Consultation fee', '₹${(consultationFeeFull * shareRatio).toStringAsFixed(0)}'));
    if (convenienceFeeFull > 0) rows.add(MapEntry('Platform charge', '₹${(convenienceFeeFull * shareRatio).toStringAsFixed(0)}'));
    if (emergencyFeeFull > 0) rows.add(MapEntry('Emergency fee', '₹${(emergencyFeeFull * shareRatio).toStringAsFixed(0)}'));
    if (gstAmountFull > 0) rows.add(MapEntry('Transaction charge', '₹${(gstAmountFull * shareRatio).toStringAsFixed(0)}'));
  }
  return _ReceiptBreakdown(rows, paidAmount);
}

class _PaymentReceiptSheet extends StatelessWidget {
  final PaymentItem payment;
  final Appointment? appointment;
  const _PaymentReceiptSheet({required this.payment, this.appointment});

  String get _shortId => payment.id.length > 8 ? payment.id.substring(0, 8) : payment.id;

  // COMPLETENESS FIX (mobile parity audit — Patient panel, user request: "download ka option
  // ... kahi v" / nowhere at all) — same share-sheet approach as BookingSlipSheet._shareSlip;
  // this sheet previously had no export action of any kind (not even a copy button).
  String _buildReceiptText(_ReceiptBreakdown breakdown) {
    final isPaid = payment.status == 'paid';
    return '''
========================================
       BOOKMYDOCTOR24 - PAYMENT RECEIPT
========================================
Receipt No: #${payment.receiptNumber ?? _shortId}
Status: ${isPaid ? "Settled" : "Pending"}
Amount Paid: ₹${breakdown.amountPaid.toStringAsFixed(0)}
Payment Mode: ${payment.mode.toUpperCase()} (${isOnlineBookingPayment(payment) ? "At booking" : "At clinic"})
${payment.transactionRef != null && payment.transactionRef!.isNotEmpty ? "Reference ID: ${payment.transactionRef}\n" : ""}${payment.createdAt != null ? "Date: ${payment.createdAt!.split("T").first}\n" : ""}
FEE BREAKDOWN:
${breakdown.rows.map((r) => "${r.key}: ${r.value}").join("\n")}
${appointment != null ? "\nAPPOINTMENT:\nDate: ${appointment!.appointmentDate}\nTime: ${appointment!.appointmentTime}\n${appointment!.tokenNumber != null ? "Token Number: #${appointment!.tokenNumber}\n" : ""}" : ""}
PARTIES:
Doctor: Dr. ${payment.doctor?.name ?? "—"}
Clinic: ${payment.clinic?.name ?? "—"}
${payment.patient?.name != null ? "Patient: ${payment.patient!.name}\n" : ""}----------------------------------------
This is a digitally generated clinic payment receipt.
========================================
''';
  }

  Future<void> _shareReceipt(BuildContext context, _ReceiptBreakdown breakdown) async {
    await shareText(filename: 'payment-receipt-$_shortId.txt', content: _buildReceiptText(breakdown));
  }

  @override
  Widget build(BuildContext context) {
    final amount = payment.fees.amount ?? 0;
    final isPaid = payment.status == 'paid';
    final breakdown = _computeReceiptBreakdown(payment, appointment);

    return DraggableScrollableSheet(
      initialChildSize: 0.8,
      maxChildSize: 0.92,
      minChildSize: 0.5,
      builder: (_, scrollController) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: ListView(
          controller: scrollController,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(color: Colors.grey.shade300, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('BookMyDoctor24', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.primary)),
                    Text('OFFICIAL PAYMENT RECEIPT', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 0.5, color: AppColors.textSecondary)),
                  ],
                ),
                StatusBadge(status: payment.status),
              ],
            ),
            const Divider(height: 24),
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('AMOUNT RECEIVED', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.primaryDark)),
                      Text(
                        '₹${amount.toStringAsFixed(0)}',
                        style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.primaryDark),
                      ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        payment.mode.toUpperCase(),
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                      ),
                      Text(
                        isPaid ? 'Settled' : 'Pending',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: isPaid ? AppColors.success : AppColors.warning,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            // PARITY FIX (mobile parity audit — Patient panel): web's patient receipt itemizes the
            // fee breakdown (consultation/platform/transaction charge) rather than a lump total —
            // see _computeReceiptBreakdown's doc comment for the exact-vs-scaled business rule.
            _buildSection(
              title: 'Fee Breakdown',
              rows: [
                ...breakdown.rows,
                MapEntry('Amount paid', '₹${breakdown.amountPaid.toStringAsFixed(0)}'),
              ],
              boldLastRow: true,
            ),
            const SizedBox(height: AppSpacing.md),
            if (appointment != null) ...[
              _buildSection(
                title: 'Appointment',
                rows: [
                  MapEntry('Date', appointment!.appointmentDate),
                  MapEntry('Time', appointment!.appointmentTime),
                  if (appointment!.tokenNumber != null) MapEntry('Token number', '#${appointment!.tokenNumber}'),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
            ],
            _buildSection(
              title: 'Transaction Details',
              rows: [
                MapEntry('Receipt No', payment.receiptNumber ?? (payment.id.length > 8 ? payment.id.substring(0, 8) : payment.id)),
                if (payment.transactionRef != null && payment.transactionRef!.isNotEmpty)
                  MapEntry('Reference ID', payment.transactionRef!),
                if (payment.createdAt != null)
                  MapEntry('Date', payment.createdAt!.split('T').first),
                // COMPLETENESS FIX (mobile parity audit): web's receipt PDF writes this same
                // "at booking"/"at clinic" wording as plain text (lib/receiptPdf.js) next to the
                // payment mode — mirrored here rather than a colored badge since this is a
                // text-only receipt section.
                MapEntry(
                  'Payment Mode',
                  '${payment.mode.toUpperCase()} (${isOnlineBookingPayment(payment) ? "At booking" : "At clinic"})',
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            _buildSection(
              title: 'Practitioner & Clinic',
              rows: [
                MapEntry('Doctor', payment.doctor?.name ?? '—'),
                MapEntry('Clinic', payment.clinic?.name ?? '—'),
                if (payment.patient?.name != null)
                  MapEntry('Patient', payment.patient!.name!),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            const Text(
              'This is a digitally generated clinic payment receipt.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _shareReceipt(context, breakdown),
                    icon: const Icon(Icons.download_outlined, size: 18),
                    label: const Text('Download'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: PrimaryButton(
                    label: 'Done',
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection({required String title, required List<MapEntry<String, String>> rows, bool boldLastRow = false}) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
          const SizedBox(height: 8),
          for (var i = 0; i < rows.length; i++) ...[
            if (boldLastRow && i == rows.length - 1) const Divider(height: 14),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    rows[i].key,
                    style: TextStyle(
                      fontSize: boldLastRow && i == rows.length - 1 ? 13 : 12,
                      fontWeight: boldLastRow && i == rows.length - 1 ? FontWeight.w800 : FontWeight.normal,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  Flexible(
                    child: Text(
                      rows[i].value,
                      style: TextStyle(
                        fontSize: boldLastRow && i == rows.length - 1 ? 15 : 12,
                        fontWeight: FontWeight.w700,
                        color: boldLastRow && i == rows.length - 1 ? AppColors.primaryDark : AppColors.textPrimary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

