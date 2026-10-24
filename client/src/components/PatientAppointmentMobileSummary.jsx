import { StatusPill } from './StatusPill'
import { appointmentTimeLabel, bookingCreatedAtLabel } from '../lib/appointmentTime'
import { clinicDirectionsUrl } from '../lib/clinicLocation'
import { formatDate, sequenceId, shortId } from '../lib/format'

const Detail = ({ label, children }) => <div className="flex min-w-0 items-start justify-between gap-3"><dt className="shrink-0 text-muted">{label}</dt><dd className="min-w-0 text-right [overflow-wrap:anywhere]">{children}</dd></div>

export function PatientAppointmentMobileSummary({ appointment, clinic, index, patientName, paymentStatus, paymentMethod, transaction, fee, paid, due }) {
  const directions = clinicDirectionsUrl(clinic)
  return <>
    <div className="flex min-w-0 items-start justify-between gap-2">
      <div className="min-w-0">
        <strong className="block truncate text-sm text-ink">{appointment.doctor?.name || 'Doctor'}</strong>
        <span className="block text-xs text-muted">Booking {shortId(appointment.id)}</span>
      </div>
      <StatusPill status={appointment.status} />
    </div>
    <p className="mt-1 text-[11px] text-muted">Booked on: {bookingCreatedAtLabel(appointment)}</p>
    <div className="mt-3 grid grid-cols-2 gap-2 rounded-button bg-surface p-2.5 text-xs">
      <div><span className="block text-muted">Visit</span><strong className="text-ink">{formatDate(appointment.appointmentDate)}</strong><span className="block text-muted">{appointmentTimeLabel(appointment)}</span></div>
      <div><span className="block text-muted">Token</span><strong className="text-base text-primary-dark">{appointment.tokenNumber != null ? `#${appointment.tokenNumber}` : '—'}</strong><span className="mt-1 block"><StatusPill status={paymentStatus} /></span></div>
    </div>
    <div className="mt-3 flex min-w-0 items-start justify-between gap-2 text-xs"><span className="min-w-0 text-muted">Patient <strong className="text-ink">{patientName}</strong></span><span className="shrink-0 font-semibold text-ink">Due ₹{due}</span></div>
    <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
      <span className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">{appointment.clinic?.name || 'Clinic not available'}</span>
      {directions && <a className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-button border border-border bg-surface px-2.5 font-semibold text-primary-dark hover:border-primary-dark" href={directions} target="_blank" rel="noopener noreferrer" title="Open clinic location in Google Maps"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>Location</a>}
    </div>
    <details className="mt-3 border-t border-border pt-2 text-xs">
      <summary className="cursor-pointer py-1 font-semibold text-primary-dark">More details</summary>
      <dl className="mt-2 grid gap-2">
        <Detail label="ID">{sequenceId(index)}</Detail>
        <Detail label="Booking ID">{shortId(appointment.id)}</Detail>
        <Detail label="Patient">{patientName}</Detail>
        <Detail label="Clinic">{appointment.clinic?.name || '—'}</Detail>
        <Detail label="Payment method">{paymentMethod}</Detail>
        <Detail label="Transaction">{transaction}</Detail>
        <Detail label="Fee">₹{fee}</Detail>
        <Detail label="Paid">₹{paid}</Detail>
        <Detail label="Due">₹{due}</Detail>
        <Detail label="Notes">{appointment.reason || appointment.notes || '—'}</Detail>
      </dl>
    </details>
  </>
}
