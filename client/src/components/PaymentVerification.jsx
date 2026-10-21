import { Link } from 'react-router-dom'

export function PaymentVerification({ verification, onRetry }) {
  const pending = verification.phase === 'pending'
  const cancelled = verification.phase === 'cancelled'
  return <section className="mx-auto w-full max-w-xl" aria-live="polite">
    <h1 className="mb-4 text-2xl sm:text-3xl">{cancelled ? 'Booking not confirmed' : pending ? 'Confirmation is taking longer' : 'Verifying your payment'}</h1>
    <div className="rounded-card border border-border bg-white p-5 text-center shadow-card">
      {!pending && !cancelled && <p role="timer" aria-label="Payment verification countdown" className="text-4xl font-bold text-primary-dark">{Math.floor(verification.secondsLeft / 60)}:{String(verification.secondsLeft % 60).padStart(2, '0')}</p>}
      <p role="status" className="mt-4 text-sm text-muted">{cancelled ? 'This booking is cancelled or refunded. Check your appointments and payment status.' : pending ? 'We have not yet received final confirmation. Your payment may still be processing. Do not pay again.' : 'Checking with the payment gateway. Your token will appear as soon as the server confirms your booking. Please do not pay again.'}</p>
      {!cancelled && pending && <button type="button" onClick={onRetry} className="btn-primary mt-5">Check status again</button>}
      <Link to="/patient/appointments" className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary-dark">View my appointments</Link>
    </div>
  </section>
}
