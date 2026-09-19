import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (mobile parity): mirrors web's public "Blog" page
/// (client/src/pages/FeaturePages.jsx#PublicContent, kind: 'blog') — same
/// heading/lede plus the same three placeholder guide titles web lists
/// (web has no actual blog post content behind these, just the titles and
/// a fixed one-line description under each).
class BlogScreen extends StatelessWidget {
  const BlogScreen({super.key});

  static const _posts = [
    'How to prepare for a specialist visit',
    'What live queues mean for patients',
    'Choosing an emergency clinic',
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Blog')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          const PageHeader(title: 'BookMyDoctor24 Blog'),
          const Text(
            'Guides for healthier choices, clinic visits, and managing your care.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.5),
          ),
          const SizedBox(height: AppSpacing.lg),
          for (final title in _posts)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: SectionCard(
                title: title,
                child: const Text(
                  'A practical BookMyDoctor24 guide.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
