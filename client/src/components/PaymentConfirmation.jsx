import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export function PaymentConfirmation({ appointment, onClose }) {
  const [showToken, setShowToken] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setShowToken(true), 2000)
    return () => window.clearTimeout(timer)
  }, [])

  return <section aria-live="polite" className="mx-auto max-w-xl">
    <h1 className="mb-5 text-2xl sm:text-3xl">{showToken ? 'Your appointment token' : 'Payment confirmed'}</h1>
    <div className="rounded-card border border-success/30 bg-white p-6 text-center shadow-card">
      <div aria-hidden="true" className="mx-auto grid size-14 place-items-center rounded-full bg-success/10 text-3xl text-success">✓</div>
      <h2 className="mt-3 text-xl font-semibold">{showToken ? 'Booking confirmed' : 'Payment successful'}</h2>
      <p className="mt-2 text-sm text-muted">{appointment.doctor?.name || 'Doctor'} · {appointment.appointmentDate}</p>
      {showToken ? <>
        <p className="mt-5 text-4xl font-bold text-primary-dark">Token #{appointment.tokenNumber}</p>
        {appointment.paymentStatus === 'paid' ? <p className="mt-3 text-sm font-semibold text-success">✓ Paid online</p> : <p className="mt-3 text-sm font-semibold text-success">✓ Booking amount paid online — balance due at the clinic</p>}
        {appointment.clinic?.name && <p className="mt-2 text-sm text-muted">{appointment.clinic.name}</p>}
        <p className="mt-3 text-sm text-muted">Follow your token and consultation status in the queue tracker.</p>
        <Link to="/patient/appointments" onClick={onClose} className="btn-primary mt-5 inline-flex">View my appointments</Link>
      </> : <>
        <p role="status" className="mt-4 text-sm text-muted">Your booking is confirmed. Opening your token details…</p>
        <button type="button" onClick={() => setShowToken(true)} className="btn-primary mt-5">View token now</button>
      </>}
    </div>
  </section>
}
