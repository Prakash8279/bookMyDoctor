import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Shared across all 4 roles — GET /notifications is hard-scoped server-side
/// to the caller's own inbox regardless of role (integration_plan.md §1.15).
/// Note the row `id` here is the NotificationRecipient id, distinct from
/// `notificationId` — PATCH /:id/read takes THIS id, not notificationId.
class NotificationsScreen extends StatefulWidget {
  // COMPLETENESS FIX (mobile parity audit, patient panel): only the patient portal's own
  // Notifications page (PatientPages.jsx) has an "Export CSV" button — the shared SimpleInbox
  // (FeaturePages.jsx) that doctor/receptionist/admin use does not. Since this screen is shared
  // across all 4 roles, the button is opt-in per caller rather than always-on, so doctor/
  // receptionist/admin don't gain an extra button their own web page never has.
  final bool showExportCsv;
  const NotificationsScreen({super.key, this.showExportCsv = false});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  Future<List<AppNotification>>? _future;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
    // BUG FIX (mobile parity audit): web's SimpleInbox polls GET /notifications every 30s while
    // the page is open (FeaturePages.jsx) — mobile only ever fetched once on open or on manual
    // pull-to-refresh, so a doctor/receptionist sitting on this tab never saw a new notification
    // appear on its own.
    _pollTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) _load();
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<List<AppNotification>> _fetch() async {
    try {
      final res = await ApiClient.instance
          .get('/notifications', query: {'pageSize': 50})
          .catchError((_) => ApiResponse(data: []));
      final list = <AppNotification>[];
      for (final item in res.list) {
        try {
          list.add(AppNotification.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<void> _markRead(AppNotification n) async {
    if (n.isRead) return;
    try {
      await ApiClient.instance.patch('/notifications/${n.id}/read');
      if (!mounted) return;
      _load();
    } catch (_) {
      // Non-fatal — the notification just stays showing as unread.
    }
  }

  Future<void> _markAllRead() async {
    try {
      await ApiClient.instance.patch('/notifications/read-all');
      if (!mounted) return;
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

  // COMPLETENESS FIX (mobile parity audit): web's patient Notifications "Export CSV" action
  // (PatientPages.jsx#Notifications exportCsv) had no mobile equivalent. Same header/column
  // order/values — note web exports the raw createdAt string, not a display-formatted date.
  Future<void> _exportCsv(List<AppNotification> items) async {
    await shareCsv(
      filename: 'notifications.csv',
      headers: const ['ID', 'Date', 'Title', 'Message', 'Type', 'Status'],
      rows: [
        for (var i = 0; i < items.length; i++)
          [
            'DC${(i + 1).toString().padLeft(2, '0')}',
            items[i].createdAt ?? '',
            items[i].title,
            items[i].body,
            items[i].type ?? 'system',
            items[i].isRead ? 'read' : 'unread',
          ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    // No own Scaffold/AppBar — this screen is only ever embedded as a RoleScaffold nav-item body
    // (across all 4 roles' home screens), which already supplies the app bar. It used to keep a
    // titleless AppBar just to hold the "Mark all read" action, which still doubled up the toolbar
    // under RoleScaffold's own — that action now lives in PageHeader's own `action` slot instead,
    // matching how the other nav-item screens (e.g. doctor_dashboard_screen.dart) were fixed.
    return Column(
        children: [
          // Mirrors web's SimpleInbox (doctor/receptionist notifications inbox — FeaturePages.jsx):
          // <Page title="Notifications" subtitle="New bookings, queue activity, reviews, and
          // system updates.">. This screen's own behavior (tap a row to mark it read, one
          // "mark all read" action) matches SimpleInbox's shape more closely than the patient
          // portal's dedicated table/CSV page, so that is the copy mirrored here.
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Notifications',
              subtitle: 'New bookings, queue activity, reviews, and system updates.',
              action: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextButton(onPressed: _markAllRead, child: const Text('Mark all read')),
                  if (widget.showExportCsv)
                    FutureBuilder<List<AppNotification>>(
                      future: _future,
                      builder: (context, snapshot) {
                        final items = snapshot.data ?? const <AppNotification>[];
                        return TextButton.icon(
                          onPressed: items.isEmpty ? null : () => _exportCsv(items),
                          icon: const Icon(Icons.file_download_outlined, size: 16),
                          label: const Text('Export CSV'),
                        );
                      },
                    ),
                ],
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<AppNotification>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
                }
                final items = snapshot.data ?? [];
                if (items.isEmpty) {
                  return const EmptyStateView(icon: Icons.notifications_none, title: 'No notifications');
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final n = items[i];
                      return ListTile(
                        onTap: () => _markRead(n),
                        leading: Icon(
                          n.isRead ? Icons.notifications_none : Icons.notifications,
                          color: n.isRead ? AppColors.textSecondary : AppColors.primary,
                        ),
                        title: Text(n.title, style: TextStyle(fontWeight: n.isRead ? FontWeight.w400 : FontWeight.w700)),
                        subtitle: Text(n.body),
                        trailing: n.createdAt != null ? Text(n.createdAt!.split('T').first, style: const TextStyle(fontSize: 11)) : null,
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
