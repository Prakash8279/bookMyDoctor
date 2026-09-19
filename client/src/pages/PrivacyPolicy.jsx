import { Link } from 'react-router-dom'
import { SiteHeader } from './PublicPages'

// Rewritten for Play Store submission readiness (product request: "privacy
// policy launch-ready level pe lao"). Content below is grounded in the
// platform's actual, verified data practices (auth/session model, Prisma
// schema, Razorpay integration, notification flows, upload handling) rather
// than generic boilerplate. Two things are intentionally left as `[FILL: ...]`
// placeholders because they depend on business/legal facts only the operator
// can supply (registered company name & address, grievance officer contact) —
// per an explicit product decision to keep placeholders there rather than
// invent them. Everything else describes what the app actually does today.
//
// Still recommended before public launch: a pass by qualified legal counsel,
// particularly for the DPDP Act / IT Rules references below, since this was
// written by an engineering pass, not by a lawyer.
const EFFECTIVE_DATE_NOTE = 'Set this to the real date you publish this policy before submitting to the Play Store.'

const SECTIONS = [
  [
    '1. Scope',
    'This Privacy Policy applies to the BookMyDoctor24 website and mobile app ("the platform"), operated by [FILL: legal company/proprietor name]. It describes what information we collect from patients, doctors, clinic staff (receptionists/admins), and visitors, why we collect it, who we share it with, and the choices available to you. It applies whether you use the platform as a registered account holder or as a visitor browsing public pages.',
  ],
  [
    '2. Information we collect',
    'Account & contact details: your name, email address, phone number, and password (stored as a one-way bcrypt hash — we never store or can recover your actual password) when you register or log in. Health & profile information: for patients, information you or your treating doctor add in connection with an appointment — this can include free-text clinical notes, prescriptions, and medical history entered by a doctor during or after a consultation. For doctors, your medical specialization, registration/qualification details, clinic affiliations, consultation fees, and profile bio. Family member records: if you use the "family members" feature to book appointments for dependants, we store the name, relationship, and any appointment/medical details you enter for that family member under your own account. Appointment & queue data: bookings, appointment status, live queue position, check-in times, and consultation outcomes. Uploaded files: any documents, prescriptions, or photos you or your clinic upload in connection with a consultation are stored on our servers and linked to the relevant appointment or profile. Payment information: when you pay for a consultation online, payment is processed by Razorpay, our third-party payment gateway — we receive and store the payment amount, status, and a Razorpay transaction reference, but we do not receive, process, or store your card, UPI, or bank account details; those are handled entirely within Razorpay\'s own secure checkout. Notifications: we send appointment, queue, and account-related notifications; if a message channel requires it, the content of that notification (e.g. a reminder) may pass through the relevant delivery channel. Technical information: standard request metadata such as IP address, browser/device type, and timestamps, collected automatically for security, rate-limiting, and abuse-prevention purposes (for example, detecting repeated failed logins).',
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
    'Within a booking, your relevant information is visible to the specific doctor and clinic you book with, and to that clinic\'s receptionist/staff accounts, strictly to manage your visit — this is necessary for the platform to function as a clinic-booking tool. Administrators of the platform can access account and operational data as needed for verification, support, moderation, and fraud prevention. Razorpay, our payment processor, receives the payment details needed to process your transaction, under its own privacy policy and PCI-DSS obligations. We may disclose information where required by applicable law, regulation, legal process, or a valid government/law-enforcement request. We do not share, rent, or sell your information to advertisers, data brokers, or unrelated third parties.',
  ],
  [
    '6. Security measures',
    'We apply industry-standard safeguards proportionate to a healthcare-adjacent platform: passwords are hashed with bcrypt and never stored in plain text; sessions use signed JSON Web Tokens with a restricted signing-algorithm allowlist; access to clinical, appointment, and account data is restricted by role (patient/doctor/receptionist/admin/superadmin), so a user only sees what their role and relationship to a record entitles them to; login, password-reset, and token-refresh endpoints are rate-limited to slow down automated abuse; and in production, all traffic is redirected to HTTPS. No system is completely secure, and no method of transmission or storage can be guaranteed 100% secure — we cannot promise absolute security, but we work to keep these protections current.',
  ],
  [
    '7. Data retention',
    'We retain account, appointment, and health-related information for as long as your account remains active, and for a reasonable period afterward to meet recordkeeping obligations that commonly apply to healthcare-adjacent and financial services (for example, payment records may need to be retained longer than other data for accounting and tax purposes). If you request deletion of your account (see Section 9), we will delete or anonymize the information we control, except where we are legally required or permitted to retain it — for example, a clinic\'s own clinical records of a completed consultation, financial records needed for tax/audit purposes, or information relevant to an open dispute or investigation.',
  ],
  [
    '8. Children\'s data / family members',
    'The platform is intended for use by adults managing their own healthcare, and, through the "family members" feature, for booking appointments on behalf of dependants (including minors) under a parent or guardian\'s own account. We do not knowingly allow a minor to independently create and control their own account. If you add a family member\'s details, you confirm you are authorized to do so on their behalf.',
  ],
  [
    '9. Your rights and choices',
    <>
      You can review and update most of your profile information directly from your account settings. You may request access to, correction of, or deletion of your personal information, or ask what information we hold about you, by using our{' '}
      <Link to="/delete-account" className="font-semibold text-primary-dark underline">
        account & data deletion request page
      </Link>{' '}
      (no login required) or by contacting us at the details in Section 12. Some records — such as a clinic's own clinical notes on a completed consultation, or financial records tied to a payment — may need to be retained by the clinic or by us independently of your account, for medical recordkeeping or legal reasons, even after your account is deleted; we will tell you if this applies when you make a request.
    </>,
  ],
  [
    '10. Applicable law',
    'We aim to handle personal data in a manner consistent with India\'s Digital Personal Data Protection Act, 2023 (DPDP Act) and the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011 and IT Rules, 2021, as applicable to a platform of this kind. This section is a general statement of intent rather than a certified legal compliance claim; [FILL: confirm applicable-law statement with counsel before publishing].',
  ],
  [
    '11. Changes to this policy',
    'We may update this Privacy Policy as the platform changes. If we make a material change to how health-related information is collected, used, or shared, we will make reasonable efforts to notify users (for example, via an in-app or email notice) before the change takes effect. The "Last updated" date below reflects the most recent revision.',
  ],
  [
    '12. Contact & grievance officer',
    'Questions about this policy, or requests about your information, can be sent through our Contact page, or to bookmydoctor24@gmail.com. As required under Indian IT Rules for a grievance-redressal contact point: Grievance Officer — [FILL: name], [FILL: designation], [FILL: email/phone], [FILL: registered address]. We aim to acknowledge grievances promptly and resolve them within the timeframe required by applicable law.',
  ],
]

export function PrivacyPolicy() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <article className="mt-2 rounded-card border border-border bg-white p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">Legal</p>
          <h1 className="mt-1 text-3xl">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted">Last updated: [FILL: publish date] — {EFFECTIVE_DATE_NOTE}</p>

          <div className="mt-6 space-y-6">
            {SECTIONS.map(([heading, body]) => (
              <section key={heading}>
                <h2 className="text-xl">{heading}</h2>
                <p className="mt-2 leading-7 text-muted">{body}</p>
              </section>
            ))}
          </div>

          <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
            This policy reflects the platform's actual data practices as implemented. A few fields marked{' '}
            <code className="rounded bg-surface px-1 py-0.5">[FILL: ...]</code> depend on your registered business
            details and should be completed, and this page should be reviewed by qualified legal counsel, before you
            rely on it as your final published policy.
          </p>
        </article>
      </main>
    </>
  )
}
