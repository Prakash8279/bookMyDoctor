import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// This is a read-only history of already-recorded payments (receptionist/admin cash entries,
/// and the patient's own completed online payments). It is deliberately NOT where a patient pays
/// online — that happens inline right after booking, when an appointment needs prepayment (see
/// payment_required_screen.dart, opened from book_appointment_screen.dart). Most bookings never
/// go through that path at all (only a non-zero-fee online booking does), so this screen simply
/// shows whatever has already settled either way.
class PatientPaymentsScreen extends StatelessWidget {
  const PatientPaymentsScreen({super.key});

  Future<List<PaymentItem>> _load() async {
    final res = await ApiClient.instance.get('/payments', query: {'pageSize': 50});
    return res.list.map(PaymentItem.fromJson).toList();
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
            builder: (context, payments) => ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: payments.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, i) {
                final p = payments[i];
                return Card(
                  child: ListTile(
                    title: Text(p.doctor?.name ?? p.clinic?.name ?? 'Payment'),
                    subtitle: Text(
                      '${p.mode.toUpperCase()}${p.receiptNumber != null ? " · #${p.receiptNumber}" : ""}${p.createdAt != null ? " · ${p.createdAt!.split("T").first}" : ""}',
                    ),
                    trailing: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        if (p.fees.amount != null) Text('₹${p.fees.amount!.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        StatusBadge(status: p.status),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}
