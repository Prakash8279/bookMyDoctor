import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, Line } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js'
import { DataTable } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { FormField } from '../components/FormField'
import { StatCard } from '../components/StatCard'
import { StatusPill } from '../components/StatusPill'
import { PaymentSourceBadge } from '../components/PaymentSourceBadge'
import { theme } from '../lib/theme'
import { doctorCharge, isOnlineBookingPayment } from '../lib/paymentVisibility'
import { useAppStore } from '../store/useAppStore'
import { sequenceId, shortId } from '../lib/format'
import { buildCsv, downloadCsv } from '../lib/csv'
import { useDeleteWithConfirm } from '../hooks/useDeleteWithConfirm'
import { buildStaffReceiptPdfBlob } from '../lib/receiptPdf'
import { usePdfPreview } from '../hooks/usePdfPreview'
import { PdfPreviewModal } from '../components/PdfPreviewModal'
ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip)

// BUG FIX (found live: a doctor saving an invalid IFSC code in the bank-details form below saw
// only "Validation failed" with no indication of which field or why). Every 422 VALIDATION_ERROR
// from the backend (validateRequest.js) carries the SAME generic top-level message
// ("Validation failed") — the actually useful, field-specific reason
// (e.g. "bankIfscCode must be a valid 11-character IFSC code…") only ever exists in
// `err.details[0].message` (apiClient.js's shapeError attaches the server's `error.details`
// array as `err.details`). Every catch block in this file that previously read `err.message`
// directly now goes through this helper instead, so the specific reason surfaces whenever the
// backend sent one — behaviorally identical to before when it didn't (err.details absent/empty),
// which is what every existing mocked `new Error(...)` in this file's tests already looks like.
function firstErrorMessage(err, fallback) {
  const fieldMessage = Array.isArray(err?.details) && err.details[0] && err.details[0].message
  return fieldMessage || err?.message || fallback
}

const Page = ({ title, subtitle, children, action, kicker }) => <section><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div>{kicker && <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">{kicker}</p>}<h1 className="text-2xl sm:text-3xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>{action}</div>{children}</section>
const Button = ({ children, tone = 'primary', className = '', ...props }) => <button className={`touch-target rounded-button px-4 py-2.5 text-sm font-semibold ${tone === 'primary' ? 'bg-primary-dark text-white hover:bg-charcoal' : tone === 'dark' ? 'bg-charcoal text-white' : 'border border-border bg-white text-ink'} ${className}`} {...props}>{children}</button>
// Reusable inline error slot — matches the pattern already established in
// AdminPages.jsx (ErrorNote) so error display is consistent across the app.
const ErrorNote = ({ children }) => children ? <p role="alert" className="mb-4 rounded-button border border-error/30 bg-error/10 px-3 py-2 text-sm font-semibold text-error">{children}</p> : null
// Age from a "YYYY-MM-DD" dateOfBirth — only ever present on `item.patient` when the backend
// has decided the caller (treating doctor / admin) is allowed to see it; absent entirely for a
// receptionist caller, so this simply never runs for them.
const ageFromDob = (dob) => {
  if (!dob) return null
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const beforeBirthdayThisYear = now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  if (beforeBirthdayThisYear) age -= 1
  return age >= 0 ? age : null
}
// Compact "gender · age · blood group" summary — each part only renders if the backend actually
// sent it, so this degrades gracefully to '—' for a receptionist (whose patient object never
// carries these clinical fields at all — see appointments.service.js#shapePatientRef).
export const patientVitals = (patient) => {
  if (!patient) return '—'
  const parts = []
  if (patient.gender) parts.push(patient.gender)
  const age = ageFromDob(patient.dateOfBirth)
  if (age != null) parts.push(`${age}y`)
  if (patient.bloodGroup) parts.push(patient.bloodGroup)
  return parts.length ? parts.join(' · ') : '—'
}
// §6.7 — no `/patients` endpoint exists anywhere in the API. Derive a
// best-effort distinct patient list from already-fetched appointments
// instead of a dedicated fetch (integration plan §6.7).
const derivePatients = (appointments = []) => {
  const map = new Map()
  appointments.forEach((item) => {
    if (!item.patient?.id) return
    const entry = map.get(item.patient.id) || {
      id: item.patient.id,
      name: item.patient.name,
      // Present only when the backend actually sent them (doctor/admin caller) — see
      // appointments.service.js#shapePatientRef. Taken from whichever appointment row this
      // patient last appeared in, since they're stable per-patient, not per-visit.
      phone: item.patient.phone || null,
      gender: item.patient.gender || null,
      dateOfBirth: item.patient.dateOfBirth || null,
      bloodGroup: item.patient.bloodGroup || null,
      medicalHistory: item.patient.medicalHistory || null,
      emergencyContact: item.patient.emergencyContact || null,
      visits: 0,
      lastStatus: item.status,
    }
    entry.visits += 1
    entry.lastStatus = item.status
    map.set(item.patient.id, entry)
  })
  return Array.from(map.values())
}

const AppointmentTable = ({ data }) => {
  const updateAppointmentStatus = useAppStore((state) => state.updateAppointmentStatus)
  const fetchAppointments = useAppStore((state) => state.fetchAppointments)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  const load = () => {
    setLoading(true)
    setLoadError('')
    return fetchAppointments({}).catch((err) => setLoadError(firstErrorMessage(err, 'Could not load appointments.'))).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [fetchAppointments])

  const changeStatus = async (id, status) => {
    setBusyId(id)
    setActionError('')
    try {
      await updateAppointmentStatus(id, status)
    } catch (err) {
      setActionError(firstErrorMessage(err, 'Could not update the appointment status.'))
    } finally {
      setBusyId(null)
    }
  }

  // COMPLETENESS FIX (audit Priority 1 #3): the backend already accepts 'cancelled'/'no_show' for
  // doctor/receptionist via PATCH /appointments/:id/status (mobile already wires both), but this
  // shared web table only ever offered Confirm/Complete — staff had no way to cancel a booking or
  // record a no-show from the web app at all. Cancel gets a confirm prompt (releases the queue
  // token and, per appointments.service.js's own rules, can't be undone); No-show doesn't, same
  // as Complete above it.
  const { deletingId: cancellingId, remove: cancelAppointment } = useDeleteWithConfirm({
    deleteFn: (item) => updateAppointmentStatus(item.id, 'cancelled'),
    confirmMessage: (item) => `Cancel the appointment for ${item.patient?.name || item.familyMember?.name || 'this patient'}${item.tokenNumber != null ? ` (token #${item.tokenNumber})` : ''}? This cannot be undone.`,
    errorFallback: 'Could not cancel this appointment.',
    setError: setActionError,
  })

  return <>
    <ErrorNote>{actionError}</ErrorNote>
    <DataTable
      loading={loading}
      error={loadError}
      onRetry={load}
      rows={(data.appointments || [])}
      columns={[
        { key: 'id', label: 'ID', render: (item, index) => sequenceId(index) },
        // BOOKING-ID VISIBILITY FIX (user request: "bookinh id ko slip pe dikhai and my bookong me
        // v dikhao", follow-up: "dctor receptionest ko v show ho") — 'ID' above is just this
        // table's own row sequence number (DC01, DC02...), not the real booking id a patient
        // would read off their slip or "My Bookings" page. This table is shared by both the
        // doctor's and receptionist's Appointments pages (see AppointmentTable's two callers
        // below), so one column here covers both roles. Same shortId() format used everywhere
        // else in the app.
        { key: 'bookingId', label: 'Booking ID', render: (item) => shortId(item.id) },
        { key: 'tokenNumber', label: 'Token', render: (item) => item.tokenNumber != null ? `#${item.tokenNumber}` : '—' },
        { key: 'appointmentDate', label: 'Date', render: (item) => item.appointmentDate || '—' },
        { key: 'appointmentTime', label: 'Time', render: (item) => item.appointmentTime || '—' },
        { key: 'doctorName', label: 'Doctor', render: (item) => item.doctor?.name || '—' },
        { key: 'patientName', label: 'Patient', render: (item) => item.patient?.name || item.familyMember?.name || 'Patient' },
        // Phone: sent for both doctor and receptionist (front-desk needs it to call a patient
        // in / confirm a booking) — absent (renders '—') for any role the backend doesn't mask
        // it in for.
        { key: 'patientPhone', label: 'Phone', render: (item) => item.patient?.phone || '—' },
        // Clinical fields (gender/age/blood group + medical history/emergency contact) are only
        // ever present on `item.patient` for a doctor/admin caller — appointments.service.js
        // deliberately omits them for receptionist/patient, so these two columns render '—' for
        // a receptionist rather than needing a role check here on the frontend too.
        { key: 'patientVitals', label: 'Patient info', render: (item) => patientVitals(item.patient) },
        {
          key: 'healthNotes',
          label: 'Health notes',
          render: (item) => {
            const history = item.patient?.medicalHistory
            const emergency = item.patient?.emergencyContact
            if (!history && !emergency) return '—'
            const full = [history && `History: ${history}`, emergency && `Emergency contact: ${emergency}`].filter(Boolean).join(' · ')
            const truncated = full.length > 60 ? `${full.slice(0, 57)}...` : full
            return <span title={full}>{truncated}</span>
          },
        },
        { key: 'clinicName', label: 'Clinic', render: (item) => item.clinic?.name || '—' },
        { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
        { key: 'paymentStatus', label: 'Payment', render: (item) => <StatusPill status={item.paymentStatus || 'pending'} /> },
        { key: 'paymentMethod', label: 'Payment method', render: (item) => item.paymentMethod || '—' },
        // Doctor/receptionist fee masking exposes ONLY consultationFee (plan §1.8) —
        // never read a flat `.totalAmount`/`.paidAmount`, those fields don't exist here.
        { key: 'consultationFee', label: 'Fee', render: (item) => item.fees?.consultationFee != null ? `₹${Number(item.fees.consultationFee).toFixed(2)}` : '—' },
        // DUE-AMOUNT VISIBILITY FIX (user request: "jab payment minimum hua hai to receptionist ko
        // v to baki ka due show hoga aur doctor ko") — `fees.due` is server-computed and already
        // contextual to paymentStatus (0 once paid, the doctor's own remaining share once a
        // patient paid just the minimum booking amount online, the full fee if nothing's paid
        // yet) — see appointments.service.js#shapeFees. Never re-derive this client-side from
        // totalAmount/consultationFee — doctor/receptionist never even receive those other fields.
        { key: 'due', label: 'Due', render: (item) => item.fees?.due != null ? `₹${Number(item.fees.due).toFixed(2)}` : '—' },
        { key: 'reason', label: 'Notes', render: (item) => item.reason || '—' },
        {
          key: 'actionCol',
          label: 'Actions',
          render: (item) => <div className="flex flex-wrap gap-2">
            {item.status === 'upcoming' && <button disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'confirmed')} className="touch-target text-xs font-semibold text-primary-dark disabled:opacity-50">{busyId === item.id ? 'Saving…' : 'Confirm'}</button>}
            {(item.status === 'upcoming' || item.status === 'confirmed') && <button disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'completed')} className="touch-target text-xs font-semibold text-primary-dark disabled:opacity-50">{busyId === item.id ? 'Saving…' : 'Complete'}</button>}
            {(item.status === 'upcoming' || item.status === 'confirmed') && <button disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'no_show')} className="touch-target text-xs font-semibold text-muted disabled:opacity-50">{busyId === item.id ? 'Saving…' : 'No-show'}</button>}
            {(item.status === 'upcoming' || item.status === 'confirmed') && <button disabled={cancellingId === item.id} onClick={() => cancelAppointment(item)} className="touch-target text-xs font-semibold text-error disabled:opacity-50">{cancellingId === item.id ? 'Saving…' : 'Cancel'}</button>}
          </div>,
        },
      ]}
    />
  </>
}

export function DoctorDashboard({ data }) {
  const currentUser = useAppStore((state) => state.currentUser)
  const updateDoctorBookingPolicy = useAppStore((state) => state.updateDoctorBookingPolicy)
  const profile = currentUser?.profile || {}
  const [onDutyOverride, setOnDutyOverride] = useState(null)
  const [dutyBusy, setDutyBusy] = useState(false)
  const [dutyError, setDutyError] = useState('')
  const onDuty = onDutyOverride ?? (profile.onlineBooking !== false)
  const toggleDuty = async () => {
    if (!currentUser) return
    setDutyBusy(true)
    setDutyError('')
    try {
      await updateDoctorBookingPolicy(currentUser.id, {
        onlineBooking: !onDuty,
        allowRebooking: profile.allowRebooking !== false,
        maxDaysAdvance: profile.maxDaysAdvance || 7,
      })
      setOnDutyOverride(!onDuty)
    } catch (err) {
      setDutyError(firstErrorMessage(err, 'Could not update your duty status.'))
    } finally {
      setDutyBusy(false)
    }
  }
  // `(data.appointments || [])`/`(data.queueTokens || [])`/`(data.payments || [])` are already scoped
  // server-side to this doctor (plan §1.8/§1.9/§1.12) — no client-side
  // doctorId filtering needed or possible (those fields aren't even in the
  // real row shapes any more).
  const doctorAppointments = data.appointments || []
  const doctorPayments = data.payments || []
  const today = doctorAppointments.filter((item) => item.status !== 'completed').length
  const doctorRevenue = doctorPayments.reduce((sum, item) => sum + doctorCharge({ consultationFee: item.fees?.consultationFee }, {}), 0)
  const recentRecords = [...doctorAppointments].reverse().slice(0, 6).map((item) => ({
    id: item.id,
    time: `${item.appointmentDate || 'Today'} ${item.appointmentTime || ''}`.trim(),
    patient: item.patient?.name || 'Patient',
    details: item.clinic?.name || '—',
    status: item.status || 'upcoming',
  }))
  const firstName = (currentUser?.name || 'Doctor').replace(/^dr\.?\s+/i, '').split(' ')[0]
  return <Page kicker="Production database" title={`Welcome, ${firstName}.`} subtitle="Your authenticated workspace is connected to live records." action={<Link to="/doctor/queue" className="touch-target inline-flex items-center rounded-button bg-primary-dark px-4 py-2 text-sm font-semibold text-white hover:bg-charcoal">Open OPD console</Link>}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-button border border-border bg-white px-4 py-3 text-sm">
      <span><span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${onDuty ? 'bg-success' : 'bg-muted'}`} />{onDuty ? 'Patients can currently find and book you.' : 'You are hidden from new patient bookings.'}</span>
      <Button tone="secondary" className="py-1.5 px-3 text-xs" disabled={dutyBusy || !currentUser} onClick={toggleDuty}>{dutyBusy ? 'Saving…' : onDuty ? 'Go off duty' : 'Go on duty'}</Button>
    </div>
    <ErrorNote>{dutyError}</ErrorNote>
    {profile.status && profile.status !== 'verified' && (
      <p role="alert" className="mb-4 rounded-button border border-gold/40 bg-gold/10 px-3 py-2 text-sm font-semibold text-gold-dark">
        {profile.status === 'disabled'
          ? 'Your account has been disabled by an admin. Contact support if you believe this is a mistake.'
          : 'Your account is pending admin verification — patients cannot find or book you until verification is complete.'}
      </p>
    )}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="TODAY'S BOOKINGS" value={today} icon="◷" to="/doctor/appointments" />
      <StatCard label="WAITING PATIENTS" value={(data.queueTokens || []).filter((item) => item.status === 'waiting').length} icon="≡" to="/doctor/queue" />
      <StatCard label="TODAY'S REVENUE" value={`₹${doctorRevenue}`} icon="₹" to="/doctor/revenue" />
      <StatCard label="PATIENT RATING" value={profile.rating || 0} icon="★" to="/doctor/reviews" />
    </div>
    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="rounded-card border border-border bg-white p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold font-sans text-ink">Recent live records</h2><span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">Connected</span></div>
        {recentRecords.length ? <DataTable rows={recentRecords} columns={[{ key: 'time', label: 'Time / ID' }, { key: 'patient', label: 'Patient / User' }, { key: 'details', label: 'Details' }, { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> }]} /> : <EmptyState title="No live records yet" message="Consultations will appear here as they happen." />}
      </div>
      <div className="rounded-card border border-border bg-white p-5 shadow-card">
        <h2 className="mb-3 text-lg font-bold font-sans text-ink">Quick actions</h2>
        <div className="space-y-2">{[['Queue management', '/doctor/queue', '≡'], ['Appointments', '/doctor/appointments', '📅'], ['Analytics', '/doctor/analytics', '📊']].map(([label, path, icon]) => <Link key={path} to={path} className="flex items-center gap-3 rounded-button bg-surface p-3 border border-border/60 hover:border-primary transition"><span className="text-xl">{icon}</span><span><span className="block text-sm font-bold text-ink">{label}</span><span className="block text-xs text-muted">Open live workspace</span></span></Link>)}</div>
      </div>
    </div>
  </Page>
}

const bookingLabel = (source) => source === 'walk_in' ? 'Walk-in' : source === 'online' ? 'Online' : '—'
const queueRecordCsv = (rows) => buildCsv(['Id', 'Token', 'Patient', 'Status', 'Booking', 'Patients ahead', 'Estimated wait (min)'], rows.map((item) => [item.displayId, `#${item.tokenNumber ?? ''}`, item.patient?.name || '', item.status, bookingLabel(item.source), item.patientsAhead ?? '', item.estimatedWaitMinutes ?? '']))
export function QueueManagement({ data, receptionist = false }) {
  const setQueueTokenStatus = useAppStore((state) => state.setQueueTokenStatus)
  const fetchQueue = useAppStore((state) => state.fetchQueue)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  const loadQueue = () => {
    setLoading(true)
    setLoadError('')
    return fetchQueue({}).catch((err) => setLoadError(firstErrorMessage(err, 'Could not load the live queue.'))).finally(() => setLoading(false))
  }
  useEffect(() => { loadQueue() }, [fetchQueue])

  // `GET /queue` is already scoped server-side (doctor sees only their own
  // tokens, receptionist only their clinic's) — no client-side doctor filter
  // is needed or possible any more (queue rows carry no doctor field at all).
  const tokens = data.queueTokens || []
  const rows = tokens.map((item, index) => ({ ...item, displayId: index + 1 }))
  const activeRows = rows.filter((item) => item.status !== 'completed')
  const completedRows = rows.filter((item) => item.status === 'completed')

  const changeStatus = async (id, status) => {
    setBusyId(id)
    setActionError('')
    try {
      // Completing a token cascades server-side to the linked appointment's
      // status — no extra client call needed for that (plan §1.9).
      await setQueueTokenStatus(id, status)
    } catch (err) {
      setActionError(firstErrorMessage(err, 'Could not update the queue token.'))
    } finally {
      setBusyId(null)
    }
  }

  // Strictly sequential, forward-only transitions server-side
  // (waiting → called → in_consultation → completed) — only show the one
  // legal next step rather than every button every time.
  const nextStep = (status) => status === 'waiting' ? { label: 'Call', status: 'called' }
    : status === 'called' ? { label: 'Start', status: 'in_consultation' }
      : status === 'in_consultation' ? { label: 'Complete', status: 'completed' }
        : null

  const actionColumn = {
    key: 'actions',
    label: 'Actions',
    render: (item) => {
      const next = nextStep(item.status)
      if (!next) return <span className="text-xs text-muted">—</span>
      return <Button tone="secondary" className="py-1 px-2.5 text-xs" disabled={busyId === item.id} onClick={() => changeStatus(item.id, next.status)}>{busyId === item.id ? 'Saving…' : next.label}</Button>
    },
  }
  const baseColumns = [
    { key: 'displayId', label: 'Id' },
    { key: 'number', label: 'Token', render: (item) => `#${item.tokenNumber ?? '—'}` },
    { key: 'patient', label: 'Patient', render: (item) => item.patient?.name || '—' },
    { key: 'patientPhone', label: 'Phone', render: (item) => item.patient?.phone || '—' },
    // Doctor-only in practice: queue.service.js#shapeQueuePatientRef never sends gender/DOB/
    // bloodGroup to a receptionist caller, so this renders '—' on the receptionist's queue
    // monitor and real values on the doctor's OPD queue.
    { key: 'patientVitals', label: 'Patient info', render: (item) => patientVitals(item.patient) },
    { key: 'source', label: 'Booking', render: (item) => <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${item.source === 'walk_in' ? 'bg-gold/15 text-charcoal' : item.source === 'online' ? 'bg-teal/15 text-teal-dark' : 'bg-surface text-muted'}`}>{bookingLabel(item.source)}</span> },
    { key: 'patientsAhead', label: 'Patients ahead', render: (item) => item.patientsAhead ?? '—' },
    { key: 'estimatedWaitMinutes', label: 'Est. wait', render: (item) => item.estimatedWaitMinutes != null ? `${item.estimatedWaitMinutes} min` : '—' },
    { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
  ]
  const exportCsv = () => downloadCsv('queue-records.csv', queueRecordCsv(rows))
  return <Page kicker="Production database" title={receptionist ? 'Queue monitor' : 'Live OPD queue'} subtitle={receptionist ? 'Operate the clinic waiting line in real time.' : 'Call patients and update the live waiting line.'} action={<div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success"><span className="h-1.5 w-1.5 rounded-full bg-success" />Live</span><Button type="button" tone="secondary" className="py-1.5 px-3 text-xs" disabled={loading} onClick={loadQueue}>{loading ? 'Refreshing…' : 'Refresh'}</Button><Button type="button" tone="dark" className="py-1.5 px-3 text-xs" onClick={exportCsv}>Export CSV</Button></div>}>
    {receptionist && <p className="mb-4 text-sm text-muted">This queue is automatically scoped to your assigned clinic.</p>}
    <ErrorNote>{actionError}</ErrorNote>
    <div className="rounded-card border border-border bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg">Live records</h2><span className="text-xs font-semibold text-muted">{activeRows.length} record(s)</span></div>
      <DataTable loading={loading} error={loadError} onRetry={loadQueue} rows={activeRows} columns={[...baseColumns, actionColumn]} />
    </div>
    <div className="mt-5 rounded-card border border-border bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg">Completed</h2><span className="text-xs font-semibold text-muted">{completedRows.length} record(s)</span></div>
      {completedRows.length ? <DataTable rows={completedRows} columns={baseColumns} /> : <EmptyState title="No completed consultations yet" message="Patients marked as complete will move here." />}
    </div>
  </Page>
}

export function DoctorProfileEdit({ data }) {
  const currentUser = useAppStore((state) => state.currentUser)
  const profile = currentUser?.profile || {}
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [photo, setPhoto] = useState(currentUser?.photoUrl || '')
  const [photoError, setPhotoError] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [docFile, setDocFile] = useState(null)
  const [docName, setDocName] = useState('')
  const [docError, setDocError] = useState('')
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [bankSaved, setBankSaved] = useState(false)
  const [bankError, setBankError] = useState('')
  const [savingBank, setSavingBank] = useState(false)
  const updateDoctorProfile = useAppStore((state) => state.updateDoctorProfile)
  const uploadPhoto = useAppStore((state) => state.uploadPhoto)
  const uploadVerificationDocument = useAppStore((state) => state.uploadVerificationDocument)
  const changePassword = useAppStore((state) => state.changePassword)
  const save = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    const specialization = (data.specializations || []).find((item) => item.name === values.specialization)
    setSubmitting(true)
    setError('')
    try {
      // photoUrl is deliberately NOT part of this submit — choosePhoto() below already POSTs
      // the file to /media/photo and persists it server-side (via the store's uploadPhoto) the
      // instant a file is chosen, independent of this form's own save.
      await updateDoctorProfile({
        name: values.name || currentUser?.name,
        phone: values.phone || '',
        specializationId: specialization?.id,
        qualification: values.qualification,
        registrationNumber: values.registrationNumber,
        experienceYears: Number(values.experience) || 0,
        consultationFee: Number(values.fee) || 0,
        emergencyFee: Number(values.emergencyFee) || 0,
        languages: String(values.languages || '').split(',').map((item) => item.trim()).filter(Boolean),
        bio: values.bio,
        emergencyAvailable: values.emergencyAvailable === 'on',
        minBookingAdvanceAmount: values.minBookingAmount ? Number(values.minBookingAmount) : null,
      })
      setSaved(true)
    } catch (err) {
      setError(firstErrorMessage(err, 'Could not save your profile.'))
    } finally {
      setSubmitting(false)
    }
  }
  if (!currentUser) {
    // A successful password change clears the local session (the server revokes every refresh
    // token — see the store's changePassword), so `currentUser` goes null on THIS SAME render as
    // the redirect to /login is kicked off below. Without this branch the generic "no profile"
    // empty state below would flash instead of the actual confirmation message the doctor just
    // triggered — same risk PortalProfile's password form sidesteps by never hard-gating on
    // currentUser at all. Anyone reaching this component without ever having a currentUser (not
    // mid-redirect) still gets the ordinary empty state.
    if (passwordSaved) return <Page title="My profile"><p role="status" className="rounded-button border border-success/30 bg-success/10 px-3 py-2 text-sm font-semibold text-success">Password changed successfully. Redirecting to sign in…</p></Page>
    return <Page title="Professional profile"><EmptyState title="No doctor profile yet" message="Register a doctor account to add your professional details." /></Page>
  }
  // Uploads immediately on selection (POST /media/photo) rather than waiting for the surrounding
  // form's Save button — matches how the preview used to update instantly, but now the upload
  // itself (and the server-side users.photo_url write) happens right away too. A failed upload
  // shows inline via photoError and leaves the rest of the form untouched/still submittable.
  const choosePhoto = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.')
      return
    }
    setPhotoError('')
    setUploadingPhoto(true)
    try {
      const url = await uploadPhoto(file)
      setPhoto(url)
    } catch (err) {
      setPhotoError(firstErrorMessage(err, 'Could not upload photo.'))
    } finally {
      setUploadingPhoto(false)
    }
  }
  // Doctor-only self-service verification-document submission (POST /media/document — see the
  // store's uploadVerificationDocument for why this exists at all). Kept as an explicit
  // choose-then-upload step, unlike the photo picker's upload-on-select, because a document
  // benefits from an optional label typed in first ("Aadhaar", "MBBS certificate") — uploading
  // the instant a file is chosen would leave no chance to name it before it's saved.
  const chooseDoc = (event) => {
    const file = event.target.files?.[0]
    setDocError('')
    if (file && file.size > 10 * 1024 * 1024) {
      setDocFile(null)
      setDocError('File is too large — documents must be 10MB or smaller.')
      return
    }
    setDocFile(file || null)
  }
  const uploadDoc = async () => {
    if (!docFile) return
    setDocError('')
    setUploadingDoc(true)
    try {
      await uploadVerificationDocument(docFile, docName)
      setDocFile(null)
      setDocName('')
      const input = document.getElementById('verification-document-input')
      if (input) input.value = ''
    } catch (err) {
      setDocError(firstErrorMessage(err, 'Could not upload this document.'))
    } finally {
      setUploadingDoc(false)
    }
  }
  const documents = Array.isArray(profile.verificationDocuments) ? profile.verificationDocuments : []
  // COMPLETENESS ADD (request: "doctor bank details v only admin and super admin dekh sakta hai
  // add kro bank detail se ke"): payout bank details, self-editable here via the same PATCH /me
  // action as the main profile form above, but kept as its own small save unit (like the
  // password form below) rather than folded into the big form — a doctor filling in their bank
  // account shouldn't have to re-submit their whole professional profile at the same time.
  // Server-side this is read back ONLY by the doctor themselves or an admin/superadmin (see
  // doctors.service.js#shapeDoctor's includeContact gate) — never a public/patient caller.
  const bank = profile.bankDetails || {}
  const saveBank = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    setSavingBank(true)
    setBankError('')
    try {
      await updateDoctorProfile({
        bankAccountHolderName: values.bankAccountHolderName || null,
        bankAccountNumber: values.bankAccountNumber || null,
        bankIfscCode: values.bankIfscCode || null,
        bankName: values.bankName || null,
        // COMPLETENESS ADD (request: "upiid dalne ka v option de do") — an alternative/additional
        // payout option, independent of the 4 bank fields above.
        bankUpiId: values.bankUpiId || null,
      })
      setBankSaved(true)
    } catch (err) {
      setBankSaved(false)
      setBankError(firstErrorMessage(err, 'Could not save your bank details.'))
    } finally {
      setSavingBank(false)
    }
  }
  // COMPLETENESS FIX (doctor panel profile-section audit): every other role reaching a "My
  // profile" page (patient/receptionist/admin/superadmin, all via PortalSectionPages.jsx's
  // PortalProfile) gets a change-password form — the doctor's own profile page never had one,
  // meaning a doctor had NO self-service way to change their password at all. Same convention as
  // PortalProfile#updatePassword: the server revokes every refresh token on success, so the
  // local session is already dead — redirect to /login rather than pretending it survives.
  const updatePassword = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    if (values.nextPassword !== values.confirmPassword) {
      setPasswordError('New passwords do not match.')
      setPasswordSaved(false)
      return
    }
    setChangingPassword(true)
    setPasswordError('')
    try {
      await changePassword(values.currentPassword, values.nextPassword, values.confirmPassword)
      setPasswordSaved(true)
      navigate('/login', { replace: true })
    } catch (err) {
      setPasswordSaved(false)
      setPasswordError(firstErrorMessage(err, 'Could not change password.'))
    } finally {
      setChangingPassword(false)
    }
  }
  return <Page title="My profile" subtitle="Update qualifications, expertise, fees, photo, and biography.">
    {profile.status && profile.status !== 'verified' && (
      <p role="alert" className="mb-4 max-w-3xl rounded-button border border-gold/40 bg-gold/10 px-3 py-2 text-sm font-semibold text-gold-dark">
        {profile.status === 'disabled'
          ? 'Your account has been disabled by an admin. Contact support if you believe this is a mistake.'
          : 'Your account is pending admin verification. Upload a verification document below (registration certificate, degree, or ID proof) to help the review team confirm your credentials.'}
      </p>
    )}
    <form onSubmit={save} className="max-w-3xl rounded-card border border-border bg-white p-5 shadow-card">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 flex flex-wrap items-center gap-4 rounded-button bg-surface p-3">
          <span className="grid h-16 w-16 overflow-hidden place-items-center rounded-full bg-primary-light text-lg font-bold text-primary-dark">{photo ? <img src={photo} alt="Doctor profile preview" className="h-full w-full object-cover" /> : 'DR'}</span>
          <label className="block text-sm font-medium text-ink"><span className="mb-1 block">Profile photo</span><input type="file" accept="image/*" onChange={choosePhoto} disabled={uploadingPhoto} className="block max-w-full text-xs" /><span className="mt-1 block text-xs text-muted">{uploadingPhoto ? 'Uploading…' : 'JPEG, PNG, or WebP, up to 5MB.'}</span>{photoError && <span role="alert" className="mt-1 block text-xs font-semibold text-error">{photoError}</span>}</label>
        </div>
        <FormField label="Full name" name="name" defaultValue={currentUser.name} required />
        <FormField label="Phone" name="phone" type="tel" defaultValue={currentUser.phone || ''} />
        <FormField label="Specialization" name="specialization" type="select" options={(data.specializations || []).map((item) => item.name)} defaultValue={profile.specialization?.name} />
        <FormField label="Qualification" name="qualification" defaultValue={profile.qualification || ''} />
        <FormField label="Registration number" name="registrationNumber" defaultValue={profile.registrationNumber || ''} />
        <FormField label="Experience (years)" name="experience" type="number" defaultValue={profile.experienceYears || 0} min="0" />
        <FormField label="Consultation fee" name="fee" type="number" defaultValue={profile.consultationFee || 0} min="0" />
        <FormField label="Emergency fee" name="emergencyFee" type="number" defaultValue={profile.emergencyFee || 0} min="0" />
        <div>
          <FormField label="Minimum booking amount (optional)" name="minBookingAmount" type="number" min="0" placeholder="No minimum-pay option" defaultValue={profile.minBookingAdvanceAmount ?? ''} />
          <p className="mt-1 text-xs text-muted">Online payment is now mandatory before a patient gets a token. Set this to let patients pay just this much at booking time instead of the full fee — the rest is collected at the clinic. Leave blank to only offer full payment. Cannot exceed the consultation fee.</p>
        </div>
        <FormField label="Languages (comma separated)" name="languages" defaultValue={(profile.languages || []).join(', ')} />
        <div className="sm:col-span-2"><FormField label="Professional biography" name="bio" type="textarea" defaultValue={profile.bio || ''} /></div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" name="emergencyAvailable" defaultChecked={profile.emergencyAvailable} /> Available for emergency care</label>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" className="mt-5" disabled={submitting}>{submitting ? 'Saving…' : 'Save changes'}</Button>
      {saved && <p role="status" className="mt-3 text-sm font-semibold text-success">Profile saved.</p>}
    </form>
    <div className="mt-5 max-w-3xl rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg font-bold font-sans text-ink">Verification documents</h2>
      <p className="mt-1 text-sm text-muted">Upload your registration certificate, medical degree, or a government ID so admins can verify your account. Accepted: JPEG, PNG, WebP, or PDF, up to 10MB.</p>
      {documents.length
        ? <ul className="mt-4 divide-y divide-border rounded-button border border-border">
          {documents.map((doc, index) => <li key={`${doc.url}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
            <span className="font-medium text-ink">{doc.name || `Document ${index + 1}`}</span>
            <span className="flex items-center gap-3 text-xs text-muted">
              {doc.uploadedAt && new Date(doc.uploadedAt).toLocaleDateString()}
              <a href={doc.url} target="_blank" rel="noreferrer" className="font-semibold text-primary-dark hover:underline">View</a>
            </span>
          </li>)}
        </ul>
        : <EmptyState title="No documents uploaded yet" message="Add at least one document so the review team has something to verify your account against." />}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm font-medium text-ink">
          <span className="mb-1 block">Choose file</span>
          <input id="verification-document-input" type="file" accept="image/*,application/pdf" onChange={chooseDoc} disabled={uploadingDoc} className="block max-w-full text-xs" />
        </label>
        <FormField label="Document name (optional)" placeholder="e.g. MBBS certificate" value={docName} onChange={(event) => setDocName(event.target.value)} />
        <Button type="button" tone="secondary" disabled={!docFile || uploadingDoc} onClick={uploadDoc}>{uploadingDoc ? 'Uploading…' : 'Upload document'}</Button>
      </div>
      {docError && <p role="alert" className="mt-2 text-sm font-semibold text-error">{docError}</p>}
    </div>
    <form onSubmit={saveBank} className="mt-5 max-w-3xl rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg font-bold font-sans text-ink">Bank details</h2>
      <p className="mt-1 text-sm text-muted">Used for payouts. Visible only to you and the platform admin team — never shown to patients or on your public profile.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormField label="Account holder name" name="bankAccountHolderName" defaultValue={bank.accountHolderName || ''} />
        <FormField label="Bank name" name="bankName" defaultValue={bank.bankName || ''} />
        <FormField label="Account number" name="bankAccountNumber" defaultValue={bank.accountNumber || ''} />
        <FormField label="IFSC code" name="bankIfscCode" placeholder="e.g. HDFC0001234" defaultValue={bank.ifscCode || ''} />
        <div className="sm:col-span-2">
          <FormField label="UPI ID (optional)" name="bankUpiId" placeholder="e.g. name@okhdfcbank" defaultValue={bank.upiId || ''} />
          <p className="mt-1 text-xs text-muted">An alternative or addition to the bank account above — fill in either, both, or neither.</p>
        </div>
      </div>
      <Button type="submit" className="mt-5" disabled={savingBank}>{savingBank ? 'Saving…' : 'Save bank details'}</Button>
      {bankError && <p role="alert" className="mt-3 text-sm font-semibold text-error">{bankError}</p>}
      {bankSaved && <p role="status" className="mt-3 text-sm font-semibold text-success">Bank details saved.</p>}
    </form>
    <form onSubmit={updatePassword} className="mt-5 max-w-3xl rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg font-bold font-sans text-ink">Change password</h2>
      <p className="mt-1 text-sm text-muted">Use your current password to set a new one. You'll need to sign in again afterwards.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormField label="Current password" name="currentPassword" type="password" required />
        <div />
        <FormField label="New password" name="nextPassword" type="password" minLength="8" required />
        <FormField label="Confirm new password" name="confirmPassword" type="password" minLength="8" required />
      </div>
      <Button type="submit" className="mt-5" disabled={changingPassword}>{changingPassword ? 'Changing…' : 'Change password'}</Button>
      {passwordError && <p role="alert" className="mt-3 text-sm font-semibold text-error">{passwordError}</p>}
      {passwordSaved && <p role="status" className="mt-3 text-sm font-semibold text-success">Password changed successfully. Redirecting to sign in…</p>}
    </form>
  </Page>
}

const OPD_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const opdEntryCsv = (rows) => buildCsv(['Id', 'Type', 'Clinic', 'Day/Date', 'Hours/Reason', 'Patient time', 'Status'], rows.map((item) => [
  item.displayId,
  item.kind === 'hours' ? 'weekly OPD' : 'closing date',
  item.clinicLabel || '',
  item.kind === 'hours' ? (OPD_DAYS[item.weekday] || '') : (item.closedDate || ''),
  item.kind === 'hours' ? `${item.startTime || ''}-${item.endTime || ''}` : (item.reason || ''),
  item.kind === 'hours' ? `${item.slotMinutes || 15} min` : '',
  item.kind === 'hours' ? (item.status || 'active') : 'closed',
]))
export function ClinicSchedule({ data }) {
  const currentUser = useAppStore((state) => state.currentUser)
  const profile = currentUser?.profile || {}
  const [refreshedAt, setRefreshedAt] = useState(() => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  const [savedPolicy, setSavedPolicy] = useState(false)
  const [savedOpd, setSavedOpd] = useState(false)
  const [savedClosing, setSavedClosing] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const updateDoctorBookingPolicy = useAppStore((state) => state.updateDoctorBookingPolicy)
  const upsertClinicHours = useAppStore((state) => state.upsertClinicHours)
  const createClinicClosure = useAppStore((state) => state.createClinicClosure)
  const deleteClinicHours = useAppStore((state) => state.deleteClinicHours)
  const deleteClinicClosure = useAppStore((state) => state.deleteClinicClosure)
  const fetchClinicHours = useAppStore((state) => state.fetchClinicHours)
  const fetchClinicClosures = useAppStore((state) => state.fetchClinicClosures)
  const entries = data.opdEntries || []

  useEffect(() => {
    // Clinic hours/closures are per-clinic resources (plan §1.5) — hydrate
    // them for every clinic in the bulk-loaded directory this doctor could be
    // scheduled at.
    (data.clinics || []).forEach((clinic) => {
      fetchClinicHours(clinic.id).catch(() => { })
      fetchClinicClosures(clinic.id).catch(() => { })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!currentUser) return <Page title="OPD schedule"><EmptyState title="No doctor profile yet" message="Sign in as a doctor to manage clinic schedules." /></Page>

  const savePolicy = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    setSubmitting(true)
    setError('')
    try {
      // onlineBooking/allowRebooking/maxDaysAdvance are all required by the server (plan §1.4) —
      // onlineBooking isn't collected on this form, so carry the current value through.
      // maxOnlineBookingsPerDay is optional/nullable: an empty field means "no daily cap",
      // sent as null rather than 0 so the server doesn't read it as "block every booking."
      await updateDoctorBookingPolicy(currentUser.id, {
        onlineBooking: profile.onlineBooking !== false,
        allowRebooking: values.allowRebooking === 'on',
        maxDaysAdvance: Number(values.maxDaysAdvance) || 1,
        maxOnlineBookingsPerDay: values.maxOnlineBookingsPerDay ? Number(values.maxOnlineBookingsPerDay) : null,
        // COMPLETENESS ADD (request: "doctor ek booking rule do jo booking online wala continues
        // token no jayega ya odd ya even patient ko mle" + follow-up "odd ya even select karne ka
        // option do doctor jo select kar online ke lie"): 'sequential' (default) keeps one shared
        // token count for everyone; the other two options both turn on 'alternate' numbering but
        // let the doctor pick WHICH parity online bookings get (walk-ins always get the other
        // one) — see appointments.service.js#runBookingJob for exactly how the numbering works.
        tokenNumberingMode: values.tokenNumberingMode === 'Sequential' ? 'sequential' : 'alternate',
        onlineTokenParity: values.tokenNumberingMode === 'Odd / even — online gets even numbers' ? 'even' : 'odd',
      })
      setSavedPolicy(true)
    } catch (err) {
      setError(firstErrorMessage(err, 'Could not save the booking window.'))
    } finally {
      setSubmitting(false)
    }
  }
  const saveOpd = async (event) => {
    event.preventDefault()
    // Captured before the `await` below — a DOM event's `currentTarget` is only valid while the
    // event is actively dispatching and goes back to null once that finishes, which (for an
    // async handler) is well before `await upsertClinicHours(...)` resolves. Reading
    // `event.currentTarget` after the await was throwing "Cannot read properties of null
    // (reading 'reset')" on every successful save — the save itself worked, but the crash while
    // trying to reset the form afterward showed the user a scary error and never cleared the
    // fields. `form` is a plain reference to the element, unaffected by the event finishing.
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    const clinic = (data.clinics || []).find((item) => item.name === values.clinicName)
    if (!clinic) { setError('Choose a clinic before saving OPD timing.'); return }
    setSubmitting(true)
    setError('')
    try {
      await upsertClinicHours(clinic.id, {
        weekday: OPD_DAYS.indexOf(values.day),
        startTime: values.start,
        endTime: values.end,
        slotMinutes: Number(values.slotMinutes) || 15,
      })
      setSavedOpd(true)
      form.reset()
    } catch (err) {
      setError(firstErrorMessage(err, 'Could not save the OPD timing.'))
    } finally {
      setSubmitting(false)
    }
  }
  const saveClosing = async (event) => {
    event.preventDefault()
    const form = event.currentTarget // see saveOpd's comment above — same currentTarget-after-await bug
    const values = Object.fromEntries(new FormData(form).entries())
    const clinic = (data.clinics || []).find((item) => item.name === values.clinicName)
    if (!clinic) { setError('Choose a clinic before adding a closing date.'); return }
    setSubmitting(true)
    setError('')
    try {
      await createClinicClosure(clinic.id, { closedDate: values.date, reason: values.reason })
      setSavedClosing(true)
      form.reset()
    } catch (err) {
      setError(firstErrorMessage(err, 'Could not add the closing date.'))
    } finally {
      setSubmitting(false)
    }
  }
  const removeEntry = async (item) => {
    setError('')
    try {
      if (item.kind === 'closure') await deleteClinicClosure(item.clinicId, item.id)
      else await deleteClinicHours(item.clinicId, item.id)
    } catch (err) {
      setError(firstErrorMessage(err, 'Could not remove that entry.'))
    }
  }
  const refresh = () => setRefreshedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  const rows = entries.map((item, index) => ({ ...item, displayId: index + 1, clinicLabel: (data.clinics || []).find((clinic) => clinic.id === item.clinicId)?.name || '—' }))
  const exportCsv = () => downloadCsv('opd-schedule.csv', opdEntryCsv(rows))
  return <Page kicker="Production database" title="OPD schedule" subtitle="Set each clinic's day-wise hours, patient duration, future-booking window, and closing dates." action={<div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success"><span className="h-1.5 w-1.5 rounded-full bg-success" />Live · {refreshedAt}</span><Button type="button" tone="secondary" className="py-1.5 px-3 text-xs" onClick={refresh}>Refresh</Button><Button type="button" tone="secondary" className="py-1.5 px-3 text-xs" onClick={exportCsv}>Export CSV</Button></div>}>
    <ErrorNote>{error}</ErrorNote>
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={savePolicy} className="rounded-card border border-border bg-white p-5 shadow-card">
        <h2 className="text-lg">Patient booking window</h2>
        <p className="mt-1 text-sm text-muted">Control how far ahead patients can book and whether same-day rebooking is allowed.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Days patients can book in advance" name="maxDaysAdvance" type="number" min="1" defaultValue={profile.maxDaysAdvance || 7} />
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" name="allowRebooking" defaultChecked={profile.allowRebooking !== false} /> Allow same-day rebooking</label>
          <div className="sm:col-span-2">
            <FormField label="Max online bookings per day (optional)" name="maxOnlineBookingsPerDay" type="number" min="1" max="500" placeholder="No limit" defaultValue={profile.maxOnlineBookingsPerDay ?? ''} />
            <p className="mt-1 text-xs text-muted">Caps only patients' own online bookings each day — leave blank for no limit. Walk-ins your receptionist registers at the desk are never counted or blocked by this.</p>
          </div>
          <div className="sm:col-span-2">
            <FormField
              label="Token numbering for queue"
              name="tokenNumberingMode"
              type="select"
              options={['Sequential', 'Odd / even — online gets odd numbers', 'Odd / even — online gets even numbers']}
              defaultValue={
                profile.tokenNumberingMode !== 'alternate'
                  ? 'Sequential'
                  : profile.onlineTokenParity === 'even'
                    ? 'Odd / even — online gets even numbers'
                    : 'Odd / even — online gets odd numbers'
              }
            />
            <p className="mt-1 text-xs text-muted">Sequential gives every booking the next number in one queue. The odd/even options split online and walk-in bookings into their own alternating sequences — pick whichever parity you want your OWN online patients to get; walk-ins always get the other one. Helps your queue display tell them apart at a glance.</p>
          </div>
        </div>
        <Button type="submit" className="mt-4" disabled={submitting}>{submitting ? 'Saving…' : 'Save booking window'}</Button>
        {savedPolicy && <p role="status" className="mt-3 text-sm font-semibold text-success">Booking window saved.</p>}
      </form>
      <form onSubmit={saveOpd} className="rounded-card border border-border bg-white p-5 shadow-card">
        <h2 className="text-lg">Add or update day-wise OPD</h2>
        <p className="mt-1 text-sm text-muted">Set opening hours and patient consultation duration for a clinic and day.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Clinic" name="clinicName" type="select" options={(data.clinics || []).map((clinic) => clinic.name)} required />
          <FormField label="Day" name="day" type="select" options={OPD_DAYS} required />
          <FormField label="Opening time" name="start" type="time" defaultValue="10:00" required />
          <FormField label="Closing time" name="end" type="time" defaultValue="18:00" required />
          <FormField label="Patient time (minutes)" name="slotMinutes" type="number" min="5" defaultValue="15" />
        </div>
        <Button type="submit" className="mt-4" disabled={submitting}>{submitting ? 'Saving…' : 'Save OPD timing'}</Button>
        {savedOpd && <p role="status" className="mt-3 text-sm font-semibold text-success">OPD timing saved.</p>}
      </form>
      <form onSubmit={saveClosing} className="rounded-card border border-border bg-white p-5 shadow-card lg:col-span-2">
        <h2 className="text-lg">Add a closing date</h2>
        <p className="mt-1 text-sm text-muted">Block a specific date so patients cannot book at this clinic.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FormField label="Clinic" name="clinicName" type="select" options={(data.clinics || []).map((clinic) => clinic.name)} required />
          <FormField label="Date" name="date" type="date" required />
          <FormField label="Reason" name="reason" placeholder="Holiday, personal leave, etc." />
        </div>
        <Button type="submit" className="mt-4" disabled={submitting}>{submitting ? 'Saving…' : 'Add closing date'}</Button>
        {savedClosing && <p role="status" className="mt-3 text-sm font-semibold text-success">Closing date saved.</p>}
      </form>
    </div>
    <div className="mt-6 rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="mb-3 text-lg">Live records</h2>
      {rows.length ? <DataTable rows={rows} columns={[
        { key: 'displayId', label: 'Id' },
        { key: 'type', label: 'Type', render: (item) => item.kind === 'hours' ? 'Weekly OPD' : 'Closing date' },
        { key: 'clinicLabel', label: 'Clinic' },
        { key: 'dayDate', label: 'Day / Date', render: (item) => item.kind === 'hours' ? (OPD_DAYS[item.weekday] || '—') : (item.closedDate || '—') },
        { key: 'hours', label: 'Hours / Reason', render: (item) => item.kind === 'hours' ? `${item.startTime} – ${item.endTime}` : (item.reason || '—') },
        { key: 'slotMinutes', label: 'Patient time', render: (item) => item.kind === 'hours' ? `${item.slotMinutes || 15} min` : '—' },
        { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.kind === 'hours' ? (item.status || 'active') : 'closed'} /> },
        { key: 'actionCol', label: 'Actions', render: (item) => <button type="button" onClick={() => removeEntry(item)} className="touch-target text-xs font-semibold text-error">Remove</button> },
      ]} /> : <EmptyState title="No OPD entries yet" message="Add day-wise OPD timings or closing dates above to see them here." />}
    </div>
  </Page>
}

export function DoctorAppointments({ data }) { return <Page title="Appointments" subtitle="Manage scheduled patients and consultation status."><AppointmentTable data={data} /></Page> }

export function PatientHistory({ data }) {
  const fetchAppointments = useAppStore((state) => state.fetchAppointments)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const load = () => { setLoading(true); setLoadError(''); return fetchAppointments({}).catch((err) => setLoadError(firstErrorMessage(err, 'Could not load patient history.'))).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [fetchAppointments])
  // §6.7 — no `/patients` endpoint exists; derive a distinct patient list
  // from already-fetched appointments instead (reduced view: no city, since
  // the real appointment's nested `patient` only carries {id, name}).
  const patients = derivePatients((data.appointments || []))
  const term = search.trim().toLowerCase()
  const filteredPatients = term ? patients.filter((patient) => `${patient.name || ''} ${patient.phone || ''}`.toLowerCase().includes(term)) : patients
  return <Page title="Patient history">
    <div className="mb-4 max-w-md"><FormField label="Search patient" placeholder="Name or mobile number" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <DataTable loading={loading} error={loadError} onRetry={load} rows={filteredPatients} columns={[
      { key: 'name', label: 'Patient' },
      { key: 'phone', label: 'Phone', render: (item) => item.phone || '—' },
      { key: 'vitals', label: 'Patient info', render: (item) => patientVitals(item) },
      {
        key: 'healthNotes',
        label: 'Health notes',
        render: (item) => {
          if (!item.medicalHistory && !item.emergencyContact) return '—'
          const full = [item.medicalHistory && `History: ${item.medicalHistory}`, item.emergencyContact && `Emergency contact: ${item.emergencyContact}`].filter(Boolean).join(' · ')
          const truncated = full.length > 60 ? `${full.slice(0, 57)}...` : full
          return <span title={full}>{truncated}</span>
        },
      },
      { key: 'visits', label: 'Visits' },
      { key: 'lastStatus', label: 'Last status', render: (item) => <StatusPill status={item.lastStatus} /> },
    ]} />
  </Page>
}

const lineData = (analytics, label, values) => ({ labels: analytics.labels, datasets: [{ label, data: values, borderColor: theme.primary, backgroundColor: `${theme.primary}26`, tension: .35, fill: true }] })
export function Analytics({ data, admin = false, embedded = false }) {
  const a = data.analytics
  // §6.3 — no time-series/analytics endpoint exists anywhere in the API;
  // `data.analytics` stays permanently null. Show a clear "not available"
  // state instead of crashing on `a.labels`.
  if (!a) {
    const notice = <EmptyState title="Analytics not available" message="The current API has no time-series analytics endpoint yet." />
    return embedded ? notice : <Page title={admin ? 'Platform analytics' : 'Practice analytics'} subtitle="Not available in this version of the API.">{notice}</Page>
  }
  const charts = <div className="grid gap-5 lg:grid-cols-2"><div className="rounded-card border border-border bg-white p-5 shadow-card"><h2 className="mb-4 text-lg">Appointments</h2><Line data={lineData(a, 'Appointments', a.appointments)} options={{ responsive: true }} /></div><div className="rounded-card border border-border bg-white p-5 shadow-card"><h2 className="mb-4 text-lg">Revenue</h2><Bar data={{ labels: a.labels, datasets: [{ label: 'Revenue (₹)', data: a.revenue, backgroundColor: theme.teal, borderRadius: 6 }] }} /></div></div>
  return embedded ? charts : <Page title={admin ? 'Platform analytics' : 'Practice analytics'} subtitle={admin ? 'See platform-wide trends, completion rate, and workload.' : 'See appointment trends, completion rate, and workload.'}>{charts}</Page>
}

export function ReceptionDashboard({ data }) {
  const currentUser = useAppStore((state) => state.currentUser)
  const getClinic = useAppStore((state) => state.getClinic)
  // Same fix as WalkIn's Doctor dropdown below: "Assigned doctors" used to read `data.doctors`
  // (the platform-wide public directory) instead of this receptionist's own clinic team.
  const clinicId = currentUser?.profile?.clinicId
  const [clinicDoctors, setClinicDoctors] = useState([])
  useEffect(() => {
    let cancelled = false
    if (!clinicId) return undefined
    getClinic(clinicId).then((clinic) => { if (!cancelled) setClinicDoctors(clinic.doctors || []) }).catch(() => { })
    return () => { cancelled = true }
  }, [clinicId, getClinic])
  const today = new Date().toISOString().slice(0, 10)
  const waiting = (data.queueTokens || []).filter((item) => item.status === 'waiting').length
  const todaysPatients = (data.appointments || []).filter((item) => item.appointmentDate === today).length
  const consultationsDone = (data.appointments || []).filter((item) => item.status === 'completed').length
  const pendingPayments = (data.payments || []).filter((item) => String(item.status || '').toLowerCase() === 'pending').length
  const recentRecords = [...(data.appointments || [])].reverse().slice(0, 6).map((item, index) => ({
    id: item.id,
    time: `${item.appointmentDate || 'Today'} ${item.appointmentTime || ''}`.trim(),
    patient: item.patient?.name || 'Patient',
    details: `Appointment #${index + 1}`,
    status: item.status || 'upcoming',
  }))
  const firstName = (currentUser?.name || 'Reception').split(' ')[0]
  return <Page kicker="Production database" title={`Welcome, ${firstName}.`} subtitle="Your authenticated workspace is connected to live records." action={<Link to="/receptionist/walk-in" className="touch-target inline-flex items-center rounded-button bg-primary-dark px-4 py-2 text-sm font-semibold text-white hover:bg-charcoal">Register walk-in</Link>}>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="TODAY'S PATIENTS" value={todaysPatients} icon="👥" to="/receptionist/patients" />
      <StatCard label="CONSULTATIONS DONE" value={consultationsDone} icon="✓" to="/receptionist/appointments" />
      <StatCard label="WAITING IN QUEUE" value={waiting} icon="≡" to="/receptionist/queue" />
      <StatCard label="PENDING PAYMENTS" value={pendingPayments} icon="₹" to="/receptionist/payments" />
    </div>
    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="rounded-card border border-border bg-white p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold font-sans text-ink">Recent live records</h2><span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">Connected</span></div>
        {recentRecords.length ? <DataTable rows={recentRecords} columns={[{ key: 'time', label: 'Time / ID' }, { key: 'patient', label: 'Patient / User' }, { key: 'details', label: 'Details' }, { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> }]} /> : <EmptyState title="No live records yet" message="Walk-ins and bookings will appear here as they happen." />}
      </div>
      <div className="rounded-card border border-border bg-white p-5 shadow-card">
        <h2 className="mb-3 text-lg font-bold font-sans text-ink">Quick actions</h2>
        <div className="space-y-2">{[['Walk-in registration', '/receptionist/walk-in', '🧾'], ['Queue monitor', '/receptionist/queue', '≡'], ['Appointments', '/receptionist/appointments', '📅'], ['Payments', '/receptionist/payments', '💳']].map(([label, path, icon]) => <Link key={path} to={path} className="flex items-center gap-3 rounded-button bg-surface p-3 border border-border/60 hover:border-primary transition"><span className="text-xl">{icon}</span><span><span className="block text-sm font-bold text-ink">{label}</span><span className="block text-xs text-muted">Open live workspace</span></span></Link>)}</div>
      </div>
    </div>
    <div className="mt-6 rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg">Assigned doctors</h2>
      <div className="mt-4">{clinicDoctors.length ? <div className="grid gap-3 sm:grid-cols-2">{clinicDoctors.map((doctor) => <div className="rounded-button bg-surface p-4" key={doctor.doctorUserId}><p className="font-semibold">{doctor.name}</p><p className="text-sm text-muted">{doctor.specialization?.name || 'Specialization not added'}</p><div className="mt-2"><StatusPill status={doctor.onlineBooking ? 'active' : 'paused'} /></div></div>)}</div> : <EmptyState title="No doctors assigned" message="Doctors added to your clinic team will appear here." />}</div>
    </div>
  </Page>
}

// yyyy-mm-dd in the browser's own local time — same helper as PatientPages.jsx's Booking page
// (not shared cross-file per this codebase's existing per-module convention).
const walkInTodayStr = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// COMPLETENESS FIX (audit Priority 1 #2): this used to be a documented no-op — every submit just
// showed a "not available yet" message, because POST /appointments required an existing
// patientUserId and nothing could create one inline. appointments.service.js#runBookingJob now
// find-or-creates the patient account server-side (by phone, so a returning walk-in never gets a
// duplicate account) — this form now actually books the visit and issues a real queue token.
export function WalkIn({ data }) {
  const createAppointment = useAppStore((state) => state.createAppointment)
  const bookingQueueInfo = useAppStore((state) => state.bookingQueueInfo)
  const currentUser = useAppStore((state) => state.currentUser)
  const getClinic = useAppStore((state) => state.getClinic)
  const [doctorId, setDoctorId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [booked, setBooked] = useState(null)
  // BUG FIX ("yaha par do doctor kyu aa raha hai... jis doctor ka receptionist hai ushi ka show
  // hona chahiye"): the Doctor dropdown used to read `data.doctors`, which is the PLATFORM-WIDE
  // public directory (loadPublicDirectory()'s searchDoctors({pageSize:100})) — every verified
  // doctor on BookMyDoctors, not just the ones at this receptionist's own clinic. Fixed by
  // loading this receptionist's own clinic (GET /clinics/:id via the existing getClinic action,
  // keyed off currentUser.profile.clinicId) and scoping the dropdown to clinic.doctors instead.
  const clinicId = currentUser?.profile?.clinicId
  const [clinicDoctors, setClinicDoctors] = useState([])
  const [clinicError, setClinicError] = useState('')
  useEffect(() => {
    let cancelled = false
    if (!clinicId) return undefined
    getClinic(clinicId)
      .then((clinic) => { if (!cancelled) setClinicDoctors((clinic.doctors || []).map((doctor) => ({ id: doctor.doctorUserId, name: doctor.name }))) })
      .catch((err) => { if (!cancelled) setClinicError(err.message || 'Could not load your clinic’s doctors.') })
    return () => { cancelled = true }
  }, [clinicId, getClinic])

  const save = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    setError('')
    setBooked(null)
    setConfirming(true)
    try {
      const appointment = await createAppointment({
        doctorUserId: values.doctor,
        appointmentDate: values.date,
        appointmentTime: values.time || undefined,
        reason: values.reason || '',
        patientName: values.name,
        patientPhone: values.phone,
        patientEmail: values.email || undefined,
      })
      setBooked(appointment)
      form.reset()
      setDoctorId('')
    } catch (err) {
      setError(firstErrorMessage(err, 'Could not register this walk-in.'))
    } finally {
      setConfirming(false)
    }
  }

  return <Page title="Walk-in registration" subtitle="Create or find a patient, book the visit, and issue a queue token.">
    <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <form onSubmit={save} className="rounded-card border border-border bg-white p-5 shadow-card">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Patient name" name="name" required />
          <FormField label="Phone" name="phone" type="tel" placeholder="Used to find a returning patient" required />
          <FormField label="Patient email (optional)" name="email" type="email" />
          <FormField label="Doctor" name="doctorLabel" type="select" options={clinicDoctors.map((doctor) => doctor.name)} value={clinicDoctors.find((doctor) => doctor.id === doctorId)?.name || ''} onChange={(event) => { const selected = clinicDoctors.find((doctor) => doctor.name === event.target.value); setDoctorId(selected?.id || '') }} required />
          <input type="hidden" name="doctor" value={doctorId} />
          {clinicError && <div className="sm:col-span-2"><ErrorNote>{clinicError}</ErrorNote></div>}
          {!clinicError && clinicId && !clinicDoctors.length && <p className="sm:col-span-2 text-sm text-muted">No doctors are assigned to your clinic yet — ask an admin to add one before registering a walk-in.</p>}
          {!clinicId && <p className="sm:col-span-2 text-sm text-muted">Your account isn't linked to a clinic yet — ask an admin to assign you to one.</p>}
          <FormField label="Visit date" name="date" type="date" required defaultValue={walkInTodayStr()} />
          <FormField label="Slot time (optional)" name="time" type="time" placeholder="Leave blank to auto-assign the next slot" />
          <div className="sm:col-span-2"><FormField label="Reason for visit" name="reason" type="textarea" placeholder="Symptoms or follow-up details" /></div>
          <div className="sm:col-span-2"><ErrorNote>{error}</ErrorNote></div>
          <Button type="submit" disabled={confirming} className="sm:col-span-2">{confirming ? 'Registering…' : 'Register and issue token'}</Button>
          {confirming && bookingQueueInfo?.aheadOfYou > 0 && <p className="sm:col-span-2 text-sm text-muted">{bookingQueueInfo.aheadOfYou} booking(s) ahead — assigning a token…</p>}
          {booked && <p role="status" className="sm:col-span-2 text-sm font-semibold text-success">Registered — token #{booked.tokenNumber ?? '—'} issued for {booked.patient?.name || 'the patient'}.</p>}
        </div>
      </form>
    </div>
    <div className="mt-6"><DataTable rows={(data.appointments || [])} columns={[{ key: 'id', label: 'Id', render: (item, index) => sequenceId(index) }, { key: 'appointmentDate', label: 'Date' }, { key: 'appointmentTime', label: 'Time' }, { key: 'patientName', label: 'Patient', render: (item) => item.patient?.name || '—' }, { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> }]} /></div>
  </Page>
}

export function CheckIn({ data }) {
  // No endpoint sets `checkedInAt` directly — derive check-in status from
  // already-fetched appointments instead (Foundation notes / plan §5).
  const checkedIn = (data.appointments || []).filter((item) => item.checkedInAt).map((item) => item.id)
  return <Page title="Check-in / check-out">
    <p className="mb-4 text-sm text-muted">Check-in status is set automatically by the booking/queue system — the current API has no manual check-in endpoint.</p>
    <DataTable rows={(data.appointments || []).filter((item) => item.status === 'upcoming' || item.status === 'confirmed')} columns={[
      { key: 'doctorName', label: 'Doctor', render: (item) => item.doctor?.name || '—' },
      { key: 'time', label: 'Time', render: (item) => item.appointmentTime || '—' },
      { key: 'token', label: 'Token', render: (item) => item.tokenNumber != null ? `#${item.tokenNumber}` : '—' },
      { key: 'id', label: 'Status', render: (item) => checkedIn.includes(item.id) ? <StatusPill status="completed" /> : <span className="text-xs text-muted">Not checked in</span> },
    ]} />
  </Page>
}

export function CashPayment({ data }) {
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // BUG FIX ("eshko sahi review kro proper"): the "Unpaid appointment" select used to show the
  // full raw database id (`#5c1a256d-3583-4400-9dd5-498660ebf63b · Rahul Verma · ₹500`) — the
  // same raw-UUID display bug fixed elsewhere in the app. On top of that, `save()` re-derived
  // WHICH appointment was picked by string-matching `#${item.id}` back out of that label text, so
  // simply shortening the label (without this fix) would have silently broken submission — the
  // shortened text would stop matching the full id. Fixed properly: the select is bound to an
  // explicit appointmentId (same hidden-input pattern as WalkIn's Doctor select above), so the
  // label is free to show shortId() and the actual match is a plain id equality check.
  const [appointmentId, setAppointmentId] = useState('')
  const createPayment = useAppStore((state) => state.createPayment)
  const fetchPayments = useAppStore((state) => state.fetchPayments)
  // "jiska payment complete ho jaye hat jaye" — data.appointments is only loaded once at login
  // (loadUserData), so createPayment() flipping the appointment's paymentStatus server-side never
  // showed up here on its own. Refetch appointments after a successful save so the just-paid one
  // drops out of `unpaidAppointments` below immediately, instead of waiting for next login/reload.
  const fetchAppointments = useAppStore((state) => state.fetchAppointments)
  const load = () => { setLoading(true); setLoadError(''); return fetchPayments({}).catch((err) => setLoadError(firstErrorMessage(err, 'Could not load payments.'))).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [fetchPayments])

  const unpaidAppointments = (data.appointments || []).filter((item) => item.paymentStatus !== 'paid')
  const appointmentLabel = (item) => `${shortId(item.id)} · ${item.patient?.name || 'Patient'} · ₹${item.fees?.consultationFee ?? 0}`
  const selectedAppointment = unpaidAppointments.find((item) => item.id === appointmentId)
  // Doctor/receptionist fee masking exposes ONLY consultationFee (plan §1.8/§1.12) —
  // flatten it through the existing `doctorCharge` helper's expected shape. Also cross-reference
  // the matching appointment (same pattern as PatientPages.jsx's Payments rows) so the receipt PDF
  // below can show the visit date/time/token and doctor specialization, not just the amount.
  const clinicPayments = (data.payments || []).map((payment) => ({
    ...payment,
    clinicAmount: doctorCharge({ consultationFee: payment.fees?.consultationFee }, {}),
    // Keep the raw booking id BEFORE the lookup below overwrites `appointment` with the full
    // (possibly not-found -> undefined) appointment object, so the "Booking ID" column below
    // never goes blank just because the matching appointment isn't in this page's own
    // data.appointments list — every payment row already carries `appointment: {id}` straight
    // from the API (payments.service.js#shapePayment), unmasked for every role.
    bookingId: payment.appointment?.id || null,
    appointment: (data.appointments || []).find((item) => item.id === payment.appointment?.id),
  }))
  // COMPLETENESS ADD (request: "receptionist and doctor ke pass show ho online payment kitna hua
  // cash ye proper way me", then "eshme ye show hona chahiye ki online booking ke time pe kitna
  // payment hua hai and second clinic pe aake cash ya online ye v to confirm hona chahiye") — this
  // table already had a per-row "Method" column, but no running totals. First pass only split
  // cash vs "everything else" — that still lumped a patient's own online prepayment (Razorpay, at
  // booking time, before ever reaching the clinic) together with a payment the receptionist
  // collects and records in person at the counter (cash, or UPI/card/online taken there). Now a
  // three-way split: paid online at booking vs collected at the clinic (cash vs online), using
  // isOnlineBookingPayment (lib/paymentVisibility.js) to tell the two "online" cases apart.
  const bookingPayments = clinicPayments.filter(isOnlineBookingPayment)
  const isCashMode = (item) => String(item.mode || '').toLowerCase() === 'cash'
  const cashPayments = clinicPayments.filter((item) => isCashMode(item) && !isOnlineBookingPayment(item))
  const clinicOnlinePayments = clinicPayments.filter((item) => !isCashMode(item) && !isOnlineBookingPayment(item))
  const bookingTotal = bookingPayments.reduce((sum, item) => sum + Number(item.clinicAmount || 0), 0)
  const cashTotal = cashPayments.reduce((sum, item) => sum + Number(item.clinicAmount || 0), 0)
  const clinicOnlineTotal = clinicOnlinePayments.reduce((sum, item) => sum + Number(item.clinicAmount || 0), 0)
  // VIEW-THEN-DOWNLOAD, same pattern as PatientPages.jsx's booking slip and receipt (request:
  // "baki jagah v same kar do jaha slip download ho raha hai") — opens the PDF in an in-page
  // preview instead of saving it straight away; the actual save-to-disk action lives inside that
  // preview (see hooks/usePdfPreview.js + components/PdfPreviewModal.jsx).
  const receipt = usePdfPreview()
  const viewReceipt = (item) => receipt.open(() => buildStaffReceiptPdfBlob(item))

  const save = async (event) => {
    event.preventDefault()
    const form = event.currentTarget // see StaffPages' saveOpd comment — currentTarget-after-await bug
    const values = Object.fromEntries(new FormData(form).entries())
    const appointment = (data.appointments || []).find((item) => item.id === values.appointment)
    setSubmitting(true)
    setError('')
    try {
      // POST /payments is receptionist/admin/superadmin only (plan §6.2) —
      // this is the one role group that can call it.
      await createPayment({
        appointmentId: appointment?.id,
        patientUserId: appointment?.patient?.id,
        doctorUserId: appointment?.doctor?.id,
        clinicId: appointment?.clinic?.id,
        isEmergency: appointment?.isEmergency || false,
        mode: (values.method || 'cash').toLowerCase(),
        transactionRef: values.transaction || undefined,
        // COMPLETENESS ADD (request: "utr no aaye upi id aaye ushke pad use show ho", clarified
        // to always show regardless of payment method, and to be saved — see the "UPI ID" field
        // below). transactionRef above already covers "UTR number" (relabeled client-side).
        payerUpiId: values.payerUpiId || undefined,
      })
      setSaved(true)
      form.reset()
      setAppointmentId('')
      // Refresh so the appointment we just paid disappears from "Unpaid appointment" right away.
      fetchAppointments({}).catch(() => { })
    } catch (err) {
      setError(firstErrorMessage(err, 'Could not record the payment.'))
    } finally {
      setSubmitting(false)
    }
  }

  return <>
    <Page title="Payments" subtitle="Record clinic collections and review receipts.">
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="PAID ONLINE AT BOOKING" value={`₹${bookingTotal}`} detail={`${bookingPayments.length} payment${bookingPayments.length === 1 ? '' : 's'} · paid before arrival`} icon="🌐" />
        <StatCard label="CASH COLLECTED AT CLINIC" value={`₹${cashTotal}`} detail={`${cashPayments.length} payment${cashPayments.length === 1 ? '' : 's'}`} icon="₹" />
        <StatCard label="ONLINE COLLECTED AT CLINIC" value={`₹${clinicOnlineTotal}`} detail={`${clinicOnlinePayments.length} payment${clinicOnlinePayments.length === 1 ? '' : 's'} · UPI/Card/Online`} icon="📶" />
      </div>
      <form onSubmit={save} className="max-w-2xl rounded-card border border-border bg-white p-5 shadow-card">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Unpaid appointment" name="appointmentLabel" type="select" options={unpaidAppointments.map(appointmentLabel)} value={selectedAppointment ? appointmentLabel(selectedAppointment) : ''} onChange={(event) => { const index = event.target.selectedIndex - 1; setAppointmentId(unpaidAppointments[index]?.id || '') }} required />
          <input type="hidden" name="appointment" value={appointmentId} />
          <FormField label="Payment method" name="method" type="select" options={['Cash', 'Upi', 'Card', 'Online']} required />
          {/* DUE-AMOUNT VISIBILITY FIX (user request: "jab payment minimum hua hai to receptionist
            ko v to baki ka due show hoga aur doctor ko") — this used to show only a vague
            "advance already paid online, collecting the remaining balance now" sentence for a
            'partial' appointment, with NO number at all, because the receptionist only ever saw
            `fees.consultationFee` (mandatory rule 8 masking still applies — never
            totalAmount/GST/convenience-fee breakdown). The server now also sends a single,
            already-contextual `fees.due` figure (see appointments.service.js#shapeFees) — the
            doctor's own outstanding share once a minimum-only payment was made online, without
            leaking any of the masked platform-business fields — so the exact amount to collect
            can finally be shown as a number. */}
          {selectedAppointment && <div className="sm:col-span-2 rounded-button border border-border bg-surface px-4 py-3 text-sm">
            <p className="font-semibold text-ink">Consultation fee: ₹{selectedAppointment.fees?.consultationFee ?? 0}</p>
            {selectedAppointment.paymentStatus === 'partial'
              ? <p className="mt-1 text-muted">An advance has already been paid online for this appointment — <strong>Due now: ₹{selectedAppointment.fees?.due ?? selectedAppointment.fees?.consultationFee ?? 0}</strong> collected at the clinic.</p>
              : <p className="mt-1 text-muted">Paid so far: ₹0 · Due now: ₹{selectedAppointment.fees?.due ?? selectedAppointment.fees?.consultationFee ?? 0}</p>}
          </div>}
          <FormField label="UTR / Transaction number" name="transaction" placeholder="Bank/UPI reference number" />
          <FormField label="UPI ID" name="payerUpiId" placeholder="e.g. name@okhdfcbank" />
          <div className="sm:col-span-2"><ErrorNote>{error}</ErrorNote></div>
          <Button type="submit" disabled={submitting} className="sm:col-span-2">{submitting ? 'Recording…' : 'Record payment'}</Button>
          {saved && <p role="status" className="text-sm font-semibold text-success sm:col-span-2">Payment recorded.</p>}
        </div>
      </form>
      <div className="mt-6"><DataTable loading={loading} error={loadError} onRetry={load} rows={clinicPayments} columns={[
        { key: 'id', label: 'Receipt', render: (item) => item.receiptNumber || shortId(item.id) },
        // BOOKING-ID VISIBILITY FIX (user request: "payment me v booking id do", follow-up to
        // "bookinh id ko slip pe dikhai and my bookong me v dikhao") — 'Receipt' above is the
        // payment's own id/receipt number, not the appointment/booking it belongs to. Same
        // shortId() format already used on the Appointments table above and the patient's own
        // Payments table.
        { key: 'bookingId', label: 'Booking ID', render: (item) => item.bookingId ? shortId(item.bookingId) : '—' },
        { key: 'date', label: 'Date', render: (item) => item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—' },
        { key: 'description', label: 'Appointment', render: (item) => item.doctor?.name || item.patient?.name || '—' },
        { key: 'clinicAmount', label: 'Doctor charge', render: (item) => `₹${item.clinicAmount}` },
        // COMPLETENESS ADD (request: "online booking ke time pe kitna payment hua hai and second
        // clinic pe aake cash ya online ye v to confirm hona chahiye", then "eshme v add kro ye sab
        // ye sab patient setion me v add kro ... admin section me v") — this used to say just
        // "online" for both a patient's own booking-time Razorpay payment and a UPI/card payment
        // the receptionist took in person, with no way to tell which happened here on this row.
        // Shared PaymentSourceBadge (components/PaymentSourceBadge.jsx) so the same "At booking" /
        // "At clinic" tag reads identically here, on the patient's own Payments page, and in the
        // admin Revenue report.
        { key: 'mode', label: 'Method', render: (item) => <span className="inline-flex items-center gap-1.5">{item.mode}<PaymentSourceBadge payment={item} /></span> },
        { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
        { key: 'transaction', label: 'UTR / Transaction', render: (item) => item.transactionRef || '—' },
        { key: 'payerUpiId', label: 'UPI ID', render: (item) => item.payerUpiId || '—' },
        // COMPLETENESS FIX ("recipt jaha v janerate ho raha hai proper pdf generat ho... fix all
        // slip generates point") — there was previously NO receipt/download action anywhere on this
        // page at all. Consultation-fee-only PDF, per the same staff fee-masking rule as the table
        // above (never a fee breakdown the API never sent to this role).
        { key: 'actions', label: 'Actions', render: (item) => <button type="button" className="whitespace-nowrap rounded-button border border-border px-3 py-2 text-xs font-semibold text-primary-dark disabled:opacity-60" onClick={() => viewReceipt(item)} disabled={receipt.loading}>{receipt.loading ? 'Opening…' : '👁 View receipt'}</button> },
      ]} /></div>
    </Page>
    <PdfPreviewModal preview={receipt.preview} onClose={receipt.close} title="Payment receipt preview" />
  </>
}

export function ReceptionAppointments({ data }) { return <Page title="Appointments" subtitle="Manage scheduled and walk-in visits."><AppointmentTable data={data} /></Page> }
