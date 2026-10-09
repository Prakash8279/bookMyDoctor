import 'package:flutter/material.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (audit Priority 3 #3 — mobile parity): mobile's payments screen was
/// view-only — a patient whose online booking required prepayment (see
/// appointments.service.js#runBookingJob's `requiresPrepayment` — a non-zero-fee online booking
/// is created `pending_payment` with no token until paid) had no way to pay from the app at all
/// and had to wait for a receptionist or switch to web. Mirrors web's
/// PatientPages.jsx#Booking's payNow('full') flow: POST /payments/razorpay/order -> open
/// Razorpay Checkout -> POST /payments/razorpay/verify with the checkout's response, then trust
/// the freshly re-fetched appointment the backend returns rather than guessing its new shape.
///
/// Only the "pay full amount" path is wired here (not web's separate "pay just the minimum
/// booking amount, rest at the clinic" option) — that second option depends on
/// doctorProfile.minBookingAdvanceAmount, which isn't modelled on mobile's DoctorDirectoryItem
/// yet; flagged as a follow-up rather than bolted on here.
class PaymentRequiredScreen extends StatefulWidget {
  final Appointment appointment;
  const PaymentRequiredScreen({super.key, required this.appointment});

  @override
  State<PaymentRequiredScreen> createState() => _PaymentRequiredScreenState();
}

class _PaymentRequiredScreenState extends State<PaymentRequiredScreen> {
  late final Razorpay _razorpay;
  late Appointment _appointment;
  bool _payingNow = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _appointment = widget.appointment;
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError);
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _payNow([String option = 'full']) async {
    setState(() {
      _error = null;
      _payingNow = true;
    });
    try {
      final res = await ApiClient.instance.post('/payments/razorpay/order', body: {
        'appointmentId': _appointment.id,
        'paymentOption': option,
      });
      final order = res.map;
      _razorpay.open({
        'key': order['keyId'],
        'amount': order['amount'],
        'currency': order['currency'],
        'order_id': order['orderId'],
        'name': 'BookADoctors',
        'description': 'Consultation with ${_appointment.doctor?.name ?? "doctor"}${option == "minimum" ? " · Booking amount" : ""}',
        'theme': {'color': '#AD5D3B'},
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _payingNow = false;
        _error = err is ApiException ? err.message : 'Could not start the payment. Please try again.';
      });
    }
  }

  Future<void> _onPaymentSuccess(PaymentSuccessResponse response) async {
    try {
      final res = await ApiClient.instance.post('/payments/razorpay/verify', body: {
        'appointmentId': _appointment.id,
        'razorpayOrderId': response.orderId,
        'razorpayPaymentId': response.paymentId,
        'razorpaySignature': response.signature,
      });
      final appointment = Appointment.fromJson(res.map['appointment'] as Map<String, dynamic>);
      if (!mounted) return;
      setState(() {
        _appointment = appointment;
        _payingNow = false;
      });
    } catch (err) {
      // PARITY FIX (mobile parity audit — Patient panel): ports the RESUME/RECONCILE fix from
      // useRazorpayPayment.js — Razorpay's success callback only ever fires after the payment has
      // already been captured, so a failure here (timeout, dropped connection, a transient error
      // after the backend's own transaction actually committed) does NOT mean the money wasn't
      // taken. Re-check the appointment's real status before reporting a failure — if it's no
      // longer `pending_payment`, the verify actually succeeded server-side and this was just a
      // lost response; only show the error if the appointment genuinely still needs payment.
      try {
        final fresh = await ApiClient.instance.get('/appointments/${_appointment.id}');
        final freshAppointment = Appointment.fromJson(fresh.map);
        if (freshAppointment.status != 'pending_payment') {
          if (!mounted) return;
          setState(() {
            _appointment = freshAppointment;
            _payingNow = false;
          });
          return;
        }
      } catch (_) {
        // Couldn't even re-check — fall through to showing the original error below.
      }
      if (!mounted) return;
      setState(() {
        _payingNow = false;
        _error = err is ApiException
            ? err.message
            : 'Payment succeeded but could not be verified — please check My Appointments or contact the clinic.';
      });
    }
  }

  void _onPaymentError(PaymentFailureResponse response) {
    if (!mounted) return;
    setState(() {
      _payingNow = false;
      _error = response.message?.isNotEmpty == true ? response.message : 'Payment failed. Please try again.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final total = _appointment.fees.totalAmount ?? 0;
    final minAmount = _appointment.fees.minBookingAmount ?? 0;
    final minRemainder = _appointment.fees.minBookingRemainder ?? 0;
    final paid = _appointment.status != 'pending_payment';

    return Scaffold(
      appBar: AppBar(title: Text(paid ? 'Appointment booked' : 'Payment')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: paid
              ? Container(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.success.withValues(alpha: 0.3)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.04),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: AppColors.success.withValues(alpha: 0.12),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.check, color: AppColors.success, size: 28),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      const Text(
                        'Booking confirmed',
                        style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${_appointment.doctor?.name ?? "Doctor"} · ${_appointment.appointmentDate}',
                        style: const TextStyle(fontSize: 14, color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(
                        'Token #${_appointment.tokenNumber ?? "—"}',
                        style: const TextStyle(
                          fontSize: 32,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primaryDark,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        "You'll be seen in this order after check-in — track live queue status under My Appointments.",
                        style: TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.4),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Container(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text('Consultation amount', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                                Text('₹${total.toStringAsFixed(0)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                              ],
                            ),
                            const SizedBox(height: 8),
                            if (_appointment.paymentStatus == 'paid')
                              const Row(
                                children: [
                                  Icon(Icons.check_circle_outline, size: 16, color: AppColors.success),
                                  SizedBox(width: 6),
                                  Text('Paid online', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.success)),
                                ],
                              )
                            else if (_appointment.paymentStatus == 'partial')
                              const Row(
                                children: [
                                  Icon(Icons.check_circle_outline, size: 16, color: AppColors.success),
                                  SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      'Booking amount paid online — balance due at the clinic',
                                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.success),
                                    ),
                                  ),
                                ],
                              )
                            else
                              const Text('No online payment was required for this booking.', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpacing.xl),
                      PrimaryButton(
                        label: 'View my appointments',
                        onPressed: () => Navigator.of(context).pop(_appointment),
                      ),
                    ],
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const PageHeader(
                      title: 'Payment required',
                      subtitle: 'Pay online to confirm your booking and get your token number.',
                    ),
                    SectionCard(
                      title: 'Payment required to confirm',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${_appointment.doctor?.name ?? "—"} · ${_appointment.appointmentDate}', style: const TextStyle(fontWeight: FontWeight.w600)),
                          const SizedBox(height: AppSpacing.xs),
                          const Text(
                            'Your token number will be issued as soon as payment is received.',
                            style: TextStyle(color: AppColors.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    if (_error != null) ...[
                      ErrorBanner(error: _error!),
                      const SizedBox(height: AppSpacing.md),
                    ],
                    SectionCard(
                      title: 'Full consultation amount',
                      trailing: Text('₹${total.toStringAsFixed(0)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                      child: PrimaryButton(
                        label: 'Pay ₹${total.toStringAsFixed(0)} now',
                        onPressed: () => _payNow('full'),
                        loading: _payingNow,
                      ),
                    ),
                    if (minAmount > 0) ...[
                      const SizedBox(height: AppSpacing.md),
                      SectionCard(
                        title: 'Minimum booking amount',
                        trailing: Text('₹${minAmount.toStringAsFixed(0)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              'Remaining ₹${minRemainder.toStringAsFixed(0)} to be paid at the clinic.',
                              style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: AppColors.primaryDark),
                                foregroundColor: AppColors.primaryDark,
                                padding: const EdgeInsets.symmetric(vertical: 14),
                              ),
                              onPressed: _payingNow ? null : () => _payNow('minimum'),
                              child: Text('Pay ₹${minAmount.toStringAsFixed(0)} now', style: const TextStyle(fontWeight: FontWeight.w600)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
        ),
      ),
    );
  }
}
