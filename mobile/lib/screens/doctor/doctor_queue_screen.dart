import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

// BUG FIX (mobile parity audit): web's booking-source label (StaffPages.jsx `bookingLabel`) —
// used both for the badge on each queue card and the CSV export below.
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

/// Doctor's live queue console. Status transitions are strictly sequential
/// and forward-only on the backend (waiting -> called -> in_consultation ->
/// completed, one step at a time) — integration_plan.md §1.9. Completing a
/// token also marks the linked appointment completed server-side, so there
/// is nothing extra to do here for that. Only the single legal "next" action
/// is ever offered per row — skipping/going backward isn't exposed at all.
class DoctorQueueScreen extends StatefulWidget {
  const DoctorQueueScreen({super.key});

  @override
  State<DoctorQueueScreen> createState() => _DoctorQueueScreenState();
}

class _DoctorQueueScreenState extends State<DoctorQueueScreen> {
  DateTime _date = DateTime.now();
  Future<List<QueueTokenItem>>? _future;
  final Set<String> _busyIds = {};

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
    setState(() => _busyIds.add(token.id));
    try {
      await ApiClient.instance.patch('/queue/${token.id}/status', body: {'status': next});
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyIds.remove(token.id));
    }
  }

  // BUG FIX (mobile parity audit): mirrors web's `queueRecordCsv` (StaffPages.jsx) — runs against
  // the FULL unsplit list (active + completed together), not just whichever section is on screen.
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
    final busy = _busyIds.contains(t.id);
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
                  // Phone + clinical vitals — queue.service.js#shapeQueuePatientRef
                  // only ever sends these to a doctor caller (never receptionist).
                  if (t.patient?.phone != null || t.patient?.vitalsSummary != null)
                    Text(
                      [t.patient?.phone, t.patient?.vitalsSummary].whereType<String>().join(' · '),
                      style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
                    ),
                  if (t.patient?.hasHealthNotes ?? false)
                    Text(
                      t.patient!.healthNotesSummary!,
                      style: const TextStyle(fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      StatusBadge(status: t.status),
                      const SizedBox(width: 8),
                      // BUG FIX (mobile parity audit): web's "Booking" column (Online/Walk-in
                      // pill) — `t.source` was already parsed onto the model but never rendered.
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.border.withValues(alpha: 0.5),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(_bookingLabel(t.source), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600)),
                      ),
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
    return Scaffold(
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Live OPD queue',
              subtitle: 'Call patients and update the live waiting line.',
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
                // separate "Completed" table (StaffPages.jsx `activeRows`/`completedRows`) —
                // mobile used to render one flat, unsectioned list.
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
      ),
    );
  }
}
