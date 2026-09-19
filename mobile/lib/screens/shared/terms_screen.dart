import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (mobile parity): mirrors web's Terms of Service page
/// (client/src/pages/TermsOfService.jsx) — same draft-placeholder notice and
/// the same 8 numbered sections, condensed for a mobile scroll view. Per
/// that file's own header comment, this is placeholder copy for a healthcare
/// appointment platform, not reviewed by a lawyer; the notice banner below
/// must stay until real, counsel-reviewed terms replace this content.
class TermsScreen extends StatelessWidget {
  const TermsScreen({super.key});

  static const _sections = [
    [
      '1. Acceptance of these terms',
      'By creating an account or using BookMyDoctor24 ("the platform") as a patient, doctor, clinic, or clinic '
          'staff member, you agree to these Terms of Service. If you do not agree, do not use the platform.',
    ],
    [
      '2. What the platform is — and is not',
      'BookMyDoctor24 helps patients discover doctors and clinics, book appointments, and follow their live '
          'clinic queue. It also gives clinics tools to manage appointments, walk-ins, queues, and payments. '
          'BookMyDoctor24 is not a medical provider, does not practice medicine, and is not a substitute for '
          'professional medical judgment. In a medical emergency, contact local emergency services directly '
          'rather than relying on this platform.',
    ],
    [
      '3. Accounts and eligibility',
      'You must provide accurate registration information and keep your login credentials confidential. You '
          'are responsible for activity that happens under your account. Doctor accounts are created only after '
          'verification by an administrator; a doctor or clinic profile being listed does not itself guarantee '
          'availability, response time, or outcome of care.',
    ],
    [
      '4. Appointments, queues, and payments',
      'Booking an appointment reserves a queue position with the selected doctor or clinic, subject to that '
          'clinic\'s own cancellation and rescheduling policies. Where an online advance payment is collected at '
          'booking, the remaining consultation fee (if any) is payable directly at the clinic. Refunds for '
          'cancelled or missed appointments follow the applicable clinic\'s policy, shown at the time of booking.',
    ],
    [
      '5. Acceptable use',
      'You agree not to misuse the platform — including submitting false medical, identity, or payment '
          'information; attempting to access another user\'s account or health records; disrupting clinic queues '
          'or bookings for others; or using the platform for anything unlawful.',
    ],
    [
      '6. Doctor and clinic responsibilities',
      'Doctors and clinics using BookMyDoctor24 remain solely responsible for the medical care they provide, '
          'for complying with applicable healthcare regulations and licensing requirements, and for the accuracy '
          'of the schedules, fees, and availability they publish on the platform.',
    ],
    [
      '7. Changes to these terms',
      'These terms may be updated as the platform changes. Continued use of BookMyDoctor24 after an update '
          'means you accept the revised terms.',
    ],
    [
      '8. Contact',
      'Questions about these terms can be sent through the Contact page, or to bookmydoctor24@gmail.com.',
    ],
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Terms of Service')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          const PageHeader(
            kicker: 'Legal',
            title: 'Terms of Service',
            subtitle: 'Last updated: this is placeholder content and has no effective date until reviewed and '
                'published by counsel.',
          ),
          Container(
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(
              color: AppColors.gold.withOpacity(0.1),
              border: Border.all(color: AppColors.gold.withOpacity(0.4)),
              borderRadius: BorderRadius.circular(AppRadius.button),
            ),
            child: const Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: 'Draft placeholder — not final legal terms. ', style: TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(
                    text: 'This page is a reasonable starting draft for a healthcare appointment platform. It has '
                        'not been reviewed by a lawyer and must not be treated as binding or launch-ready until '
                        'qualified legal counsel reviews it.',
                  ),
                ],
              ),
              style: TextStyle(fontSize: 13, color: AppColors.textPrimary, height: 1.4),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          for (final section in _sections)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(section[0], style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  const SizedBox(height: AppSpacing.xs),
                  Text(section[1], style: const TextStyle(color: AppColors.textSecondary, fontSize: 14, height: 1.5)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
