import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

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
    _load();
  }

  void _load() {
    final dateStr = DateFormat('yyyy-MM-dd').format(_date);
    setState(() {
      _future = ApiClient.instance
          .get('/queue', query: {'date': dateStr, 'pageSize': 100})
          .then((res) => res.list.map(QueueTokenItem.fromJson).toList());
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
            child: Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _pickDate,
                icon: const Icon(Icons.calendar_today_outlined, size: 16),
                label: Text(DateFormat('dd MMM yyyy').format(_date)),
              ),
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
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
                    itemCount: tokens.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final t = tokens[i];
                      final next = _nextStatus(t.status);
                      final busy = _busyIds.contains(t.id);
                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          child: Row(
                            children: [
                              CircleAvatar(
                                backgroundColor: AppColors.primary.withOpacity(0.1),
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
                                OutlinedButton(onPressed: () => _advance(t), child: Text(_actionLabel(next))),
                            ],
                          ),
                        ),
                      );
                    },
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
