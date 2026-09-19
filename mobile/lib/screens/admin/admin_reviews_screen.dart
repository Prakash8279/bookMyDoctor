import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Review moderation queue. Only admin/superadmin get to honor the `status`
/// filter on GET /reviews (every other caller is forced to 'approved' —
/// integration_plan.md §1.14); a doctor's rating/reviewCount recompute
/// automatically via a DB trigger whenever a review's status changes, so
/// nothing else needs updating client-side after this action.
class AdminReviewsScreen extends StatefulWidget {
  const AdminReviewsScreen({super.key});

  @override
  State<AdminReviewsScreen> createState() => _AdminReviewsScreenState();
}

class _AdminReviewsScreenState extends State<AdminReviewsScreen> {
  String _statusFilter = 'pending';
  Future<List<ReviewItem>>? _future;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() {
      _future = ApiClient.instance
          .get('/reviews', query: {'status': _statusFilter, 'pageSize': 100})
          .then((res) => res.list.map(ReviewItem.fromJson).toList());
    });
  }

  Future<void> _setStatus(ReviewItem r, String status) async {
    setState(() => _busyId = r.id);
    try {
      await ApiClient.instance.patch('/reviews/${r.id}/status', body: {'status': status});
      if (mounted) showSuccessSnack(context, 'Marked $status');
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          // Mirrors the web app's ReviewModeration `Page` header (AdminPages.jsx /
          // PortalSectionPages.jsx) — same title + subtitle copy.
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'Review moderation',
              subtitle: 'Keep public feedback useful, respectful, and actionable.',
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: ['pending', 'approved', 'rejected'].map((s) {
                final selected = _statusFilter == s;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(s[0].toUpperCase() + s.substring(1)),
                    selected: selected,
                    onSelected: (_) {
                      setState(() => _statusFilter = s);
                      _load();
                    },
                  ),
                );
              }).toList(),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<ReviewItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
                }
                final reviews = snapshot.data ?? [];
                if (reviews.isEmpty) return const EmptyStateView(icon: Icons.star_outline, title: 'No reviews here');
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: reviews.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final r = reviews[i];
                      final busy = _busyId == r.id;
                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(child: Text('Dr. ${r.doctor.name ?? "—"}', style: const TextStyle(fontWeight: FontWeight.w700))),
                                  Row(
                                    children: List.generate(5, (i) => Icon(i < r.rating ? Icons.star : Icons.star_border, size: 16, color: AppColors.warning)),
                                  ),
                                ],
                              ),
                              Text('By ${r.patient.name ?? "Patient"}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              if (r.text != null) ...[
                                const SizedBox(height: 6),
                                Text(r.text!),
                              ],
                              if (busy) ...[
                                const SizedBox(height: AppSpacing.sm),
                                const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                              ] else ...[
                                const SizedBox(height: AppSpacing.sm),
                                Wrap(
                                  spacing: 8,
                                  children: [
                                    if (r.status != 'approved') OutlinedButton(onPressed: () => _setStatus(r, 'approved'), child: const Text('Approve')),
                                    if (r.status != 'rejected') OutlinedButton(onPressed: () => _setStatus(r, 'rejected'), child: const Text('Reject')),
                                    if (r.status != 'pending') OutlinedButton(onPressed: () => _setStatus(r, 'pending'), child: const Text('Reset to pending')),
                                  ],
                                ),
                              ],
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
