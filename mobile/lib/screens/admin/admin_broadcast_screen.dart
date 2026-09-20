import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Broadcast notifications: send new (POST /notifications/broadcast) +
/// history log (GET /notifications/broadcast, distinct from the personal
/// inbox — integration_plan.md §1.15).
class AdminBroadcastScreen extends StatefulWidget {
  const AdminBroadcastScreen({super.key});

  @override
  State<AdminBroadcastScreen> createState() => _AdminBroadcastScreenState();
}

class _AdminBroadcastScreenState extends State<AdminBroadcastScreen> {
  String _audience = 'all';
  final _titleCtrl = TextEditingController();
  final _bodyCtrl = TextEditingController();
  final _targetUserIdCtrl = TextEditingController();
  bool _sending = false;
  String? _error;

  Future<List<BroadcastLogItem>>? _historyFuture;

  @override
  void initState() {
    super.initState();
    _historyFuture = _fetchHistory();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _bodyCtrl.dispose();
    _targetUserIdCtrl.dispose();
    super.dispose();
  }

  Future<List<BroadcastLogItem>> _fetchHistory() async {
    try {
      final res = await ApiClient.instance
          .get('/notifications/broadcast', query: {'pageSize': 50})
          .catchError((_) => ApiResponse(data: []));
      final list = <BroadcastLogItem>[];
      for (final item in res.list) {
        try {
          list.add(BroadcastLogItem.fromJson(item));
        } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  void _loadHistory() {
    setState(() {
      _historyFuture = _fetchHistory();
    });
  }

  Future<void> _send() async {
    if (_titleCtrl.text.trim().isEmpty || _bodyCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Title and body are required');
      return;
    }
    if (_audience == 'single_user' && _targetUserIdCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Enter the target user id for a single-user broadcast');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/notifications/broadcast', body: {
        'audience': _audience,
        'title': _titleCtrl.text.trim(),
        'body': _bodyCtrl.text.trim(),
        if (_audience == 'single_user') 'targetUserId': _targetUserIdCtrl.text.trim(),
      });
      if (mounted) showSuccessSnack(context, 'Broadcast sent');
      _titleCtrl.clear();
      _bodyCtrl.clear();
      _targetUserIdCtrl.clear();
      _loadHistory();
    } catch (err) {
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        // Mirrors the web app's Broadcast `Page` header (AdminPages.jsx) — same
        // title + subtitle copy.
        const PageHeader(
          title: 'Notifications',
          subtitle: 'Queue, booking, payment, and system updates.',
        ),
        SectionCard(
          title: 'Send broadcast',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.sm)],
              DropdownButtonFormField<String>(
                value: _audience,
                decoration: const InputDecoration(labelText: 'Audience'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Everyone')),
                  DropdownMenuItem(value: 'patients', child: Text('Patients')),
                  DropdownMenuItem(value: 'doctors', child: Text('Doctors')),
                  DropdownMenuItem(value: 'receptionists', child: Text('Receptionists')),
                  DropdownMenuItem(value: 'single_user', child: Text('Single user (by id)')),
                ],
                onChanged: (v) => setState(() => _audience = v ?? 'all'),
              ),
              if (_audience == 'single_user') ...[
                const SizedBox(height: AppSpacing.sm),
                TextField(controller: _targetUserIdCtrl, decoration: const InputDecoration(labelText: 'Target user id')),
              ],
              const SizedBox(height: AppSpacing.sm),
              TextField(controller: _titleCtrl, decoration: const InputDecoration(labelText: 'Title')),
              const SizedBox(height: AppSpacing.sm),
              TextField(controller: _bodyCtrl, maxLines: 4, decoration: const InputDecoration(labelText: 'Message')),
              const SizedBox(height: AppSpacing.sm),
              PrimaryButton(label: 'Send', onPressed: _send, loading: _sending),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        SectionCard(
          title: 'History',
          child: FutureBuilder<List<BroadcastLogItem>>(
            future: _historyFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
              if (snapshot.hasError) return ErrorBanner(error: snapshot.error!, onRetry: _loadHistory);
              final items = snapshot.data ?? [];
              if (items.isEmpty) return const Text('No broadcasts sent yet', style: TextStyle(color: AppColors.textSecondary));
              return Column(
                children: items.map((b) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(b.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text(b.body, style: const TextStyle(fontSize: 13)),
                        Text(
                          '${b.audience} · ${b.recipientCount} recipients · ${b.readCount} read',
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              );
            },
          ),
        ),
      ],
    );
  }
}
