import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class PatientPaymentsScreen extends StatelessWidget {
  const PatientPaymentsScreen({super.key});

  Future<List<PaymentItem>> _load() async {
    final res = await ApiClient.instance
        .get('/payments', query: {'pageSize': 50})
        .catchError((_) => ApiResponse(data: []));
    final list = <PaymentItem>[];
    for (final item in res.list) {
      try {
        list.add(PaymentItem.fromJson(item));
      } catch (_) {}
    }
    return list;
  }

  void _showReceipt(BuildContext context, PaymentItem item) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _PaymentReceiptSheet(payment: item),
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
          child: AsyncScreen<List<PaymentItem>>(
            load: _load,
            isEmpty: (list) => list.isEmpty,
            emptyIcon: Icons.receipt_long_outlined,
            emptyTitle: 'No payments yet',
            emptySubtitle: 'Payments are recorded by the clinic reception after your visit',
            builder: (context, payments) {
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
                    Card(
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
                                      Text(
                                        'Mode: ${p.mode.toUpperCase()}${p.createdAt != null ? " · ${p.createdAt!.split("T").first}" : ""}',
                                        style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
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
                                  onPressed: () => _showReceipt(context, p),
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
                    ),
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
}

class _PaymentReceiptSheet extends StatelessWidget {
  final PaymentItem payment;
  const _PaymentReceiptSheet({required this.payment});

  @override
  Widget build(BuildContext context) {
    final amount = payment.fees.amount ?? 0;
    final isPaid = payment.status == 'paid';

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
            _buildSection(
              title: 'Transaction Details',
              rows: [
                MapEntry('Receipt No', payment.receiptNumber ?? (payment.id.length > 8 ? payment.id.substring(0, 8) : payment.id)),
                if (payment.transactionRef != null && payment.transactionRef!.isNotEmpty)
                  MapEntry('Reference ID', payment.transactionRef!),
                if (payment.createdAt != null)
                  MapEntry('Date', payment.createdAt!.split('T').first),
                MapEntry('Payment Mode', payment.mode.toUpperCase()),
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
            PrimaryButton(
              label: 'Done',
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection({required String title, required List<MapEntry<String, String>> rows}) {
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
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(row.key, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                  Flexible(
                    child: Text(
                      row.value,
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis,
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

