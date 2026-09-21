import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../core/payment_visibility.dart';
import '../../models/clinical_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Ports client/src/lib/format.js's shortId() exactly — see appointments_screen.dart's copy for
/// the same rationale (a private per-file helper, matching this codebase's existing convention
/// rather than a shared util module).
String _shortId(String id) {
  final tail = id.contains('_') ? id.split('_').last : id;
  return '#${tail.length > 4 ? tail.substring(tail.length - 4) : tail}';
}

/// COMPLETENESS FIX (mobile parity — client/src/pages/AdminPages.jsx#RevenueReports's
/// doctorOnly=true variant had no mobile equivalent; DoctorPaymentsScreen is a flat list with no
/// date range or summary totals). Fee masking applies here too: a doctor only ever receives
/// `fees.consultationFee` on /payments (never commission/clinicPayout), so — same as the web
/// page's doctorOnly branch — this treats consultationFee as the doctor's full revenue with zero
/// commission, and skips the doctor-filter dropdown the admin-wide report shows.
///
/// COMPLETENESS FIX (mobile parity audit round 2, doctor panel): this screen previously only had
/// the "Selected range revenue"/"Average payment" stat tiles and a bare per-mode COUNT — missing
/// the "Download Excel" export, the Booking ID + At-booking/At-clinic badge on each payment row,
/// the three-way "Paid at booking / Cash (clinic) / Online (clinic)" rupee rollup, per-mode
/// AMOUNTS (not just counts), the Platform commission/Clinic payout stat tiles, and the (single-
/// row, since a doctor only ever sees their own payments) "Doctor-wise revenue" table — all
/// present on web's RevenueReports({doctorOnly:true}) (AdminPages.jsx:943-1086).
class DoctorRevenueReportsScreen extends StatefulWidget {
  const DoctorRevenueReportsScreen({super.key});

  @override
  State<DoctorRevenueReportsScreen> createState() => _DoctorRevenueReportsScreenState();
}

class _DoctorRevenueReportsScreenState extends State<DoctorRevenueReportsScreen> {
  late DateTime _from;
  late DateTime _to;
  Future<List<PaymentItem>>? _future;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _from = DateTime(now.year, now.month, 1);
    _to = now;
    _future = _fetch();
  }

  Future<List<PaymentItem>> _fetch() async {
    try {
      final res = await ApiClient.instance
          .get('/payments', query: {'pageSize': 200})
          .catchError((_) => ApiResponse(data: []));
      final list = <PaymentItem>[];
      for (final item in res.list) {
        try {
          list.add(PaymentItem.fromJson(item));
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

  Future<void> _pickFrom() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _from,
      firstDate: DateTime.now().subtract(const Duration(days: 730)),
      lastDate: _to,
    );
    if (picked != null) setState(() => _from = picked);
  }

  Future<void> _pickTo() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _to,
      firstDate: _from,
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) setState(() => _to = picked);
  }

  bool _inRange(PaymentItem payment) {
    if (payment.createdAt == null) return false;
    final date = DateTime.tryParse(payment.createdAt!);
    if (date == null) return false;
    final start = DateTime(_from.year, _from.month, _from.day);
    final end = DateTime(_to.year, _to.month, _to.day, 23, 59, 59);
    return !date.isBefore(start) && !date.isAfter(end);
  }

  // COMPLETENESS FIX (mobile parity audit): web's "Download Excel" action (AdminPages.jsx's
  // downloadExcel, doctorOnly branch) — same HTML-table-as-.xls trick as admin's own mobile
  // export (admin_revenue_reports_screen.dart), scoped to the doctor's own single-row summary.
  Future<void> _downloadExcel({
    required String periodLabel,
    required String doctorName,
    required double total,
    required int paymentsCount,
    required double clinicPayout,
    required List<PaymentItem> payments,
  }) async {
    String escape(Object? value) => (value?.toString() ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    String money(double value) => '₹${value.toStringAsFixed(0)}';

    final doctorRowHtml = '<tr><td>${escape(doctorName)}</td><td>$paymentsCount</td><td>${escape(money(total))}</td></tr>';
    final paymentRowsHtml = payments
        .map((p) => '<tr><td>${escape(p.createdAt != null ? p.createdAt!.split("T").first : '')}</td>'
            '<td>${escape(doctorName)}</td>'
            '<td>${escape(p.receiptNumber ?? '')}</td>'
            '<td>${escape(p.mode)}</td>'
            '<td>${escape(money(p.fees.consultationFee ?? 0))}</td>'
            '<td>${escape(p.status)}</td></tr>')
        .join();
    final html = '<html><head><meta charset="UTF-8"></head><body>'
        '<h2>BookMyDoctor24 Revenue Report</h2>'
        '<p>Period: ${escape(periodLabel)} · Doctor: ${escape(doctorName)}</p>'
        '<table border="1"><tr><th>Metric</th><th>Value</th></tr>'
        '<tr><td>Revenue</td><td>${escape(money(total))}</td></tr>'
        '<tr><td>Payments</td><td>$paymentsCount</td></tr>'
        '<tr><td>Platform commission</td><td>Shown to admin only</td></tr>'
        '<tr><td>Clinic payout</td><td>${escape(money(clinicPayout))}</td></tr></table><br>'
        '<h3>Doctor-wise revenue</h3>'
        '<table border="1"><tr><th>Doctor</th><th>Payments</th><th>Revenue</th></tr>$doctorRowHtml</table><br>'
        '<h3>Payment details</h3>'
        '<table border="1"><tr><th>Date</th><th>Doctor</th><th>Receipt</th><th>Mode</th><th>Amount</th><th>Status</th></tr>'
        '${paymentRowsHtml.isEmpty ? '<tr><td colspan="6">No payments</td></tr>' : paymentRowsHtml}</table>'
        '</body></html>';

    final fromStr = DateFormat('yyyy-MM-dd').format(_from);
    final toStr = DateFormat('yyyy-MM-dd').format(_to);
    await shareText(filename: 'bookmydoctor24-revenue-$fromStr-to-$toStr.xls', content: html);
  }

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('d MMM yyyy');
    final doctorName = context.watch<AuthProvider>().user?.name ?? 'You';
    // No own Scaffold/AppBar — only ever embedded as a RoleScaffold nav-item body
    // (doctor_home_screen.dart), which already supplies the app bar.
    return Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'My revenue reports',
              subtitle: 'View only your own revenue for any selected date range.',
            ),
          ),
          Expanded(
            child: FutureBuilder<List<PaymentItem>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
          if (snapshot.hasError) {
            return Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: ErrorBanner(error: snapshot.error!, onRetry: _load),
            );
          }
          final all = snapshot.data ?? [];
          final filtered = all.where(_inRange).toList()
            ..sort((a, b) => (b.createdAt ?? '').compareTo(a.createdAt ?? ''));
          final total = filtered.fold<double>(0, (sum, p) => sum + (p.fees.consultationFee ?? 0));
          final average = filtered.isEmpty ? 0.0 : total / filtered.length;
          // doctorOnly branch: commission is always hidden ("—"), clinicPayout equals the total
          // (the doctor's full consultation charges) — mirrors AdminPages.jsx's doctorOnly math.
          final clinicPayout = total;

          // COMPLETENESS FIX (mobile parity — web's RevenueReports "Payment modes" breakdown,
          // client/src/pages/AdminPages.jsx#RevenueReports): amount + count per literal mode, plus
          // the three-way "paid at booking / cash at clinic / online at clinic" rollup that tells
          // a patient's own Razorpay booking-time payment apart from one collected in person.
          final modeAmounts = <String, double>{};
          final modeCounts = <String, int>{};
          double bookingTotal = 0, cashTotal = 0, onlineTotal = 0;
          for (final p in filtered) {
            final amount = p.fees.consultationFee ?? 0;
            final mode = p.mode.isEmpty ? 'Other' : p.mode;
            modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
            modeAmounts[mode] = (modeAmounts[mode] ?? 0) + amount;
            final atBooking = isOnlineBookingPayment(p);
            final isCash = p.mode.toLowerCase() == 'cash';
            if (atBooking) {
              bookingTotal += amount;
            } else if (isCash) {
              cashTotal += amount;
            } else {
              onlineTotal += amount;
            }
          }
          final periodLabel = '${dateFormat.format(_from)} to ${dateFormat.format(_to)}';

          return RefreshIndicator(
            onRefresh: () async => _load(),
            child: ListView(
              padding: const EdgeInsets.all(AppSpacing.md),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _pickFrom,
                        icon: const Icon(Icons.calendar_today_outlined, size: 16),
                        label: Text(dateFormat.format(_from)),
                      ),
                    ),
                    const Padding(padding: EdgeInsets.symmetric(horizontal: 8), child: Text('to')),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _pickTo,
                        icon: const Icon(Icons.calendar_today_outlined, size: 16),
                        label: Text(dateFormat.format(_to)),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                // COMPLETENESS FIX (mobile parity audit): web's "Download Excel" action.
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: filtered.isEmpty
                        ? null
                        : () => _downloadExcel(
                              periodLabel: periodLabel,
                              doctorName: doctorName,
                              total: total,
                              paymentsCount: filtered.length,
                              clinicPayout: clinicPayout,
                              payments: filtered,
                            ),
                    icon: const Icon(Icons.file_download_outlined, size: 16),
                    label: const Text('Download Excel'),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: 'Selected range revenue',
                        value: '₹${total.toStringAsFixed(0)}',
                        icon: Icons.currency_rupee,
                        detail: '${filtered.length} payment${filtered.length == 1 ? '' : 's'}',
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'Average payment',
                        value: '₹${average.toStringAsFixed(0)}',
                        icon: Icons.trending_up_outlined,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: 'Platform commission',
                        value: '—',
                        icon: Icons.percent,
                        detail: 'Shown to admin only',
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'Clinic payout',
                        value: '₹${clinicPayout.toStringAsFixed(0)}',
                        icon: Icons.check_circle_outline,
                        detail: 'Your consultation charges',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                SectionCard(
                  title: 'Doctor-wise revenue',
                  child: filtered.isEmpty
                      ? const Text('No payments in this period.', style: TextStyle(color: AppColors.textSecondary))
                      : Row(
                          children: [
                            Expanded(child: Text(doctorName, overflow: TextOverflow.ellipsis)),
                            Text('${filtered.length} pmt${filtered.length == 1 ? '' : 's'}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                            const SizedBox(width: AppSpacing.sm),
                            Text('₹${total.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                          ],
                        ),
                ),
                const SizedBox(height: AppSpacing.md),
                SectionCard(
                  title: 'Payment modes',
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Expanded(child: _ModeTotalTile(label: 'Paid at booking', value: bookingTotal)),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(child: _ModeTotalTile(label: 'Cash (clinic)', value: cashTotal)),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(child: _ModeTotalTile(label: 'Online (clinic)', value: onlineTotal)),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.md),
                      if (modeCounts.isEmpty)
                        const Text('No payments in this period.', style: TextStyle(color: AppColors.textSecondary))
                      else
                        Column(
                          children: modeCounts.entries.map((entry) {
                            return Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Row(
                                children: [
                                  Expanded(child: Text(entry.key)),
                                  Text(
                                    '₹${(modeAmounts[entry.key] ?? 0).toStringAsFixed(0)} · ${entry.value}',
                                    style: const TextStyle(fontWeight: FontWeight.w700),
                                  ),
                                ],
                              ),
                            );
                          }).toList(),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                if (filtered.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpacing.xl),
                    child: EmptyStateView(
                      icon: Icons.receipt_long_outlined,
                      title: 'No payments in this period',
                    ),
                  )
                else
                  ...filtered.map((p) => Card(
                        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: ListTile(
                          title: Text(p.patient?.name ?? 'Patient'),
                          subtitle: Row(
                            children: [
                              Flexible(
                                child: Text(
                                  '${p.mode.toUpperCase()}${p.receiptNumber != null ? " · #${p.receiptNumber}" : ""}'
                                  '${p.appointment != null ? " · Booking ${_shortId(p.appointment!.id)}" : ""}'
                                  '${p.createdAt != null ? " · ${p.createdAt!.split("T").first}" : ""}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 6),
                              PaymentSourceBadge(payment: p),
                            ],
                          ),
                          trailing: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              if (p.fees.consultationFee != null)
                                Text('₹${p.fees.consultationFee!.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                              StatusBadge(status: p.status),
                            ],
                          ),
                        ),
                      )),
              ],
            ),
          );
        },
            ),
          ),
        ],
      );
  }
}

class _ModeTotalTile extends StatelessWidget {
  final String label;
  final double value;
  const _ModeTotalTile({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm, horizontal: 8),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(8)),
      child: Column(
        children: [
          Text(label, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.textSecondary), textAlign: TextAlign.center),
          const SizedBox(height: 4),
          Text('₹${value.toStringAsFixed(0)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }
}
