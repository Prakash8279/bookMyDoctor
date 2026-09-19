import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { FormField } from '../components/FormField'
import { LiveQueueWidget } from '../components/LiveQueueWidget'
import { StatusPill } from '../components/StatusPill'
import { useAppStore } from '../store/useAppStore'
import { formatDate } from '../lib/format'
import { CONTACT_STATUS_LABELS } from '../lib/statusLabels'
import { useDeleteWithConfirm } from '../hooks/useDeleteWithConfirm'

const Page = ({ title, subtitle, children, action }) => <section><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl sm:text-3xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>{action}</div>{children}</section>
const Button = ({ children, className = '', ...props }) => <button className={`touch-target rounded-button bg-primary-dark px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal ${className}`} {...props}>{children}</button>
// `role="alert"` red inline text matches the error-display idiom already used
// across AdminPages.jsx/PatientPages.jsx — reused here rather than inventing
// a new pattern for this file.
const ErrorNote = ({ children }) => children ? <p role="alert" className="mt-3 text-sm font-semibold text-error">{children}</p> : null

export function QueueTracker({ data, role = 'patient' }) {
  const fetchMyQueueStatus = useAppStore((state) => state.fetchMyQueueStatus)
  const fetchQueue = useAppStore((state) => state.fetchQueue)
  const appointment = (data.appointments || []).find((item) => ['upcoming', 'confirmed'].includes(item.status))
  const tokens = data.queueTokens || []
  const [myStatus, setMyStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [loading, setLoading] = useState(role === 'patient')

  // The literal fix for this page always showing "no active queue": GET /queue (which fills
  // `data.queueTokens`, used below for the staff view) is doctor/receptionist-only — a patient
  // was never able to fetch their own queue position from anywhere. `fetchMyQueueStatus` (GET
  // /queue/mine/:appointmentId — see queue.service.js#getMyQueueStatus) is the patient-scoped
  // equivalent. Polls every 15s while this page stays open — shorter than the notifications
  // inbox's 30s poll, deliberately: this page's whole point is watching a live token move.
  useEffect(() => {
    if (role !== 'patient') return undefined
    if (!appointment) { setLoading(false); return undefined }
    let cancelled = false
    const load = () => {
      fetchMyQueueStatus(appointment.id)
        .then((result) => { if (!cancelled) { setMyStatus(result); setStatusError('') } })
        .catch((err) => { if (!cancelled) setStatusError(err.message || 'Could not load your live queue status.') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    setLoading(true)
    load()
    const interval = setInterval(load, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [role, appointment, fetchMyQueueStatus])

  // Staff view (kept for role !== 'patient' — no route mounts it that way today, but this is the
  // one path that legitimately reads the doctor/receptionist-only GET /queue list).
  useEffect(() => {
    if (role === 'patient') return undefined
    let cancelled = false
    fetchQueue({}).catch(() => {})
    const interval = setInterval(() => { if (!cancelled) fetchQueue({}).catch(() => {}) }, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [role, fetchQueue])

  const widgetQueue = appointment && myStatus
    ? { appointmentId: appointment.id, token: myStatus.token, nowServing: myStatus.nowServing, patientsAhead: myStatus.patientsAhead, estimatedWait: myStatus.estimatedWaitMinutes, doctorStatus: myStatus.status }
    : null

  return <Page title={role === 'patient' ? 'Live queue tracker' : 'Queue management'} subtitle={role === 'patient' ? 'Follow your real token and consultation status.' : 'Follow the live token flow and keep every arrival visible.'}>
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      {role === 'patient' ? (
        appointment
          ? <LiveQueueWidget appointmentId={appointment.id} initialQueue={widgetQueue} loading={loading} error={statusError} onRetry={() => fetchMyQueueStatus(appointment.id).then(setMyStatus).catch((err) => setStatusError(err.message))} />
          : <div className="rounded-card border border-border bg-white p-6 text-center shadow-card"><p className="text-4xl">◷</p><h2 className="mt-3 text-xl">No active queue</h2><p className="mt-1 text-sm text-muted">Your live token will appear here after an appointment is checked in.</p></div>
      ) : (
        appointment ? <LiveQueueWidget appointmentId={appointment.id} initialQueue={tokens.find((item) => item.appointmentId === appointment.id) ? (() => { const t = tokens.find((item) => item.appointmentId === appointment.id); return { appointmentId: appointment.id, token: t.tokenNumber, patientsAhead: t.patientsAhead, estimatedWait: t.estimatedWaitMinutes, doctorStatus: t.status } })() : null} /> : <div className="rounded-card border border-border bg-white p-6 text-center shadow-card"><p className="text-4xl">◷</p><h2 className="mt-3 text-xl">No active queue</h2><p className="mt-1 text-sm text-muted">Your live token will appear here after an appointment is checked in.</p></div>
      )}
      {role === 'patient' ? (
        <div className="rounded-card border border-border bg-white p-5 shadow-card">
          <h2 className="mb-3 text-lg">What each status means</h2>
          <ul className="space-y-2 text-sm text-muted">
            <li><strong className="text-ink">Waiting</strong> — your token has joined the line; "Patients ahead" shows how many are before you.</li>
            <li><strong className="text-ink">Called</strong> — the clinic has called your token; please head to the doctor's room.</li>
            <li><strong className="text-ink">In consultation</strong> — you're currently with the doctor.</li>
            <li><strong className="text-ink">Completed</strong> — your visit for today is done.</li>
          </ul>
        </div>
      ) : (
        <div className="rounded-card border border-border bg-white p-5 shadow-card"><div className="mb-3 flex items-center justify-between"><h2 className="text-lg">Today’s tokens</h2><span className="text-xs font-semibold text-teal-dark">Live updates</span></div><DataTable rows={tokens} columns={[
          { key: 'number', label: 'Token', render: (item) => `#${item.tokenNumber}` },
          { key: 'patient', label: 'Patient', render: (item) => item.patient?.name || '—' },
          { key: 'estimatedWaitMinutes', label: 'Est. wait', render: (item) => item.estimatedWaitMinutes != null ? `${item.estimatedWaitMinutes} min` : '—' },
          { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
        ]} /></div>
      )}
    </div>
  </Page>
}

export function PortalAppointments({ data, role = 'patient' }) {
  const fetchAppointments = useAppStore((state) => state.fetchAppointments)
  const updateAppointmentStatus = useAppStore((state) => state.updateAppointmentStatus)
  const [loading, setLoading] = useState(role === 'admin')
  const [listError, setListError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  // Appointments aren't part of the admin/superadmin bulk load (plan §4.2
  // admin branch) — fetch them here for the platform-wide registry view.
  const load = () => {
    setLoading(true)
    setListError('')
    return fetchAppointments({}).catch((err) => setListError(err.message || 'Could not load appointments.')).finally(() => setLoading(false))
  }
  useEffect(() => {
    if (role !== 'admin') return undefined
    let cancelled = false
    setLoading(true)
    setListError('')
    fetchAppointments({})
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load appointments.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchAppointments, role])

  const rows = data.appointments || []
  const changeStatus = async (id, status) => {
    setBusyId(id)
    setActionError('')
    try {
      await updateAppointmentStatus(id, status)
    } catch (err) {
      setActionError(err.message || 'Could not update this appointment.')
    } finally {
      setBusyId(null)
    }
  }
  const TERMINAL = ['completed', 'cancelled', 'no_show']
  // A `pending_payment` booking (online booking still awaiting the patient's mandatory payment —
  // see appointments.service.js's AppointmentStatus enum comment) can ONLY move to 'cancelled'
  // from here (APPOINTMENT_TRANSITIONS.pending_payment = ['cancelled']) — Confirm/Complete would
  // always fail with a 409 on one of these, so show Cancel instead of those two.
  const statusActions = (item) => <div className="flex gap-2">
    {item.status === 'pending_payment' && <button disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'cancelled')} className="touch-target text-xs font-semibold text-error">Cancel</button>}
    {item.status !== 'pending_payment' && item.status !== 'confirmed' && !TERMINAL.includes(item.status) && <button disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'confirmed')} className="touch-target text-xs font-semibold text-primary-dark">Confirm</button>}
    {item.status !== 'pending_payment' && !TERMINAL.includes(item.status) && <button disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'completed')} className="touch-target text-xs font-semibold text-primary-dark">Complete</button>}
  </div>
  if (role === 'admin') {
    return <Page title="Appointments registry" subtitle="Manage every booking in the platform.">
      <ErrorNote>{actionError}</ErrorNote>
      <DataTable loading={loading} error={listError} onRetry={load} rows={rows} columns={[
        { key: 'id', label: 'ID' },
        { key: 'token', label: 'Token', render: (item) => item.tokenNumber != null ? `#${item.tokenNumber}` : '—' },
        { key: 'date', label: 'Date', render: (item) => item.appointmentDate || '—' },
        { key: 'time', label: 'Time', render: (item) => item.appointmentTime || '—' },
        { key: 'doctorName', label: 'Doctor', render: (item) => item.doctor?.name || '—' },
        { key: 'patientName', label: 'Patient', render: (item) => item.patient?.name || item.familyMember?.name || '—' },
        { key: 'clinicName', label: 'Clinic', render: (item) => item.clinic?.name || '—' },
        { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
        { key: 'paymentStatus', label: 'Payment', render: (item) => <StatusPill status={item.paymentStatus || 'pending'} /> },
        { key: 'paymentMethod', label: 'Payment method', render: (item) => item.paymentMethod || '—' },
        // `fees` is the role-masked nested object now (plan §1.8) — admin
        // sees the full set, never a flat `.totalAmount`.
        { key: 'totalAmount', label: 'Fee', render: (item) => `₹${Number(item.fees?.totalAmount ?? item.fees?.consultationFee ?? 0)}` },
        { key: 'reason', label: 'Notes', render: (item) => item.reason || '—' },
        { key: 'actionCol', label: 'Actions', render: statusActions },
      ]} />
    </Page>
  }
  return <Page title={role === 'patient' ? 'My appointments' : 'Appointments'} subtitle={role === 'patient' ? 'View upcoming bookings, download slips, and review completed consultations.' : 'Manage scheduled patients and consultation status.'}>
    <ErrorNote>{actionError}</ErrorNote>
    <DataTable rows={rows} columns={[
      { key: 'id', label: 'Id' },
      { key: 'date', label: 'Date', render: (item) => item.appointmentDate || '—' },
      { key: 'time', label: 'Time', render: (item) => item.appointmentTime || '—' },
      { key: 'doctorName', label: 'Doctor', render: (item) => item.doctor?.name || '—' },
      { key: 'patientName', label: 'Patient', render: (item) => item.patient?.name || item.familyMember?.name || '—' },
      { key: 'clinicName', label: 'Clinic', render: (item) => item.clinic?.name || '—' },
      { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
      { key: 'actionCol', label: 'Actions', render: (item) => role === 'patient' ? <button onClick={() => window.alert(`${item.doctor?.name || 'Doctor'}\n${item.clinic?.name || 'Clinic'}\n${item.appointmentDate || ''} · ${item.appointmentTime || ''}\nStatus: ${item.status}`)} className="touch-target text-sm font-semibold text-primary-dark">Details</button> : statusActions(item) },
    ]} />
  </Page>
}

export function PortalPatients({ data }) {
  // §6.7 — no /patients endpoint exists; derive a best-effort distinct
  // patient list from appointments already bulk-loaded for the receptionist
  // role.
  const patientMap = new Map()
  for (const appointment of data.appointments || []) {
    if (appointment.patient?.id) patientMap.set(appointment.patient.id, appointment.patient)
  }
  const patients = Array.from(patientMap.values()).map((patient) => ({
    ...patient,
    appointmentCount: (data.appointments || []).filter((item) => item.patient?.id === patient.id).length,
  }))
  return <Page title="Patient directory" subtitle="View patients connected to this clinic.">
    <p className="mb-4 rounded-button border border-dashed border-border bg-surface px-3 py-2.5 text-sm text-muted">This list is built from appointments already loaded — the API has no dedicated patient directory (plan §6.7).</p>
    <DataTable rows={patients} columns={[
      { key: 'name', label: 'Patient' },
      // Front-desk data only — appointments.service.js#shapePatientRef deliberately never sends
      // gender/DOB/blood group/medical history to a receptionist caller, so only phone (useful
      // to call a patient about their booking) is added here, not a "Patient info" column.
      { key: 'phone', label: 'Phone', render: (item) => item.phone || '—' },
      { key: 'appointmentCount', label: 'Appointments' },
    ]} />
  </Page>
}

export function Specializations({ data }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const addSpecialization = useAppStore((state) => state.addSpecialization)
  const deleteSpecialization = useAppStore((state) => state.deleteSpecialization)
  // Store action takes a single fields object — {name, icon?, description?}.
  const add = async (event) => {
    event.preventDefault()
    if (!form.name.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await addSpecialization({ name: form.name.trim(), description: form.description.trim() || undefined })
      setForm({ name: '', description: '' })
      setAdding(false)
    } catch (err) {
      setError(err.message || 'Could not add this specialization.')
    } finally {
      setSubmitting(false)
    }
  }
  const { deletingId, remove } = useDeleteWithConfirm({
    setError,
    confirmMessage: (item) => `Delete the specialization "${item.name}"? This cannot be undone.`,
    errorFallback: 'Could not delete this specialization.',
    deleteFn: (item) => deleteSpecialization(item.id),
  })
  return <Page title="Specializations" subtitle="Maintain the live medical specialty catalogue." action={<Button onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add specialization'}</Button>}>
    {adding && <form onSubmit={add} className="mb-5 grid max-w-xl gap-3 rounded-card border border-border bg-white p-4 shadow-card"><FormField label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /><FormField label="Description" type="textarea" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save specialization'}</Button><ErrorNote>{error}</ErrorNote></form>}
    {!adding && <ErrorNote>{error}</ErrorNote>}
    <DataTable rows={data.specializations || []} columns={[
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Name' },
      {
        key: 'actions',
        label: 'Actions',
        render: (item) => <button
          type="button"
          disabled={deletingId === item.id}
          onClick={() => remove(item)}
          className="touch-target text-sm font-semibold text-error disabled:opacity-50"
        >
          {deletingId === item.id ? 'Deleting…' : 'Delete'}
        </button>,
      },
    ]} />
  </Page>
}

export function ReviewModeration({ data }) {
  const updateReviewStatus = useAppStore((state) => state.updateReviewStatus)
  const fetchReviews = useAppStore((state) => state.fetchReviews)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  // Reviews aren't part of the admin bulk load, and only admin/superadmin
  // callers get to see every status (not just approved) — plan §1.14 — so
  // this needs its own unfiltered fetch on mount.
  const load = () => {
    setLoading(true)
    setListError('')
    return fetchReviews({}).catch((err) => setListError(err.message || 'Could not load reviews.')).finally(() => setLoading(false))
  }
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError('')
    fetchReviews({})
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load reviews.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchReviews])

  const reviews = data.reviews || []
  const changeStatus = async (id, status) => {
    setBusyId(id)
    setActionError('')
    try {
      await updateReviewStatus(id, status)
    } catch (err) {
      setActionError(err.message || 'Could not update this review.')
    } finally {
      setBusyId(null)
    }
  }
  const actionsFor = (item) => {
    const status = item.status || 'approved'
    if (status === 'rejected') return <button type="button" disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'pending')} className="touch-target text-sm font-semibold text-success">Return to pending</button>
    if (status === 'pending') return <div className="flex gap-3"><button type="button" disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'approved')} className="touch-target text-sm font-semibold text-success">Approve</button><button type="button" disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'rejected')} className="touch-target text-sm font-semibold text-error">Reject</button></div>
    return <button type="button" disabled={busyId === item.id} onClick={() => changeStatus(item.id, 'rejected')} className="touch-target text-sm font-semibold text-error">Reject</button>
  }
  return <Page title="Review moderation" subtitle="Keep public feedback useful, respectful, and actionable.">
    <ErrorNote>{actionError}</ErrorNote>
    <DataTable loading={loading} error={listError} onRetry={load} rows={reviews} columns={[
      { key: 'id', label: 'ID' },
      { key: 'date', label: 'Date', render: (item) => formatDate(item.createdAt) },
      { key: 'patientName', label: 'Patient', render: (item) => item.patient?.name || 'Verified patient' },
      { key: 'doctor', label: 'Doctor', render: (item) => item.doctor?.name || '—' },
      { key: 'rating', label: 'Rating', render: (item) => `★ ${item.rating || 0}/5` },
      { key: 'text', label: 'Review' },
      { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status || 'approved'} /> },
      { key: 'actionCol', label: 'Actions', render: actionsFor },
    ]} />
  </Page>
}

export function ContactInbox({ data }) {
  const updateContactRequest = useAppStore((state) => state.updateContactRequest)
  const fetchContactRequests = useAppStore((state) => state.fetchContactRequests)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [requestId, setRequestId] = useState('')
  const [status, setStatus] = useState('open')
  const [response, setResponse] = useState('')
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  // Contact requests aren't part of the admin bulk load either — fetch on
  // mount, same pattern as the rest of this file's admin-only tables.
  const load = () => {
    setLoading(true)
    setListError('')
    return fetchContactRequests({}).catch((err) => setListError(err.message || 'Could not load contact requests.')).finally(() => setLoading(false))
  }
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError('')
    fetchContactRequests({})
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load contact requests.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchContactRequests])

  const requests = data.contactRequests || []
  const save = async (event) => {
    event.preventDefault()
    if (!requestId) return
    setSubmitting(true)
    setFormError('')
    try {
      await updateContactRequest(requestId, { status, response: response.trim() || undefined })
      setSaved(true)
      setResponse('')
    } catch (err) {
      setFormError(err.message || 'Could not save this response.')
    } finally {
      setSubmitting(false)
    }
  }
  return <Page title="Contact inbox" subtitle="Track public support requests and save responses.">
    <form onSubmit={save} className="mb-5 grid max-w-2xl gap-4 rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg">Respond to a contact request</h2>
      <FormField label="Contact request ID" type="select" options={requests.map((item) => item.id)} value={requestId} onChange={(event) => setRequestId(event.target.value)} required />
      <FormField label="Status" type="select" options={Object.values(CONTACT_STATUS_LABELS)} value={CONTACT_STATUS_LABELS[status]} onChange={(event) => setStatus(Object.keys(CONTACT_STATUS_LABELS).find((key) => CONTACT_STATUS_LABELS[key] === event.target.value) || 'open')} required />
      <FormField label="Response" type="textarea" value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Delivered to the requester's notification inbox when an account exists." />
      <Button type="submit" className="w-fit" disabled={submitting}>{submitting ? 'Saving…' : 'Save response'}</Button>
      <ErrorNote>{formError}</ErrorNote>
      {saved && <p role="status" className="text-sm font-semibold text-success">Response saved.</p>}
    </form>
    <DataTable loading={loading} error={listError} onRetry={load} rows={requests} columns={[{ key: 'id', label: 'ID' }, { key: 'date', label: 'Date', render: (item) => formatDate(item.createdAt) }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'subject', label: 'Subject' }, { key: 'message', label: 'Message' }, { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> }, { key: 'response', label: 'Response', render: (item) => item.response || '—' }]} />
  </Page>
}

export function PortalProfile({ data, role = 'patient' }) {
  // `currentUser` lives at the top level of the store, not inside `data`
  // (plan §3.1) — it now carries the full GET /me shape, including a nested
  // `profile` object rather than flat profile fields.
  const currentUser = useAppStore((state) => state.currentUser)
  const current = currentUser || {}
  const profile = current.profile || {}
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [genderError, setGenderError] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const updateProfile = useAppStore((state) => state.updateProfile)
  const uploadPhoto = useAppStore((state) => state.uploadPhoto)
  const logout = useAppStore((state) => state.logout)
  const changePassword = useAppStore((state) => state.changePassword)

  // Uploads immediately on selection (POST /media/photo) — the store merges the returned URL
  // into `currentUser` itself, so `current.photoUrl` below updates without waiting for the
  // surrounding form's own Save button. A failed upload shows inline and leaves the rest of the
  // form (name/phone/city/etc., saved separately via updateProfile) untouched.
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
      await uploadPhoto(file)
    } catch (err) {
      setPhotoError(err.message || 'Could not upload photo.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const save = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    setSubmitting(true)
    setProfileError('')
    setSaved(false)
    try {
      await updateProfile(values)
      setSaved(true)
    } catch (err) {
      setProfileError(err.message || 'Could not save profile changes.')
    } finally {
      setSubmitting(false)
    }
  }
  const changeGender = async (event) => {
    setGenderError('')
    try {
      await updateProfile({ gender: event.target.value })
    } catch (err) {
      setGenderError(err.message || 'Could not update gender.')
    }
  }
  const updatePassword = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    if (values.nextPassword !== values.confirmPassword) {
      setPasswordError('New passwords do not match.')
      setPasswordSaved(false)
      return
    }
    setChangingPassword(true)
    setPasswordError('')
    try {
      // 3-arg now, and the server revokes ALL sessions on success (plan
      // §1.2) — the store's changePassword() already clears local session
      // state, so redirect to login rather than pretending the session
      // survives.
      await changePassword(values.currentPassword, values.nextPassword, values.confirmPassword)
      setPasswordSaved(true)
      navigate('/login', { replace: true })
    } catch (err) {
      setPasswordSaved(false)
      setPasswordError(err.message || 'Could not change password.')
    } finally {
      setChangingPassword(false)
    }
  }
  const signOut = async () => {
    try { await logout() } catch { /* logout is best-effort locally regardless of server outcome */ }
    navigate('/login', { replace: true })
  }
  return <Page title="My profile" subtitle="Manage personal, contact, and account security information."><div className="grid max-w-4xl gap-6 lg:grid-cols-[1.2fr_.8fr]">
    <form onSubmit={save} className="rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg">{role === 'patient' ? 'Account information' : 'Profile details'}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 flex flex-wrap items-center gap-4 rounded-button bg-surface p-3"><span className="grid h-16 w-16 overflow-hidden place-items-center rounded-full bg-primary-light text-lg font-bold text-primary-dark">{current.photoUrl ? <img src={current.photoUrl} alt="Profile" className="h-full w-full object-cover" /> : (current.name || 'U').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><label className="block text-sm font-medium text-ink"><span className="mb-1 block">Profile photo</span><input type="file" accept="image/*" onChange={choosePhoto} disabled={uploadingPhoto} className="block max-w-full text-xs" /><span className="mt-1 block text-xs text-muted">{uploadingPhoto ? 'Uploading…' : 'JPEG, PNG, or WebP, up to 5MB.'}</span>{photoError && <span role="alert" className="mt-1 block text-xs font-semibold text-error">{photoError}</span>}</label></div>
        <FormField label="Full name" name="name" defaultValue={current.name || ''} required />
        {/* Email isn't in the PATCH /me editable field set (plan §1.2) —
            shown for reference only. */}
        <FormField label="Email" defaultValue={current.email || ''} disabled readOnly />
        <FormField label="Phone" name="phone" defaultValue={current.phone || ''} />
        <FormField label="City" name="city" defaultValue={current.city || ''} />
        {role === 'patient' && <><FormField label="Date of birth" name="dateOfBirth" type="date" defaultValue={profile.dateOfBirth || ''} /><FormField label="Gender" name="gender" type="select" options={['Male', 'Female', 'Other']} value={profile.gender || ''} onChange={changeGender} /><FormField label="Blood group" name="bloodGroup" defaultValue={profile.bloodGroup || ''} /><FormField label="Emergency contact" name="emergencyContact" defaultValue={profile.emergencyContact || ''} /><FormField label="Address" name="address" defaultValue={profile.address || ''} /><FormField label="Medical history" name="medicalHistory" defaultValue={profile.medicalHistory || ''} /></>}
        {role !== 'patient' && <div className="sm:col-span-2"><FormField label="About" name="about" type="textarea" defaultValue={profile.about || ''} placeholder="Add a short profile description" /></div>}
      </div>
      <Button className="mt-5" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save changes'}</Button>
      <ErrorNote>{profileError || genderError}</ErrorNote>
      {saved && <p role="status" className="mt-3 text-sm font-semibold text-success">Profile changes saved.</p>}
    </form>
    <div className="space-y-6">
      <form onSubmit={updatePassword} className="rounded-card border border-border bg-white p-5 shadow-card">
        <h2 className="text-lg">Change password</h2>
        <p className="mt-1 text-sm text-muted">Use your current password to set a new one. You'll need to sign in again afterwards.</p>
        <div className="mt-4 space-y-4">
          <FormField label="Current password" name="currentPassword" type="password" required />
          <FormField label="New password" name="nextPassword" type="password" minLength="8" required />
          <FormField label="Confirm new password" name="confirmPassword" type="password" minLength="8" required />
          <Button type="submit" disabled={changingPassword}>{changingPassword ? 'Changing…' : 'Change password'}</Button>
          {passwordError && <p role="alert" className="text-sm font-semibold text-error">{passwordError}</p>}
          {passwordSaved && <p role="status" className="text-sm font-semibold text-success">Password changed successfully. Redirecting to sign in…</p>}
        </div>
      </form>
      <div className="rounded-card border border-error/30 bg-white p-5 shadow-card"><h2 className="text-lg">Account actions</h2><p className="mt-1 text-sm text-muted">Sign out from this device.</p><button type="button" onClick={signOut} className="mt-4 touch-target rounded-button bg-error px-4 py-2.5 text-sm font-semibold text-white">Sign out</button></div>
    </div>
  </div></Page>
}
