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

  Future<void> _payNow() async {
    setState(() {
      _error = null;
      _payingNow = true;
    });
    try {
      final res = await ApiClient.instance.post('/payments/razorpay/order', body: {
        'appointmentId': _appointment.id,
        'paymentOption': 'full',
      });
      final order = res.map;
      _razorpay.open({
        'key': order['keyId'],
        'amount': order['amount'],
        'currency': order['currency'],
        'order_id': order['orderId'],
        'name': 'BookMyDoctor24',
        'description': 'Consultation with ${_appointment.doctor?.name ?? "doctor"}',
        // Web's Razorpay Checkout uses AppColors.primary's exact hex (see
        // PatientPages.jsx#Booking's payNow: theme:{color:'#ad5d3b'}) — this
        // previously hardcoded '#EA580C', the old pre-rebrand orange that
        // app_theme.dart's own header comment calls out as no longer matching
        // anything in the app, so the one native-styled part of this screen
        // (the Razorpay widget itself, which can't read Flutter theme data)
        // silently broke brand consistency right at the moment of payment.
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
      // Backend returns the authoritative, freshly re-fetched appointment (status may have just
      // flipped pending_payment -> upcoming, with a newly-minted token number) — trust that
      // instead of guessing the new shape ourselves, same as the web client does.
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
    final paid = _appointment.status != 'pending_payment';
    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: paid
              ? Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const PageHeader(
                      title: 'Appointment booked',
                      subtitle: 'Your booking has been confirmed.',
                    ),
                    const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 56),
                    const SizedBox(height: AppSpacing.md),
                    const Text('Booking confirmed', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                    const SizedBox(height: AppSpacing.sm),
                    Text('Token number: ${_appointment.tokenNumber ?? "—"}', style: const TextStyle(fontSize: 16)),
                    const SizedBox(height: AppSpacing.lg),
                    PrimaryButton(label: 'Done', onPressed: () => Navigator.of(context).pop(_appointment)),
                  ],
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
                          Text('${_appointment.doctor?.name ?? "—"} · ${_appointment.appointmentDate}'),
                          const SizedBox(height: AppSpacing.sm),
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
                    // Mirrors web's inner "rounded-button bg-surface p-4" fee box inside the same
                    // pending_payment card (PatientPages.jsx#Booking) — same "Full consultation
                    // amount" label wording, amount, and its own Pay button, rather than a bare
                    // Row + button floating in the page padding.
                    SectionCard(
                      title: 'Full consultation amount',
                      trailing: Text('₹${total.toStringAsFixed(0)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                      child: PrimaryButton(label: 'Pay ₹${total.toStringAsFixed(0)} now', onPressed: _payNow, loading: _payingNow),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
