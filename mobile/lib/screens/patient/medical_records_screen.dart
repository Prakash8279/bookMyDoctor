import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class PatientMedicalRecordsScreen extends StatelessWidget {
  const PatientMedicalRecordsScreen({super.key});

  Future<List<MedicalRecordItem>> _load() async {
    final res = await ApiClient.instance.get('/medical-records', query: {'pageSize': 50});
    return res.list.map(MedicalRecordItem.fromJson).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(
            title: 'Medical records',
            subtitle: 'Notes and care plans your doctors have recorded for you.',
          ),
        ),
        Expanded(
          child: AsyncScreen<List<MedicalRecordItem>>(
            load: _load,
            isEmpty: (list) => list.isEmpty,
            emptyIcon: Icons.folder_open_outlined,
            emptyTitle: 'No medical records yet',
            builder: (context, records) => ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: records.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, i) {
                final r = records[i];
                return Card(
                  child: ExpansionTile(
                    title: Text(r.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(
                      '${r.type ?? ""}${r.doctor?.name != null ? " · ${r.doctor!.name}" : ""}${r.createdAt != null ? " · ${r.createdAt!.split("T").first}" : ""}',
                    ),
                    childrenPadding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
                    children: [
                      if (r.notes != null) ...[
                        const Align(alignment: Alignment.centerLeft, child: Text('Notes', style: TextStyle(fontWeight: FontWeight.w600))),
                        Text(r.notes!),
                        const SizedBox(height: AppSpacing.sm),
                      ],
                      if (r.carePlan != null) ...[
                        const Align(alignment: Alignment.centerLeft, child: Text('Care plan', style: TextStyle(fontWeight: FontWeight.w600))),
                        Text(r.carePlan!),
                      ],
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
