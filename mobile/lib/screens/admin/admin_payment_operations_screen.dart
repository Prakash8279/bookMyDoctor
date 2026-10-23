import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/india_time.dart';
import '../../widgets/admin_record_panel.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class AdminPaymentOperationsScreen extends StatefulWidget {
  const AdminPaymentOperationsScreen({super.key});

  @override
  State<AdminPaymentOperationsScreen> createState() =>
      _AdminPaymentOperationsScreenState();
}

class _AdminPaymentOperationsScreenState
    extends State<AdminPaymentOperationsScreen> {
  late Future<List<ApiResponse>> _future = _load();
  String? _retrying;

  Future<List<ApiResponse>> _load() => Future.wait([
        ApiClient.instance
            .getAll('/payments/refunds', query: {'pageSize': 100}),
        ApiClient.instance
            .getAll('/payments/reconciliation', query: {'pageSize': 100}),
      ]);

  void _refresh() => setState(() {
        _future = _load();
      });

  Future<void> _retry(String id) async {
    setState(() => _retrying = id);
    try {
      await ApiClient.instance.post('/payments/refunds/$id/retry');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Refund retry submitted.')));
      _refresh();
    } catch (error) {
      if (mounted) showErrorSnack(context, error);
    } finally {
      if (mounted) setState(() => _retrying = null);
    }
  }

  String _money(dynamic value) =>
      '₹${(num.tryParse(value?.toString() ?? '') ?? 0).toStringAsFixed(2)}';

  @override
  Widget build(BuildContext context) => Column(children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(
              title: 'Refunds & reconciliation',
              subtitle:
                  'Monitor gateway refunds, retry failures, and review ledger mismatches.'),
        ),
        Expanded(
            child: FutureBuilder<List<ApiResponse>>(
                future: _future,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snapshot.hasError) {
                    return Padding(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        child: ErrorBanner(
                            error: snapshot.error!, onRetry: _refresh));
                  }
                  final refunds = snapshot.data![0].list;
                  final reconciliation = snapshot.data![1].list;
                  final kpi =
                      snapshot.data![1].kpi ?? const <String, dynamic>{};
                  return RefreshIndicator(
                    onRefresh: () async => _refresh(),
                    child: ListView(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        children: [
                          Wrap(
                              spacing: AppSpacing.sm,
                              runSpacing: AppSpacing.sm,
                              children: [
                                _Metric(
                                    label: 'Payments (overall)',
                                    value:
                                        '${kpi['totalPayments'] ?? reconciliation.length}'),
                                _Metric(
                                    label: 'Refund pending (overall)',
                                    value: '${kpi['refundPendingCount'] ?? 0}'),
                                _Metric(
                                    label: 'Refund failed (overall)',
                                    value: '${kpi['refundFailedCount'] ?? 0}'),
                                _Metric(
                                    label: 'Unreconciled',
                                    value: '${kpi['unreconciledCount'] ?? 0}'),
                              ]),
                          const SizedBox(height: AppSpacing.md),
                          const Text('Refund queue',
                              style: TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.w700)),
                          const SizedBox(height: AppSpacing.sm),
                          if (refunds.isEmpty)
                            const EmptyStateView(
                                icon: Icons.currency_exchange,
                                title: 'No refunds')
                          else
                            AdminRecordPanel<Map<String, dynamic>>(
                                items: refunds,
                                shrinkWrap: true,
                                dateOf: (row) => row['createdAt']?.toString(),
                                filename: 'refunds',
                                headers: const [
                                  'ID',
                                  'Created (IST)',
                                  'Booking ID',
                                  'Amount',
                                  'Status',
                                  'Gateway refund ID',
                                  'Failure reason'
                                ],
                                rowOf: (row) => [
                                      row['id'],
                                      indiaTimestamp(
                                          row['createdAt']?.toString()),
                                      row['appointment']?['id'],
                                      row['amount'],
                                      row['status'],
                                      row['gatewayRefundId'],
                                      row['failureReason']
                                    ],
                                itemBuilder: (context, row, index) {
                                  final appointment = row['appointment'] is Map
                                      ? row['appointment'] as Map
                                      : const {};
                                  final patient = appointment['patient'] is Map
                                      ? appointment['patient'] as Map
                                      : const {};
                                  final status =
                                      row['status']?.toString() ?? 'pending';
                                  return Padding(
                                      padding: const EdgeInsets.only(
                                          bottom: AppSpacing.sm),
                                      child: SectionCard(
                                        title: patient['name']?.toString() ??
                                            'Refund',
                                        child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                  '${_money(row['amount'])} · Booking ${appointment['id'] ?? '—'}'),
                                              const SizedBox(height: 8),
                                              StatusBadge(status: status),
                                              if ((row['failureReason']
                                                          ?.toString() ??
                                                      '')
                                                  .isNotEmpty) ...[
                                                const SizedBox(height: 8),
                                                Text(
                                                    row['failureReason']
                                                        .toString(),
                                                    style: TextStyle(
                                                        color: context
                                                            .palette.danger))
                                              ],
                                              if (status != 'processed') ...[
                                                const SizedBox(height: 8),
                                                TextButton(
                                                    onPressed: _retrying ==
                                                            row['id']
                                                        ? null
                                                        : () => _retry(row['id']
                                                            .toString()),
                                                    child: Text(
                                                        _retrying == row['id']
                                                            ? 'Retrying…'
                                                            : 'Retry refund'))
                                              ],
                                            ]),
                                      ));
                                }),
                          const SizedBox(height: AppSpacing.md),
                          const Text('Reconciliation',
                              style: TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.w700)),
                          const SizedBox(height: AppSpacing.sm),
                          AdminRecordPanel<Map<String, dynamic>>(
                              items: reconciliation,
                              shrinkWrap: true,
                              dateOf: (row) => row['createdAt']?.toString(),
                              filename: 'reconciliation',
                              headers: const [
                                'ID',
                                'Created (IST)',
                                'Receipt',
                                'Patient',
                                'Amount',
                                'Status',
                                'Category'
                              ],
                              rowOf: (row) => [
                                    row['id'],
                                    indiaTimestamp(
                                        row['createdAt']?.toString()),
                                    row['receiptNumber'],
                                    row['patient']?['name'],
                                    row['amount'],
                                    row['status'],
                                    row['reconciliationCategory']
                                  ],
                              itemBuilder: (context, row, index) => Padding(
                                  padding: const EdgeInsets.only(
                                      bottom: AppSpacing.sm),
                                  child: SectionCard(
                                    title: row['receiptNumber']?.toString() ??
                                        'Payment',
                                    child: Row(children: [
                                      Expanded(
                                          child: Text(
                                              '${_money(row['amount'])} · ${row['patient']?['name'] ?? 'Patient'}')),
                                      StatusBadge(
                                          status: row['reconciliationCategory']
                                                  ?.toString() ??
                                              'unreconciled')
                                    ]),
                                  ))),
                        ]),
                  );
                })),
      ]);
}

class _Metric extends StatelessWidget {
  final String label;
  final String value;
  const _Metric({required this.label, required this.value});

  @override
  Widget build(BuildContext context) => Container(
        width: 145,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
            color: context.palette.surface,
            borderRadius: BorderRadius.circular(AppRadius.card),
            border: Border.all(color: context.palette.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label,
              style: TextStyle(
                  color: context.palette.textSecondary, fontSize: 12)),
          const SizedBox(height: 4),
          Text(value,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 22))
        ]),
      );
}
