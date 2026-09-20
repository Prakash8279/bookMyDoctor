import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (audit Priority 3 #4 — mobile parity): the web app has a working doctor "My
/// reviews" screen (client/src/pages/FeaturePages.jsx#DoctorReviews) backed by a real endpoint —
/// nothing equivalent existed on mobile, so a mobile doctor had zero visibility into patient
/// feedback. GET /reviews is public/optionally-authenticated and always forces non-admin callers
/// to approved-only (reviews.service.js#listReviews) — a doctor can never see their own
/// pending/rejected reviews here, same restriction the web page documents.
class DoctorReviewsScreen extends StatelessWidget {
  const DoctorReviewsScreen({super.key});

  Future<List<ReviewItem>> _load(String doctorId) async {
    final res = await ApiClient.instance
        .get('/reviews', query: {'doctorId': doctorId, 'pageSize': 100})
        .catchError((_) => ApiResponse(data: []));
    final list = <ReviewItem>[];
    for (final item in res.list) {
      try {
        list.add(ReviewItem.fromJson(item));
      } catch (_) {}
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    final doctorId = context.watch<AuthProvider>().user?.id;
    if (doctorId == null) {
      return const Scaffold(body: LoadingView());
    }
    return Scaffold(
      body: AsyncScreen<List<ReviewItem>>(
        load: () => _load(doctorId),
        isEmpty: (list) => list.isEmpty,
        emptyIcon: Icons.star_outline,
        emptyTitle: 'No reviews yet',
        emptySubtitle: 'Feedback your patients leave after completed consultations will show up here',
        builder: (context, reviews) {
          final average = reviews.isEmpty
              ? 0.0
              : reviews.map((r) => r.rating).reduce((a, b) => a + b) / reviews.length;
          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              const PageHeader(
                title: 'Patient reviews',
                subtitle: 'Feedback your patients have left after completed consultations.',
              ),
              SectionCard(
                child: Row(
                  children: [
                    Text(
                      '★ ${average.toStringAsFixed(1)}',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.warning),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Text('${reviews.length} review(s)', style: const TextStyle(color: AppColors.textSecondary)),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              for (final r in reviews) ...[
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                r.patient.name ?? 'Patient',
                                style: const TextStyle(fontWeight: FontWeight.w700),
                              ),
                            ),
                            Row(
                              children: List.generate(
                                5,
                                (i) => Icon(i < r.rating ? Icons.star : Icons.star_border, size: 16, color: AppColors.warning),
                              ),
                            ),
                          ],
                        ),
                        if (r.createdAt != null) ...[
                          const SizedBox(height: 2),
                          Text(r.createdAt!.split('T').first, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                        ],
                        if (r.text != null && r.text!.isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.sm),
                          Text(r.text!),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
              ],
            ],
          );
        },
      ),
    );
  }
}
