import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (mobile parity): mirrors web's public "About" page
/// (client/src/pages/FeaturePages.jsx#PublicContent, kind: 'about') — the
/// mobile app had no screen at all for this standalone marketing page.
/// Web's copy for this page is a single short heading + lede paragraph
/// with no further sections, so this screen matches that same brevity
/// rather than inventing extra content.
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('About')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: const [
          PageHeader(title: 'About BookADoctors'),
          Text(
            'We help patients find care and track their clinic queue from anywhere.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.5),
          ),
        ],
      ),
    );
  }
}
