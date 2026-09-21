import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Clinic approval queue — unlike doctors, this one has a real working
/// backing endpoint: `GET /clinics?approvalStatus=pending` is honored for
/// admin/superadmin (integration_plan.md §1.5). Tabs switch between the
/// pending queue and the full clinic list.
class AdminClinicsScreen extends StatefulWidget {
  final int initialTabIndex;
  final bool verificationOnly;
  const AdminClinicsScreen({
    super.key,
    this.initialTabIndex = 0,
    this.verificationOnly = false,
  });

  @override
  State<AdminClinicsScreen> createState() => _AdminClinicsScreenState();
}

class _AdminClinicsScreenState extends State<AdminClinicsScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabController = TabController(
    length: 2,
    vsync: this,
    initialIndex: widget.initialTabIndex.clamp(0, 1),
  );
  Future<List<Clinic>>? _pendingFuture;
  Future<List<Clinic>>? _allFuture;
  String? _busyId;
  String? _busyKey;

  @override
  void initState() {
    super.initState();
    _pendingFuture = _fetchPending();
    _allFuture = _fetchAll();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<List<Clinic>> _fetchPending() async {
    try {
      final res = await ApiClient.instance
          .get('/clinics', query: {'approvalStatus': 'pending', 'pageSize': 100})
          .catchError((_) => ApiResponse(data: []));
      final list = <Clinic>[];
      for (final item in res.list) {
        try {
          list.add(Clinic.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  Future<List<Clinic>> _fetchAll() async {
    try {
      final res = await ApiClient.instance
          .get('/clinics', query: {'pageSize': 100})
          .catchError((_) => ApiResponse(data: []));
      final list = <Clinic>[];
      for (final item in res.list) {
        try {
          list.add(Clinic.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  void _load() {
    setState(() {
      _pendingFuture = _fetchPending();
      _allFuture = _fetchAll();
    });
  }

  Future<void> _approve(Clinic c) async {
    setState(() => _busyId = c.id);
    try {
      await ApiClient.instance.patch('/clinics/${c.id}/approve');
      if (mounted) showSuccessSnack(context, 'Clinic approved');
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _reject(Clinic c) async {
    final reasonCtrl = TextEditingController();
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text('Reject ${c.name}?'),
          content: TextField(controller: reasonCtrl, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason (5-1000 chars)')),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Reject')),
          ],
        ),
      );
      if (confirmed != true) return;
      if (reasonCtrl.text.trim().length < 5) {
        if (mounted) showErrorSnack(context, 'Reason must be at least 5 characters');
        return;
      }
      setState(() => _busyId = c.id);
      try {
        await ApiClient.instance.patch('/clinics/${c.id}/reject', body: {'rejectionReason': reasonCtrl.text.trim()});
        if (mounted) showSuccessSnack(context, 'Clinic rejected');
        _load();
      } catch (err) {
        if (mounted) showErrorSnack(context, err);
      } finally {
        if (mounted) setState(() => _busyId = null);
      }
    } finally {
      reasonCtrl.dispose();
    }
  }

  // Mirrors web's `toggleClinicStatus` (AdminPages.jsx / useAppStore.js) — there's no
  // dedicated status endpoint, so "disable" reuses `/reject` and "enable" reuses `/approve`.
  Future<void> _toggleStatus(Clinic c) async {
    final disabling = c.approvalStatus != 'disabled';
    if (disabling) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text('Disable ${c.name}?'),
          content: const Text('Disabled clinics are hidden from patients and cannot take new bookings.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Disable')),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    setState(() => _busyKey = '${c.id}:status');
    try {
      if (disabling) {
        await ApiClient.instance.patch('/clinics/${c.id}/reject', body: {'rejectionReason': 'Disabled by admin.'});
      } else {
        await ApiClient.instance.patch('/clinics/${c.id}/approve');
      }
      if (mounted) showSuccessSnack(context, disabling ? 'Clinic disabled' : 'Clinic enabled');
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  // Mirrors web's `toggleClinicEmergency` — PATCH /clinics/:id with the flipped
  // `emergencyAvailable` boolean (the general clinic-update endpoint; no dedicated toggle route).
  Future<void> _toggleEmergency(Clinic c) async {
    final next = !c.emergencyAvailable;
    setState(() => _busyKey = '${c.id}:emergency');
    try {
      await ApiClient.instance.patch('/clinics/${c.id}', body: {'emergencyAvailable': next});
      if (mounted) showSuccessSnack(context, next ? 'Emergency availability enabled' : 'Emergency availability disabled');
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  Widget _list(Future<List<Clinic>>? future, {required bool showActions, bool showManageActions = false}) {
    return FutureBuilder<List<Clinic>>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
        if (snapshot.hasError) {
          return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
        }
        final clinics = snapshot.data ?? [];
        if (clinics.isEmpty) {
          return EmptyStateView(icon: Icons.local_hospital_outlined, title: showActions ? 'No clinics awaiting approval' : 'No clinics found');
        }
        return RefreshIndicator(
          onRefresh: () async => _load(),
          child: ListView.separated(
            padding: const EdgeInsets.all(AppSpacing.md),
            itemCount: clinics.length,
            separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
            itemBuilder: (context, i) {
              final c = clinics[i];
              final busy = _busyId == c.id;
              return Card(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700))),
                          StatusBadge(status: c.approvalStatus),
                        ],
                      ),
                      if (c.address != null) Text(c.address!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                      if (c.city != null)
                        Text('${c.city!.name}${c.area != null ? ", ${c.area!.name}" : ""}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                      if (busy) ...[
                        const SizedBox(height: AppSpacing.sm),
                        const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                      ] else if (showActions && c.approvalStatus == 'pending') ...[
                        const SizedBox(height: AppSpacing.sm),
                        Row(
                          children: [
                            OutlinedButton(onPressed: () => _approve(c), child: const Text('Approve')),
                            const SizedBox(width: 8),
                            OutlinedButton(onPressed: () => _reject(c), child: const Text('Reject')),
                          ],
                        ),
                      ],
                      if (showManageActions) ...[
                        const SizedBox(height: AppSpacing.sm),
                        const Divider(height: 1),
                        const SizedBox(height: AppSpacing.sm),
                        Row(
                          children: [
                            Expanded(
                              child: Row(
                                children: [
                                  const Text('Emergency', style: TextStyle(fontSize: 13)),
                                  Switch(
                                    value: c.emergencyAvailable,
                                    onChanged: _busyKey == '${c.id}:emergency' ? null : (_) => _toggleEmergency(c),
                                  ),
                                ],
                              ),
                            ),
                            if (_busyKey == '${c.id}:status')
                              const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                            else
                              OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: c.approvalStatus == 'disabled' ? AppColors.success : AppColors.danger,
                                ),
                                onPressed: () => _toggleStatus(c),
                                child: Text(c.approvalStatus == 'disabled' ? 'Enable' : 'Disable'),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.verificationOnly) {
      return Scaffold(
        body: Column(
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
              child: PageHeader(
                title: 'Clinic verification',
                subtitle: 'Review clinic submissions before making them available.',
              ),
            ),
            Expanded(
              child: _list(_pendingFuture, showActions: true),
            ),
          ],
        ),
      );
    }

    return Scaffold(
      body: Column(
        children: [
          // Mirrors the web app's ManageClinics `Page` header (AdminPages.jsx) — same
          // title + subtitle copy; this screen additionally folds in the pending-approval
          // queue (web's separate ClinicVerification page) as the first tab.
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Clinic management',
              subtitle: 'Review and control clinic availability.',
            ),
          ),
          TabBar(
            controller: _tabController,
            labelColor: AppColors.primary,
            unselectedLabelColor: AppColors.textSecondary,
            tabs: const [Tab(text: 'Pending approval'), Tab(text: 'All clinics')],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _list(_pendingFuture, showActions: true),
                _list(_allFuture, showActions: false, showManageActions: true),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
