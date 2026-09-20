import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class ComplaintsScreen extends StatefulWidget {
  const ComplaintsScreen({super.key});

  @override
  State<ComplaintsScreen> createState() => _ComplaintsScreenState();
}

class _ComplaintsScreenState extends State<ComplaintsScreen> {
  Future<List<ComplaintItem>>? _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _future = ApiClient.instance
        .get('/complaints', query: {'pageSize': 50})
        .then((res) {
          final list = <ComplaintItem>[];
          for (final item in res.list) {
            try {
              list.add(ComplaintItem.fromJson(item));
            } catch (_) {}
          }
          return list;
        })
        .catchError((_) => <ComplaintItem>[]);
    if (mounted) setState(() {});
  }

  Future<void> _openNewComplaint() async {
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _NewComplaintForm(),
    );
    if (result == true) {
      _load();
      // COMPLETENESS FIX (mobile parity — feedback pattern used everywhere else, e.g.
      // appointments_screen.dart's cancel/review actions): confirm the submission the same way
      // instead of silently refreshing the list.
      if (mounted) showSuccessSnack(context, 'Complaint submitted');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openNewComplaint,
        icon: const Icon(Icons.add),
        label: const Text('New complaint'),
      ),
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Complaints',
              subtitle: 'Raise an issue with the platform and track its resolution.',
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
                if (complaints.isEmpty) {
                  return const EmptyStateView(icon: Icons.support_agent_outlined, title: 'No complaints raised');
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: complaints.length,
                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, i) {
                    final c = complaints[i];
                    return Card(
                      child: ExpansionTile(
                        title: Text(c.subject, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: StatusBadge(status: c.status),
                        childrenPadding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
                        children: [
                          if (c.description != null) Align(alignment: Alignment.centerLeft, child: Text(c.description!)),
                          if (c.adminResponse != null) ...[
                            const SizedBox(height: AppSpacing.sm),
                            const Align(alignment: Alignment.centerLeft, child: Text('Response', style: TextStyle(fontWeight: FontWeight.w600))),
                            Align(alignment: Alignment.centerLeft, child: Text(c.adminResponse!)),
                          ],
                        ],
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _NewComplaintForm extends StatefulWidget {
  const _NewComplaintForm();

  @override
  State<_NewComplaintForm> createState() => _NewComplaintFormState();
}

class _NewComplaintFormState extends State<_NewComplaintForm> {
  final _subjectController = TextEditingController();
  final _descriptionController = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _subjectController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_subjectController.text.trim().isEmpty) {
      setState(() => _error = 'Subject is required');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/complaints', body: {
        'subject': _subjectController.text.trim(),
        if (_descriptionController.text.trim().isNotEmpty) 'description': _descriptionController.text.trim(),
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
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Raise a complaint', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: AppSpacing.md),
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          TextField(controller: _subjectController, decoration: const InputDecoration(labelText: 'Subject')),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _descriptionController,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Description (optional)'),
          ),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Submit', onPressed: _submit, loading: _submitting),
        ],
      ),
    );
  }
}
