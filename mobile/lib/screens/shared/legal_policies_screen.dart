import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Mobile mirror of the website's three standalone legal pages (client/src/pages/PrivacyPolicy.jsx,
/// TermsOfService.jsx, CancellationRefundPolicy.jsx) — reachable from every role's "My profile"
/// screen (see profile_screen.dart's "Legal & policies" button), matching the product decision
/// that these documents live as real screens in both the app and the website, not just the
/// website. Content here is a manual copy, not shared code with the website (this is a Flutter
/// app, not a webview) — if the website copy changes, update the matching list below to keep
/// them in sync. Last synced with the website copy: 21 September 2026.
class LegalPoliciesScreen extends StatelessWidget {
  const LegalPoliciesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    Widget tile(IconData icon, String title, String subtitle, List<List<String>> sections, {String? intro}) {
      return Card(
        child: ListTile(
          leading: Icon(icon, color: AppColors.primary),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(subtitle, style: const TextStyle(fontSize: 12)),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => LegalDocumentScreen(title: title, lastUpdated: _lastUpdated, sections: sections, intro: intro),
          )),
        ),
      );
    }

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          const PageHeader(
            title: 'Legal & policies',
            subtitle: 'Privacy, terms of service, and our cancellation & refund policy.',
          ),
          tile(Icons.privacy_tip_outlined, 'Privacy Policy', 'What we collect, why, and who it’s shared with.', kPrivacySections),
          const SizedBox(height: AppSpacing.sm),
          tile(Icons.description_outlined, 'Terms of Service', 'The terms that govern using BookMyDoctor24.', kTermsSections),
          const SizedBox(height: AppSpacing.sm),
          tile(
            Icons.receipt_long_outlined,
            'Cancellation & Refund Policy',
            'How appointment cancellations, refunds, and payment issues are handled.',
            kCancellationSections,
            intro:
                'Doctor Connect is a technology platform that enables patients to discover doctors and book appointments. Cancellation and refund matters related to an appointment are primarily handled by the respective doctor or clinic.',
          ),
        ],
      ),
    );
  }
}

const _lastUpdated = '21 September 2026';

/// Generic renderer for a legal document: a title, an optional intro paragraph, and a numbered
/// list of (heading, body) sections — shared by all three documents above rather than three
/// near-identical screen classes.
class LegalDocumentScreen extends StatelessWidget {
  final String title;
  final String lastUpdated;
  final List<List<String>> sections;
  final String? intro;

  const LegalDocumentScreen({
    super.key,
    required this.title,
    required this.lastUpdated,
    required this.sections,
    this.intro,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('Last updated: $lastUpdated', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          if (intro != null) ...[
            const SizedBox(height: AppSpacing.md),
            Text(intro!, style: const TextStyle(height: 1.5)),
          ],
          const SizedBox(height: AppSpacing.lg),
          for (final section in sections) ...[
            Text(section[0], style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(section[1], style: const TextStyle(height: 1.5)),
            const SizedBox(height: AppSpacing.lg),
          ],
        ],
      ),
    );
  }
}

// Mirrors client/src/pages/PrivacyPolicy.jsx's SECTIONS exactly (as of the September 2026
// production-readiness pass) — same headings, same wording. Section 9's "account & data deletion
// request page" link on the website is this app's own Profile > "Delete my account" screen.
const kPrivacySections = <List<String>>[
  [
    '1. Scope',
    'This Privacy Policy applies to the BookMyDoctor24 website and mobile app ("the platform"), operated by BookMyDoctor24. It describes what information we collect from patients, doctors, clinic staff (receptionists/admins), and visitors, why we collect it, who we share it with, and the choices available to you. It applies whether you use the platform as a registered account holder or as a visitor browsing public pages.',
  ],
  [
    '2. Information we collect',
    "Account & contact details: your name, email address, phone number, and password (stored as a one-way bcrypt hash — we never store or can recover your actual password) when you register or log in. Health & profile information: for patients, information you or your treating doctor add in connection with an appointment — this can include free-text clinical notes, prescriptions, and medical history entered by a doctor during or after a consultation. For doctors, your medical specialization, registration/qualification details, clinic affiliations, consultation fees, and profile bio. Family member records: if you use the \"family members\" feature to book appointments for dependants, we store the name, relationship, and any appointment/medical details you enter for that family member under your own account. Appointment & queue data: bookings, appointment status, live queue position, check-in times, and consultation outcomes. Uploaded files: any documents, prescriptions, or photos you or your clinic upload in connection with a consultation are stored on our servers and linked to the relevant appointment or profile. Payment information: when you pay for a consultation online, payment is processed by Razorpay, our third-party payment gateway — we receive and store the payment amount, status, and a Razorpay transaction reference, but we do not receive, process, or store your card, UPI, or bank account details; those are handled entirely within Razorpay's own secure checkout. Notifications: we send appointment, queue, and account-related notifications; if a message channel requires it, the content of that notification (e.g. a reminder) may pass through the relevant delivery channel. Technical information: standard request metadata such as IP address, browser/device type, and timestamps, collected automatically for security, rate-limiting, and abuse-prevention purposes (for example, detecting repeated failed logins).",
  ],
  [
    '3. What we do not collect',
    'To be specific about the boundaries of data collection: we do not collect precise GPS or real-time device location — only the city/area you select yourself while searching for a clinic. We do not currently use third-party analytics or advertising SDKs of any kind, so no behavioral or ad-targeting data is collected or shared with ad networks. We do not currently offer social login (e.g. "Sign in with Google/Facebook") — accounts are created directly with an email and password, so no data is exchanged with a social login provider. If any of this changes in the future (for example, if we add analytics to improve the product), we will update this policy before that change takes effect.',
  ],
  [
    '4. How we use this information',
    'We use the information above to: create, secure, and authenticate your account; let patients search for doctors/clinics and book, manage, reschedule, or cancel appointments; let doctors and clinic staff record and manage the care and consultations they provide through the platform; operate live clinic queues and check-in flows; process online payments via Razorpay and reconcile clinic payouts; send appointment, queue, and account-related notifications; investigate and prevent fraud, abuse, or violations of our Terms of Service; and comply with legal, regulatory, or law-enforcement requests where required. We do not sell your personal or health information to anyone, and we do not use it for advertising.',
  ],
  [
    '5. Who your information is shared with',
    "Within a booking, your relevant information is visible to the specific doctor and clinic you book with, and to that clinic's receptionist/staff accounts, strictly to manage your visit — this is necessary for the platform to function as a clinic-booking tool. Administrators of the platform can access account and operational data as needed for verification, support, moderation, and fraud prevention. Razorpay, our payment processor, receives the payment details needed to process your transaction, under its own privacy policy and PCI-DSS obligations. We may disclose information where required by applicable law, regulation, legal process, or a valid government/law-enforcement request. We do not share, rent, or sell your information to advertisers, data brokers, or unrelated third parties.",
  ],
  [
    '6. Security measures',
    'We apply industry-standard safeguards proportionate to a healthcare-adjacent platform: passwords are hashed with bcrypt and never stored in plain text; sessions use signed JSON Web Tokens with a restricted signing-algorithm allowlist; access to clinical, appointment, and account data is restricted by role (patient/doctor/receptionist/admin/superadmin), so a user only sees what their role and relationship to a record entitles them to; login, password-reset, and token-refresh endpoints are rate-limited to slow down automated abuse; and in production, all traffic is redirected to HTTPS. No system is completely secure, and no method of transmission or storage can be guaranteed 100% secure — we cannot promise absolute security, but we work to keep these protections current.',
  ],
  [
    '7. Data retention',
    "We retain account, appointment, and health-related information for as long as your account remains active, and for a reasonable period afterward to meet recordkeeping obligations that commonly apply to healthcare-adjacent and financial services (for example, payment records may need to be retained longer than other data for accounting and tax purposes). If you request deletion of your account (see Section 9), we will delete or anonymize the information we control, except where we are legally required or permitted to retain it — for example, a clinic's own clinical records of a completed consultation, financial records needed for tax/audit purposes, or information relevant to an open dispute or investigation.",
  ],
  [
    "8. Children's data / family members",
    "The platform is intended for use by adults managing their own healthcare, and, through the \"family members\" feature, for booking appointments on behalf of dependants (including minors) under a parent or guardian's own account. We do not knowingly allow a minor to independently create and control their own account. If you add a family member's details, you confirm you are authorized to do so on their behalf.",
  ],
  [
    '9. Your rights and choices',
    "You can review and update most of your profile information directly from your account settings. You may request access to, correction of, or deletion of your personal information, or ask what information we hold about you, from Profile > \"Delete my account\" in this app (no login required on the website's equivalent page) or by contacting us at the details in Section 12. Some records — such as a clinic's own clinical notes on a completed consultation, or financial records tied to a payment — may need to be retained by the clinic or by us independently of your account, for medical recordkeeping or legal reasons, even after your account is deleted; we will tell you if this applies when you make a request.",
  ],
  [
    '10. Applicable law',
    "We aim to handle personal data in a manner consistent with India's Digital Personal Data Protection Act, 2023 (DPDP Act) and the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011 and IT Rules, 2021, as applicable to a platform of this kind. This section is a general statement of intent rather than a certified legal compliance claim, and we recommend a review by qualified legal counsel for your specific circumstances.",
  ],
  [
    '11. Changes to this policy',
    'We may update this Privacy Policy as the platform changes. If we make a material change to how health-related information is collected, used, or shared, we will make reasonable efforts to notify users (for example, via an in-app or email notice) before the change takes effect. The "Last updated" date above reflects the most recent revision.',
  ],
  [
    '12. Contact & grievance officer',
    'Questions about this policy, or requests about your information, can be sent through our Contact page, or to bookmydoctor24@gmail.com. As required under Indian IT Rules for a grievance-redressal contact point: Grievance Officer contact — bookmydoctor24@gmail.com. We aim to acknowledge grievances promptly and resolve them within the timeframe required by applicable law.',
  ],
];

// Mirrors client/src/pages/TermsOfService.jsx's SECTIONS exactly (as of the September 2026
// production-readiness pass).
const kTermsSections = <List<String>>[
  [
    '1. Acceptance of these terms',
    'By creating an account or using BookMyDoctor24 ("the platform") as a patient, doctor, clinic, or clinic staff member, you agree to these Terms of Service. If you do not agree, do not use the platform.',
  ],
  [
    '2. What the platform is — and is not',
    'BookMyDoctor24 helps patients discover doctors and clinics, book appointments, and follow their live clinic queue. It also gives clinics tools to manage appointments, walk-ins, queues, and payments. BookMyDoctor24 is not a medical provider, does not practice medicine, and is not a substitute for professional medical judgment. In a medical emergency, contact local emergency services directly rather than relying on this platform.',
  ],
  [
    '3. Accounts and eligibility',
    'You must provide accurate registration information and keep your login credentials confidential. You are responsible for activity that happens under your account. Doctor accounts are created only after verification by an administrator; a doctor or clinic profile being listed does not itself guarantee availability, response time, or outcome of care.',
  ],
  [
    '4. Appointments, queues, and payments',
    "Booking an appointment reserves a queue position with the selected doctor or clinic, subject to that clinic's own cancellation and rescheduling policies. Where an online advance payment is collected at booking, the remaining consultation fee (if any) is payable directly at the clinic. Cancellations and refunds are governed by our Cancellation & Refund Policy (see the Legal & policies section).",
  ],
  [
    '5. Acceptable use',
    "You agree not to misuse the platform — including submitting false medical, identity, or payment information; attempting to access another user's account or health records; disrupting clinic queues or bookings for others; or using the platform for anything unlawful.",
  ],
  [
    '6. Doctor and clinic responsibilities',
    'Doctors and clinics using BookMyDoctor24 remain solely responsible for the medical care they provide, for complying with applicable healthcare regulations and licensing requirements, and for the accuracy of the schedules, fees, and availability they publish on the platform.',
  ],
  [
    '7. Limitation of liability',
    "BookMyDoctor24 acts as a technology platform connecting patients with independent doctors and clinics. To the maximum extent permitted by applicable law, BookMyDoctor24 is not liable for the medical care, advice, diagnosis, or treatment provided by any doctor or clinic listed on the platform, or for any loss arising from a doctor or clinic's own scheduling, cancellation, or refund decisions.",
  ],
  [
    '8. Changes to these terms',
    'These terms may be updated as the platform changes. Continued use of BookMyDoctor24 after an update means you accept the revised terms.',
  ],
  [
    '9. Governing law',
    'These terms are governed by the laws of India, without regard to its conflict-of-law principles.',
  ],
  [
    '10. Contact',
    'Questions about these terms can be sent through the Contact page, or to bookmydoctor24@gmail.com.',
  ],
];

// Mirrors client/src/pages/CancellationRefundPolicy.jsx exactly — verbatim text supplied
// directly by the platform operator. Do NOT paraphrase or edit this content.
const kCancellationSections = <List<String>>[
  [
    '1. Appointment Cancellation',
    'If you wish to cancel an appointment, please contact the respective doctor or clinic directly.\n\nCancellation availability and any applicable cancellation conditions may vary depending on the doctor or clinic.',
  ],
  [
    '2. Refund',
    'Any refund related to a cancelled appointment will be subject to the refund policy and decision of the respective doctor or clinic.\n\nDoctor Connect does not independently determine or guarantee refunds for appointments cancelled by patients or doctors.\n\nFor cancellation or refund-related queries, please contact the respective doctor or clinic directly.',
  ],
  [
    '3. Payment Failure',
    'If your payment fails, or if the payment amount is deducted from your bank account but the appointment is not confirmed, please contact Doctor Connect through the Contact Us / Customer Support section available on our website.\n\nPlease provide your transaction/payment details so that our support team can verify the payment status and assist you.',
  ],
  [
    '4. Duplicate Payment',
    "If you believe that you have been charged more than once for the same appointment, please contact Doctor Connect through our website's Contact Us / Customer Support section with the relevant transaction details.",
  ],
  [
    '5. Important Notice',
    'Doctor Connect acts as a technology platform for appointment booking and does not control the individual cancellation or refund policies of doctors or clinics.\n\nThe applicable refund, if any, will be processed according to the terms and procedures applicable to the respective appointment and payment transaction.',
  ],
];
