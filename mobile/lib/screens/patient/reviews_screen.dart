import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (mobile parity — client/src/pages/FeaturePages.jsx#PatientReviews had no
/// mobile equivalent). A review requires a completed appointment id (`POST /reviews` body:
/// {appointmentId, rating, text}) — there is no doctorId-only review path — so this lists the
/// patient's completed appointments, same as the web page, rather than a doctor directory.
class PatientReviewsScreen extends StatefulWidget {
  const PatientReviewsScreen({super.key});

  @override
  State<PatientReviewsScreen> createState() => _PatientReviewsScreenState();
}

class _PatientReviewsScreenState extends State<PatientReviewsScreen> {
  Future<List<Appointment>>? _future;
  final Set<String> _submittedIds = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() {
      _future = ApiClient.instance
          .get('/appointments', query: {'status': 'completed', 'pageSize': 100})
          .then((res) => res.list.map(Appointment.fromJson).toList());
    });
  }

  @override
  Widget build(BuildContext context) {
    // No own Scaffold — this screen is only ever embedded as a RoleScaffold nav-item body
    // (patient_home_screen.dart), which already supplies the app bar; a nested bodyless Scaffold
    // here added nothing and broke from every sibling nav-item screen's pattern.
    return Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              title: 'My reviews',
              subtitle: "Share feedback for a doctor you've consulted.",
            ),
          ),
          Expanded(
            child: FutureBuilder<List<Appointment>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: ErrorBanner(error: snapshot.error!, onRetry: _load),
                  );
                }
                final appointments = snapshot.data ?? [];
                if (appointments.isEmpty) {
                  return const EmptyStateView(
                    icon: Icons.rate_review_outlined,
                    title: 'No completed visits yet',
                    subtitle: 'Reviews can be added once a booked consultation is marked completed.',
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => _load(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: appointments.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      final appointment = appointments[i];
                      return _ReviewCard(
                        appointment: appointment,
                        alreadySubmitted: _submittedIds.contains(appointment.id),
                        onSubmitted: () => setState(() => _submittedIds.add(appointment.id)),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      );
  }
}

class _ReviewCard extends StatefulWidget {
  final Appointment appointment;
  final bool alreadySubmitted;
  final VoidCallback onSubmitted;
  const _ReviewCard({required this.appointment, required this.alreadySubmitted, required this.onSubmitted});

  @override
  State<_ReviewCard> createState() => _ReviewCardState();
}

class _ReviewCardState extends State<_ReviewCard> {
  bool _writing = false;
  bool _submitting = false;
  int _rating = 5;
  final _textController = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_textController.text.trim().isEmpty) {
      setState(() => _error = 'Please write a few words of feedback.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/reviews', body: {
        'appointmentId': widget.appointment.id,
        'rating': _rating,
        'text': _textController.text.trim(),
      });
      widget.onSubmitted();
    } catch (err) {
      setState(() {
        _error = err.toString();
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.appointment;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(a.doctor?.name ?? 'Doctor', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            if (a.doctor?.specialization != null)
              Text(a.doctor!.specialization!.name, style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: AppSpacing.sm),
            if (widget.alreadySubmitted)
              const Text(
                'Review submitted — pending moderation before it appears publicly.',
                style: TextStyle(color: AppColors.success, fontWeight: FontWeight.w600),
              )
            else if (!_writing)
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(onPressed: () => setState(() => _writing = true), child: const Text('Write a review')),
              )
            else ...[
              Row(
                children: [
                  const Text('Rating: '),
                  ...List.generate(
                    5,
                    (i) => IconButton(
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                      visualDensity: VisualDensity.compact,
                      icon: Icon(i < _rating ? Icons.star : Icons.star_border, color: AppColors.warning),
                      onPressed: () => setState(() => _rating = i + 1),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              TextField(
                controller: _textController,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'Your feedback'),
              ),
              const SizedBox(height: AppSpacing.sm),
              if (_error != null) ...[Text(_error!, style: const TextStyle(color: AppColors.danger)), const SizedBox(height: AppSpacing.sm)],
              PrimaryButton(label: 'Save review', onPressed: _submit, loading: _submitting),
            ],
          ],
        ),
      ),
    );
  }
}
