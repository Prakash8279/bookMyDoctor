import 'package:flutter/material.dart';
import 'legal_policies_screen.dart';

/// Uses the same policy content as Help & Policies, without a separate stale draft.
class TermsScreen extends StatelessWidget {
  const TermsScreen({super.key});
  @override
  Widget build(BuildContext context) => const LegalDocumentScreen(
        title: 'Terms of Service',
        lastUpdated: '21 September 2026',
        sections: kTermsSections,
      );
}
