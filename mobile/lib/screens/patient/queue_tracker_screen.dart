import 'dart:async';
import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// One patient's live position in today's queue for a single appointment.
/// Mirrors GET /queue/mine/:appointmentId's response shape exactly (see
/// server/server/src/modules/queue/queue.service.js#getMyQueueStatus):
/// `token`/`status`/`nowServing`/`patientsAhead`/`estimatedWaitMinutes` are
/// ALL null together when the appointment never reached the queue yet
/// (payment still pending) or was cancelled/no_show before being called —
/// that's not an error, it just means there is nothing live to show.
class MyQueueStatus {
  final int? token;
  final String? status; // waiting|called|in_consultation|completed
  final int? nowServing;
  final int? patientsAhead;
  final int? estimatedWaitMinutes;

  MyQueueStatus({
    this.token,
    this.status,
    this.nowServing,
    this.patientsAhead,
    this.estimatedWaitMinutes,
  });

  bool get hasActiveQueue => token != null;

  factory MyQueueStatus.fromJson(Map<String, dynamic> json) => MyQueueStatus(
        token: json['token'] == null ? null : asInt(json['token']),
        status: json['status'] as String?,
        nowServing: json['nowServing'] == null ? null : asInt(json['nowServing']),
        patientsAhead: json['patientsAhead'] == null ? null : asInt(json['patientsAhead']),
        estimatedWaitMinutes: json['estimatedWaitMinutes'] == null ? null : asInt(json['estimatedWaitMinutes']),
      );
}

/// Patient-facing live queue tracker for a single appointment — the mobile
/// equivalent of the website's `QueueTracker` (client/src/pages/PortalSectionPages.jsx,
/// mounted at /patient/queue). Reached via `Navigator.push` from
/// [PatientAppointmentsScreen] rather than a bottom-nav tab, since it only
/// ever makes sense scoped to one specific appointment's token — hence its
/// own Scaffold+AppBar here instead of the bare-body pattern role tab
/// screens use.
///
/// Polls GET /queue/mine/:appointmentId every 15 seconds while this screen
/// stays open, same cadence as the website's widget, since the whole point
/// of this screen is watching a live token move without the patient having
/// to manually pull-to-refresh.
class QueueTrackerScreen extends StatefulWidget {
  final String? appointmentId;
  final bool embedded;
  const QueueTrackerScreen({super.key, this.appointmentId, this.embedded = false});

  @override
  State<QueueTrackerScreen> createState() => _QueueTrackerScreenState();
}

class _QueueTrackerScreenState extends State<QueueTrackerScreen> with WidgetsBindingObserver {
  MyQueueStatus? _status;
  String? _resolvedAppointmentId;
  Object? _error;
  bool _loading = true;
  Timer? _pollTimer;
  bool _isPaused = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _resolvedAppointmentId = widget.appointmentId;
    _load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      _isPaused = true;
      _pollTimer?.cancel();
    } else if (state == AppLifecycleState.resumed) {
      _isPaused = false;
      if (mounted) _load();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _status == null;
      _error = null;
    });
    try {
      String? targetId = _resolvedAppointmentId;
      if (targetId == null) {
        final res = await ApiClient.instance.get('/appointments', query: {'pageSize': 20});
        final appts = res.list.where((a) {
          final s = a['status'] as String?;
          return s == 'upcoming' || s == 'confirmed';
        }).toList();
        if (appts.isNotEmpty) {
          targetId = appts.first['id'] as String?;
          _resolvedAppointmentId = targetId;
        }
      }

      if (targetId != null) {
        final res = await ApiClient.instance.get('/queue/mine/$targetId');
        if (!mounted) return;
        setState(() {
          _status = MyQueueStatus.fromJson(res.map);
          _loading = false;
        });
      } else {
        if (!mounted) return;
        setState(() {
          _status = null;
          _loading = false;
        });
      }
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err;
        _loading = false;
      });
    }
    _schedulePoll();
  }

  void _schedulePoll() {
    _pollTimer?.cancel();
    if (_isPaused || !mounted) return;
    _pollTimer = Timer(const Duration(seconds: 15), () {
      if (!mounted || _isPaused) return;
      _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.embedded) {
      return RefreshIndicator(
        onRefresh: _load,
        child: _buildBody(),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Live queue tracker')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading && _status == null) {
      return const LoadingView();
    }
    if (_error != null && _status == null) {
      return ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          ErrorBanner(error: _error!, onRetry: _load),
        ],
      );
    }

    final status = _status;
    if (status == null || !status.hasActiveQueue) {
      return ListView(
        children: const [
          SizedBox(height: 96),
          EmptyStateView(
            icon: Icons.hourglass_empty,
            title: 'No active queue',
            subtitle: 'Your live token will appear here after this appointment is checked in.',
          ),
        ],
      );
    }

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        const PageHeader(
          title: 'Live queue tracker',
          subtitle: 'Follow your real token and consultation status.',
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              children: [
                const Text(
                  'YOUR TOKEN',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  '#${status.token}',
                  style: const TextStyle(fontSize: 48, fontWeight: FontWeight.w800, color: AppColors.primaryDark),
                ),
                const SizedBox(height: AppSpacing.sm),
                if (status.status != null) StatusBadge(status: status.status!),
                if (status.nowServing != null) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Text('Now serving token #${status.nowServing}', style: const TextStyle(color: AppColors.textSecondary)),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        // StatCard (not a plain SectionCard+Text) so these two numbers carry the same visual
        // weight as every other key-metric pair in the app (mirrors web's LiveQueueWidget, which
        // gives "Patients ahead"/"Estimated wait" their own stat tiles alongside the token).
        Row(
          children: [
            Expanded(
              child: StatCard(
                label: 'Patients ahead',
                value: status.patientsAhead != null ? '${status.patientsAhead}' : '—',
                icon: Icons.groups_outlined,
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: StatCard(
                label: 'Estimated wait',
                value: status.estimatedWaitMinutes != null ? '${status.estimatedWaitMinutes} min' : '—',
                icon: Icons.timer_outlined,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        const SectionCard(
          title: 'What each status means',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _StatusExplainer(
                label: 'Waiting',
                description: 'your token has joined the line; "Patients ahead" shows how many are before you.',
              ),
              SizedBox(height: AppSpacing.sm),
              _StatusExplainer(
                label: 'Called',
                description: "the clinic has called your token; please head to the doctor's room.",
              ),
              SizedBox(height: AppSpacing.sm),
              _StatusExplainer(
                label: 'In consultation',
                description: "you're currently with the doctor.",
              ),
              SizedBox(height: AppSpacing.sm),
              _StatusExplainer(
                label: 'Completed',
                description: 'your visit for today is done.',
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _StatusExplainer extends StatelessWidget {
  final String label;
  final String description;
  const _StatusExplainer({required this.label, required this.description});

  @override
  Widget build(BuildContext context) {
    return RichText(
      text: TextSpan(
        style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4),
        children: [
          TextSpan(text: '$label — ', style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700)),
          TextSpan(text: description),
        ],
      ),
    );
  }
}
