import { SiteHeader } from './PublicPages'

// Cancellation & Refund Policy page. The body text below is verbatim, exact wording supplied
// directly by the platform operator as the final legal text for this policy (product decision —
// "production ready karo" request, 2026-09). Do NOT paraphrase, reorder, or edit this content; if
// the policy needs to change, get updated exact text from the operator rather than rewording it
// here. Routed at /cancellation-refund-policy (App.jsx) and linked from the site footer, and
// mirrored as its own screen in the mobile app (mobile/lib/screens/shared/legal_policies_screen.dart)
// so both surfaces show the identical text.
const SECTIONS = [
  [
    '1. Appointment Cancellation',
    <>
      If you wish to cancel an appointment, please contact the respective doctor or clinic directly.
      <br />
      Cancellation availability and any applicable cancellation conditions may vary depending on the doctor or clinic.
    </>,
  ],
  [
    '2. Refund',
    <>
      Any refund related to a cancelled appointment will be subject to the refund policy and decision of the respective doctor or clinic.
      <br />
      Doctor Connect does not independently determine or guarantee refunds for appointments cancelled by patients or doctors.
      <br />
      For cancellation or refund-related queries, please contact the respective doctor or clinic directly.
    </>,
  ],
  [
    '3. Payment Failure',
    <>
      If your payment fails, or if the payment amount is deducted from your bank account but the appointment is not confirmed, please contact Doctor Connect through the Contact Us / Customer Support section available on our website.
      <br />
      Please provide your transaction/payment details so that our support team can verify the payment status and assist you.
    </>,
  ],
  [
    '4. Duplicate Payment',
    'If you believe that you have been charged more than once for the same appointment, please contact Doctor Connect through our website\'s Contact Us / Customer Support section with the relevant transaction details.',
  ],
  [
    '5. Important Notice',
    <>
      Doctor Connect acts as a technology platform for appointment booking and does not control the individual cancellation or refund policies of doctors or clinics.
      <br />
      The applicable refund, if any, will be processed according to the terms and procedures applicable to the respective appointment and payment transaction.
    </>,
  ],
]

export function CancellationRefundPolicy() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <article className="mt-2 rounded-card border border-border bg-white p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">Legal</p>
          <h1 className="mt-1 text-3xl">Cancellation & Refund Policy</h1>
          <p className="mt-4 leading-7 text-muted">
            Doctor Connect is a technology platform that enables patients to discover doctors and book appointments.
            Cancellation and refund matters related to an appointment are primarily handled by the respective doctor
            or clinic.
          </p>

          <div className="mt-6 space-y-6">
            {SECTIONS.map(([heading, body]) => (
              <section key={heading}>
                <h2 className="text-xl">{heading}</h2>
                <p className="mt-2 leading-7 text-muted">{body}</p>
              </section>
            ))}
          </div>

          <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
            For any cancellation, refund, payment-failure, or duplicate-payment query, use our{' '}
            <a href="/contact" className="font-semibold text-primary-dark underline">Contact Us / Customer Support</a> page.
          </p>
        </article>
      </main>
    </>
  )
}
