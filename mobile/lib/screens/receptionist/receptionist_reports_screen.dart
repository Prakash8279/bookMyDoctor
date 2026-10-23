import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/admin_period.dart';
import '../../widgets/admin_period_filter.dart';
import '../../core/payment_visibility.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/role_scaffold.dart';
import 'receptionist_appointments_screen.dart';

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

/// Clinic-scoped complete report with an India-date period filter.
/// Collections use payment date, walk-ins use visit date, arrivals use checkedInAt.
class ReceptionistReportsScreen extends StatefulWidget {
  const ReceptionistReportsScreen({super.key});

  @override
  State<ReceptionistReportsScreen> createState() =>
      _ReceptionistReportsScreenState();
}

class _ReceptionistReportsScreenState extends State<ReceptionistReportsScreen> {
  Future<_ReportData>? _future;
  AdminPeriod _period = AdminPeriod.today();

  void _changePeriod(AdminPeriod period) {
    setState(() {
      _period = period;
      if (period.isValid) _future = _fetch();
    });
  }

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

  // DIAGNOSTIC FIX (user report: "recieptinest ka report me data nahi aa raha hai"): each of
  // these three calls used to have its own `.catchError((_) => ApiResponse(data: []))`, so ANY
  // failure on ANY of the three (a timeout, a non-2xx response, a dropped connection) silently
  // became "this clinic has zero appointments/payments/queue entries" with no way to tell that
  // apart from a real empty clinic. Since the Payments tab (same /payments endpoint, same
  // account) shows real payment records, this screen's silent-empty behavior was hiding whatever
  // the actual fetch error is. Now a genuine failure propagates out of Future.wait to the
  // FutureBuilder's existing `snapshot.hasError` branch (ErrorBanner) instead.
  // ROOT CAUSE FOUND (user confirmed the ErrorBanner from the fix above actually reads
  // "Validation failed"): the server's list-query validator caps `pageSize` at 100 (same rule as
  // admin.validation.js's `query('pageSize').optional().isInt({ min: 1, max: 100 })` — the
  // appointments/payments/queue list routes enforce the identical 1-100 range). This screen was
  // sending `pageSize: 200`, which the validator rejects outright with a 422 before the request
  // ever reaches listAppointments/listPayments/listQueue — unlike pagination.js's OWN internal
  // parsePagination(), which merely clamps an out-of-range value instead of erroring; that lenient
  // clamp only ever runs for values that got past this earlier, stricter route-level check.
  // Appointments (pageSize 100) and Payments (pageSize 50) tabs stayed within range and always
  // worked — only this screen's 200 was ever out of bounds. Capped to 100, the actual max.
  Future<_ReportData> _fetch() async {
    final period = _period;
    final results = await Future.wait([
      ApiClient.instance.getAll('/appointments', query: {'pageSize': 100}),
      ApiClient.instance.getAll('/payments', query: {'pageSize': 100}),
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

    final appointmentsById = {for (final a in appointments) a.id: a};
    final rows = payments
        .where((payment) => period.includes(payment.createdAt))
        .map((payment) {
      final appointment = appointmentsById[payment.appointment?.id];
      return _ReportPaymentRow(
          payment: payment,
          doctorCharge: _doctorCharge(payment.fees, appointment?.fees));
    }).toList();

    // BUG FIX (mobile parity audit): web's ReceptionReports (FeaturePages.jsx) shows 5 metrics —
    // mobile only ever computed "Cash collected", dropping "Paid online at booking" and "Online
    // collected at clinic" entirely. isOnlineBookingPayment distinguishes a patient's own Razorpay
    // payment (mode 'online', transactionRef starting 'pay_') from one a receptionist typed in by
    // hand at the clinic — see core/payment_visibility.dart.
    final collected = rows
        .where((row) => row.payment.status == 'paid' && row.doctorCharge > 0)
        .toList();
    final bookingCollected = collected
        .where((row) => isOnlineBookingPayment(row.payment))
        .fold<double>(0, (sum, row) => sum + row.doctorCharge);
    final cashCollected = collected
        .where((row) =>
            !isOnlineBookingPayment(row.payment) &&
            row.payment.mode.toLowerCase() == 'cash')
        .fold<double>(0, (sum, row) => sum + row.doctorCharge);
    final onlineCollected = collected
        .where((row) =>
            !isOnlineBookingPayment(row.payment) &&
            row.payment.mode.toLowerCase() != 'cash')
        .fold<double>(0, (sum, row) => sum + row.doctorCharge);
    final checkedInCount = appointments
        .where((a) =>
            a.checkedInAt != null &&
            a.checkedInAt!.isNotEmpty &&
            period.includes(a.checkedInAt))
        .length;

    return _ReportData(
      walkIns: appointments
          .where((a) =>
              period.includes(a.appointmentDate) &&
              a.source == 'walk_in' &&
              !['cancelled', 'no_show'].contains(a.status))
          .length,
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
          final loading = _period.isValid &&
              snapshot.connectionState != ConnectionState.done;
          final data = !loading && _period.isValid && !snapshot.hasError
              ? snapshot.data
              : null;
          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              const PageHeader(
                title: 'Reception reports',
                subtitle:
                    'Selected-period clinic collections. Refunded and failed payments are excluded from totals.',
              ),
              AdminPeriodFilter(value: _period, onChanged: _changePeriod),
              const SizedBox(height: AppSpacing.sm),
              const Text(
                  'Collections use payment date; walk-ins use visit date; check-ins use arrival date (IST).',
                  style: TextStyle(fontSize: 11)),
              TextButton.icon(
                onPressed: () {
                  if (RoleScaffold.of(context)
                          ?.navigateToLabel('Appointments') ==
                      true) {
                    return;
                  }
                  Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => Scaffold(
                          appBar: AppBar(title: const Text('Appointments')),
                          body: const ReceptionistAppointmentsScreen())));
                },
                icon: const Icon(Icons.download_outlined, size: 18),
                label: const Text('Download appointments by date range'),
              ),
              if (loading)
                const Padding(
                    padding: EdgeInsets.only(top: AppSpacing.xl),
                    child: LoadingView()),
              if (snapshot.hasError)
                ErrorBanner(error: snapshot.error!, onRetry: _load),
              if (data != null) ...[
                // BUG FIX (mobile parity audit): web shows 5 stat cards — mobile had only 3
                // (missing "Paid online at booking" and "Online collected at clinic").
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                        child: StatCard(
                            label: 'Walk-ins',
                            value: '${data.walkIns}',
                            icon: Icons.directions_walk_outlined)),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                        child: StatCard(
                            label: 'Check-ins',
                            value: '${data.checkedInCount}',
                            icon: Icons.how_to_reg_outlined)),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                        child: StatCard(
                            label: 'Paid online at booking',
                            value:
                                '₹${data.bookingCollected.toStringAsFixed(0)}',
                            icon: Icons.public)),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                        child: StatCard(
                            label: 'Cash collected',
                            value: '₹${data.cashCollected.toStringAsFixed(0)}',
                            icon: Icons.currency_rupee)),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                StatCard(
                    label: 'Online collected at clinic',
                    value: '₹${data.onlineCollected.toStringAsFixed(0)}',
                    icon: Icons.wifi),
                const SizedBox(height: AppSpacing.lg),
                SectionCard(
                  title: 'Payments',
                  child: data.payments.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.symmetric(
                              vertical: AppSpacing.md),
                          child: Text('No payments in selected dates.',
                              style: TextStyle(
                                  color: context.palette.textSecondary)),
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
              Text(_formatDate(payment.createdAt),
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              StatusBadge(status: payment.status),
              const SizedBox(height: 2),
              Text(
                'Receipt: ${payment.receiptNumber ?? '—'}',
                style: TextStyle(
                    color: context.palette.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 2),
              Text(
                '${payment.doctor?.name ?? '—'} · ${payment.mode.toUpperCase()}',
                style: TextStyle(
                    color: context.palette.textSecondary, fontSize: 13),
              ),
            ],
          ),
        ),
        Text('₹${row.doctorCharge.toStringAsFixed(0)}',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
      ],
    );
  }
}
