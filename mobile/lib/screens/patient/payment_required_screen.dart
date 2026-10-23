import 'dart:async';

import 'package:flutter/material.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../../core/api_client.dart';
import '../../core/payment_verification.dart';
import '../../core/india_time.dart';
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
/// Supports the doctor's three booking rules: platform charge only, minimum-or-full choice,
/// and full payment only. The backend remains authoritative for which option is allowed.
class PaymentRequiredScreen extends StatefulWidget {
  final Appointment appointment;
  const PaymentRequiredScreen({super.key, required this.appointment});

  @override
  State<PaymentRequiredScreen> createState() => _PaymentRequiredScreenState();
}

class _PaymentRequiredScreenState extends State<PaymentRequiredScreen> {
  late final Razorpay _razorpay;
  late Appointment _appointment;
  Timer? _clockTimer;
  PaymentVerificationController? _verification;
  bool _payingNow = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _appointment = widget.appointment;
    _clockTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _appointment.status == 'pending_payment') setState(() {});
    });
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError);
  }

  @override
  void dispose() {
    _clockTimer?.cancel();
    _verification?.dispose();
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _payNow([String option = 'full']) async {
    if (_verification != null) return;
    if (_secondsRemaining == 0) {
      setState(() => _error =
          'Your ten-minute payment window expired. Please book an available slot again.');
      return;
    }
    setState(() {
      _error = null;
      _payingNow = true;
    });
    try {
      final res =
          await ApiClient.instance.post('/payments/razorpay/order', body: {
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
        'description':
            'Consultation with ${_appointment.doctor?.name ?? "doctor"}${option == "minimum" ? " · Booking amount" : option == "platform_only" ? " · Platform charge" : ""}',
        'theme': {'color': '#AD5D3B'},
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _payingNow = false;
        _error = err is ApiException
            ? err.message
            : 'Could not start the payment. Please try again.';
      });
    }
  }

  int? get _secondsRemaining {
    final createdAt = DateTime.tryParse(_appointment.createdAt ?? '');
    if (createdAt == null) return null;
    final remainingMs = createdAt
        .add(const Duration(minutes: 10))
        .difference(DateTime.now())
        .inMilliseconds;
    return remainingMs <= 0 ? 0 : (remainingMs + 999) ~/ 1000;
  }

  Future<void> _onPaymentSuccess(PaymentSuccessResponse response) async {
    if (!mounted ||
        _verification?.phase == 'verifying' ||
        isConfirmedPayment(_appointment)) {
      return;
    }
    _verification?.dispose();
    final signed = {
      'appointmentId': _appointment.id,
      'razorpayOrderId': response.orderId,
      'razorpayPaymentId': response.paymentId,
      'razorpaySignature': response.signature,
    };
    final controller = PaymentVerificationController(
      verify: () async {
        final result = await ApiClient.instance
            .post('/payments/razorpay/verify', body: signed);
        return Appointment.fromJson(
            result.map['appointment'] as Map<String, dynamic>);
      },
      fetch: () async => Appointment.fromJson(
          (await ApiClient.instance.get('/appointments/${_appointment.id}'))
              .map),
      onConfirmed: (appointment) {
        if (mounted) {
          setState(() {
            _appointment = appointment;
            _payingNow = false;
          });
        }
      },
    );
    _verification = controller;
    controller.addListener(() {
      if (mounted) setState(() {});
    });
    setState(() {
      _error = null;
      _payingNow = false;
    });
    controller.start();
  }

  void _onPaymentError(PaymentFailureResponse response) {
    // A late checkout error must not replace an in-flight server verification.
    if (!mounted || _verification != null || isConfirmedPayment(_appointment)) {
      return;
    }
    setState(() {
      _payingNow = false;
      _error = response.message?.isNotEmpty == true
          ? response.message
          : 'Payment failed. Please try again.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final total = _appointment.fees.totalAmount ?? 0;
    final minAmount = _appointment.fees.minBookingAmount ?? 0;
    final minRemainder = _appointment.fees.minBookingRemainder ?? 0;
    final paymentPolicy = _appointment.fees.bookingPaymentPolicy ??
        (minAmount > 0 ? 'minimum_or_full' : 'full');
    final platformOnlyAmount = _appointment.fees.platformOnlyBookingAmount ?? 0;
    final paid = isConfirmedPayment(_appointment);
    if (_verification != null && !paid) {
      final controller = _verification!;
      final checking = controller.phase == 'verifying';
      return Scaffold(
        appBar: AppBar(title: const Text('Payment verification')),
        body: SafeArea(
            child: SingleChildScrollView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: SectionCard(
                  title: controller.phase == 'cancelled'
                      ? 'Booking cancelled'
                      : checking
                          ? 'Thank you!'
                          : 'Payment verification pending',
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (checking) ...[
                          const Center(child: CircularProgressIndicator()),
                          const SizedBox(height: 20),
                          const Text('Please wait while we check your payment.',
                              textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          Text(
                              '${controller.secondsLeft ~/ 60}:${(controller.secondsLeft % 60).toString().padLeft(2, '0')}',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                  fontSize: 28, fontWeight: FontWeight.w700)),
                        ],
                        const SizedBox(height: 12),
                        Text(controller.phase == 'cancelled'
                            ? 'This booking was cancelled. Please check your payment history or contact support before paying again.'
                            : 'Your booking confirmation and token will appear after verification. Please do not pay again.'),
                        if (!checking && controller.phase != 'cancelled') ...[
                          const SizedBox(height: 16),
                          PrimaryButton(
                              label: 'Check status again',
                              onPressed: controller.start),
                        ],
                        const SizedBox(height: 12),
                        Text(
                            'Booked on: ${indiaTimestamp(_appointment.createdAt)}',
                            style: const TextStyle(fontSize: 12)),
                        TextButton(
                            onPressed: () => Navigator.of(context).pop(),
                            child: const Text('Back to appointments')),
                      ]),
                ))),
      );
    }
    final expired = _appointment.status == 'cancelled' ||
        (_appointment.status == 'pending_payment' && _secondsRemaining == 0);

    return Scaffold(
      appBar: AppBar(title: Text(paid ? 'Appointment booked' : 'Payment')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: expired
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const PageHeader(
                        title: 'Booking expired',
                        subtitle:
                            'Payment was not completed within ten minutes.'),
                    const SectionCard(
                      title: 'Slot released',
                      child: Text(
                          'No token number was issued. If a payment was captured, its refund will be processed.'),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    PrimaryButton(
                        label: 'Choose another slot',
                        onPressed: () => Navigator.of(context).pop()),
                  ],
                )
              : paid
                  ? Container(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      decoration: BoxDecoration(
                        color: context.palette.surface,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                            color:
                                context.palette.success.withValues(alpha: 0.3)),
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
                              color: context.palette.success
                                  .withValues(alpha: 0.12),
                              shape: BoxShape.circle,
                            ),
                            child: Icon(Icons.check,
                                color: context.palette.success, size: 28),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          Text(
                            'Booking confirmed',
                            style: TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.bold,
                                color: context.palette.textPrimary),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${_appointment.doctor?.displayName ?? "Doctor"} · ${_appointment.appointmentDate}',
                            style: TextStyle(
                                fontSize: 14,
                                color: context.palette.textSecondary),
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          Text(
                            'Token #${_appointment.tokenNumber ?? "—"}',
                            style: TextStyle(
                              fontSize: 32,
                              fontWeight: FontWeight.w800,
                              color: context.palette.primaryDark,
                              letterSpacing: -0.5,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            "You'll be seen in this order after check-in — track live queue status under My Appointments.",
                            style: TextStyle(
                                fontSize: 13,
                                color: context.palette.textSecondary,
                                height: 1.4),
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          Container(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            decoration: BoxDecoration(
                              color: context.palette.surface,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    const Text('Consultation amount',
                                        style: TextStyle(
                                            fontSize: 14,
                                            fontWeight: FontWeight.w500)),
                                    Text('₹${total.toStringAsFixed(0)}',
                                        style: const TextStyle(
                                            fontSize: 18,
                                            fontWeight: FontWeight.bold)),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                if (_appointment.paymentStatus == 'paid')
                                  Row(
                                    children: [
                                      Icon(Icons.check_circle_outline,
                                          size: 16,
                                          color: context.palette.success),
                                      const SizedBox(width: 6),
                                      Text('Paid online',
                                          style: TextStyle(
                                              fontSize: 13,
                                              fontWeight: FontWeight.w600,
                                              color: context.palette.success)),
                                    ],
                                  )
                                else if (_appointment.paymentStatus ==
                                    'partial')
                                  Row(
                                    children: [
                                      Icon(Icons.check_circle_outline,
                                          size: 16,
                                          color: context.palette.success),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: Text(
                                          'Booking amount paid online — balance due at the clinic',
                                          style: TextStyle(
                                              fontSize: 13,
                                              fontWeight: FontWeight.w600,
                                              color: context.palette.success),
                                        ),
                                      ),
                                    ],
                                  )
                                else
                                  Text(
                                      'No online payment was required for this booking.',
                                      style: TextStyle(
                                          fontSize: 12,
                                          color:
                                              context.palette.textSecondary)),
                              ],
                            ),
                          ),
                          const SizedBox(height: AppSpacing.xl),
                          PrimaryButton(
                            label: 'View my appointments',
                            onPressed: () =>
                                Navigator.of(context).pop(_appointment),
                          ),
                        ],
                      ),
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const PageHeader(
                          title: 'Payment required',
                          subtitle:
                              'Pay online to confirm your booking and get your token number.',
                        ),
                        SectionCard(
                          title: 'Payment required to confirm',
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                  '${_appointment.doctor?.displayName ?? "—"} · ${_appointment.appointmentDate}',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w600)),
                              const SizedBox(height: AppSpacing.xs),
                              Text(
                                'Your token number will be issued as soon as payment is received.',
                                style: TextStyle(
                                    color: context.palette.textSecondary),
                              ),
                              const SizedBox(height: AppSpacing.xs),
                              Text(
                                'Complete payment within ten minutes to keep this slot${_secondsRemaining != null ? ' · ${_secondsRemaining! ~/ 60}:${(_secondsRemaining! % 60).toString().padLeft(2, '0')} left' : ''}.',
                                style: TextStyle(
                                    color: context.palette.primaryDark,
                                    fontWeight: FontWeight.w600),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        if (_error != null) ...[
                          ErrorBanner(error: _error!),
                          const SizedBox(height: AppSpacing.md),
                        ],
                        if (paymentPolicy != 'platform_only')
                          SectionCard(
                            title: 'Full consultation amount',
                            trailing: Text('₹${total.toStringAsFixed(0)}',
                                style: const TextStyle(
                                    fontSize: 18, fontWeight: FontWeight.w700)),
                            child: PrimaryButton(
                              label: 'Pay ₹${total.toStringAsFixed(0)} now',
                              onPressed: () => _payNow('full'),
                              loading: _payingNow,
                            ),
                          ),
                        if (paymentPolicy == 'minimum_or_full' &&
                            minAmount > 0) ...[
                          const SizedBox(height: AppSpacing.md),
                          SectionCard(
                            title: 'Minimum booking amount',
                            trailing: Text('₹${minAmount.toStringAsFixed(0)}',
                                style: const TextStyle(
                                    fontSize: 18, fontWeight: FontWeight.w700)),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  'Remaining ₹${minRemainder.toStringAsFixed(0)} to be paid at the clinic.',
                                  style: TextStyle(
                                      fontSize: 12,
                                      color: context.palette.textSecondary),
                                ),
                                const SizedBox(height: AppSpacing.sm),
                                OutlinedButton(
                                  style: OutlinedButton.styleFrom(
                                    side: BorderSide(
                                        color: context.palette.primaryDark),
                                    foregroundColor:
                                        context.palette.primaryDark,
                                    padding: const EdgeInsets.symmetric(
                                        vertical: 14),
                                  ),
                                  onPressed: _payingNow
                                      ? null
                                      : () => _payNow('minimum'),
                                  child: Text(
                                      'Pay ₹${minAmount.toStringAsFixed(0)} now',
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w600)),
                                ),
                              ],
                            ),
                          ),
                        ],
                        if (paymentPolicy == 'platform_only') ...[
                          SectionCard(
                            title: 'Platform charge only',
                            trailing: Text(
                                '₹${platformOnlyAmount.toStringAsFixed(0)}',
                                style: const TextStyle(
                                    fontSize: 18, fontWeight: FontWeight.w700)),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  'No doctor advance is charged online. Consultation fee is payable at the clinic.',
                                  style: TextStyle(
                                      fontSize: 12,
                                      color: context.palette.textSecondary),
                                ),
                                const SizedBox(height: AppSpacing.sm),
                                PrimaryButton(
                                  label:
                                      'Pay ₹${platformOnlyAmount.toStringAsFixed(0)} now',
                                  onPressed: () => _payNow('platform_only'),
                                  loading: _payingNow,
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
