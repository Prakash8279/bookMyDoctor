import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (mobile parity — client/src/pages/AdminPages.jsx#RevenueReports's
/// doctorOnly=true variant had no mobile equivalent; DoctorPaymentsScreen is a flat list with no
/// date range or summary totals). Fee masking applies here too: a doctor only ever receives
/// `fees.consultationFee` on /payments (never commission/clinicPayout), so — same as the web
/// page's doctorOnly branch — this treats consultationFee as the doctor's full revenue with zero
/// commission, and skips the doctor-filter dropdown the admin-wide report shows.
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

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('d MMM yyyy');
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
          // COMPLETENESS FIX (mobile parity — web's RevenueReports "Payment modes" breakdown,
          // client/src/pages/AdminPages.jsx#RevenueReports): counts payments in the selected range
          // by mode (cash/upi/etc.), same grouping the web page shows next to its doctor-wise table.
          final modeCounts = <String, int>{};
          for (final p in filtered) {
            final mode = p.mode.isEmpty ? 'Other' : p.mode;
            modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
          }

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
                const SizedBox(height: AppSpacing.md),
                SectionCard(
                  title: 'Payment modes',
                  child: modeCounts.isEmpty
                      ? const Text('No payments in this period.', style: TextStyle(color: AppColors.textSecondary))
                      : Column(
                          children: modeCounts.entries.map((entry) {
                            return Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Row(
                                children: [
                                  Expanded(child: Text(entry.key)),
                                  Text('${entry.value}', style: const TextStyle(fontWeight: FontWeight.w700)),
                                ],
                              ),
                            );
                          }).toList(),
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
                          subtitle: Text(
                            '${p.mode.toUpperCase()}${p.receiptNumber != null ? " · #${p.receiptNumber}" : ""}${p.createdAt != null ? " · ${p.createdAt!.split("T").first}" : ""}',
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
