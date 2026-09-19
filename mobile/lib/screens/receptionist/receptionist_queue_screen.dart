import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

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
                      final busy = _busyId == t.id;
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
      );
  }
}
