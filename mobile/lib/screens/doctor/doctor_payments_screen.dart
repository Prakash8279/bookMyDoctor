import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/payment_visibility.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Ports client/src/lib/format.js's shortId() exactly — see appointments_screen.dart's copy for
/// the same rationale (a private per-file helper, matching this codebase's existing convention).
String _shortId(String id) {
  final tail = id.contains('_') ? id.split('_').last : id;
  return '#${tail.length > 4 ? tail.substring(tail.length - 4) : tail}';
}

/// Read-only for the doctor — POST /payments is receptionist/admin/
/// superadmin only (integration_plan.md §1.12). Fee masking applies here
/// too: a doctor only ever sees `fees.consultationFee`, never convenience/
/// GST/total/commission — those keys are simply absent, not null.
class DoctorPaymentsScreen extends StatelessWidget {
  const DoctorPaymentsScreen({super.key});

  Future<List<PaymentItem>> _load() async {
    try {
      final res = await ApiClient.instance.get('/payments', query: {'pageSize': 50});
      final list = <PaymentItem>[];
      for (final item in res.list) {
        try { list.add(PaymentItem.fromJson(item)); } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  @override
  Widget build(BuildContext context) {
    return AsyncScreen<List<PaymentItem>>(
      load: _load,
      isEmpty: (list) => list.isEmpty,
      emptyIcon: Icons.receipt_long_outlined,
      emptyTitle: 'No payments recorded yet',
      // COMPLETENESS FIX (mobile parity — consistency): every sibling doctor screen shows a
      // PageHeader with a title/subtitle before its list; this one previously jumped straight
      // into the list with no page title at all.
      builder: (context, payments) => Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Payments',
              subtitle: 'Payments recorded for your consultations.',
            ),
          ),
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: payments.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, i) {
                final p = payments[i];
                return Card(
                  child: ListTile(
                    title: Text(p.patient?.name ?? 'Patient'),
                    // COMPLETENESS FIX (mobile parity audit round 2, doctor panel): web's payments
                    // table (embedded in AdminPages.jsx#RevenueReports, doctorOnly branch) also
                    // shows the Booking ID (shortId of the appointment) and an "At booking"/
                    // "At clinic" PaymentSourceBadge next to the mode — both were missing here.
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
                        if (p.fees.consultationFee != null) Text('₹${p.fees.consultationFee!.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        StatusBadge(status: p.status),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
