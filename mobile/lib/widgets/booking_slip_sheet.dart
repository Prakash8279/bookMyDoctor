import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/clinical_models.dart';
import '../theme/app_theme.dart';
import 'common_widgets.dart';

/// Opens the booking slip modal sheet for an appointment.
void showBookingSlipSheet(BuildContext context, Appointment appointment) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => BookingSlipSheet(appointment: appointment),
  );
}

/// Opens the payment receipt modal sheet for a payment.
void showPaymentReceiptSheet(BuildContext context, PaymentItem payment) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => PaymentReceiptSheet(payment: payment),
  );
}

/// Full parity Booking Slip matching the website's booking-slip PDF format
/// (lib/receiptPdf.js#buildBookingSlipSections) and in-page preview.
class BookingSlipSheet extends StatelessWidget {
  final Appointment appointment;

  const BookingSlipSheet({super.key, required this.appointment});

  String get _shortId {
    final id = appointment.id;
    return id.length > 8 ? id.substring(0, 8) : id;
  }

  double get _displayFee {
    return appointment.fees.totalAmount ?? appointment.fees.consultationFee ?? 0;
  }

  double get _paidAmount {
    if (appointment.paymentStatus == 'paid') {
      return _displayFee;
    } else if (appointment.paymentStatus == 'partial') {
      final minAmt = appointment.fees.minBookingAmount;
      if (minAmt != null) return minAmt;
      final due = appointment.fees.due ?? 0;
      return (_displayFee - due).clamp(0, _displayFee);
    }
    return 0;
  }

  double get _dueAmount {
    if (appointment.paymentStatus == 'paid') return 0;
    if (appointment.fees.due != null) return appointment.fees.due!;
    return (_displayFee - _paidAmount).clamp(0, _displayFee);
  }

  void _copySlip(BuildContext context) {
    final text = '''
========================================
       BOOKMYDOCTOR24 - BOOKING SLIP
========================================
Booking ID: #$_shortId
Token Number: #${appointment.tokenNumber ?? "Not yet assigned"}
Status: ${appointment.status.toUpperCase()}
Date & Time: ${appointment.appointmentDate} at ${appointment.appointmentTime}

DOCTOR & CLINIC:
Doctor: Dr. ${appointment.doctor?.name ?? "—"}
Specialization: ${appointment.doctor?.specialization?.name ?? "General Practice"}
Clinic: ${appointment.clinic?.name ?? "—"}
${appointment.clinic?.address != null && appointment.clinic!.address!.isNotEmpty ? "Address: ${appointment.clinic!.address}\n" : ""}${appointment.clinic?.phone != null && appointment.clinic!.phone!.isNotEmpty ? "Phone: ${appointment.clinic!.phone}\n" : ""}
PATIENT:
Name: ${appointment.familyMember?.name ?? appointment.patient?.name ?? "Self"}
${appointment.familyMember?.relation != null ? "Relation: ${appointment.familyMember!.relation}\n" : ""}${appointment.patient?.phone != null ? "Phone: ${appointment.patient!.phone}\n" : ""}${appointment.reason != null && appointment.reason!.isNotEmpty ? "Reason: ${appointment.reason}\n" : ""}
FINANCIAL SUMMARY:
Total Amount: ₹${_displayFee.toStringAsFixed(0)}
Paid: ₹${_paidAmount.toStringAsFixed(0)}
Due at Clinic: ₹${_dueAmount.toStringAsFixed(0)}
Payment Status: ${appointment.paymentStatus ?? "Pending"}
${appointment.paymentMethod != null ? "Mode: ${appointment.paymentMethod!.toUpperCase()}\n" : ""}
----------------------------------------
This is a computer-generated booking slip.
Please present this slip at the clinic reception upon arrival.
========================================
''';
    Clipboard.setData(ClipboardData(text: text));
    showSuccessSnack(context, 'Booking slip details copied to clipboard');
  }

  @override
  Widget build(BuildContext context) {
    final isPaid = appointment.paymentStatus == 'paid';
    final isPartial = appointment.paymentStatus == 'partial';

    return DraggableScrollableSheet(
      initialChildSize: 0.88,
      maxChildSize: 0.96,
      minChildSize: 0.5,
      builder: (_, scrollController) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: ListView(
          controller: scrollController,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            // Header Row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.receipt_long, color: AppColors.primaryDark, size: 24),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'BookMyDoctor24',
                          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.primary),
                        ),
                        Text(
                          'CLINIC BOOKING SLIP · #$_shortId',
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.5,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                StatusBadge(status: appointment.status),
              ],
            ),
            const Divider(height: 24),

            // Token Highlight Box
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'APPOINTMENT TOKEN',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.8,
                          color: AppColors.primaryDark,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        appointment.tokenNumber != null ? '#${appointment.tokenNumber}' : 'Not assigned',
                        style: const TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          color: AppColors.primaryDark,
                        ),
                      ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        appointment.appointmentDate,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        appointment.appointmentTime,
                        style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),

            // Doctor & Clinic
            _buildSection(
              title: 'Practitioner & Clinic',
              icon: Icons.local_hospital_outlined,
              rows: [
                MapEntry('Doctor', appointment.doctor?.name != null ? 'Dr. ${appointment.doctor!.name}' : '—'),
                if (appointment.doctor?.specialization != null)
                  MapEntry('Specialization', appointment.doctor!.specialization!.name),
                MapEntry('Clinic', appointment.clinic?.name ?? '—'),
                if (appointment.clinic?.address != null && appointment.clinic!.address!.isNotEmpty)
                  MapEntry('Address', appointment.clinic!.address!),
                if (appointment.clinic?.phone != null && appointment.clinic!.phone!.isNotEmpty)
                  MapEntry('Phone', appointment.clinic!.phone!),
              ],
            ),
            const SizedBox(height: AppSpacing.md),

            // Patient details
            _buildSection(
              title: 'Patient Details',
              icon: Icons.person_outline,
              rows: [
                MapEntry(
                  'Patient Name',
                  appointment.familyMember?.name ?? appointment.patient?.name ?? 'Self',
                ),
                if (appointment.familyMember?.relation != null)
                  MapEntry('Relation', appointment.familyMember!.relation!),
                if (appointment.patient?.phone != null)
                  MapEntry('Contact Phone', appointment.patient!.phone!),
                if (appointment.reason != null && appointment.reason!.isNotEmpty)
                  MapEntry('Reason for Visit', appointment.reason!),
              ],
            ),
            const SizedBox(height: AppSpacing.md),

            // Financial Summary
            _buildSection(
              title: 'Financial Summary',
              icon: Icons.payments_outlined,
              rows: [
                MapEntry('Total Amount', '₹${_displayFee.toStringAsFixed(0)}'),
                MapEntry('Paid Amount', '₹${_paidAmount.toStringAsFixed(0)}'),
                MapEntry('Due at Clinic', '₹${_dueAmount.toStringAsFixed(0)}'),
                MapEntry(
                  'Payment Status',
                  isPaid ? 'Paid in Full' : isPartial ? 'Advance Paid (Balance Due)' : 'Pending / Due at Clinic',
                ),
                if (appointment.paymentMethod != null)
                  MapEntry('Payment Mode', appointment.paymentMethod!.toUpperCase()),
              ],
            ),
            const SizedBox(height: AppSpacing.md),

            // Notice
            Container(
              padding: const EdgeInsets.all(AppSpacing.sm),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text(
                'This is a computer-generated booking slip from BookMyDoctor24. Please present this slip at the reception counter upon arrival. Tokens are called in sequence.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 11, color: AppColors.textSecondary, height: 1.4),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),

            // Actions
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _copySlip(context),
                    icon: const Icon(Icons.copy_outlined, size: 18),
                    label: const Text('Copy Slip'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primaryDark,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Done', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection({
    required String title,
    required IconData icon,
    required List<MapEntry<String, String>> rows,
  }) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: AppColors.primary),
              const SizedBox(width: 8),
              Text(
                title,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
              ),
            ],
          ),
          const SizedBox(height: 10),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(row.key, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                  const SizedBox(width: 12),
                  Flexible(
                    child: Text(
                      row.value,
                      textAlign: TextAlign.end,
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Payment Receipt sheet matching website's staff/patient payment receipt
/// (lib/receiptPdf.js#buildStaffReceiptPdfBlob).
class PaymentReceiptSheet extends StatelessWidget {
  final PaymentItem payment;

  const PaymentReceiptSheet({super.key, required this.payment});

  String get _shortId {
    final id = payment.id;
    return id.length > 8 ? id.substring(0, 8) : id;
  }

  void _copyReceipt(BuildContext context) {
    final amount = payment.fees.amount ?? payment.fees.consultationFee ?? 0;
    final text = '''
========================================
       BOOKMYDOCTOR24 - PAYMENT RECEIPT
========================================
Receipt No: #${payment.receiptNumber ?? _shortId}
Status: ${payment.status.toUpperCase()}
Amount: ₹${amount.toStringAsFixed(0)}
Payment Method: ${payment.mode.toUpperCase()}
${payment.transactionRef != null && payment.transactionRef!.isNotEmpty ? "Transaction Ref: ${payment.transactionRef}\n" : ""}Date: ${payment.createdAt ?? "—"}

PARTIES:
Patient: ${payment.patient?.name ?? "—"}
Doctor: Dr. ${payment.doctor?.name ?? "—"}
Clinic: ${payment.clinic?.name ?? "—"}
${payment.appointment?.id != null ? "Booking ID: #${payment.appointment!.id.length > 8 ? payment.appointment!.id.substring(0, 8) : payment.appointment!.id}\n" : ""}----------------------------------------
Official computer-generated receipt.
========================================
''';
    Clipboard.setData(ClipboardData(text: text));
    showSuccessSnack(context, 'Payment receipt details copied to clipboard');
  }

  @override
  Widget build(BuildContext context) {
    final amount = payment.fees.amount ?? payment.fees.consultationFee ?? 0;

    return DraggableScrollableSheet(
      initialChildSize: 0.8,
      maxChildSize: 0.95,
      minChildSize: 0.45,
      builder: (_, scrollController) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: ListView(
          controller: scrollController,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.paid_outlined, color: AppColors.primaryDark, size: 24),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('BookMyDoctor24', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.primary)),
                        Text('RECEIPT #${payment.receiptNumber ?? _shortId}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textSecondary)),
                      ],
                    ),
                  ],
                ),
                StatusBadge(status: payment.status),
              ],
            ),
            const Divider(height: 24),

            // Amount Box
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('AMOUNT RECEIVED', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.primaryDark)),
                      const SizedBox(height: 2),
                      Text('₹${amount.toStringAsFixed(0)}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.primaryDark)),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(payment.mode.toUpperCase(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
                      if (payment.transactionRef != null && payment.transactionRef!.isNotEmpty)
                        Text(payment.transactionRef!, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),

            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                children: [
                  _row('Receipt Number', payment.receiptNumber ?? '#$_shortId'),
                  if (payment.appointment?.id != null)
                    _row('Booking ID', '#${payment.appointment!.id.length > 8 ? payment.appointment!.id.substring(0, 8) : payment.appointment!.id}'),
                  _row('Patient Name', payment.patient?.name ?? '—'),
                  _row('Doctor', payment.doctor?.name != null ? 'Dr. ${payment.doctor!.name}' : '—'),
                  _row('Clinic', payment.clinic?.name ?? '—'),
                  _row('Payment Mode', payment.mode.toUpperCase()),
                  if (payment.transactionRef != null && payment.transactionRef!.isNotEmpty)
                    _row('UTR / Reference', payment.transactionRef!),
                  if (payment.createdAt != null)
                    _row('Date Recorded', payment.createdAt!.split('T').first),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),

            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _copyReceipt(context),
                    icon: const Icon(Icons.copy_outlined, size: 18),
                    label: const Text('Copy Receipt'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primaryDark,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Done', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
            ),
          ),
        ],
      ),
    );
  }
}
