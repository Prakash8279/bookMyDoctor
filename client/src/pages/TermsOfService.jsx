import { Link } from 'react-router-dom'
import { SiteHeader } from './PublicPages'

// Finalized for production launch (product decision, September 2026): promoted from the earlier
// engineering draft to the platform's live Terms of Service. This was written by an engineering
// pass, not by a lawyer — as with any startup's terms, we recommend a periodic review by
// qualified legal counsel as the platform and applicable regulations evolve, but that
// recommendation does not block publishing reasonable, accurate terms today. Sectioned as plain
// <article> content (matching PublicContent's about/blog layout in FeaturePages.jsx) rather than
// the "auth-page" split layout, since this is a single scrollable document, not a form.
const LAST_UPDATED = '21 September 2026'

const SECTIONS = [
  ['1. Acceptance of these terms', 'By creating an account or using BookMyDoctors ("the platform") as a patient, doctor, clinic, or clinic staff member, you agree to these Terms of Service. If you do not agree, do not use the platform.'],
  ['2. What the platform is — and is not', 'BookMyDoctors helps patients discover doctors and clinics, book appointments, and follow their live clinic queue. It also gives clinics tools to manage appointments, walk-ins, queues, and payments. BookMyDoctors is not a medical provider, does not practice medicine, and is not a substitute for professional medical judgment. In a medical emergency, contact local emergency services directly rather than relying on this platform.'],
  ['3. Accounts and eligibility', 'You must provide accurate registration information and keep your login credentials confidential. You are responsible for activity that happens under your account. Doctor accounts are created only after verification by an administrator; a doctor or clinic profile being listed does not itself guarantee availability, response time, or outcome of care.'],
  [
    '4. Appointments, queues, and payments',
    <>
      Booking an appointment reserves a queue position with the selected doctor or clinic, subject to that clinic's own cancellation and rescheduling policies. Where an online advance payment is collected at booking, the remaining consultation fee (if any) is payable directly at the clinic. Cancellations and refunds are governed by our{' '}
      <Link to="/cancellation-refund-policy" className="font-semibold text-primary-dark underline">Cancellation &amp; Refund Policy</Link>.
    </>,
  ],
  ['5. Acceptable use', 'You agree not to misuse the platform — including submitting false medical, identity, or payment information; attempting to access another user’s account or health records; disrupting clinic queues or bookings for others; or using the platform for anything unlawful.'],
  ['6. Doctor and clinic responsibilities', 'Doctors and clinics using BookMyDoctors remain solely responsible for the medical care they provide, for complying with applicable healthcare regulations and licensing requirements, and for the accuracy of the schedules, fees, and availability they publish on the platform.'],
  ['7. Limitation of liability', 'BookMyDoctors acts as a technology platform connecting patients with independent doctors and clinics. To the maximum extent permitted by applicable law, BookMyDoctors is not liable for the medical care, advice, diagnosis, or treatment provided by any doctor or clinic listed on the platform, or for any loss arising from a doctor or clinic\'s own scheduling, cancellation, or refund decisions.'],
  ['8. Changes to these terms', 'These terms may be updated as the platform changes. Continued use of BookMyDoctors after an update means you accept the revised terms.'],
  ['9. Governing law', 'These terms are governed by the laws of India, without regard to its conflict-of-law principles.'],
  ['10. Contact', 'Questions about these terms can be sent through the Contact page, or to bookmydoctors@gmail.com.'],
]

export function TermsOfService() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <article className="mt-2 rounded-card border border-border bg-white p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">Legal</p>
          <h1 className="mt-1 text-3xl">Terms of Service</h1>
          <p className="mt-2 text-sm text-muted">Last updated: {LAST_UPDATED}</p>

          <div className="mt-6 space-y-6">
            {SECTIONS.map(([heading, body]) => (
              <section key={heading}>
                <h2 className="text-xl">{heading}</h2>
                <p className="mt-2 leading-7 text-muted">{body}</p>
              </section>
            ))}
          </div>

          <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
            These terms are provided by BookMyDoctors. We recommend a periodic review by qualified legal counsel as
            the platform and applicable regulations evolve.
          </p>
        </article>
      </main>
    </>
  )
}
