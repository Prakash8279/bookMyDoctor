import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/api_client.dart';
import '../core/csv_export.dart';
import '../models/admin_models.dart';
import '../models/clinical_models.dart';
import '../state/auth_provider.dart';
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
class BookingSlipSheet extends StatefulWidget {
  final Appointment appointment;

  const BookingSlipSheet({super.key, required this.appointment});

  @override
  State<BookingSlipSheet> createState() => _BookingSlipSheetState();
}

class _BookingSlipSheetState extends State<BookingSlipSheet> {
  Appointment get appointment => widget.appointment;

  // COMPLETENESS FIX (mobile parity audit — Patient panel, user request: "patient detail me
  // bload group,age,gender add kar dena"): neither GET /appointments' embedded `familyMember`
  // (id/name/relation only — appointments.service.js's APPOINTMENT_SELECT) nor its own-booking
  // `patient` shape (identity only — shapePatientRef's "patient (own booking)" branch) ever
  // include clinical fields for a patient's OWN view of their booking, so this fetches them
  // separately: the family member's own record (GET /family-members — the patient's own
  // sub-resource, which DOES carry bloodGroup/gender/age, no masking involved) when the booking
  // is for a dependant, or the patient's own cached profile (AuthProvider, from GET /me) when the
  // booking is for themself.
  String? _patientGender;
  String? _patientBloodGroup;
  int? _patientAge;

  @override
  void initState() {
    super.initState();
    _loadPatientDetails();
  }

  Future<void> _loadPatientDetails() async {
    try {
      final familyMemberId = appointment.familyMember?.id;
      if (familyMemberId != null) {
        final res = await ApiClient.instance.get('/family-members', query: {'pageSize': 50});
        for (final item in res.list) {
          try {
            final fm = FamilyMember.fromJson(item);
            if (fm.id == familyMemberId) {
              if (!mounted) return;
              setState(() {
                _patientGender = fm.gender;
                _patientBloodGroup = fm.bloodGroup;
                _patientAge = fm.age;
              });
              return;
            }
          } catch (_) {}
        }
      } else {
        final profile = context.read<AuthProvider>().profile;
        int? age;
        final dob = profile?.dateOfBirth != null ? DateTime.tryParse(profile!.dateOfBirth!) : null;
        if (dob != null) {
          final now = DateTime.now();
          age = now.year - dob.year;
          if (now.month < dob.month || (now.month == dob.month && now.day < dob.day)) age--;
        }
        if (!mounted) return;
        setState(() {
          _patientGender = profile?.gender;
          _patientBloodGroup = profile?.bloodGroup;
          _patientAge = age;
        });
      }
    } catch (_) {
      // Non-fatal — the slip still renders everything else; these three rows are simply omitted.
    }
  }

  String get _shortId {
    final id = appointment.id;
    return id.length > 8 ? id.substring(0, 8) : id;
  }

  // PARITY FIX (mobile parity audit — Patient panel): these three getters used to read
  // `appointment.fees.due`, which appointments.service.js#shapeFees only ever sends to a
  // doctor/receptionist caller (mandatory rule 8 — see clinical_models.dart's Fees doc comment);
  // for the patient's own booking slip it's always absent, so `_dueAmount` fell through to
  // `(_displayFee - _paidAmount)`, the same flat re-derivation that was previously a bug on the
  // web app. Rewritten to use `minBookingAmount`/`minBookingRemainder` — the patient-safe fields
  // shapeFees actually sends for a partial online payment — matching
  // screens/patient/appointments_screen.dart's already-correct `_computeMoney`.
  double get _displayFee {
    final fee = appointment.fees.totalAmount ?? appointment.fees.consultationFee ?? 0;
    final minBookingAmount = appointment.fees.minBookingAmount;
    final minRemainder = appointment.fees.minBookingRemainder;
    if (appointment.paymentStatus == 'partial' && minBookingAmount != null && minRemainder != null) {
      return minBookingAmount + minRemainder;
    }
    return fee;
  }

  double get _paidAmount {
    if (appointment.paymentStatus == 'paid') return _displayFee;
    if (appointment.paymentStatus == 'partial') return appointment.fees.minBookingAmount ?? 0;
    return 0;
  }

  double get _dueAmount {
    if (appointment.paymentStatus == 'paid') return 0;
    if (appointment.paymentStatus == 'partial' && appointment.fees.minBookingRemainder != null) {
      return appointment.fees.minBookingRemainder!;
    }
    return (_displayFee - _paidAmount).clamp(0, _displayFee);
  }

  String _buildSlipText() {
    return '''
========================================
       BOOKMYDOCTORS - BOOKING SLIP
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
${appointment.familyMember?.relation != null ? "Relation: ${appointment.familyMember!.relation}\n" : ""}${_patientGender != null ? "Gender: $_patientGender\n" : ""}${_patientAge != null ? "Age: $_patientAge\n" : ""}${_patientBloodGroup != null ? "Blood Group: $_patientBloodGroup\n" : ""}${appointment.patient?.phone != null ? "Phone: ${appointment.patient!.phone}\n" : ""}${appointment.reason != null && appointment.reason!.isNotEmpty ? "Reason: ${appointment.reason}\n" : ""}
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
  }

  void _copySlip(BuildContext context) {
    Clipboard.setData(ClipboardData(text: _buildSlipText()));
    showSuccessSnack(context, 'Booking slip details copied to clipboard');
  }

  // COMPLETENESS FIX (mobile parity audit — Patient panel, user request: "slip view kr bad
  // download ka option website me hai app me nahi hai kahi v"): web's booking slip is a real
  // downloadable PDF (lib/receiptPdf.js#buildBookingSlipPdfBlob, opened via usePdfPreview's
  // view-then-download flow) — mobile had "Copy Slip" (clipboard only) and nothing that actually
  // leaves the device. Flutter has no browser-style "save to Downloads" primitive without adding
  // a new native plugin, so this reuses the same OS-share-sheet approach already established for
  // every other "web downloads a file" gap in this app (see core/csv_export.dart's own doc
  // comment) — the patient can save it to Files, print it, or send it via WhatsApp/email from
  // the share sheet, covering the same real-world need as a browser download.
  Future<void> _shareSlip(BuildContext context) async {
    await shareText(filename: 'booking-slip-$_shortId.txt', content: _buildSlipText());
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
                          'BookMyDoctors',
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
                // COMPLETENESS FIX (mobile parity audit — Patient panel, user request: "booking
                // slip pe booking id nahi aa raha hai"): the booking id only ever appeared as a
                // small caption in the header ("CLINIC BOOKING SLIP · #...") — web hit the exact
                // same complaint and added it as its own row too (receiptPdf.js's
                // "BOOKING-ID VISIBILITY FIX": "bookinh id ko slip pe dikhai").
                MapEntry('Booking ID', '#$_shortId'),
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
                // COMPLETENESS FIX (mobile parity audit — Patient panel, user request: "patient
                // detail me bload group,age,gender add kar dena") — see _loadPatientDetails'
                // doc comment for where these come from; simply omitted while still loading or
                // if genuinely unset, rather than showing a blank/placeholder row.
                if (_patientGender != null) MapEntry('Gender', _patientGender!),
                if (_patientAge != null) MapEntry('Age', '$_patientAge yrs'),
                if (_patientBloodGroup != null) MapEntry('Blood Group', _patientBloodGroup!),
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
                'This is a computer-generated booking slip from BookMyDoctors. Please present this slip at the reception counter upon arrival. Tokens are called in sequence.',
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
                    label: const Text('Copy'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                // COMPLETENESS FIX (mobile parity audit — Patient panel, user request: "slip
                // view kr bad download ka option website me hai app me nahi hai") — see
                // _shareSlip's doc comment for why this is a share sheet rather than a true
                // browser-style download.
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _shareSlip(context),
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

  String _buildReceiptText() {
    final amount = payment.fees.amount ?? payment.fees.consultationFee ?? 0;
    return '''
========================================
       BOOKMYDOCTORS - PAYMENT RECEIPT
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
  }

  void _copyReceipt(BuildContext context) {
    Clipboard.setData(ClipboardData(text: _buildReceiptText()));
    showSuccessSnack(context, 'Payment receipt details copied to clipboard');
  }

  // COMPLETENESS FIX (mobile parity audit — Patient panel, user request: "download ka option
  // ... kahi v" / nowhere at all) — same share-sheet approach as BookingSlipSheet._shareSlip,
  // extended here so the payment receipt sheet also has a "leave the device" option, not just
  // the booking slip.
  Future<void> _shareReceipt(BuildContext context) async {
    await shareText(filename: 'payment-receipt-$_shortId.txt', content: _buildReceiptText());
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
                        const Text('BookMyDoctors', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.primary)),
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
                    label: const Text('Copy'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _shareReceipt(context),
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
