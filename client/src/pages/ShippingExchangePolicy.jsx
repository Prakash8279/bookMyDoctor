import { Link } from 'react-router-dom'
import { SiteHeader } from './PublicPages'

export function ShippingExchangePolicy() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <article className="rounded-card border border-border bg-white p-5 shadow-card sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">Legal</p>
          <h1 className="mt-1 text-2xl sm:text-3xl">Shipping &amp; Exchange Policy</h1>
          <p className="mt-2 text-sm text-muted">Last updated: 21 October 2026</p>
          <div className="mt-6 space-y-6">
            <section>
              <h2 className="text-xl">Appointment services, not physical goods</h2>
              <p className="mt-2 leading-7 text-muted">BookADoctors is an appointment-booking and clinic queue platform. We do not sell or ship physical products. Shipping, courier delivery, and physical product exchanges are therefore not applicable to our services.</p>
            </section>
            <section>
              <h2 className="text-xl">Digital booking details</h2>
              <p className="mt-2 leading-7 text-muted">Booking status and confirmed appointment details are available digitally in your BookADoctors account. Where payment is required, confirmation and token allocation depend on successful payment verification. Visit times are approximate and depend on the clinic queue.</p>
            </section>
            <section>
              <h2 className="text-xl">Appointment changes, cancellations, and refunds</h2>
              <p className="mt-2 leading-7 text-muted">An appointment is not a physical product and cannot be exchanged as goods. For appointment cancellations and refund eligibility, please refer to our <Link to="/cancellation-refund-policy" className="font-semibold text-primary-dark underline">Cancellation &amp; Refund Policy</Link>. For help with a booking or a requested appointment change, <Link to="/contact" className="font-semibold text-primary-dark underline">contact support</Link>.</p>
            </section>
          </div>
        </article>
      </main>
    </>
  )
}
