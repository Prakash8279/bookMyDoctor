import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Complaint moderation — admin/superadmin see every patient's complaint
/// (patients only see their own). PATCH body field is `adminResponse`, not
/// `response` (integration_plan.md §1.16 — a literal rename vs the old
/// mock, and distinct from /contact's `response` field on the screen below).
class AdminComplaintsScreen extends StatefulWidget {
  const AdminComplaintsScreen({super.key});

  @override
  State<AdminComplaintsScreen> createState() => _AdminComplaintsScreenState();
}

class _AdminComplaintsScreenState extends State<AdminComplaintsScreen> {
  String? _statusFilter;
  Future<List<ComplaintItem>>? _future;

  static const _filters = <(String?, String)>[
    (null, 'All'),
    ('open', 'Open'),
    ('in_progress', 'In progress'),
    ('resolved', 'Resolved'),
    ('closed', 'Closed'),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() {
      _future = ApiClient.instance
          .get('/complaints', query: {if (_statusFilter != null) 'status': _statusFilter, 'pageSize': 100})
          .then((res) => res.list.map(ComplaintItem.fromJson).toList());
    });
  }

  Future<void> _respond(ComplaintItem c) async {
    final saved = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _ComplaintResponseForm(complaint: c));
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          // Mirrors the web app's Complaints `Page` header (AdminPages.jsx) — same
          // title + subtitle copy.
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Complaints',
              subtitle: 'Respond to and resolve submitted issues.',
            ),
          ),
          SizedBox(
            height: 48,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 4),
              itemCount: _filters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final (value, label) = _filters[i];
                final selected = _statusFilter == value;
                return ChoiceChip(
                  label: Text(label),
                  selected: selected,
                  onSelected: (_) {
                    setState(() => _statusFilter = value);
                    _load();
                  },
                );
              },
            ),
          ),
          Expanded(
            child: FutureBuilder<List<ComplaintItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
                }
                final complaints = snapshot.data ?? [];
                if (complaints.isEmpty) return const EmptyStateView(icon: Icons.report_problem_outlined, title: 'No complaints found');
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: complaints.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final c = complaints[i];
                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(child: Text(c.subject, style: const TextStyle(fontWeight: FontWeight.w700))),
                                  StatusBadge(status: c.status),
                                ],
                              ),
                              if (c.raisedBy?.name != null)
                                Text('By ${c.raisedBy!.name}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              if (c.description != null) ...[
                                const SizedBox(height: 6),
                                Text(c.description!),
                              ],
                              if (c.adminResponse != null) ...[
                                const SizedBox(height: 6),
                                Text('Response: ${c.adminResponse}', style: const TextStyle(fontStyle: FontStyle.italic)),
                              ],
                              const SizedBox(height: AppSpacing.sm),
                              OutlinedButton(onPressed: () => _respond(c), child: const Text('Update / Respond')),
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

class _ComplaintResponseForm extends StatefulWidget {
  final ComplaintItem complaint;
  const _ComplaintResponseForm({required this.complaint});

  @override
  State<_ComplaintResponseForm> createState() => _ComplaintResponseFormState();
}

class _ComplaintResponseFormState extends State<_ComplaintResponseForm> {
  late String _status = widget.complaint.status;
  late final _responseCtrl = TextEditingController(text: widget.complaint.adminResponse ?? '');
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _responseCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.patch('/complaints/${widget.complaint.id}', body: {
        'status': _status,
        if (_responseCtrl.text.trim().isNotEmpty) 'adminResponse': _responseCtrl.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      setState(() {
        _error = err.toString();
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: AppSpacing.md, right: AppSpacing.md, top: AppSpacing.md, bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.complaint.subject, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: AppSpacing.md),
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          DropdownButtonFormField<String>(
            value: _status,
            decoration: const InputDecoration(labelText: 'Status'),
            items: const [
              DropdownMenuItem(value: 'open', child: Text('Open')),
              DropdownMenuItem(value: 'in_progress', child: Text('In progress')),
              DropdownMenuItem(value: 'resolved', child: Text('Resolved')),
              DropdownMenuItem(value: 'closed', child: Text('Closed')),
            ],
            onChanged: (v) => setState(() => _status = v ?? _status),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _responseCtrl, maxLines: 4, decoration: const InputDecoration(labelText: 'Response (optional)')),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Save', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}
