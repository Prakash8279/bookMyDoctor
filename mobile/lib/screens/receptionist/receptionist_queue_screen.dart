import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

// BUG FIX (mobile parity audit): web's booking-source label (StaffPages.jsx `bookingLabel`),
// used for the CSV export below (mirrors doctor_queue_screen.dart's identical helper).
String _bookingLabel(String? source) {
  switch (source) {
    case 'walk_in':
      return 'Walk-in';
    case 'online':
      return 'Online';
    default:
      return '—';
  }
}

/// Front-desk queue console — same /queue endpoints as the doctor's queue
/// screen, but scoped server-side to the receptionist's own clinicId
/// instead of a single doctor (integration_plan.md §1.9: "receptionist sees
/// only their clinic's [tokens]"). Status transitions remain strictly
/// sequential and forward-only (waiting -> called -> in_consultation ->
/// completed).
class ReceptionistQueueScreen extends StatefulWidget {
  const ReceptionistQueueScreen({super.key});

  @override
  State<ReceptionistQueueScreen> createState() => _ReceptionistQueueScreenState();
}

class _ReceptionistQueueScreenState extends State<ReceptionistQueueScreen> {
  DateTime _date = DateTime.now();
  Future<List<QueueTokenItem>>? _future;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    final dateStr = DateFormat('yyyy-MM-dd').format(_date);
    _future = _fetch(dateStr);
  }

  Future<List<QueueTokenItem>> _fetch(String dateStr) async {
    try {
      final res = await ApiClient.instance
          .get('/queue', query: {'date': dateStr, 'pageSize': 100})
          .catchError((_) => ApiResponse(data: []));
      final list = <QueueTokenItem>[];
      for (final item in res.list) {
        try {
          list.add(QueueTokenItem.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  void _load() {
    final dateStr = DateFormat('yyyy-MM-dd').format(_date);
    setState(() {
      _future = _fetch(dateStr);
    });
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime.now().subtract(const Duration(days: 90)),
      lastDate: DateTime.now().add(const Duration(days: 90)),
    );
    if (picked != null) {
      setState(() => _date = picked);
      _load();
    }
  }

  String? _nextStatus(String current) {
    switch (current) {
      case 'waiting':
        return 'called';
      case 'called':
        return 'in_consultation';
      case 'in_consultation':
        return 'completed';
      default:
        return null;
    }
  }

  String _actionLabel(String next) {
    switch (next) {
      case 'called':
        return 'Call';
      case 'in_consultation':
        return 'Start consultation';
      case 'completed':
        return 'Complete';
      default:
        return next;
    }
  }

  Future<void> _advance(QueueTokenItem token) async {
    final next = _nextStatus(token.status);
    if (next == null) return;
    setState(() => _busyId = token.id);
    try {
      await ApiClient.instance.patch('/queue/${token.id}/status', body: {'status': next});
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  // BUG FIX (mobile parity audit): mirrors web's `queueRecordCsv` (StaffPages.jsx) — runs against
  // the FULL unsplit list (active + completed together).
  Future<void> _exportCsv(List<QueueTokenItem> tokens) async {
    await shareCsv(
      filename: 'queue-records.csv',
      headers: const ['Id', 'Token', 'Patient', 'Status', 'Booking', 'Patients ahead', 'Estimated wait (min)'],
      rows: [
        for (var i = 0; i < tokens.length; i++)
          [
            i + 1,
            '#${tokens[i].tokenNumber}',
            tokens[i].patient?.name ?? '',
            tokens[i].status,
            _bookingLabel(tokens[i].source),
            tokens[i].patientsAhead,
            tokens[i].estimatedWaitMinutes,
          ],
      ],
    );
  }

  Widget _tokenCard(QueueTokenItem t) {
    final next = _nextStatus(t.status);
    final busy = _busyId == t.id;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: AppColors.primary.withValues(alpha: 0.1),
              child: Text(
                '#${t.tokenNumber}',
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12, color: AppColors.primary),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(t.patient?.name ?? 'Patient', style: const TextStyle(fontWeight: FontWeight.w600)),
                  // Front-desk data only — queue.service.js#shapeQueuePatientRef
                  // never sends clinical fields to a receptionist caller, only phone.
                  if (t.patient?.phone != null)
                    Text(t.patient!.phone!, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      StatusBadge(status: t.status),
                      if (t.source != null) ...[
                        const SizedBox(width: 8),
                        Text(t.source!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                      ],
                      if (t.status == 'waiting') ...[
                        const SizedBox(width: 8),
                        Text(
                          '${t.patientsAhead} ahead · ~${t.estimatedWaitMinutes} min',
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            if (busy)
              const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
            else if (next != null)
              OutlinedButton(onPressed: () => _advance(t), child: Text(_actionLabel(next)))
            else if (t.status == 'completed')
              const Icon(Icons.check_circle, color: AppColors.success, size: 20),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // No own Scaffold/AppBar — reached only as a RoleScaffold nav-item body
    // (receptionist_home_screen.dart) or pushed from the dashboard already
    // wrapped in its own Scaffold+AppBar (receptionist_dashboard_screen.dart);
    // either way an outer Scaffold/AppBar already exists, so one here would
    // just duplicate the title bar.
    return Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              kicker: 'Production database',
              title: 'Queue monitor',
              subtitle: 'Operate the clinic waiting line in real time.',
            ),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.sm, AppSpacing.md, 0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'This queue is automatically scoped to your assigned clinic.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today_outlined, size: 16),
                  label: Text(DateFormat('dd MMM yyyy').format(_date)),
                ),
                const Spacer(),
                // COMPLETENESS FIX (mobile parity audit): web's "Export CSV" action
                // (StaffPages.jsx `queueRecordCsv`) had no mobile equivalent.
                FutureBuilder<List<QueueTokenItem>>(
                  future: _future,
                  builder: (context, snapshot) {
                    final tokens = snapshot.data ?? const <QueueTokenItem>[];
                    return TextButton.icon(
                      onPressed: tokens.isEmpty ? null : () => _exportCsv(tokens),
                      icon: const Icon(Icons.file_download_outlined, size: 16),
                      label: const Text('Export CSV'),
                    );
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: FutureBuilder<List<QueueTokenItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: ErrorBanner(error: snapshot.error!, onRetry: _load),
                  );
                }
                final tokens = snapshot.data ?? [];
                if (tokens.isEmpty) {
                  return const EmptyStateView(icon: Icons.people_alt_outlined, title: 'No queue tokens for this date');
                }
                // BUG FIX (mobile parity audit): web splits into a "Live records" table and a
                // separate "Completed" table (StaffPages.jsx) — mobile rendered one flat list.
                final active = tokens.where((t) => t.status != 'completed').toList();
                final completed = tokens.where((t) => t.status == 'completed').toList();
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
                    children: [
                      Text('Live records (${active.length})', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                      const SizedBox(height: AppSpacing.sm),
                      if (active.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
                          child: Text('No live queue tokens right now.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                        )
                      else
                        ...active.map((t) => Padding(padding: const EdgeInsets.only(bottom: AppSpacing.sm), child: _tokenCard(t))),
                      const SizedBox(height: AppSpacing.lg),
                      Text('Completed (${completed.length})', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                      const SizedBox(height: AppSpacing.sm),
                      if (completed.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
                          child: Text('No completed consultations yet.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                        )
                      else
                        ...completed.map((t) => Padding(padding: const EdgeInsets.only(bottom: AppSpacing.sm), child: _tokenCard(t))),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      );
  }
}
