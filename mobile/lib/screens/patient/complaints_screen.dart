import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class PatientComplaintsScreen extends StatefulWidget {
  const PatientComplaintsScreen({super.key});

  @override
  State<PatientComplaintsScreen> createState() => _PatientComplaintsScreenState();
}

class _PatientComplaintsScreenState extends State<PatientComplaintsScreen> {
  late Future<List<Map<String, dynamic>>> _future = _load();
  final _subject = TextEditingController();
  final _description = TextEditingController();
  bool _saving = false;

  Future<List<Map<String, dynamic>>> _load() async => (await ApiClient.instance.get('/complaints', query: {'pageSize': 100})).list;

  Future<void> _submit() async {
    if (_subject.text.trim().length < 3 || _description.text.trim().length < 10) {
      showErrorSnack(context, 'Enter a subject and at least 10 characters of detail.');
      return;
    }
    setState(() => _saving = true);
    try {
      await ApiClient.instance.post('/complaints', body: {'subject': _subject.text.trim(), 'description': _description.text.trim()});
      _subject.clear();
      _description.clear();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Complaint submitted.')));
      setState(() => _future = _load());
    } catch (error) {
      if (mounted) showErrorSnack(context, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _subject.dispose();
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(AppSpacing.md), children: [
        const PageHeader(title: 'Help & complaints', subtitle: 'Raise an issue and track the admin response.'),
        SectionCard(title: 'New complaint', child: Column(children: [
          TextField(controller: _subject, maxLength: 160, decoration: const InputDecoration(labelText: 'Subject')),
          const SizedBox(height: AppSpacing.sm),
          TextField(controller: _description, minLines: 3, maxLines: 6, maxLength: 5000, decoration: const InputDecoration(labelText: 'Describe the issue')),
          const SizedBox(height: AppSpacing.sm),
          PrimaryButton(label: 'Submit complaint', loading: _saving, onPressed: _submit),
        ])),
        const SizedBox(height: AppSpacing.md),
        FutureBuilder<List<Map<String, dynamic>>>(future: _future, builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) return ErrorBanner(error: snapshot.error!, onRetry: () => setState(() => _future = _load()));
          final rows = snapshot.data ?? const [];
          if (rows.isEmpty) return const EmptyStateView(icon: Icons.support_agent_outlined, title: 'No complaints yet');
          return Column(children: rows.map((row) => Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: SectionCard(title: row['subject']?.toString() ?? 'Complaint', child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(row['description']?.toString() ?? ''),
              const SizedBox(height: 8),
              StatusBadge(status: row['status']?.toString() ?? 'open'),
              const SizedBox(height: 8),
              Text(row['adminResponse']?.toString().isNotEmpty == true ? 'Admin: ${row['adminResponse']}' : 'Awaiting admin response', style: const TextStyle(color: AppColors.textSecondary)),
            ])),
          )).toList());
        }),
      ]);
}
