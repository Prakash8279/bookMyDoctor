import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../core/payment_visibility.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Ports client/src/lib/format.js's shortId() exactly for Booking ID display
String _shortId(String id) {
  if (id.isEmpty || id == '—') return '—';
  final tail = id.contains('_') ? id.split('_').last : id;
  return '#${tail.length > 4 ? tail.substring(tail.length - 4) : tail}';
}

/// COMPLETENESS FIX (mobile parity — client/src/pages/AdminPages.jsx#RevenueReports's
/// doctorOnly=false variant (mounted at web's /admin/revenue) had no mobile equivalent; mobile
/// only had the doctor-scoped DoctorRevenueReportsScreen). Mirrors that screen's structure
/// (date-range pickers, GET /payments, stat tiles, filtered+sorted payment list) but for the
/// platform-wide admin view: an admin/superadmin caller to GET /payments gets every payment
/// across every doctor (payments.service.js `ADMIN_ROLES` branch), already shaped with the full
/// fee breakdown — `fees.amount`, `fees.commission`, `fees.clinicPayout` — rather than the
/// doctor-masked `fees.consultationFee` alone, so this screen reports total platform revenue
/// plus the commission/clinic-payout split (no "your revenue" framing), a per-doctor breakdown,
/// a payment-mode breakdown, and a doctor name on every payment row.
///
/// Doctor filter: rather than adding a dependency on a separate doctor-directory fetch (and a
/// second loading state to reconcile with the payments list), the filter dropdown is built from
/// the distinct doctors already present in the loaded payment set — the same set of doctors the
/// underlying data could possibly show revenue for in the selected window. This keeps the screen
/// to the one GET /payments call the doctor-scoped screen already makes. A doctor with zero
/// payments in view naturally won't appear in the dropdown; that's an acceptable limitation of
/// avoiding a second endpoint round-trip purely for a filter list.
class AdminRevenueReportsScreen extends StatefulWidget {
  const AdminRevenueReportsScreen({super.key});

  @override
  State<AdminRevenueReportsScreen> createState() => _AdminRevenueReportsScreenState();
}

class _AdminRevenueReportsScreenState extends State<AdminRevenueReportsScreen> {
  late DateTime _from;
  late DateTime _to;
  String _doctorFilter = 'all'; // 'all' or a NamedRef.id
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
          .get('/payments', query: {'pageSize': 100})
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

  // COMPLETENESS FIX (mobile parity audit): web's "Download Excel" action
  // (AdminPages.jsx#RevenueReports `downloadExcel`) had no mobile equivalent — mobile only ever
  // built the on-screen stat tiles/tables from this same data, never let an admin export it.
  // Same HTML-table-as-.xls trick as web (a real spreadsheet library is overkill for one export
  // button), same three tables (summary, doctor-wise, payment details) and same escaping.
  Future<void> _downloadExcel({
    required String periodLabel,
    required double total,
    required int paymentsCount,
    required double commission,
    required double clinicPayout,
    required List<_DoctorRevenue> doctorRows,
    required List<PaymentItem> payments,
  }) async {
    String escape(Object? value) => (value?.toString() ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    String money(double value) => '₹${value.toStringAsFixed(0)}';

    final doctorRowsHtml = doctorRows
        .map((d) => '<tr><td>${escape(d.name)}</td><td>${d.payments}</td><td>${escape(money(d.revenue))}</td></tr>')
        .join();
    final paymentRowsHtml = payments
        .map((p) => '<tr><td>${escape(p.createdAt != null ? p.createdAt!.split("T").first : '')}</td>'
            '<td>${escape(p.doctor?.name ?? 'Unassigned')}</td>'
            '<td>${escape(p.receiptNumber ?? '')}</td>'
            '<td>${escape(p.bookingId != null ? _shortId(p.bookingId!) : '—')}</td>'
            '<td>${escape(p.mode)}</td>'
            '<td>${escape(money(p.fees.amount ?? p.fees.consultationFee ?? 0))}</td>'
            '<td>${escape(p.status)}</td></tr>')
        .join();
    final html = '<html><head><meta charset="UTF-8"></head><body>'
        '<h2>BookADoctors Revenue Report</h2>'
        '<p>Period: ${escape(periodLabel)} · Doctor: ${escape(_doctorFilter == 'all' ? 'All doctors' : _doctorFilter)}</p>'
        '<table border="1"><tr><th>Metric</th><th>Value</th></tr>'
        '<tr><td>Revenue</td><td>${escape(money(total))}</td></tr>'
        '<tr><td>Payments</td><td>$paymentsCount</td></tr>'
        '<tr><td>Platform commission</td><td>${escape(money(commission))}</td></tr>'
        '<tr><td>Clinic payout</td><td>${escape(money(clinicPayout))}</td></tr></table><br>'
        '<h3>Doctor-wise revenue</h3>'
        '<table border="1"><tr><th>Doctor</th><th>Payments</th><th>Revenue</th></tr>'
        '${doctorRowsHtml.isEmpty ? '<tr><td colspan="3">No payments</td></tr>' : doctorRowsHtml}</table><br>'
        '<h3>Payment details</h3>'
        '<table border="1"><tr><th>Date</th><th>Doctor</th><th>Receipt</th><th>Booking ID</th><th>Mode</th><th>Amount</th><th>Status</th></tr>'
        '${paymentRowsHtml.isEmpty ? '<tr><td colspan="7">No payments</td></tr>' : paymentRowsHtml}</table>'
        '</body></html>';

    final fromStr = DateFormat('yyyy-MM-dd').format(_from);
    final toStr = DateFormat('yyyy-MM-dd').format(_to);
    await shareText(filename: 'bookadoctors-revenue-$fromStr-to-$toStr.xls', content: html);
  }

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('d MMM yyyy');
    // No own Scaffold/AppBar — only ever embedded as a RoleScaffold nav-item body
    // (admin_home_screen.dart), which already supplies the app bar.
    return Column(
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(
            title: 'Revenue reports',
            subtitle: 'View payment revenue for any selected date range and doctor.',
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
              final inPeriod = all.where(_inRange).toList();

              // Distinct doctors present in the period's data, for the filter dropdown —
              // keeps the previously-chosen filter selectable even after a date-range
              // change drops it out of view, same tolerance the web page's `doctorNames`
              // union (doctors list + payments) gives.
              final doctorsById = <String, String>{};
              for (final p in inPeriod) {
                if (p.doctor != null && p.doctor!.id.isNotEmpty) {
                  doctorsById[p.doctor!.id] = p.doctor!.name ?? 'Unassigned';
                }
              }
              final doctorEntries = doctorsById.entries.toList()
                ..sort((a, b) => a.value.compareTo(b.value));

              final filtered = inPeriod.where((p) {
                if (_doctorFilter == 'all') return true;
                return p.doctor?.id == _doctorFilter;
              }).toList()
                ..sort((a, b) => (b.createdAt ?? '').compareTo(a.createdAt ?? ''));

              final total = filtered.fold<double>(0, (sum, p) => sum + (p.fees.amount ?? p.fees.consultationFee ?? 0));
              final average = filtered.isEmpty ? 0.0 : total / filtered.length;
              final commission = filtered.fold<double>(0, (sum, p) => sum + (p.fees.commission ?? 0));
              final clinicPayout = filtered.fold<double>(0, (sum, p) => sum + (p.fees.clinicPayout ?? 0));

              // Doctor-wise revenue breakdown, sorted by revenue descending (highest earners
              // first) — mirrors the "Doctor-wise revenue" table on the web admin page.
              final byDoctor = <String, _DoctorRevenue>{};
              for (final p in filtered) {
                final name = p.doctor?.name ?? 'Unassigned';
                final entry = byDoctor.putIfAbsent(name, () => _DoctorRevenue(name: name));
                entry.payments += 1;
                entry.revenue += (p.fees.amount ?? p.fees.consultationFee ?? 0);
              }
              final doctorRows = byDoctor.values.toList()..sort((a, b) => b.revenue.compareTo(a.revenue));

              // Payment-mode breakdown, mirrors web's RevenueReports "Payment modes" panel:
              // 3-way rollup (Paid at booking / Cash at clinic / Online at clinic) + per-mode amounts & counts.
              final modeAmounts = <String, double>{};
              final modeCounts = <String, int>{};
              double bookingTotal = 0, cashTotal = 0, onlineTotal = 0;
              for (final p in filtered) {
                final amount = (p.fees.amount ?? p.fees.consultationFee ?? 0);
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
              final selectedDoctorName = _doctorFilter == 'all'
                  ? 'All doctors'
                  : (doctorsById[_doctorFilter] ?? 'Selected doctor');
              final invalidRange = _from.isAfter(_to);

              return RefreshIndicator(
                onRefresh: () async => _load(),
                child: ListView(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  children: [
                    if (invalidRange)
                      Container(
                        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: AppColors.danger.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
                        ),
                        child: const Text(
                          'From date must be before To date.',
                          style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600, fontSize: 13),
                        ),
                      ),
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
                    DropdownButtonFormField<String>(
                      initialValue: _doctorFilter,
                      decoration: const InputDecoration(labelText: 'Doctor'),
                      items: [
                        const DropdownMenuItem(value: 'all', child: Text('All doctors')),
                        ...doctorEntries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))),
                      ],
                      onChanged: (v) => setState(() => _doctorFilter = v ?? 'all'),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    // COMPLETENESS FIX (mobile parity audit): web's "Download Excel" action — see
                    // _downloadExcel's doc comment.
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                        onPressed: filtered.isEmpty
                            ? null
                            : () => _downloadExcel(
                                  periodLabel: periodLabel,
                                  total: total,
                                  paymentsCount: filtered.length,
                                  commission: commission,
                                  clinicPayout: clinicPayout,
                                  doctorRows: doctorRows,
                                  payments: filtered,
                                ),
                        icon: const Icon(Icons.file_download_outlined, size: 16),
                        label: const Text('Download Excel'),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
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
                            icon: Icons.calculate_outlined,
                            detail: periodLabel,
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
                            value: '₹${commission.toStringAsFixed(0)}',
                            icon: Icons.percent_outlined,
                            detail: 'Convenience/emergency/GST charges',
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: StatCard(
                            label: 'Clinic payout',
                            value: '₹${clinicPayout.toStringAsFixed(0)}',
                            icon: Icons.check_circle_outline,
                            detail: "Full consultation fee (doctor's share)",
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    SectionCard(
                      title: 'Doctor-wise revenue',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '$periodLabel · $selectedDoctorName',
                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          if (doctorRows.isEmpty)
                            const Text('No payments in this period.', style: TextStyle(color: AppColors.textSecondary))
                          else
                            ...doctorRows.map((d) => Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 4),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: Text(d.name, style: const TextStyle(fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                                      ),
                                      Text(
                                        '${d.payments} pmt${d.payments == 1 ? '' : 's'}',
                                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                      ),
                                      const SizedBox(width: AppSpacing.sm),
                                      Text(
                                        '₹${d.revenue.toStringAsFixed(0)}',
                                        style: const TextStyle(fontWeight: FontWeight.w700),
                                      ),
                                    ],
                                  ),
                                )),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    SectionCard(
                      title: 'Payment modes',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(child: _ModeTotalTile(label: 'PAID AT BOOKING', value: bookingTotal)),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(child: _ModeTotalTile(label: 'CASH (CLINIC)', value: cashTotal)),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(child: _ModeTotalTile(label: 'ONLINE (CLINIC)', value: onlineTotal)),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.md),
                          if (modeCounts.isEmpty)
                            const Text('No payments in this period.', style: TextStyle(color: AppColors.textSecondary))
                          else
                            ...modeCounts.entries.map((e) => Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 4),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(e.key.toUpperCase(), style: const TextStyle(fontSize: 13)),
                                      Text(
                                        '₹${(modeAmounts[e.key] ?? 0).toStringAsFixed(0)} · ${e.value}',
                                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                                      ),
                                    ],
                                  ),
                                )),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Text('Payments in selected period', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: AppSpacing.sm),
                    if (filtered.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: AppSpacing.xl),
                        child: EmptyStateView(
                          icon: Icons.receipt_long_outlined,
                          title: 'No payments in this period',
                        ),
                      )
                    else
                      ...filtered.map((p) {
                        final bId = p.bookingId;
                        final totalAmount = (p.fees.amount ?? p.fees.consultationFee ?? 0);
                        final doctorName = p.doctor?.name ?? 'Unassigned doctor';
                        final patientName = p.patient?.name ?? 'Patient';
                        final clinicName = p.clinic?.name;
                        final commission = p.fees.commission ?? 0;
                        final clinicPayout = p.fees.clinicPayout ?? (totalAmount - commission);
                        final dateStr = p.createdAt != null ? p.createdAt!.split("T").first : "";

                        return Card(
                          margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        doctorName,
                                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    InkWell(
                                      onTap: bId != null
                                          ? () {
                                              Clipboard.setData(ClipboardData(text: bId));
                                              ScaffoldMessenger.of(context).showSnackBar(
                                                SnackBar(
                                                  content: Text('Booking ID copied: $bId'),
                                                  duration: const Duration(seconds: 2),
                                                ),
                                              );
                                            }
                                          : null,
                                      borderRadius: BorderRadius.circular(4),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: bId != null ? AppColors.primaryLight : AppColors.surface,
                                          borderRadius: BorderRadius.circular(4),
                                          border: Border.all(
                                            color: bId != null ? AppColors.primaryLight : AppColors.border,
                                          ),
                                        ),
                                        child: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Text(
                                              bId != null ? 'Booking ID: ${_shortId(bId)}' : 'Booking ID: —',
                                              style: TextStyle(
                                                color: bId != null ? AppColors.primaryDark : AppColors.textSecondary,
                                                fontSize: 11,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                            if (bId != null) ...[
                                              const SizedBox(width: 3),
                                              const Icon(Icons.copy, size: 10, color: AppColors.primaryDark),
                                            ],
                                          ],
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    Expanded(
                                      child: Wrap(
                                        crossAxisAlignment: WrapCrossAlignment.center,
                                        spacing: 6,
                                        runSpacing: 4,
                                        children: [
                                          Text(
                                            patientName,
                                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
                                          ),
                                          const Text('·', style: TextStyle(color: AppColors.textSecondary)),
                                          Text(
                                            p.mode.toUpperCase(),
                                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                                          ),
                                          PaymentSourceBadge(payment: p),
                                        ],
                                      ),
                                    ),
                                    Column(
                                      crossAxisAlignment: CrossAxisAlignment.end,
                                      children: [
                                        Text(
                                          '₹${totalAmount.toStringAsFixed(0)}',
                                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                                        ),
                                        const SizedBox(height: 2),
                                        StatusBadge(status: p.status),
                                      ],
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                const Divider(height: 1),
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        'Receipt: #${p.receiptNumber ?? '—'} · Date: $dateStr'
                                        '${clinicName != null ? " · Clinic: $clinicName" : ""}',
                                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ],
                                ),
                                if (commission > 0 || clinicPayout > 0) ...[
                                  const SizedBox(height: 3),
                                  Text(
                                    'Doctor share: ₹${clinicPayout.toStringAsFixed(0)} · Commission: ₹${commission.toStringAsFixed(0)}',
                                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        );
                      }),
                    const SizedBox(height: AppSpacing.lg),
                    const SectionCard(
                      title: 'Platform analytics',
                      child: EmptyStateView(
                        icon: Icons.analytics_outlined,
                        title: 'Analytics not available',
                        subtitle: 'The current API has no time-series analytics endpoint yet.',
                      ),
                    ),
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

class _DoctorRevenue {
  final String name;
  int payments = 0;
  double revenue = 0;
  _DoctorRevenue({required this.name});
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
          Text(
            label,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 4),
          Text(
            '₹${value.toStringAsFixed(0)}',
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}
