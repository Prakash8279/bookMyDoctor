import { SiteHeader } from './PublicPages'

// Placeholder legal content (plan: ErrorBoundary/legal-pages fix group).
// This is genuine, reasonable placeholder copy for a healthcare appointment
// platform — NOT reviewed or drafted by a lawyer. See the banner rendered
// below for the same notice shown to visitors; do not remove that banner
// without replacing this file's content with real, counsel-reviewed terms
// first. Sectioned as plain <article> content (matching PublicContent's
// about/blog layout in FeaturePages.jsx) rather than the "auth-page" split
// layout, since this is a single scrollable document, not a form.
const SECTIONS = [
  ['1. Acceptance of these terms', 'By creating an account or using BookMyDoctor24 ("the platform") as a patient, doctor, clinic, or clinic staff member, you agree to these Terms of Service. If you do not agree, do not use the platform.'],
  ['2. What the platform is — and is not', 'BookMyDoctor24 helps patients discover doctors and clinics, book appointments, and follow their live clinic queue. It also gives clinics tools to manage appointments, walk-ins, queues, and payments. BookMyDoctor24 is not a medical provider, does not practice medicine, and is not a substitute for professional medical judgment. In a medical emergency, contact local emergency services directly rather than relying on this platform.'],
  ['3. Accounts and eligibility', 'You must provide accurate registration information and keep your login credentials confidential. You are responsible for activity that happens under your account. Doctor accounts are created only after verification by an administrator; a doctor or clinic profile being listed does not itself guarantee availability, response time, or outcome of care.'],
  ['4. Appointments, queues, and payments', 'Booking an appointment reserves a queue position with the selected doctor or clinic, subject to that clinic’s own cancellation and rescheduling policies. Where an online advance payment is collected at booking, the remaining consultation fee (if any) is payable directly at the clinic. Refunds for cancelled or missed appointments follow the applicable clinic’s policy, shown at the time of booking.'],
  ['5. Acceptable use', 'You agree not to misuse the platform — including submitting false medical, identity, or payment information; attempting to access another user’s account or health records; disrupting clinic queues or bookings for others; or using the platform for anything unlawful.'],
  ['6. Doctor and clinic responsibilities', 'Doctors and clinics using BookMyDoctor24 remain solely responsible for the medical care they provide, for complying with applicable healthcare regulations and licensing requirements, and for the accuracy of the schedules, fees, and availability they publish on the platform.'],
  ['7. Changes to these terms', 'These terms may be updated as the platform changes. Continued use of BookMyDoctor24 after an update means you accept the revised terms.'],
  ['8. Contact', 'Questions about these terms can be sent through the Contact page, or to bookmydoctor24@gmail.com.'],
]

export function TermsOfService() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* Draft-legal-content notice — see the header comment above. This
            banner must stay visible on this page until real counsel has
            reviewed and replaced the placeholder text below it. */}
        <div className="rounded-button border border-gold/40 bg-gold/10 p-4 text-sm text-charcoal">
          <strong>Draft placeholder — not final legal terms.</strong> This page is a reasonable starting draft for a
          healthcare appointment platform. It has not been reviewed by a lawyer and must not be treated as binding or
          launch-ready until qualified legal counsel reviews it.
        </div>

        <article className="mt-6 rounded-card border border-border bg-white p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">Legal</p>
          <h1 className="mt-1 text-3xl">Terms of Service</h1>
          <p className="mt-2 text-sm text-muted">Last updated: this is placeholder content and has no effective date until reviewed and published by counsel.</p>

          <div className="mt-6 space-y-6">
            {SECTIONS.map(([heading, body]) => (
              <section key={heading}>
                <h2 className="text-xl">{heading}</h2>
                <p className="mt-2 leading-7 text-muted">{body}</p>
              </section>
            ))}
          </div>
        </article>
      </main>
    </>
  )
}
