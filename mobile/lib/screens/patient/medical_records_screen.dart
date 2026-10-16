import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class PatientMedicalRecordsScreen extends StatefulWidget {
  const PatientMedicalRecordsScreen({super.key});

  @override
  State<PatientMedicalRecordsScreen> createState() => _PatientMedicalRecordsScreenState();
}

class _PatientMedicalRecordsScreenState extends State<PatientMedicalRecordsScreen> {
  late Future<List<Map<String, dynamic>>> _future = _load();

  Future<List<Map<String, dynamic>>> _load() async {
    final response = await ApiClient.instance.get('/medical-records', query: {'pageSize': 100});
    return response.list;
  }

  void _refresh() => setState(() => _future = _load());

  @override
  Widget build(BuildContext context) => Column(children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(title: 'Medical records', subtitle: 'Read-only notes and care plans shared by your doctors.'),
        ),
        Expanded(
          child: FutureBuilder<List<Map<String, dynamic>>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
              if (snapshot.hasError) return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _refresh));
              final rows = snapshot.data ?? const [];
              if (rows.isEmpty) return const EmptyStateView(icon: Icons.folder_shared_outlined, title: 'No medical records yet', subtitle: 'Records written after a consultation will appear here.');
              return RefreshIndicator(
                onRefresh: () async => _refresh(),
                child: ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: rows.length,
                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, index) {
                    final row = rows[index];
                    final doctor = row['doctor'] is Map ? (row['doctor'] as Map)['name']?.toString() : null;
                    return SectionCard(
                      title: row['title']?.toString() ?? 'Medical record',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${row['type'] ?? 'Consultation'}${doctor == null ? '' : ' · Dr. $doctor'}', style: const TextStyle(color: AppColors.textSecondary)),
                        if ((row['notes']?.toString() ?? '').isNotEmpty) ...[const SizedBox(height: 8), Text(row['notes'].toString())],
                        if ((row['carePlan']?.toString() ?? '').isNotEmpty) ...[const SizedBox(height: 8), Text('Care plan: ${row['carePlan']}', style: const TextStyle(fontWeight: FontWeight.w600))],
                      ]),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ]);
}
