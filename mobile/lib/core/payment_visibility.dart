import '../models/clinical_models.dart';

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
