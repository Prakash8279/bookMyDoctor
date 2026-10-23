import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import '../models/clinical_models.dart';

bool isConfirmedPayment(Appointment appointment) =>
    ['upcoming', 'confirmed', 'completed'].contains(appointment.status) &&
    appointment.tokenNumber != null &&
    (['paid', 'partial'].contains(appointment.paymentStatus) ||
        appointment.fees.totalAmount == 0);

/// Reuses the same signed payment response; retries never create another order/charge.
class PaymentVerificationController extends ChangeNotifier {
  PaymentVerificationController(
      {required this.verify,
      required this.fetch,
      required this.onConfirmed,
      DateTime Function()? now})
      : now = now ?? DateTime.now;
  final Future<Appointment> Function() verify;
  final Future<Appointment> Function() fetch;
  final void Function(Appointment) onConfirmed;
  final DateTime Function() now;
  String phase = 'idle';
  int secondsLeft = 60;
  Timer? _timer;
  int _generation = 0;
  bool _disposed = false;
  bool _reading = false;
  bool _verifying = false;
  late DateTime _deadline;

  void start() {
    if (_disposed) return;
    _generation++;
    _timer?.cancel();
    _reading = false;
    _verifying = false;
    _deadline = now().add(const Duration(minutes: 1));
    secondsLeft = 60;
    phase = 'verifying';
    notifyListeners();
    _request(fetch, false);
    _request(verify, true);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      secondsLeft = math.max(
          0, (_deadline.difference(now()).inMilliseconds / 1000).ceil());
      if (secondsLeft == 0) {
        phase = 'pending';
        timer.cancel();
      } else {
        if (timer.tick % 3 == 0) _request(fetch, false);
        if (timer.tick % 6 == 0) _request(verify, true);
      }
      if (!_disposed) notifyListeners();
    });
  }

  Future<void> _request(
      Future<Appointment> Function() request, bool signed) async {
    if (_disposed || phase != 'verifying' || (signed ? _verifying : _reading)) {
      return;
    }
    final generation = _generation;
    if (signed) {
      _verifying = true;
    } else {
      _reading = true;
    }
    try {
      final appointment = await request().timeout(const Duration(seconds: 10));
      if (_disposed ||
          generation != _generation ||
          !['verifying', 'pending'].contains(phase)) {
        return;
      }
      if (isConfirmedPayment(appointment)) {
        phase = 'confirmed';
        _timer?.cancel();
        onConfirmed(appointment);
        notifyListeners();
      } else if (appointment.status == 'cancelled') {
        phase = 'cancelled';
        _timer?.cancel();
        notifyListeners();
      }
    } catch (_) {
      // A timeout is not proof of payment failure. Independent polling can reconcile it.
    } finally {
      if (!_disposed && generation == _generation) {
        if (signed) {
          _verifying = false;
        } else {
          _reading = false;
        }
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _timer?.cancel();
    super.dispose();
  }
}
