import 'package:flutter/material.dart';
import '../core/admin_period.dart';
import '../core/api_client.dart';
import '../core/csv_export.dart';
import '../core/india_time.dart';
import '../models/clinical_models.dart';
import '../core/payment_visibility.dart';
import 'common_widgets.dart';
import 'admin_period_filter.dart';

class AdminPeriodSummary extends StatefulWidget {
  const AdminPeriodSummary({super.key});
  @override
  State<AdminPeriodSummary> createState() => _AdminPeriodSummaryState();
}

class _PeriodResult {
  _PeriodResult(this.appointments, this.payments);
  final List<Appointment> appointments;
  final List<PaymentItem> payments;
  double get revenue => payments.where(isRevenuePayment).fold(
      0, (sum, p) => sum + (p.fees.amount ?? p.fees.consultationFee ?? 0));
}

class _AdminPeriodSummaryState extends State<AdminPeriodSummary> {
  AdminPeriod _period = AdminPeriod.today();
  late Future<_PeriodResult> _future = _load(_period);
  Future<_PeriodResult> _load(AdminPeriod period) async {
    final responses = await Future.wait([
      ApiClient.instance.getAll('/appointments', query: period.visitQuery),
      ApiClient.instance.getAll('/payments'),
    ]);
    return _PeriodResult(
        responses[0]
            .list
            .map(Appointment.fromJson)
            .where((a) => period.includes(a.appointmentDate))
            .toList(),
        responses[1]
            .list
            .map(PaymentItem.fromJson)
            .where((p) => period.includes(p.createdAt))
            .toList());
  }

  Future<void> _export(_PeriodResult data) async {
    try {
      await shareCsv(
          filename:
              'platform-${_period.from ?? 'all'}-to-${_period.to ?? 'all'}.csv',
          headers: const [
            'Type',
            'ID',
            'Booking ID',
            'Patient',
            'Doctor',
            'Clinic',
            'Visit date',
            'Visit time',
            'Booked on (IST)',
            'Payment date (IST)',
            'Token',
            'Status',
            'Payment status',
            'Amount',
            'Mode',
            'Reference'
          ],
          rows: [
            for (final a in data.appointments)
              [
                'Appointment',
                a.id,
                a.id,
                a.familyMember?.name ?? a.patient?.name,
                a.doctor?.name,
                a.clinic?.name,
                a.appointmentDate,
                a.displayTime,
                indiaTimestamp(a.createdAt),
                '',
                a.tokenNumber,
                a.status,
                a.paymentStatus,
                a.fees.totalAmount ?? a.fees.consultationFee,
                a.paymentMethod,
                ''
              ],
            for (final p in data.payments)
              [
                'Payment',
                p.id,
                p.appointment?.id,
                p.patient?.name,
                p.doctor?.name,
                p.clinic?.name,
                '',
                '',
                indiaTimestamp(p.appointment?.createdAt),
                indiaTimestamp(p.createdAt),
                '',
                p.status,
                p.status,
                p.fees.amount ?? p.fees.consultationFee,
                p.mode,
                p.transactionRef
              ],
          ]);
    } catch (error) {
      if (mounted) showErrorSnack(context, error);
    }
  }

  @override
  Widget build(BuildContext context) => SectionCard(
      title: 'Selected period',
      child: Column(children: [
        AdminPeriodFilter(
            value: _period,
            onChanged: (period) => setState(() {
                  _period = period;
                  if (period.isValid) _future = _load(period);
                })),
        const SizedBox(height: 8),
        if (_period.isValid)
          FutureBuilder<_PeriodResult>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return ErrorBanner(
                      error: snapshot.error!,
                      onRetry: () => setState(() {
                            _future = _load(_period);
                          }));
                }
                final data = snapshot.data;
                final ready = snapshot.connectionState == ConnectionState.done;
                return Column(children: [
                  Row(children: [
                    Expanded(
                        child: StatCard(
                            label: 'Period bookings',
                            value: ready ? '${data!.appointments.length}' : '—',
                            detail: 'By visit date',
                            icon: Icons.calendar_today_outlined)),
                    const SizedBox(width: 8),
                    Expanded(
                        child: StatCard(
                            label: 'Period revenue',
                            value: ready
                                ? '₹${data!.revenue.toStringAsFixed(0)}'
                                : '—',
                            detail: 'Paid collections only',
                            icon: Icons.currency_rupee))
                  ]),
                  Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                          onPressed: ready && data != null
                              ? () => _export(data)
                              : null,
                          icon: const Icon(Icons.download_outlined),
                          label: const Text('Export selected period'))),
                ]);
              }),
      ]));
}
