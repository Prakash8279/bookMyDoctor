import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (mobile parity): mirrors web's Privacy Policy page
/// (client/src/pages/PrivacyPolicy.jsx) — same 12 numbered sections,
/// condensed for a mobile scroll view but keeping every section's
/// substance, including the `[FILL: ...]` placeholders that page
/// intentionally leaves for business/legal facts (registered company
/// name, grievance officer contact) rather than inventing them.
class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});

  static const _sections = [
    [
      '1. Scope',
      'This Privacy Policy applies to the BookADoctors website and mobile app ("the platform"), operated by '
          '[FILL: legal company/proprietor name]. It describes what information we collect from patients, '
          'doctors, clinic staff, and visitors, why we collect it, who we share it with, and the choices '
          'available to you — whether you use the platform as a registered account holder or as a visitor '
          'browsing public pages.',
    ],
    [
      '2. Information we collect',
      'Account & contact details (name, email, phone, and a bcrypt-hashed password we can never recover). '
          'Health & profile information (for patients: clinical notes, prescriptions, and history a doctor adds '
          'during a consultation; for doctors: specialization, qualifications, clinic affiliations, fees, bio). '
          'Family member records you add under your own account for booking on behalf of dependants. '
          'Appointment & queue data (bookings, status, live queue position, check-in times, outcomes). Uploaded '
          'files (documents, prescriptions, or photos linked to a consultation). Payment information: online '
          'payments are processed by Razorpay — we receive and store the amount, status, and a transaction '
          'reference, but never your card, UPI, or bank details, which stay entirely within Razorpay\'s own '
          'checkout. Notification content when a delivery channel requires it. Technical information such as IP '
          'address, device/browser type, and timestamps, collected for security and abuse-prevention.',
    ],
    [
      '3. What we do not collect',
      'We do not collect precise GPS or real-time location — only the city/area you select yourself. We do not '
          'currently use third-party analytics or advertising SDKs, so no behavioral or ad-targeting data is '
          'collected or shared with ad networks. We do not currently offer social login, so no data is exchanged '
          'with a social login provider. We will update this policy before any of this changes.',
    ],
    [
      '4. How we use this information',
      'To create, secure, and authenticate your account; let patients search for and book with doctors/clinics; '
          'let doctors and clinic staff record and manage care through the platform; operate live clinic queues '
          'and check-in; process payments via Razorpay and reconcile clinic payouts; send appointment, queue, and '
          'account notifications; investigate and prevent fraud or abuse; and comply with legal or regulatory '
          'requests. We do not sell your personal or health information, and we do not use it for advertising.',
    ],
    [
      '5. Who your information is shared with',
      'The specific doctor and clinic you book with, and that clinic\'s receptionist/staff accounts, strictly to '
          'manage your visit. Platform administrators, for verification, support, moderation, and fraud '
          'prevention. Razorpay, our payment processor, receives only what it needs to process your transaction. '
          'We may disclose information where required by law, regulation, or a valid legal/government request. We '
          'do not share, rent, or sell your information to advertisers, data brokers, or unrelated third parties.',
    ],
    [
      '6. Security measures',
      'Passwords are hashed with bcrypt and never stored in plain text. Sessions use signed JSON Web Tokens with '
          'a restricted signing-algorithm allowlist. Access to clinical, appointment, and account data is '
          'restricted by role (patient/doctor/receptionist/admin/superadmin). Login, password-reset, and '
          'token-refresh endpoints are rate-limited against automated abuse, and production traffic is redirected '
          'to HTTPS. No method of transmission or storage can be guaranteed 100% secure, but we keep these '
          'protections current.',
    ],
    [
      '7. Data retention',
      'We retain account, appointment, and health-related information for as long as your account is active, and '
          'a reasonable period afterward for recordkeeping obligations common to healthcare-adjacent and financial '
          'services (payment records may be kept longer for accounting/tax purposes). If you request deletion (see '
          'Section 9), we delete or anonymize what we control, except where legally required to retain it — e.g. a '
          'clinic\'s own clinical records, financial records, or records relevant to an open dispute.',
    ],
    [
      '8. Children\'s data / family members',
      'The platform is intended for adults managing their own healthcare, and, through the "family members" '
          'feature, for booking on behalf of dependants (including minors) under a parent or guardian\'s own '
          'account. We do not knowingly let a minor independently create and control their own account. Adding a '
          'family member\'s details confirms you are authorized to do so on their behalf.',
    ],
    [
      '9. Your rights and choices',
      'You can review and update most profile information from your account settings. You may request access to, '
          'correction of, or deletion of your personal information, or ask what we hold about you, using the '
          'account & data deletion request screen (no login required) or by contacting us — see Section 12. Some '
          'records, such as a clinic\'s own clinical notes or financial records tied to a payment, may need to be '
          'retained independently of your account for medical recordkeeping or legal reasons even after deletion; '
          'we will tell you if this applies to your request.',
    ],
    [
      '10. Applicable law',
      'We aim to handle personal data consistent with India\'s Digital Personal Data Protection Act, 2023 (DPDP '
          'Act) and the applicable IT Rules. This is a general statement of intent rather than a certified legal '
          'compliance claim; [FILL: confirm applicable-law statement with counsel before publishing].',
    ],
    [
      '11. Changes to this policy',
      'We may update this Privacy Policy as the platform changes. If we make a material change to how '
          'health-related information is collected, used, or shared, we will make reasonable efforts to notify '
          'users before the change takes effect. The "Last updated" date reflects the most recent revision.',
    ],
    [
      '12. Contact & grievance officer',
      'Questions about this policy, or requests about your information, can be sent through the Contact screen, '
          'or to bookmydoctors@gmail.com. As required under Indian IT Rules for a grievance-redressal contact '
          'point: Grievance Officer — [FILL: name], [FILL: designation], [FILL: email/phone], [FILL: registered '
          'address]. We aim to acknowledge grievances promptly and resolve them within the timeframe required by '
          'applicable law.',
    ],
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy Policy')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          const PageHeader(
            kicker: 'Legal',
            title: 'Privacy Policy',
            subtitle: 'Last updated: [FILL: publish date] — set this to the real date you publish this policy '
                'before submitting to the Play Store.',
          ),
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
          const Divider(),
          const Padding(
            padding: EdgeInsets.only(top: AppSpacing.sm),
            child: Text(
              'This policy reflects the platform\'s actual data practices as implemented. Fields marked '
              '[FILL: ...] depend on your registered business details and should be completed, and this page '
              'should be reviewed by qualified legal counsel, before you rely on it as your final published '
              'policy.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}
