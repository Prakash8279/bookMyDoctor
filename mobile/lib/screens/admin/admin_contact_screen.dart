import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Public contact-form inbox — POST /contact needs no auth at all (anyone
/// can submit), but GET/PATCH are admin/superadmin only. PATCH's field is
/// `response` here (matches the mock, unlike complaints' renamed
/// `adminResponse` — integration_plan.md §1.17).
class AdminContactScreen extends StatefulWidget {
  const AdminContactScreen({super.key});

  @override
  State<AdminContactScreen> createState() => _AdminContactScreenState();
}

class _AdminContactScreenState extends State<AdminContactScreen> {
  String? _statusFilter;
  Future<List<ContactRequestItem>>? _future;

  static const _filters = <(String?, String)>[
    (null, 'All'),
    ('open', 'Open'),
    ('responded', 'Responded'),
    ('resolved', 'Resolved'),
  ];

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<ContactRequestItem>> _fetch() async {
    try {
      final res = await ApiClient.instance
          .get('/contact', query: {if (_statusFilter != null) 'status': _statusFilter, 'pageSize': 100})
          .catchError((_) => ApiResponse(data: []));
      final list = <ContactRequestItem>[];
      for (final item in res.list) {
        try {
          list.add(ContactRequestItem.fromJson(item));
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

  Future<void> _respond(ContactRequestItem c) async {
    final saved = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _ContactResponseForm(item: c));
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          // Mirrors the web app's ContactInbox `Page` header (PortalSectionPages.jsx) —
          // same title + subtitle copy.
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Contact inbox',
              subtitle: 'Track public support requests and save responses.',
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
            child: FutureBuilder<List<ContactRequestItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
                }
                final items = snapshot.data ?? [];
                if (items.isEmpty) return const EmptyStateView(icon: Icons.mail_outline, title: 'No contact requests found');
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final c = items[i];
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
                              Text('${c.name} · ${c.email}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              const SizedBox(height: 6),
                              Text(c.message),
                              if (c.response != null) ...[
                                const SizedBox(height: 6),
                                Text('Response: ${c.response}', style: const TextStyle(fontStyle: FontStyle.italic)),
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

class _ContactResponseForm extends StatefulWidget {
  final ContactRequestItem item;
  const _ContactResponseForm({required this.item});

  @override
  State<_ContactResponseForm> createState() => _ContactResponseFormState();
}

class _ContactResponseFormState extends State<_ContactResponseForm> {
  late String _status = widget.item.status;
  late final _responseCtrl = TextEditingController(text: widget.item.response ?? '');
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
      await ApiClient.instance.patch('/contact/${widget.item.id}', body: {
        'status': _status,
        if (_responseCtrl.text.trim().isNotEmpty) 'response': _responseCtrl.text.trim(),
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
          Text(widget.item.subject, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: AppSpacing.md),
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          DropdownButtonFormField<String>(
            value: _status,
            decoration: const InputDecoration(labelText: 'Status'),
            items: const [
              DropdownMenuItem(value: 'open', child: Text('Open')),
              DropdownMenuItem(value: 'responded', child: Text('Responded')),
              DropdownMenuItem(value: 'resolved', child: Text('Resolved')),
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
