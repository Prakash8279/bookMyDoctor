import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Small full-width bar shown while the device has no network connectivity at all, hidden again
/// the moment connectivity_plus reports a connection. Meant to be mounted once near the top of a
/// screen's body (see lib/widgets/role_scaffold.dart) so a signed-in user gets an immediate,
/// obvious "you're offline" hint instead of only finding out once some action fails.
///
/// This only WATCHES the device's own network interfaces; it does NOT verify the connection can
/// actually reach our backend — a phone can show "connected" on a wifi network with no real
/// internet behind it, and this banner will stay hidden in that case. Real request failures are
/// still surfaced separately by each screen's own ErrorBanner (see ApiClient's "Cannot reach the
/// server" message in core/api_client.dart) — this widget is just a cheap, immediate signal on
/// top of that, same intent as the web app's own browser online/offline handling.
class ConnectivityBanner extends StatefulWidget {
  const ConnectivityBanner({super.key});

  @override
  State<ConnectivityBanner> createState() => _ConnectivityBannerState();
}

class _ConnectivityBannerState extends State<ConnectivityBanner> {
  final Connectivity _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    _checkInitial();
    _subscription = _connectivity.onConnectivityChanged.listen(
      _handleResult,
      onError: (_) {
        // Mirrors `_checkInitial()`'s own defensive try/catch around the same plugin's
        // `checkConnectivity()` call — if the connectivity_plus platform channel/EventChannel is
        // ever unavailable, swallow the error and leave the banner hidden rather than let it
        // propagate as an unhandled stream error (this widget's own doc comment above promises
        // exactly that "leave the banner hidden rather than crash" behavior).
      },
    );
  }

  Future<void> _checkInitial() async {
    try {
      final result = await _connectivity.checkConnectivity();
      _handleResult(result);
    } catch (_) {
      // No platform implementation reachable (e.g. this widget mounted somewhere with no
      // connectivity_plus platform channel available, such as a plain widget test) — leave the
      // banner hidden rather than crash the screen over a status check that isn't essential to
      // using the app.
    }
  }

  // connectivity_plus v5+ reports a `List<ConnectivityResult>` (a device can have more than one
  // active interface at once, e.g. wifi + a VPN) rather than a single result — "offline" means
  // every reported interface is `ConnectivityResult.none`, not just the first one.
  void _handleResult(List<ConnectivityResult> result) {
    if (!mounted) return;
    setState(() => _offline = result.every((r) => r == ConnectivityResult.none));
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_offline) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      color: AppColors.danger,
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: AppSpacing.md),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.wifi_off_rounded, color: Colors.white, size: 16),
          SizedBox(width: 6),
          Text(
            'No internet connection',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
