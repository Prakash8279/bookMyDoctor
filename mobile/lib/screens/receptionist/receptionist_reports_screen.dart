import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/payment_visibility.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// lib/paymentVisibility.js#doctorCharge, ported field-for-field: the fee actually charged for
/// the visit, preferring the payment record's own figures and falling back to the linked
/// appointment's, then finally the raw payment amount.
double _doctorCharge(Fees payment, Fees? appointment) {
  return payment.consultationFee ??
      appointment?.consultationFee ??
      appointment?.totalAmount ??
      payment.amount ??
      0;
}

class _ReportPaymentRow {
  final PaymentItem payment;
  final double doctorCharge;
  _ReportPaymentRow({required this.payment, required this.doctorCharge});
}

class _ReportData {
  final int walkIns;
  final int checkedInCount;
  final double bookingCollected;
  final double cashCollected;
  final double onlineCollected;
  final List<_ReportPaymentRow> payments;
  _ReportData({
    required this.walkIns,
    required this.checkedInCount,
    required this.bookingCollected,
    required this.cashCollected,
    required this.onlineCollected,
    required this.payments,
  });
}

/// Mirrors client/src/pages/FeaturePages.jsx#ReceptionReports. `payments`/`appointments`/`queue`
/// are already clinic-scoped server-side to this receptionist's own clinicId — same
/// GET /appointments and GET /payments calls as receptionist_dashboard_screen.dart and
/// receptionist_payments_screen.dart. "Walk-ins" has no dedicated endpoint (plan §5) and, same
/// as the web page's `data.queueTokens`, is derived from today's queue token count (GET /queue
/// defaults to today server-side when no `date` is passed — queue.service.js#listQueue);
/// "Check-ins" is derived from `appointment.checkedInAt` being set.
class ReceptionistReportsScreen extends StatefulWidget {
  const ReceptionistReportsScreen({super.key});

  @override
  State<ReceptionistReportsScreen> createState() => _ReceptionistReportsScreenState();
}

class _ReceptionistReportsScreenState extends State<ReceptionistReportsScreen> {
  Future<_ReportData>? _future;

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

  Future<_ReportData> _fetch() async {
    final results = await Future.wait([
      ApiClient.instance.get('/appointments', query: {'pageSize': 200}).catchError((_) => ApiResponse(data: [])),
      ApiClient.instance.get('/payments', query: {'pageSize': 200}).catchError((_) => ApiResponse(data: [])),
      ApiClient.instance.get('/queue', query: {'pageSize': 200}).catchError((_) => ApiResponse(data: [])),
    ]);
    final appointments = <Appointment>[];
    for (final item in results[0].list) {
      try {
        appointments.add(Appointment.fromJson(item));
      } catch (_) {}
    }
    final payments = <PaymentItem>[];
    for (final item in results[1].list) {
      try {
        payments.add(PaymentItem.fromJson(item));
      } catch (_) {}
    }
    final queue = results[2].list;

    final appointmentsById = {for (final a in appointments) a.id: a};
    final rows = payments.map((payment) {
      final appointment = appointmentsById[payment.appointment?.id];
      return _ReportPaymentRow(payment: payment, doctorCharge: _doctorCharge(payment.fees, appointment?.fees));
    }).toList();

    // BUG FIX (mobile parity audit): web's ReceptionReports (FeaturePages.jsx) shows 5 metrics —
    // mobile only ever computed "Cash collected", dropping "Paid online at booking" and "Online
    // collected at clinic" entirely. isOnlineBookingPayment distinguishes a patient's own Razorpay
    // payment (mode 'online', transactionRef starting 'pay_') from one a receptionist typed in by
    // hand at the clinic — see core/payment_visibility.dart.
    final bookingCollected = rows
        .where((row) => isOnlineBookingPayment(row.payment))
        .fold<double>(0, (sum, row) => sum + row.doctorCharge);
    final cashCollected = rows
        .where((row) => !isOnlineBookingPayment(row.payment) && row.payment.mode.toLowerCase() == 'cash')
        .fold<double>(0, (sum, row) => sum + row.doctorCharge);
    final onlineCollected = rows
        .where((row) => !isOnlineBookingPayment(row.payment) && row.payment.mode.toLowerCase() != 'cash')
        .fold<double>(0, (sum, row) => sum + row.doctorCharge);
    final checkedInCount = appointments.where((a) => a.checkedInAt != null && a.checkedInAt!.isNotEmpty).length;

    return _ReportData(
      walkIns: queue.length,
      checkedInCount: checkedInCount,
      bookingCollected: bookingCollected,
      cashCollected: cashCollected,
      onlineCollected: onlineCollected,
      payments: rows,
    );
  }

  @override
  Widget build(BuildContext context) {
    // No own Scaffold/AppBar — only ever embedded as a RoleScaffold nav-item body
    // (receptionist_home_screen.dart), which already supplies the app bar.
    return RefreshIndicator(
      onRefresh: () async => _load(),
      child: FutureBuilder<_ReportData>(
        future: _future,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final data = snapshot.data;
          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              const PageHeader(
                title: 'Reception reports',
                subtitle: 'Export clinic appointment and flow records.',
              ),
              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),
              if (data != null) ...[
                // BUG FIX (mobile parity audit): web shows 5 stat cards — mobile had only 3
                // (missing "Paid online at booking" and "Online collected at clinic").
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: StatCard(label: 'Walk-ins', value: '${data.walkIns}', icon: Icons.directions_walk_outlined)),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(child: StatCard(label: 'Check-ins', value: '${data.checkedInCount}', icon: Icons.how_to_reg_outlined)),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: StatCard(label: 'Paid online at booking', value: '₹${data.bookingCollected.toStringAsFixed(0)}', icon: Icons.public)),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(child: StatCard(label: 'Cash collected', value: '₹${data.cashCollected.toStringAsFixed(0)}', icon: Icons.currency_rupee)),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                StatCard(label: 'Online collected at clinic', value: '₹${data.onlineCollected.toStringAsFixed(0)}', icon: Icons.wifi),
                const SizedBox(height: AppSpacing.lg),
                SectionCard(
                  title: 'Payments',
                  child: data.payments.isEmpty
                      ? const Padding(
                          padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
                          child: Text('No payments recorded yet.', style: TextStyle(color: AppColors.textSecondary)),
                        )
                      : Column(
                          children: [
                            for (var i = 0; i < data.payments.length; i++) ...[
                              if (i > 0) const Divider(height: AppSpacing.lg),
                              _PaymentRecordTile(row: data.payments[i]),
                            ],
                          ],
                        ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _PaymentRecordTile extends StatelessWidget {
  final _ReportPaymentRow row;
  const _PaymentRecordTile({required this.row});

  String _formatDate(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final parsed = DateTime.tryParse(iso);
    if (parsed == null) return iso;
    return DateFormat('dd MMM yyyy').format(parsed.toLocal());
  }

  @override
  Widget build(BuildContext context) {
    final payment = row.payment;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_formatDate(payment.createdAt), style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(
                'Receipt: ${payment.receiptNumber ?? '—'}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 2),
              Text(
                'Dr. ${payment.doctor?.name ?? '—'} · ${payment.mode.toUpperCase()}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
              ),
            ],
          ),
        ),
        Text('₹${row.doctorCharge.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
      ],
    );
  }
}
