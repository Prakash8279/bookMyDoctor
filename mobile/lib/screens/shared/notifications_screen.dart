import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Shared across all 4 roles — GET /notifications is hard-scoped server-side
/// to the caller's own inbox regardless of role (integration_plan.md §1.15).
/// Note the row `id` here is the NotificationRecipient id, distinct from
/// `notificationId` — PATCH /:id/read takes THIS id, not notificationId.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  Future<List<AppNotification>>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
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
              action: TextButton(onPressed: _markAllRead, child: const Text('Mark all read')),
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
