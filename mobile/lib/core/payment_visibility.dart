import 'package:flutter/material.dart';

import '../models/clinical_models.dart';
import '../theme/app_theme.dart';

/// Ports client/src/lib/paymentVisibility.js (COMPLETENESS FIX, mobile parity audit) — the only
/// reliable signal distinguishing a patient's own Razorpay payment made at booking time from a
/// payment collected in person at the clinic: both share `mode == 'online'` server-side, but a
/// Razorpay payment id always starts with `pay_`, while a receptionist typing "online" by hand at
/// the clinic never types a `pay_`-prefixed reference. Used to split payment/report totals into
/// "paid online at booking" vs "collected at clinic" everywhere the web app does this split
/// (receptionist Payments + Reports screens).
final RegExp _razorpayIdPattern = RegExp(r'^pay_', caseSensitive: false);

bool isOnlineBookingPayment(PaymentItem payment) {
  return payment.mode.toLowerCase() == 'online' && _razorpayIdPattern.hasMatch(payment.transactionRef ?? '');
}

/// The amount staff ever see per payment — masked to the doctor's own consultation fee, mirroring
/// client/src/lib/paymentVisibility.js's `doctorCharge` (mandatory rule 8: staff never see
/// totalAmount/GST/convenience-fee/platform-commission breakdown, only their own consultation fee).
double clinicAmount(PaymentItem payment) {
  return payment.fees.consultationFee ?? payment.fees.amount ?? 0;
}

/// Ports components/PaymentSourceBadge.jsx (COMPLETENESS FIX, mobile parity audit, patient panel)
/// — a small "At booking" / "At clinic" tag shown next to a payment's mode, per the same user
/// request quoted in that component's own comment ("...ye sab patient setion me v add kro..."):
/// web shows this on the receptionist/doctor Payments table, the patient's own Payments table,
/// and admin's Revenue report — this widget is the shared mobile equivalent for all of them.
class PaymentSourceBadge extends StatelessWidget {
  final PaymentItem payment;
  const PaymentSourceBadge({super.key, required this.payment});

  @override
  Widget build(BuildContext context) {
    if (payment.mode.isEmpty) return const SizedBox.shrink();
    final atBooking = isOnlineBookingPayment(payment);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: atBooking ? AppColors.teal.withValues(alpha: 0.15) : AppColors.border.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        atBooking ? 'At booking' : 'At clinic',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: atBooking ? AppColors.tealDark : AppColors.textSecondary,
        ),
      ),
    );
  }
}
