import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Read-only activity feed — GET /admin/activity-log returns structured
/// fields (actor, actionType, targetEntityType/Id, description) rather than
/// the mock's single pre-formatted log string (integration_plan.md §1.18).
class AdminActivityLogScreen extends StatelessWidget {
  const AdminActivityLogScreen({super.key});

  Future<List<ActivityLogEntry>> _load() async {
    final res = await ApiClient.instance.get('/admin/activity-log', query: {'pageSize': 100});
    return res.list.map(ActivityLogEntry.fromJson).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Mirrors the web app's AuditLog `Page` header (AdminPages.jsx) — same
        // title + subtitle copy. Kept outside AsyncScreen (rather than inside its
        // `builder`, which only runs once data has loaded and is non-empty) so the
        // header still renders during the loading/error/empty states too.
        const Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(
            title: 'Activity logs',
            subtitle: 'Audit important platform actions.',
          ),
        ),
        Expanded(
          child: AsyncScreen<List<ActivityLogEntry>>(
            load: _load,
            isEmpty: (list) => list.isEmpty,
            emptyIcon: Icons.history,
            emptyTitle: 'No activity recorded yet',
            builder: (context, entries) => ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: entries.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final e = entries[i];
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        e.description ?? e.actionType.replaceAll('_', ' '),
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${e.actor?.name ?? "System"}${e.actorRole != null ? " (${e.actorRole})" : ""}${e.createdAt != null ? " · ${e.createdAt!.split("T").first}" : ""}',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}
