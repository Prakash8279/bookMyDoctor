import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { FormField } from '../components/FormField'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { Modal } from '../components/Modal'
import { Select } from '../components/Select'
import { StatCard } from '../components/StatCard'
import { StatusPill } from '../components/StatusPill'
import { PaymentSourceBadge } from '../components/PaymentSourceBadge'
import { Analytics, patientVitals } from './StaffPages'
import { useAppStore } from '../store/useAppStore'
import { formatDate as sharedFormatDate, formatMoney as money, sequenceId, shortId, stableId } from '../lib/format'
import { COMPLAINT_STATUS_LABELS } from '../lib/statusLabels'
import { isOnlineBookingPayment } from '../lib/paymentVisibility'
import { useDeleteWithConfirm } from '../hooks/useDeleteWithConfirm'
import { csvCell, downloadCsv } from '../lib/csv'
const Page = ({ title, subtitle, children, action, kicker }) =><section><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div>{kicker && <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">{kicker}</p>}<h1 className="text-2xl sm:text-3xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>{action}</div>{children}</section>
const Button = ({ children, tone = 'primary', className = '', ...props }) => <button className={`touch-target rounded-button px-4 py-2.5 text-sm font-semibold ${tone === 'primary' ? 'bg-primary-dark text-white hover:bg-charcoal' : tone === 'error' ? 'bg-error text-white' : tone === 'dark' ? 'bg-charcoal text-white hover:bg-ink' : 'border border-border bg-white text-ink'} ${className}`} {...props}>{children}</button>
const ErrorNote =({ children }) => children ? <p role="alert" className="mb-4 rounded-button border border-error/30 bg-error/10 px-3 py-2 text-sm font-semibold text-error">{children}</p> : null

export function AdminDashboard({ data }) {
  const fetchDashboardStats = useAppStore((state) => state.fetchDashboardStats)
  // Admin/superadmin's post-login bulk load does NOT fetch appointments (plan
  // §4.2 admin branch) — this page needs them for "recent live records", so
  // fetch on mount here rather than assuming they're already populated.
  const fetchAppointments = useAppStore((state) => state.fetchAppointments)
  // `currentUser` lives at the top level of the store, not inside `data`.
  const currentUser = useAppStore((state) => state.currentUser)
  const [error, setError] = useState('')
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState('')

  const loadRecords = () => {
    setRecordsLoading(true)
    setRecordsError('')
    return fetchAppointments({}).catch((err) => setRecordsError(err.message || 'Could not load recent records.')).finally(() => setRecordsLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    fetchDashboardStats().catch((err) => { if (!cancelled) setError(err.message || 'Could not load dashboard stats.') })
    return () => { cancelled = true }
  }, [fetchDashboardStats])

  useEffect(() => {
    let cancelled = false
    setRecordsLoading(true)
    setRecordsError('')
    fetchAppointments({})
      .catch((err) => { if (!cancelled) setRecordsError(err.message || 'Could not load recent records.') })
      .finally(() => { if (!cancelled) setRecordsLoading(false) })
    return () => { cancelled = true }
  }, [fetchAppointments])

  const stats = data.dashboardStats
  const firstName = (currentUser?.name || 'Admin').split(' ')[0]
  // Running DC01, DC02, DC03… sequence for the leading "ID" column across the whole app
  // (admin/doctor/patient) — per user request "dc01 se start keo dc02..... esh formate me kro".
  // shortId() from lib/format (hash-derived, e.g. '#5b4a') is kept elsewhere for
  // record-referencing text (receipts, booking-slip content) where a stable identifier tied to
  // the actual record still matters.
  const recentRecords = [...(data.appointments || [])].reverse().slice(0, 6).map((item, index) => ({
    id: sequenceId(index),
    // BOOKING-ID VISIBILITY FIX (user request: "booking id appointment me do admin supar admin
    // ke") — 'id' above is just this widget's own row sequence number (DC01, DC02...), never the
    // real booking id. Kept as its own field (not reusing 'id') so the Time/ID column above can
    // stay unchanged. Same shortId() format already used for doctor/receptionist's Appointments
    // table and every payment table in the app.
    bookingId: item.id ? shortId(item.id) : '—',
    patient: item.patient?.name || 'Patient',
    details: item.appointmentDate ? `${item.appointmentDate}${item.appointmentTime ? ` ${item.appointmentTime}` : ''}` : '—',
    status: item.status || 'upcoming'
  }))
  const quickActions = [
    ['Doctors', '/admin/doctors', '🩺'],
    ['Patients', '/admin/patients', '👥'],
    ['Clinics', '/admin/clinics', '🏢'],
    ['Cities & areas', '/admin/cities', '📍'],
  ]

  return (
    <Page
      title={`Welcome, ${firstName}.`}
      subtitle="Your authenticated workspace is connected to live records."
      action={
        <Link to="/admin/doctors" className="touch-target inline-flex items-center rounded-button bg-primary-dark px-4 py-2 text-sm font-semibold text-white hover:bg-charcoal">
          Review doctors
        </Link>
      }
    >
      <ErrorNote>{error}</ErrorNote>
      {/* Stat Cards Grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="VERIFIED DOCTORS" value={stats ? stats.verifiedDoctorsCount : '—'} icon="🩺" to="/admin/doctors" />
        <StatCard label="REGISTERED PATIENTS" value={stats ? stats.registeredPatientsCount : '—'} icon="👥" to="/admin/patients" />
        <StatCard label="TODAY'S BOOKINGS" value={stats ? stats.todaysBookingsCount : '—'} icon="📅" to="/admin/appointments" />
        <StatCard label="MONTHLY REVENUE" value={stats ? `₹${Number(stats.monthlyRevenue ?? 0).toLocaleString('en-IN')}` : '—'} icon="🧾" to="/admin/revenue" />
      </div>

      {/* Recent Live Records & Quick Actions */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-card border border-border bg-white p-5 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold font-sans text-ink">Recent live records</h2>
            <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">Connected</span>
          </div>
          <DataTable
            loading={recordsLoading}
            error={recordsError}
            onRetry={loadRecords}
            rows={recentRecords}
            columns={[
              { key: 'id', label: 'Time / ID', render: (item) => `#${item.id}` },
              { key: 'bookingId', label: 'Booking ID' },
              { key: 'patient', label: 'Patient / User' },
              { key: 'details', label: 'Details' },
              { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> }
            ]}
          />
        </div>
        <div className="rounded-card border border-border bg-white p-5 shadow-card">
          <h2 className="mb-3 text-lg font-bold font-sans text-ink">Quick actions</h2>
          <div className="space-y-2">
            {quickActions.map(([label, path, icon]) => (
              <Link key={path} to={path} className="flex items-center gap-3 rounded-button bg-surface p-3 border border-border/60 hover:border-primary transition">
                <span className="text-xl">{icon}</span>
                <span>
                  <span className="block text-sm font-bold text-ink">{label}</span>
                  <span className="block text-xs text-muted">Open live workspace</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Page>
  )
}

export function DoctorVerification({ data }) {
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [updatingId, setUpdatingId] = useState(null)
  // COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
  // separate busy-state from `updatingId` above, which tracks the verification-lifecycle
  // (doctor_profiles.status) toggle — this one tracks the account-level login toggle
  // (users.status), a genuinely distinct action against a distinct endpoint.
  const [accountUpdatingId, setAccountUpdatingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [viewingDoctor, setViewingDoctor] = useState(null)
  const [viewingId, setViewingId] = useState(null)
  const [viewError, setViewError] = useState('')
  // Per-doctor booking-settings edit modal (onlineBooking/allowRebooking/maxDaysAdvance/
  // maxOnlineBookingsPerDay + the doctor-level onlineBookingWindowStart/End override) — separate
  // state from the read-only "View details" modal above, since this one is a real form.
  const [editingDoctor, setEditingDoctor] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editError, setEditError] = useState('')
  const [bookingSubmitting, setBookingSubmitting] = useState(false)
  const [bookingSaved, setBookingSaved] = useState(false)
  // Defaults to true (follow the platform-wide window) until the fetched doctor record says
  // otherwise — same pattern as PlatformSettings' `alwaysOpen` state further down this file.
  const [followPlatformWindow, setFollowPlatformWindow] = useState(true)
  const createDoctor = useAppStore((state) => state.createDoctor)
  const updateDoctorStatus = useAppStore((state) => state.updateDoctorStatus)
  const updateDoctorAccountStatus = useAppStore((state) => state.updateDoctorAccountStatus)
  const getDoctor = useAppStore((state) => state.getDoctor)
  const updateDoctorBookingPolicy = useAppStore((state) => state.updateDoctorBookingPolicy)
  // Admin/superadmin's post-login bulk load does NOT fetch doctors (plan §4.2 admin branch —
  // it only fetches dashboard stats/notifications/charges/settings/booking rules), and an
  // authenticated session also skips the public loadPublicDirectory() call that would otherwise
  // populate this. So this page must fetch its own doctor list on mount, same pattern as
  // ManagePatients/ManageReceptionists/ManageClinics/ClinicVerification. No `status` filter is
  // passed — an admin/superadmin caller gets every doctorProfile status back in one call (see
  // doctors.service.js#listDoctors), which is what lets "Live records" and "Pending
  // verification" below both be populated from the same fetch.
  const searchDoctors = useAppStore((state) => state.searchDoctors)
  const specializations = data.specializations || []

  const load = () => {
    setLoading(true)
    setListError('')
    return searchDoctors({ pageSize: 100 }).catch((err) => setListError(err.message || 'Could not load doctors.')).finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError('')
    searchDoctors({ pageSize: 100 })
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load doctors.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [searchDoctors])

  const save = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    setSubmitting(true)
    setFormError('')
    setSaved(false)
    try {
      await createDoctor({
        name: values.name,
        email: values.email,
        password: values.password,
        phone: values.phone || undefined,
        specializationId: values.specializationId,
        qualification: values.qualification || undefined,
        registrationNumber: values.registrationNumber || undefined,
        experienceYears: Number(values.experience) || 0,
        consultationFee: Number(values.fee) || 0,
        verifyImmediately: values.verifyImmediately === 'on',
      })
      setSaved(true)
      form.reset()
    } catch (err) {
      setFormError(err.message || 'Could not create this doctor account.')
    } finally {
      setSubmitting(false)
    }
  }

  const exportCsv = () => {
    const header = 'Id,Doctor,Registration,Experience,Fee,Rating,Status\n'
    const body = (data.doctors || []).map((item) => [
      item.id,
      item.name,
      item.registrationNumber,
      `${item.experienceYears || 0} years`,
      item.consultationFee || 0,
      item.rating || 0,
      item.status || item.doctorProfile?.status || ''
    ].map(csvCell).join(',')).join('\n')
    downloadCsv('doctors.csv', header + body)
  }

  const changeStatus = async (id, nextStatus) => {
    setUpdatingId(id)
    setStatusError('')
    try {
      await updateDoctorStatus(id, nextStatus)
    } catch (err) {
      setStatusError(err.message || "Could not update this doctor's status.")
    } finally {
      setUpdatingId(null)
    }
  }

  // COMPLETENESS FIX (audit Priority 4): account-level login enable/disable — a doctor whose
  // login is disabled cannot sign in at all, regardless of their verification status above.
  const changeAccountStatus = async (id, nextStatus) => {
    setAccountUpdatingId(id)
    setStatusError('')
    try {
      await updateDoctorAccountStatus(id, nextStatus)
    } catch (err) {
      setStatusError(err.message || "Could not update this doctor's login status.")
    } finally {
      setAccountUpdatingId(null)
    }
  }

  // Full profile — email/phone/bio are only ever included in the API response for an admin
  // caller (see doctors.service.js#shapeDoctor's includeContact gate), so this dedicated fetch
  // (rather than reading fields off the already-loaded list row) is what actually gets them.
  const viewDetails = async (id) => {
    setViewingId(id)
    setViewError('')
    try {
      const doctor = await getDoctor(id)
      setViewingDoctor(doctor)
    } catch (err) {
      setViewError(err.message || "Could not load this doctor's details.")
    } finally {
      setViewingId(null)
    }
  }

  // Same GET /doctors/:id fetch as viewDetails above (needed here too — the "Live records"
  // list rows don't carry allowRebooking/maxDaysAdvance/maxOnlineBookingsPerDay/the window
  // override, only the base-shape fields; those are includeDetail-only, see doctors.service.js).
  const openBookingSettings = async (id) => {
    setEditingId(id)
    setEditError('')
    setBookingSaved(false)
    try {
      const doctor = await getDoctor(id)
      setEditingDoctor(doctor)
    } catch (err) {
      setEditError(err.message || "Could not load this doctor's booking settings.")
    } finally {
      setEditingId(null)
    }
  }

  useEffect(() => {
    if (editingDoctor) setFollowPlatformWindow(!editingDoctor.onlineBookingWindowStart)
  }, [editingDoctor])

  const saveBookingSettings = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    setBookingSubmitting(true)
    setEditError('')
    setBookingSaved(false)
    try {
      await updateDoctorBookingPolicy(editingDoctor.id, {
        onlineBooking: values.onlineBooking === 'on',
        allowRebooking: values.allowRebooking === 'on',
        maxDaysAdvance: Number(values.maxDaysAdvance) || 1,
        maxOnlineBookingsPerDay: values.maxOnlineBookingsPerDay === '' ? null : Number(values.maxOnlineBookingsPerDay),
        // "Follow platform-wide hours" clears this doctor's override entirely (both null)
        // regardless of whatever the now-hidden time inputs still hold in the DOM — the
        // checkbox is the source of truth here, same pattern as PlatformSettings' alwaysOpen.
        onlineBookingWindowStart: followPlatformWindow ? null : (values.onlineBookingWindowStart || null),
        onlineBookingWindowEnd: followPlatformWindow ? null : (values.onlineBookingWindowEnd || null),
      })
      setBookingSaved(true)
    } catch (err) {
      setEditError(err.message || 'Could not save booking settings.')
    } finally {
      setBookingSubmitting(false)
    }
  }

  const allDoctors = data.doctors || []
  const pendingDoctors = allDoctors.filter((item) => (item.status || 'verified') === 'pending')

  return <Page kicker="Production database" title="Doctor management" subtitle="Create, verify, enable, and disable doctor accounts." action={<div className="flex flex-wrap items-center gap-2"><Button type="button" tone="secondary" disabled={loading} onClick={load}>{loading ? 'Refreshing…' : '↻ Refresh'}</Button><Button type="button" tone="dark" onClick={exportCsv}>Export CSV</Button></div>}>
    <form onSubmit={save} className="mb-6 rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="mb-4 text-lg">Create doctor account</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Doctor name" name="name" required />
        <FormField label="Email" name="email" type="email" required />
        <FormField label="Phone" name="phone" type="tel" />
        <FormField label="Temporary password" name="password" type="password" required />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Specialization<span className="text-error"> *</span></span>
          <Select name="specializationId" required placeholder="Select Specialization" options={specializations.map((item) => ({ value: item.id, label: item.name }))} />
        </label>
        <FormField label="Qualification" name="qualification" />
        <FormField label="Registration number" name="registrationNumber" />
        <FormField label="Experience (years)" name="experience" type="number" min="0" />
        <FormField label="Consultation fee" name="fee" type="number" min="0" />
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" name="verifyImmediately" /> Verify immediately</label>
      </div>
      <ErrorNote>{formError}</ErrorNote>
      <Button type="submit" className="mt-4" disabled={submitting}>{submitting ? 'Creating…' : 'Create doctor'}</Button>
      {saved && <p role="status" className="mt-3 text-sm font-semibold text-success">Doctor account created.</p>}
    </form>
    <div className="rounded-card border border-border bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg">Live records</h2><span className="text-xs font-semibold uppercase tracking-widest text-muted">{allDoctors.length} record(s)</span></div>
      <ErrorNote>{statusError}</ErrorNote>
      <ErrorNote>{listError}</ErrorNote>
      <DataTable loading={loading} rows={allDoctors} columns={[
        { key: 'id', label: 'ID', render: (item) => stableId(item.doctorNumber, 'DCD') },
        { key: 'name', label: 'Doctor' },
        { key: 'registrationNumber', label: 'Registration' },
        { key: 'experienceYears', label: 'Experience', render: (item) => `${item.experienceYears || 0} years` },
        { key: 'consultationFee', label: 'Fee', render: (item) => `₹${item.consultationFee || 0}` },
        { key: 'rating', label: 'Rating' },
        { key: 'status', label: 'Verification', render: (item) => <StatusPill status={item.status || 'verified'} /> },
        // COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's
        // login"): a distinct column from "Verification" above — accountStatus is only present
        // on rows for an admin/superadmin caller (see doctors.service.js#shapeDoctor's
        // includeContact gate, which is what listDoctors passes for this caller).
        { key: 'accountStatus', label: 'Login', render: (item) => <StatusPill status={item.accountStatus || 'active'} /> },
        {
          key: 'actionCol', label: 'Actions', render: (item) => {
            const currentStatus = item.status || 'verified'
            const currentAccountStatus = item.accountStatus || 'active'
            return <div className="flex flex-wrap gap-2">
              <Button tone="secondary" disabled={viewingId === item.id} onClick={() => viewDetails(item.id)}>{viewingId === item.id ? 'Loading…' : 'View details'}</Button>
              <Button tone="secondary" disabled={editingId === item.id} onClick={() => openBookingSettings(item.id)}>{editingId === item.id ? 'Loading…' : 'Booking settings'}</Button>
              <Button tone="secondary" disabled={updatingId === item.id} onClick={() => changeStatus(item.id, currentStatus === 'verified' ? 'disabled' : 'verified')}>{currentStatus === 'verified' ? 'Disable' : 'Verify'}</Button>
              <Button tone={currentAccountStatus === 'active' ? 'error' : 'secondary'} disabled={accountUpdatingId === item.id} onClick={() => changeAccountStatus(item.id, currentAccountStatus === 'active' ? 'disabled' : 'active')}>{accountUpdatingId === item.id ? 'Updating…' : currentAccountStatus === 'active' ? 'Disable login' : 'Enable login'}</Button>
            </div>
          }
        }
      ]} />
    </div>
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg">Pending verification</h2><span className="text-xs font-semibold uppercase tracking-widest text-muted">{pendingDoctors.length} record(s)</span></div>
      {pendingDoctors.length === 0 ? (
        <EmptyState title="No doctors awaiting verification" message="Newly self-registered doctors, or any account created above without 'Verify immediately', will show up here." />
      ) : (
        <DataTable rows={pendingDoctors} columns={[
          { key: 'id', label: 'ID', render: (item) => stableId(item.doctorNumber, 'DCD') },
          { key: 'name', label: 'Doctor' },
          { key: 'registrationNumber', label: 'Registration' },
          { key: 'experienceYears', label: 'Experience', render: (item) => `${item.experienceYears || 0} years` },
          { key: 'consultationFee', label: 'Fee', render: (item) => `₹${item.consultationFee || 0}` },
          {
            key: 'actionCol', label: 'Actions', render: (item) => (
              <div className="flex flex-wrap gap-2">
                <Button tone="secondary" disabled={viewingId === item.id} onClick={() => viewDetails(item.id)}>{viewingId === item.id ? 'Loading…' : 'View details'}</Button>
                <Button tone="secondary" disabled={updatingId === item.id} onClick={() => changeStatus(item.id, 'verified')}>{updatingId === item.id ? 'Verifying…' : 'Verify'}</Button>
              </div>
            )
          }
        ]} />
      )}
    </div>
    <Modal open={!!viewingDoctor} title={viewingDoctor?.name || 'Doctor details'} onClose={() => { setViewingDoctor(null); setViewError('') }}>
      <ErrorNote>{viewError}</ErrorNote>
      {viewingDoctor && <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between"><span className="font-semibold text-ink">Verification status</span><StatusPill status={viewingDoctor.status || 'verified'} /></div>
        <div className="flex items-center justify-between"><span className="font-semibold text-ink">Login status</span><StatusPill status={viewingDoctor.accountStatus || 'active'} /></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted">Email</dt><dd className="break-all font-medium text-ink">{viewingDoctor.email || '—'}</dd>
          <dt className="text-muted">Phone</dt><dd className="font-medium text-ink">{viewingDoctor.phone || '—'}</dd>
          <dt className="text-muted">City</dt><dd className="font-medium text-ink">{viewingDoctor.city || '—'}</dd>
          <dt className="text-muted">Specialization</dt><dd className="font-medium text-ink">{viewingDoctor.specialization?.name || '—'}</dd>
          <dt className="text-muted">Qualification</dt><dd className="font-medium text-ink">{viewingDoctor.qualification || '—'}</dd>
          <dt className="text-muted">Registration no.</dt><dd className="font-medium text-ink">{viewingDoctor.registrationNumber || '—'}</dd>
          <dt className="text-muted">Experience</dt><dd className="font-medium text-ink">{viewingDoctor.experienceYears || 0} years</dd>
          <dt className="text-muted">Consultation fee</dt><dd className="font-medium text-ink">₹{viewingDoctor.consultationFee || 0}</dd>
          <dt className="text-muted">Emergency fee</dt><dd className="font-medium text-ink">₹{viewingDoctor.emergencyFee || 0}</dd>
          <dt className="text-muted">Rating</dt><dd className="font-medium text-ink">{viewingDoctor.rating || 0} ({viewingDoctor.reviewCount || 0} reviews)</dd>
          <dt className="text-muted">Languages</dt><dd className="font-medium text-ink">{(viewingDoctor.languages || []).join(', ') || '—'}</dd>
          <dt className="text-muted">Clinics</dt><dd className="font-medium text-ink">{(viewingDoctor.clinics || []).map((c) => c.name).join(', ') || '—'}</dd>
        </dl>
        {viewingDoctor.bio && <p className="rounded-button border border-border bg-surface px-3 py-2 text-muted">{viewingDoctor.bio}</p>}
        {/* COMPLETENESS FIX (doctor panel profile-section audit): verificationDocuments (an
            admin/superadmin-only field — see doctors.service.js#shapeDoctor's includeContact
            gate) was written by a doctor's self-service upload but never displayed anywhere an
            admin could actually review it before deciding to verify the account. This is that
            review surface. */}
        <div>
          <h3 className="font-semibold text-ink">Verification documents</h3>
          {(viewingDoctor.verificationDocuments || []).length
            ? <ul className="mt-2 divide-y divide-border rounded-button border border-border">
                {viewingDoctor.verificationDocuments.map((doc, index) => <li key={`${doc.url}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{doc.name || `Document ${index + 1}`}</span>
                  <span className="flex items-center gap-3 text-xs text-muted">
                    {doc.uploadedAt && new Date(doc.uploadedAt).toLocaleDateString()}
                    <a href={doc.url} target="_blank" rel="noreferrer" className="font-semibold text-primary-dark hover:underline">View</a>
                  </span>
                </li>)}
              </ul>
            : <p className="mt-2 text-sm text-muted">No documents uploaded by this doctor yet.</p>}
        </div>
        {/* COMPLETENESS ADD (request: "doctor bank details v only admin and super admin dekh
            sakta hai add kro") — bankDetails is the same admin/superadmin-only field (see
            doctors.service.js#shapeDoctor's includeContact gate) as verificationDocuments above,
            so this admin view is the one place that's ever meant to show it. */}
        <div>
          <h3 className="font-semibold text-ink">Bank details</h3>
          {viewingDoctor.bankDetails
            ? <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-button border border-border px-3 py-2">
                <dt className="text-muted">Account holder</dt><dd className="font-medium text-ink">{viewingDoctor.bankDetails.accountHolderName || '—'}</dd>
                <dt className="text-muted">Bank</dt><dd className="font-medium text-ink">{viewingDoctor.bankDetails.bankName || '—'}</dd>
                <dt className="text-muted">Account number</dt><dd className="font-medium text-ink">{viewingDoctor.bankDetails.accountNumber || '—'}</dd>
                <dt className="text-muted">IFSC code</dt><dd className="font-medium text-ink">{viewingDoctor.bankDetails.ifscCode || '—'}</dd>
                <dt className="text-muted">UPI ID</dt><dd className="font-medium text-ink">{viewingDoctor.bankDetails.upiId || '—'}</dd>
              </dl>
            : <p className="mt-2 text-sm text-muted">This doctor has not added bank details yet.</p>}
        </div>
      </div>}
    </Modal>
    <Modal
      open={!!editingDoctor}
      title={editingDoctor ? `Booking settings — ${editingDoctor.name}` : 'Booking settings'}
      onClose={() => { setEditingDoctor(null); setEditError(''); setBookingSaved(false) }}
    >
      {editingDoctor && <form onSubmit={saveBookingSettings} className="space-y-4 text-sm">
        <label className="flex min-h-11 items-center justify-between gap-3 font-medium text-ink">
          Accept online bookings
          <input type="checkbox" name="onlineBooking" defaultChecked={Boolean(editingDoctor.onlineBooking)} />
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3 font-medium text-ink">
          Allow rebooking
          <input type="checkbox" name="allowRebooking" defaultChecked={Boolean(editingDoctor.allowRebooking)} />
        </label>
        <FormField
          label="Max days advance (1-365)"
          name="maxDaysAdvance"
          type="number"
          min="1"
          max="365"
          defaultValue={editingDoctor.maxDaysAdvance ?? 30}
          required
        />
        <FormField
          label="Max online bookings per day (optional)"
          name="maxOnlineBookingsPerDay"
          type="number"
          min="1"
          max="500"
          placeholder="No daily cap"
          defaultValue={editingDoctor.maxOnlineBookingsPerDay ?? ''}
        />
        <div className="border-t border-border pt-4">
          <p className="text-sm font-semibold text-ink">Online booking hours (this doctor)</p>
          <p className="mt-1 text-xs text-muted">Keep "Follow platform-wide hours" checked to use the platform's general online-booking window (Settings → Booking rules). Uncheck it to give THIS doctor their own hours instead — this overrides the platform-wide window just for them.</p>
          <label className="mt-3 flex min-h-11 items-center gap-2 font-medium text-ink">
            <input type="checkbox" checked={followPlatformWindow} onChange={(event) => setFollowPlatformWindow(event.target.checked)} />
            Follow platform-wide hours
          </label>
          {!followPlatformWindow && <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <FormField label="Open from" name="onlineBookingWindowStart" type="time" defaultValue={editingDoctor.onlineBookingWindowStart || '09:00'} required={!followPlatformWindow} />
            <FormField label="Open until" name="onlineBookingWindowEnd" type="time" defaultValue={editingDoctor.onlineBookingWindowEnd || '21:00'} required={!followPlatformWindow} />
          </div>}
        </div>
        <ErrorNote>{editError}</ErrorNote>
        <Button type="submit" disabled={bookingSubmitting}>{bookingSubmitting ? 'Saving…' : 'Save booking settings'}</Button>
        {bookingSaved && <p role="status" className="text-sm font-semibold text-success">Booking settings saved.</p>}
      </form>}
    </Modal>
  </Page>
}

export function ClinicVerification({ data }) {
  const fetchClinics = useAppStore((state) => state.fetchClinics)
  const approveClinic = useAppStore((state) => state.approveClinic)
  const rejectClinic = useAppStore((state) => state.rejectClinic)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState(null)
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = () => {
    setLoading(true)
    setListError('')
    return fetchClinics({ approvalStatus: 'pending' })
      .catch((err) => setListError(err.message || 'Could not load pending clinics.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError('')
    fetchClinics({ approvalStatus: 'pending' })
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load pending clinics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchClinics])

  const items = (data.clinics || []).filter((clinic) => clinic.approvalStatus === 'pending')

  const openReview = (clinic) => { setSelected(clinic); setReason(''); setActionError('') }

  const approve = async (id) => {
    setSubmitting(true)
    setActionError('')
    try {
      await approveClinic(id)
      setSelected(null)
    } catch (err) {
      setActionError(err.message || 'Could not approve this clinic.')
    } finally {
      setSubmitting(false)
    }
  }

  const reject = async (id) => {
    if (reason.trim().length < 5) { setActionError('Rejection reason must be at least 5 characters.'); return }
    setSubmitting(true)
    setActionError('')
    try {
      await rejectClinic(id, reason.trim())
      setSelected(null)
    } catch (err) {
      setActionError(err.message || 'Could not reject this clinic.')
    } finally {
      setSubmitting(false)
    }
  }

  return <Page title="Clinic verification" subtitle="Review submitted details and verification documents.">
    <DataTable
      loading={loading}
      error={listError}
      onRetry={load}
      rows={items}
      columns={[
        { key: 'name', label: 'Clinic' },
        { key: 'city', label: 'City', render: (item) => item.city?.name || '—' },
        { key: 'createdAt', label: 'Submitted', render: (item) => item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—' },
        { key: 'id', label: 'Action', render: (item) => <Button onClick={() => openReview(item)}>Review</Button> }
      ]}
    />
    <Modal open={Boolean(selected)} title="Review clinic application" onClose={() => setSelected(null)}>
      {selected && <div className="space-y-3">
        <p className="text-sm"><strong>Clinic:</strong> {selected.name}</p>
        <p className="text-sm"><strong>Address:</strong> {selected.address || [selected.area?.name, selected.city?.name].filter(Boolean).join(', ') || '—'}</p>
        <p className="text-sm"><strong>Phone:</strong> {selected.phone || '—'}</p>
        <FormField label="Rejection reason (if needed)" type="textarea" value={reason} onChange={(event) => setReason(event.target.value)} />
        <ErrorNote>{actionError}</ErrorNote>
        <div className="flex gap-3">
          <Button disabled={submitting} onClick={() => approve(selected.id)}>Approve & activate</Button>
          <Button tone="error" disabled={submitting} onClick={() => reject(selected.id)}>Reject</Button>
        </div>
      </div>}
    </Modal>
  </Page>
}

export function ManageClinics({ data }) {
  const toggleClinicEmergency = useAppStore((state) => state.toggleClinicEmergency)
  const toggleClinicStatus = useAppStore((state) => state.toggleClinicStatus)
  const fetchClinics = useAppStore((state) => state.fetchClinics)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyKey, setBusyKey] = useState(null)

  const load = () => {
    setLoading(true)
    setListError('')
    return fetchClinics({}).catch((err) => setListError(err.message || 'Could not load clinics.')).finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError('')
    fetchClinics({})
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load clinics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchClinics])

  const handleToggleStatus = async (id) => {
    setBusyKey(`${id}:status`)
    setActionError('')
    try {
      await toggleClinicStatus(id)
    } catch (err) {
      setActionError(err.message || 'Could not update this clinic\'s status.')
    } finally {
      setBusyKey(null)
    }
  }

  const handleToggleEmergency = async (id) => {
    setBusyKey(`${id}:emergency`)
    setActionError('')
    try {
      await toggleClinicEmergency(id)
    } catch (err) {
      setActionError(err.message || 'Could not update emergency availability.')
    } finally {
      setBusyKey(null)
    }
  }

  return <Page title="Clinic management" subtitle="Review and control clinic availability.">
    <ErrorNote>{actionError}</ErrorNote>
    <DataTable
      loading={loading}
      error={listError}
      onRetry={load}
      rows={(data.clinics || [])}
      columns={[
        { key: 'id', label: 'ID', render: (item) => stableId(item.clinicNumber, 'DCC') },
        { key: 'name', label: 'Clinic' },
        { key: 'address', label: 'Address', render: (item) => item.address || [item.area?.name, item.city?.name].filter(Boolean).join(', ') || '—' },
        { key: 'phone', label: 'Phone', render: (item) => item.phone || '—' },
        { key: 'approvalStatus', label: 'Status', render: (item) => <StatusPill status={item.approvalStatus || 'active'} /> },
        { key: 'actionCol', label: 'Actions', render: (item) => <Button tone="secondary" disabled={busyKey === `${item.id}:status`} onClick={() => handleToggleStatus(item.id)}>{item.approvalStatus === 'disabled' ? 'Enable' : 'Disable'}</Button> },
        { key: 'emergencyAvailable', label: 'Emergency', render: (item) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(item.emergencyAvailable)} disabled={busyKey === `${item.id}:emergency`} onChange={() => handleToggleEmergency(item.id)} /> Available</label> }
      ]}
    />
  </Page>
}

export function CitiesAreas({ data }) {
  const [mode, setMode] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const addCity = useAppStore((state) => state.addCity)
  const addArea = useAppStore((state) => state.addArea)
  const deleteCity = useAppStore((state) => state.deleteCity)
  const deleteArea = useAppStore((state) => state.deleteArea)

  const saveCity = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    if (!values.city) return
    setSubmitting(true)
    setError('')
    try {
      await addCity({ name: values.city, state: values.state || undefined })
      form.reset()
      setMode(null)
    } catch (err) {
      setError(err.message || 'Could not save this city.')
    } finally {
      setSubmitting(false)
    }
  }

  const saveArea = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    if (!values.area || !values.cityId) return
    setSubmitting(true)
    setError('')
    try {
      await addArea(values.cityId, { name: values.area, pincode: values.pincode || undefined })
      form.reset()
      setMode(null)
    } catch (err) {
      setError(err.message || 'Could not save this service area.')
    } finally {
      setSubmitting(false)
    }
  }

  const { deletingId, remove: removeRow } = useDeleteWithConfirm({
    setError,
    confirmMessage: (row) => row.type === 'city' ? `Delete the city "${row.name}"? This cannot be undone.` : `Delete the service area "${row.name}"? This cannot be undone.`,
    errorFallback: 'Could not delete this item.',
    deleteFn: (row) => (row.type === 'city' ? deleteCity(row.id) : deleteArea(row.cityId, row.id)),
  })

  const cityRows = (data.cities || []).map((city) => ({ id: city.id, name: city.name, state: city.state || '—', type: 'city' }))
  const areaRows = (data.areas || []).map((area) => {
    const city = (data.cities || []).find((item) => item.id === area.cityId)
    return { id: area.id, cityId: area.cityId, name: area.name, state: city?.state || '—', type: 'area' }
  })

  return <Page title="Cities & areas" subtitle="Maintain supported locations and pincodes." action={<div className="flex gap-2"><Button onClick={() => setMode(mode === 'city' ? null : 'city')}>Add city</Button><Button tone="secondary" onClick={() => setMode(mode === 'area' ? null : 'area')}>Add service area</Button></div>}>
    <ErrorNote>{error}</ErrorNote>
    {mode === 'city' && <form onSubmit={saveCity} className="mb-5 grid max-w-2xl gap-4 rounded-card border border-border bg-white p-5 shadow-card sm:grid-cols-2"><FormField label="City" name="city" required /><FormField label="State" name="state" required /><Button type="submit" className="sm:col-span-2" disabled={submitting}>{submitting ? 'Saving…' : 'Save city'}</Button></form>}
    {mode === 'area' && <form onSubmit={saveArea} className="mb-5 grid max-w-2xl gap-4 rounded-card border border-border bg-white p-5 shadow-card sm:grid-cols-3">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">City<span className="text-error"> *</span></span>
        <Select name="cityId" required placeholder="Select City" options={(data.cities || []).map((city) => ({ value: city.id, label: city.name }))} />
      </label>
      <FormField label="Area" name="area" required />
      <FormField label="Pincode" name="pincode" inputMode="numeric" required />
      <Button type="submit" className="sm:col-span-3" disabled={submitting}>{submitting ? 'Saving…' : 'Save area'}</Button>
    </form>}
    <DataTable
      rows={[...cityRows, ...areaRows]}
      columns={[
        { key: 'id', label: 'ID', render: (item, index) => sequenceId(index) },
        { key: 'name', label: 'Name' },
        { key: 'state', label: 'State' },
        { key: 'type', label: 'Type' },
        { key: 'status', label: 'Status', render: () => <StatusPill status="active" /> },
        {
          key: 'actions',
          label: 'Actions',
          render: (row) => <Button
            tone="error"
            disabled={deletingId === row.id}
            onClick={() => removeRow(row)}
          >
            {deletingId === row.id ? 'Deleting…' : 'Delete'}
          </Button>,
        },
      ]}
    />
  </Page>
}

// Real registered-patient directory (admin.service.js#listPatients — every User row with
// role='patient', straight from the database) is the primary source here, giving admin a genuine
// "how many patients have registered" answer with each one's id. Also still fetches appointments/
// payments and merges them in ONLY for the extra clinical fields (medical history, emergency
// contact) that the lean directory endpoint deliberately doesn't carry — a patient with no
// appointment/payment yet now still shows up (previously they were invisible: the old version of
// this page derived its ENTIRE list from appointments/payments, so an admin could never see a
// patient who had only just signed up).
export function ManagePatients({ data }) {
  const fetchPatients = useAppStore((state) => state.fetchPatients)
  const fetchAppointments = useAppStore((state) => state.fetchAppointments)
  const fetchPayments = useAppStore((state) => state.fetchPayments)
  // COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
  // PATCH /admin/patients/:id/status now exists (see useAppStore.js#updatePatientStatus) — the
  // disclaimer paragraph this replaced was stale the same way the old "Users" page's "no
  // /patients endpoint" comment was (Priority 1 #4): true when written, false by the time this
  // was read.
  const updatePatientStatus = useAppStore((state) => state.updatePatientStatus)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [search, setSearch] = useState('')
  const [statusError, setStatusError] = useState('')
  const [updatingId, setUpdatingId] = useState(null)

  const load = (filters = {}) => {
    setLoading(true)
    setListError('')
    return Promise.all([fetchPatients({ pageSize: 100, ...filters }), fetchAppointments({}), fetchPayments({})])
      .catch((err) => setListError(err.message || 'Could not load patient records.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError('')
    Promise.all([fetchPatients({ pageSize: 100 }), fetchAppointments({}), fetchPayments({})])
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load patient records.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchPatients, fetchAppointments, fetchPayments])

  const searchSubmit = (event) => {
    event.preventDefault()
    load({ search: search.trim() || undefined })
  }

  const changeStatus = async (id, nextStatus) => {
    setUpdatingId(id)
    setStatusError('')
    try {
      await updatePatientStatus(id, nextStatus)
    } catch (err) {
      setStatusError(err.message || "Could not update this patient's login status.")
    } finally {
      setUpdatingId(null)
    }
  }

  // Clinical enrichment ONLY — id/name/email/phone/registeredAt all come from the real directory
  // (data.patients) below, never from this map, so a patient who never booked/paid still gets
  // correct identity fields instead of being silently dropped.
  const clinicalMap = new Map()
  for (const appointment of data.appointments || []) {
    if (appointment.patient?.id) clinicalMap.set(appointment.patient.id, appointment.patient)
  }
  for (const payment of data.payments || []) {
    if (payment.patient?.id && !clinicalMap.has(payment.patient.id)) clinicalMap.set(payment.patient.id, payment.patient)
  }

  const patients = (data.patients || []).map((patient) => ({ ...patient, ...(clinicalMap.get(patient.id) || {}) }))
  const formatDate = sharedFormatDate
  const exportCsv = () => {
    const header = 'Id,Name,Email,Phone,City,Registered,Status\n'
    const body = patients.map((item) => [item.id, item.name, item.email, item.phone, item.city, formatDate(item.registeredAt), item.status].map(csvCell).join(',')).join('\n')
    downloadCsv('patients.csv', header + body)
  }

  return <Page
    title="Patient management"
    subtitle="Every registered patient account — not just ones seen in a booking or payment."
    action={<div className="flex flex-wrap items-center gap-2"><Button type="button" tone="secondary" disabled={loading} onClick={() => load({ search: search.trim() || undefined })}>{loading ? 'Refreshing…' : '↻ Refresh'}</Button><Button type="button" tone="dark" onClick={exportCsv}>Export CSV</Button></div>}
  >
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <span className="rounded-full bg-primary-light px-3 py-1.5 text-sm font-semibold text-primary-dark">{patients.length} registered patient{patients.length === 1 ? '' : 's'}</span>
      <form onSubmit={searchSubmit} className="flex gap-2">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, email, or phone" className="min-h-11 w-64 max-w-full rounded-button border border-border bg-white px-3 text-sm outline-none focus:border-primary-dark" />
        <Button type="submit" tone="secondary">Search</Button>
      </form>
    </div>
    <ErrorNote>{statusError}</ErrorNote>
    <DataTable loading={loading} error={listError} onRetry={load} rows={patients} columns={[
      { key: 'id', label: 'ID', render: (item) => stableId(item.patientNumber, 'DCP') },
      { key: 'name', label: 'Patient' },
      { key: 'email', label: 'Email', render: (item) => item.email || '—' },
      { key: 'phone', label: 'Phone', render: (item) => item.phone || '—' },
      { key: 'registeredAt', label: 'Registered', render: (item) => formatDate(item.registeredAt) },
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
      // COMPLETENESS FIX (audit Priority 4): see useAppStore.js#updatePatientStatus.
      { key: 'status', label: 'Login', render: (item) => <StatusPill status={item.status || 'active'} /> },
      {
        key: 'actionCol',
        label: 'Actions',
        render: (item) => {
          const currentStatus = item.status || 'active'
          return <Button
            tone={currentStatus === 'active' ? 'error' : 'secondary'}
            disabled={updatingId === item.id}
            onClick={() => changeStatus(item.id, currentStatus === 'active' ? 'disabled' : 'active')}
          >
            {updatingId === item.id ? 'Updating…' : currentStatus === 'active' ? 'Disable login' : 'Enable login'}
          </Button>
        },
      },
    ]} />
  </Page>
}

export function ManageReceptionists({ data }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', clinicId: '' })
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const addReceptionist = useAppStore((state) => state.addReceptionist)
  const fetchReceptionists = useAppStore((state) => state.fetchReceptionists)

  const load = () => {
    setLoading(true)
    setListError('')
    return fetchReceptionists({}).catch((err) => setListError(err.message || 'Could not load receptionists.')).finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError('')
    fetchReceptionists({})
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load receptionists.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchReceptionists])

  const save = async (event) => {
    event.preventDefault()
    if (!form.name.trim() || !form.email.trim() || !form.password.trim() || !form.clinicId) {
      setFormError('Name, email, password, and clinic are required.')
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      await addReceptionist({ name: form.name.trim(), email: form.email.trim(), password: form.password, phone: form.phone || undefined, clinicId: form.clinicId })
      setForm({ name: '', phone: '', email: '', password: '', clinicId: '' })
      setAdding(false)
    } catch (err) {
      setFormError(err.message || 'Could not create this receptionist account.')
    } finally {
      setSubmitting(false)
    }
  }

  return <Page title="Manage receptionists" action={<Button onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Create receptionist'}</Button>}>
    {adding && <form onSubmit={save} className="mb-5 grid max-w-xl gap-3 rounded-card border border-border bg-white p-4 shadow-card sm:grid-cols-2">
      <FormField label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      <FormField label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
      <FormField label="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
      <FormField label="Temporary password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
      <label className="block sm:col-span-2">
        <span className="mb-1.5 block text-sm font-medium text-ink">Assigned clinic<span className="text-error"> *</span></span>
        <Select required placeholder="Select clinic" options={(data.clinics || []).map((clinic) => ({ value: clinic.id, label: clinic.name }))} value={form.clinicId} onChange={(event) => setForm({ ...form, clinicId: event.target.value })} />
      </label>
      <div className="sm:col-span-2"><ErrorNote>{formError}</ErrorNote></div>
      <Button type="submit" className="sm:col-span-2" disabled={submitting}>{submitting ? 'Saving…' : 'Save receptionist'}</Button>
    </form>}
    <DataTable
      loading={loading}
      error={listError}
      onRetry={load}
      rows={(data.receptionists || [])}
      columns={[{ key: 'name', label: 'Name' }, { key: 'clinicName', label: 'Assigned clinic', render: (item) => item.clinicName || '—' }, { key: 'phone', label: 'Phone', render: (item) => item.phone || '—' }, { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> }]}
    />
  </Page>
}

const parsePaymentDate = (value) => {
  if (!value) return null
  const text = String(value)
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slash) return new Date(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]))
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
const dateInputValue = (date) =>`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function RevenueReports({ data, doctorOnly = false }) {
  const fetchPayments = useAppStore((state) => state.fetchPayments)
  // `currentUser` lives at the top level of the store, not inside `data`.
  const currentUser = useAppStore((state) => state.currentUser)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const today = new Date()
  const [fromDate, setFromDate] = useState(() => dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [toDate, setToDate] = useState(() => dateInputValue(today))
  const [doctorFilter, setDoctorFilter] = useState('all')

  const load = () => {
    setLoading(true)
    setLoadError('')
    return fetchPayments({}).catch((err) => setLoadError(err.message || 'Could not load payment records.')).finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    fetchPayments({})
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load payment records.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchPayments])

  // The whole revenue-report derivation (filtering, per-payment fee shaping, the doctor-wise
  // grouping, and the payment-mode breakdown) previously ran unmemoized on every render of this
  // page, over a payments list that only grows over time, and computed the exact same
  // mode-breakdown reduce twice (once for the empty-check, once for the actual rows). Both are
  // fixed here: everything below now runs once per actual dependency change, and
  // `paymentModeBreakdown` is computed a single time and reused.
  const {
    selectedDoctor,
    payments,
    reportPayments,
    total,
    average,
    commission,
    clinicPayout,
    doctorNames,
    byDoctor,
    invalidRange,
    paymentModeBreakdown,
    bookingTotal,
    cashTotal,
    onlineTotal,
  } = useMemo(() => {
    const currentDoctor = (data.doctors || []).find((doctor) => doctor.id === currentUser?.id) || (data.doctors || []).find((doctor) => doctor.name === currentUser?.name) || null
    const selectedDoctor = doctorOnly ? (currentDoctor?.name || 'all') : doctorFilter
    const sourcePayments = doctorOnly ? (currentDoctor ? (data.payments || []).filter((payment) => payment.doctor?.id === currentDoctor.id) : []) : (data.payments || [])
    const start = parsePaymentDate(fromDate)
    const end = parsePaymentDate(toDate)
    if (start) start.setHours(0, 0, 0, 0)
    if (end) end.setHours(23, 59, 59, 999)
    const invalidRange = Boolean(fromDate && toDate && fromDate > toDate)
    const payments = sourcePayments.filter((payment) => {
      const date = parsePaymentDate(payment.createdAt)
      const name = payment.doctor?.name || 'Unassigned'
      const inPeriod = !invalidRange && date && start && end ? date >= start && date <= end : false
      return inPeriod && (selectedDoctor === 'all' || name === selectedDoctor)
    })
    // Money fields come pre-masked/pre-computed by role from the server (plan
    // §1.8/§1.12) — doctor/receptionist only ever get `fees.consultationFee`,
    // admin gets the full set including `commission`/`clinicPayout`, already
    // computed server-side. No client-side commission math needed anymore.
    const reportPayments = payments.map((item) => ({
      ...item,
      reportAmount: Number(doctorOnly ? (item.fees?.consultationFee ?? 0) : (item.fees?.amount ?? 0)),
    }))
    const total = reportPayments.reduce((sum, item) => sum + item.reportAmount, 0)
    const average = reportPayments.length ? total / reportPayments.length : 0
    const commission = doctorOnly ? 0 : reportPayments.reduce((sum, item) => sum + Number(item.fees?.commission ?? 0), 0)
    const clinicPayout = doctorOnly ? total : reportPayments.reduce((sum, item) => sum + Number(item.fees?.clinicPayout ?? 0), 0)
    const doctorNames = [...new Set([...(data.doctors || []).map((doctor) => doctor.name), ...sourcePayments.map((item) => item.doctor?.name).filter(Boolean)])]
    const byDoctor = Object.values(reportPayments.reduce((groups, item) => {
      const name = item.doctor?.name || 'Unassigned'
      const group = groups[name] || { id: name, doctor: name, payments: 0, revenue: 0 }
      group.payments += 1
      group.revenue += item.reportAmount
      groups[name] = group
      return groups
    }, {}))
    // COMPLETENESS ADD (request: "receptionist and doctor ke pass show ho online payment kitna hua
    // cash ye proper way me", then "eshme ye show hona chahiye ki online booking ke time pe kitna
    // payment hua hai and second clinic pe aake cash ya online ye v to confirm hona chahiye") —
    // this used to be a bare count per raw mode string ("Cash: 3"), with no rupee amount anywhere,
    // then a cash-vs-online rollup that didn't separate a patient's own booking-time Razorpay
    // payment from one collected in person at the clinic (both use the identical mode:'online' —
    // see lib/paymentVisibility.js's isOnlineBookingPayment for how the two are told apart). Now
    // tracks amount + count per literal mode (for the detail list) AND a three-way rollup: paid
    // online at booking, cash collected at the clinic, and online collected at the clinic.
    const paymentModeBreakdown = reportPayments.reduce((buckets, item) => {
      const mode = item.mode || 'Other'
      const bucket = buckets[mode] || { mode, count: 0, amount: 0 }
      bucket.count += 1
      bucket.amount += item.reportAmount
      buckets[mode] = bucket
      return buckets
    }, {})
    const isCashMode = (mode) => String(mode || '').toLowerCase() === 'cash'
    const bookingTotal = reportPayments.filter(isOnlineBookingPayment).reduce((sum, item) => sum + item.reportAmount, 0)
    const cashTotal = reportPayments.filter((item) => isCashMode(item.mode) && !isOnlineBookingPayment(item)).reduce((sum, item) => sum + item.reportAmount, 0)
    const onlineTotal = reportPayments.filter((item) => !isCashMode(item.mode) && !isOnlineBookingPayment(item)).reduce((sum, item) => sum + item.reportAmount, 0)
    return { selectedDoctor, payments, reportPayments, total, average, commission, clinicPayout, doctorNames, byDoctor, invalidRange, paymentModeBreakdown, bookingTotal, cashTotal, onlineTotal }
  }, [data.doctors, data.payments, currentUser, doctorOnly, doctorFilter, fromDate, toDate])
  const periodLabel = `${fromDate || 'Start'} to ${toDate || 'End'}`
  const downloadExcel = () => {
    const escape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const doctorRows = byDoctor.map((item) => `<tr><td>${escape(item.doctor)}</td><td>${item.payments}</td><td>${escape(money(item.revenue))}</td></tr>`).join('')
    const paymentRows = reportPayments.map((item) => `<tr><td>${escape(item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '')}</td><td>${escape(item.doctor?.name || 'Unassigned')}</td><td>${escape(item.receiptNumber || '')}</td><td>${escape(item.mode || 'Other')}</td><td>${escape(money(item.reportAmount))}</td><td>${escape(item.status || '')}</td></tr>`).join('')
    const html = `<html><head><meta charset="UTF-8"></head><body><h2>BookMyDoctor24 Revenue Report</h2><p>Period: ${escape(periodLabel)} · Doctor: ${escape(selectedDoctor === 'all' ? 'All doctors' : selectedDoctor)}</p><table border="1"><tr><th>Metric</th><th>Value</th></tr><tr><td>Revenue</td><td>${escape(money(total))}</td></tr><tr><td>Payments</td><td>${payments.length}</td></tr><tr><td>Platform commission</td><td>${escape(money(commission))}</td></tr><tr><td>Clinic payout</td><td>${escape(money(clinicPayout))}</td></tr></table><br><h3>Doctor-wise revenue</h3><table border="1"><tr><th>Doctor</th><th>Payments</th><th>Revenue</th></tr>${doctorRows || '<tr><td colspan="3">No payments</td></tr>'}</table><br><h3>Payment details</h3><table border="1"><tr><th>Date</th><th>Doctor</th><th>Receipt</th><th>Mode</th><th>Amount</th><th>Status</th></tr>${paymentRows || '<tr><td colspan="6">No payments</td></tr>'}</table></body></html>`
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `bookmydoctor24-revenue-${fromDate || 'start'}-to-${toDate || 'end'}.xls`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <Page title={doctorOnly ? 'My revenue reports' : 'Revenue reports'} subtitle={doctorOnly ? 'View only your own revenue for any selected date range.' : 'View payment revenue for any selected date range and doctor.'} action={<div className="flex flex-wrap items-end gap-2"><label className="text-xs font-semibold text-muted">From<input aria-label="Revenue start date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block min-h-11 rounded-button border border-border bg-white px-3 text-sm" /></label><label className="text-xs font-semibold text-muted">To<input aria-label="Revenue end date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 block min-h-11 rounded-button border border-border bg-white px-3 text-sm" /></label>{!doctorOnly && <Select aria-label="Filter by doctor" includeBlank={false} className="min-w-[10rem]" value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)} options={[{ value: 'all', label: 'All doctors' }, ...doctorNames.map((name) => ({ value: name, label: name }))]} />}<button type="button" onClick={downloadExcel} className="touch-target inline-flex items-center rounded-button bg-primary-dark px-3.5 text-sm font-semibold text-white hover:bg-charcoal">Download Excel</button></div>}>
    {invalidRange && <p role="alert" className="mb-4 rounded-button border border-error/30 bg-error/10 px-3 py-2 text-sm font-semibold text-error">From date must be before To date.</p>}
    <ErrorNote>{loadError}</ErrorNote>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Selected range revenue" value={money(total)} detail={`${reportPayments.length} payment${reportPayments.length === 1 ? '' : 's'}`} icon="₹" /><StatCard label="Average payment" value={money(average)} detail={periodLabel} icon="≈" /><StatCard label="Platform commission" value={doctorOnly ? '—' : money(commission)} detail={doctorOnly ? 'Shown to admin only' : 'Convenience/emergency/GST charges'} icon="%" /><StatCard label="Clinic payout" value={money(clinicPayout)} detail={doctorOnly ? 'Your consultation charges' : "Full consultation fee (doctor's share)"} icon="✓" /></div>
    <div className="mt-6 grid gap-5 lg:grid-cols-2"><section className="rounded-card border border-border bg-white p-5 shadow-card"><h2 className="text-lg">Doctor-wise revenue</h2><p className="mt-1 text-sm text-muted">{periodLabel} · {selectedDoctor === 'all' ? 'All doctors' : selectedDoctor}</p><div className="mt-4"><DataTable rows={byDoctor} columns={[{ key: 'doctor', label: 'Doctor' }, { key: 'payments', label: 'Payments' }, { key: 'revenue', label: 'Revenue', render: (item) => money(item.revenue) }]} /></div></section><section className="rounded-card border border-border bg-white p-5 shadow-card"><h2 className="text-lg">Payment modes</h2><div className="mt-4 grid grid-cols-3 gap-3"><div className="rounded-button bg-surface p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Paid at booking</p><p className="mt-1 text-lg font-bold text-ink">{money(bookingTotal)}</p></div><div className="rounded-button bg-surface p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Cash (clinic)</p><p className="mt-1 text-lg font-bold text-ink">{money(cashTotal)}</p></div><div className="rounded-button bg-surface p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Online (clinic)</p><p className="mt-1 text-lg font-bold text-ink">{money(onlineTotal)}</p></div></div><div className="mt-4 space-y-3">{Object.keys(paymentModeBreakdown).length ? Object.values(paymentModeBreakdown).map((bucket) => <p className="flex justify-between text-sm" key={bucket.mode}><span>{bucket.mode}</span><strong>{money(bucket.amount)} · {bucket.count}</strong></p>) : <p className="text-sm text-muted">No payments in this period.</p>}</div></section></div>
    <div className="mt-6 rounded-card border border-border bg-white p-5 shadow-card"><h2 className="mb-3 text-lg">Payments in selected period</h2><DataTable loading={loading} error={loadError} onRetry={load} rows={reportPayments} columns={[{ key: 'createdAt', label: 'Date', render: (item) => item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—' }, { key: 'doctor', label: 'Doctor', render: (item) => item.doctor?.name || 'Unassigned' }, { key: 'receiptNumber', label: 'Receipt', render: (item) => item.receiptNumber || '—' },
      // BOOKING-ID VISIBILITY FIX (user request: "payment me v booking id do", follow-up to
      // "bookinh id ko slip pe dikhai and my bookong me v dikhao") — this table (shared by
      // admin's "Revenue reports" and, via the doctorOnly prop, the doctor's own "My revenue
      // reports") only ever showed the payment's own Receipt id, never the appointment/booking it
      // belongs to. Every payment row already carries `appointment: {id}` straight from the API
      // (payments.service.js#shapePayment), unmasked for every role. Same shortId() format used
      // everywhere else in the app.
      { key: 'bookingId', label: 'Booking ID', render: (item) => item.appointment?.id ? shortId(item.appointment.id) : '—' },
      // COMPLETENESS ADD (request: "eshme v add kro ye sab ye sab patient setion me v add kro ...
      // admin section me v") — same "At booking" / "At clinic" confirmation tag as the
      // receptionist/doctor and patient Payments tables, so admin can tell a patient's own
      // booking-time Razorpay payment apart from one collected in person at the clinic.
      { key: 'mode', label: 'Mode', render: (item) => <span className="inline-flex items-center gap-1.5">{item.mode}<PaymentSourceBadge payment={item} /></span> },
      { key: 'reportAmount', label: 'Amount', render: (item) => money(item.reportAmount) }, { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> }]} /></div>
    <div className="mt-6"><Analytics data={data} admin /></div>
  </Page>
}
export function Complaints({ data }) {
  const updateComplaint = useAppStore((state) => state.updateComplaint)
  const fetchComplaints = useAppStore((state) => state.fetchComplaints)
  const complaints = data.complaints || []
  const [complaintId, setComplaintId] = useState('')
  const [status, setStatus] = useState('open')
  const [response, setResponse] = useState('')
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')

  const load = () => {
    setLoading(true)
    setListError('')
    return fetchComplaints({}).catch((err) => setListError(err.message || 'Could not load complaints.')).finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError('')
    fetchComplaints({})
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load complaints.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchComplaints])

  const save = async (event) => {
    event.preventDefault()
    if (!complaintId) return
    setSubmitting(true)
    setFormError('')
    setSaved(false)
    try {
      // Real endpoint field is `adminResponse`, not `response` (plan §1.16).
      await updateComplaint(complaintId, { status, adminResponse: response.trim() })
      setSaved(true)
      setResponse('')
    } catch (err) {
      setFormError(err.message || 'Could not save this response.')
    } finally {
      setSubmitting(false)
    }
  }
  return <Page title="Complaints" subtitle="Respond to and resolve submitted issues.">
    <form onSubmit={save} className="mb-5 grid max-w-2xl gap-4 rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg">Update complaint</h2>
      <FormField label="Complaint ID" type="select" options={complaints.map((item) => item.id)} value={complaintId} onChange={(event) => setComplaintId(event.target.value)} required />
      <FormField label="Status" type="select" options={Object.values(COMPLAINT_STATUS_LABELS)} value={COMPLAINT_STATUS_LABELS[status]} onChange={(event) => setStatus(Object.keys(COMPLAINT_STATUS_LABELS).find((key) => COMPLAINT_STATUS_LABELS[key] === event.target.value) || 'open')} required />
      <FormField label="Admin response" type="textarea" value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Reply to the complainant" />
      <ErrorNote>{formError}</ErrorNote>
      <Button type="submit" className="w-fit" disabled={submitting}>{submitting ? 'Saving…' : 'Save response'}</Button>
      {saved && <p role="status" className="text-sm font-semibold text-success">Response saved.</p>}
    </form>
    <DataTable
      loading={loading}
      error={listError}
      onRetry={load}
      rows={complaints}
      columns={[
        { key: 'id', label: 'ID', render: (item, index) => sequenceId(index) },
        { key: 'subject', label: 'Subject' },
        { key: 'raisedBy', label: 'Raised by', render: (item) => item.raisedBy?.name || '—' },
        { key: 'createdAt', label: 'Date', render: (item) => item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—' },
        { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
        { key: 'adminResponse', label: 'Admin response', render: (item) => item.adminResponse || '—' }
      ]}
    />
  </Page>
}

export function Broadcast() {
  const broadcastNotification = useAppStore((state) => state.broadcastNotification)
  const fetchBroadcastHistory = useAppStore((state) => state.fetchBroadcastHistory)
  const markAll = useAppStore((state) => state.markAllNotificationsRead)
  const broadcasts = useAppStore((state) => state.data.broadcasts || [])
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [markError, setMarkError] = useState('')
  // COMPLETENESS FIX (audit Priority 3b — web behind mobile): the backend and mobile both support
  // targeting one specific user (audience: 'single_user' + targetUserId); web's composer only had
  // All/Patients/Doctors/Receptionists. Track the selected audience so the id field can appear
  // only when needed, mirroring mobile's admin_broadcast_screen.dart.
  const [audienceChoice, setAudienceChoice] = useState('All users')

  const load = () => {
    setLoading(true)
    setListError('')
    return fetchBroadcastHistory({}).catch((err) => setListError(err.message || 'Could not load broadcast history.')).finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError('')
    fetchBroadcastHistory({})
      .catch((err) => { if (!cancelled) setListError(err.message || 'Could not load broadcast history.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchBroadcastHistory])

  const audienceMap = { 'All users': 'all', 'Patients': 'patients', 'Doctors': 'doctors', 'Receptionists': 'receptionists', 'Single user (by id)': 'single_user' }

  const send = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    const audience = audienceMap[values.audience] || 'all'
    setSubmitting(true)
    setFormError('')
    setSaved(false)
    if (audience === 'single_user' && !values.targetUserId?.trim()) {
      setFormError('Target user id is required for a single-user notification.')
      setSubmitting(false)
      return
    }
    try {
      await broadcastNotification({
        audience,
        title: values.title,
        body: values.message,
        ...(audience === 'single_user' ? { targetUserId: values.targetUserId.trim() } : {}),
      })
      setSaved(true)
      form.reset()
      setAudienceChoice('All users')
      load()
    } catch (err) {
      setFormError(err.message || 'Could not send this broadcast.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleMarkAll = async () => {
    setMarkError('')
    try {
      await markAll()
    } catch (err) {
      setMarkError(err.message || 'Could not mark notifications as read.')
    }
  }

  return <Page title="Notifications" subtitle="Queue, booking, payment, and system updates." action={<Button tone="secondary" onClick={handleMarkAll}>Mark all as read</Button>}>
    <ErrorNote>{markError}</ErrorNote>
    <form onSubmit={send} className="mb-6 max-w-2xl rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg">Send notification</h2>
      <div className="mt-4 space-y-4">
        <FormField label="Audience" name="audience" type="select" options={['All users', 'Patients', 'Doctors', 'Receptionists', 'Single user (by id)']} value={audienceChoice} onChange={(event) => setAudienceChoice(event.target.value)} />
        {audienceChoice === 'Single user (by id)' && <FormField label="Target user id" name="targetUserId" placeholder="e.g. the user's account id" required />}
        <FormField label="Title" name="title" required />
        <FormField label="Message" name="message" type="textarea" required />
        <ErrorNote>{formError}</ErrorNote>
        <Button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send broadcast'}</Button>
        {saved && <p role="status" className="text-sm font-semibold text-success">Broadcast sent.</p>}
      </div>
    </form>
    <DataTable
      loading={loading}
      error={listError}
      onRetry={load}
      rows={broadcasts}
      columns={[
        { key: 'id', label: 'Id', render: (item, index) => sequenceId(index) },
        { key: 'createdAt', label: 'Date', render: (item) => item.createdAt ? new Date(item.createdAt).toLocaleString() : '—' },
        { key: 'title', label: 'Title' },
        { key: 'body', label: 'Message' },
        { key: 'audience', label: 'Audience' },
        { key: 'recipientCount', label: 'Recipients', render: (item) => item.recipientCount ?? '—' },
        { key: 'readCount', label: 'Read', render: (item) => item.readCount ?? '—' }
      ]}
    />
  </Page>
}
export function AuditLog({ data }) {
  const fetchActivityLog = useAppStore((state) => state.fetchActivityLog)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    return fetchActivityLog({}).catch((err) => setError(err.message || 'Could not load the activity log.')).finally(() => setLoading(false))
  }

  const refresh = () => {
    setRefreshing(true)
    setError('')
    return fetchActivityLog({}).catch((err) => setError(err.message || 'Could not load the activity log.')).finally(() => setRefreshing(false))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchActivityLog({})
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load the activity log.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchActivityLog])

  return <Page title="Activity logs" subtitle="Audit important platform actions." action={<div className="flex flex-wrap items-center gap-2"><button type="button" className="touch-target rounded-button border border-border bg-white px-4 text-sm font-semibold text-ink disabled:opacity-60" onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button><Button tone="secondary" onClick={() => window.alert('CSV export is available for this browser session.')}>Export CSV</Button></div>}>
    <DataTable
      loading={loading}
      error={error}
      onRetry={load}
      rows={(data.activity || [])}
      columns={[
        { key: 'id', label: 'Id', render: (item, index) => sequenceId(index) },
        { key: 'createdAt', label: 'Date', render: (item) => item.createdAt ? new Date(item.createdAt).toLocaleString() : '—' },
        { key: 'description', label: 'Action', render: (item) => item.description || item.actionType || '—' },
        { key: 'actorName', label: 'User', render: (item) => item.actor?.name || 'System' },
        { key: 'actorEmail', label: 'Email', render: (item) => item.actor?.email || '—' },
        { key: 'actorRole', label: 'Role', render: (item) => item.actorRole || '—' },
        { key: 'ipAddress', label: 'IP address', render: (item) => item.ipAddress || '—' },
        { key: 'targetEntityType', label: 'Entity', render: (item) => item.targetEntityType || '—' },
        { key: 'targetEntityId', label: 'Entity id', render: (item) => item.targetEntityId || '—' }
      ]}
    />
  </Page>
}
export function PlatformSettings() {
  const systemSettings = useAppStore((state) => state.data.systemSettings)
  const bookingRules = useAppStore((state) => state.data.bookingRules)
  const fetchSystemSettings = useAppStore((state) => state.fetchSystemSettings)
  const updateSystemSettings = useAppStore((state) => state.updateSystemSettings)
  const fetchBookingRules = useAppStore((state) => state.fetchBookingRules)
  const updateBookingRules = useAppStore((state) => state.updateBookingRules)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [rulesSaved, setRulesSaved] = useState(false)
  const [rulesError, setRulesError] = useState('')
  const [rulesSubmitting, setRulesSubmitting] = useState(false)
  // Defaults to "always open" (true) until real data arrives, then syncs to whatever's actually
  // saved — a fetched window (both times set) flips this off so the time fields show instead.
  const [alwaysOpen, setAlwaysOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    Promise.all([fetchSystemSettings(), fetchBookingRules()])
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load settings.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchSystemSettings, fetchBookingRules])

  useEffect(() => {
    if (bookingRules) setAlwaysOpen(!bookingRules.onlineBookingWindowStart)
  }, [bookingRules])

  const save = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    setSubmitting(true)
    setFormError('')
    setSaved(false)
    try {
      // Real endpoint field is `maintenanceMode`, not `maintenance` (plan §1.18).
      // `bookingFee` deliberately dropped from this payload (product decision: keep
      // only "Platform charges" as the single pricing-config surface for
      // admin/superadmin — see admin.service.js#updateSystemSettings and
      // admin.validation.js for the matching backend-side removal).
      await updateSystemSettings({
        platformName: values.platformName,
        supportEmail: values.supportEmail || undefined,
        supportPhone: values.supportPhone || undefined,
        maintenanceMode: values.maintenanceMode === 'on',
      })
      setSaved(true)
    } catch (err) {
      setFormError(err.message || 'Could not save settings.')
    } finally {
      setSubmitting(false)
    }
  }

  const saveRules = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    setRulesSubmitting(true)
    setRulesError('')
    setRulesSaved(false)
    try {
      await updateBookingRules({
        cancellationWindowHours: Number(values.cancellationWindowHours) || 0,
        maxBookingsPerPatient: Number(values.maxBookingsPerPatient) || 1,
        defaultSlotMinutes: Number(values.defaultSlotMinutes) || 15,
        // "Always open" clears the window entirely (both null) regardless of whatever the now-
        // hidden time inputs still hold in the DOM — the checkbox is the source of truth, not
        // field presence.
        onlineBookingWindowStart: alwaysOpen ? null : (values.onlineBookingWindowStart || null),
        onlineBookingWindowEnd: alwaysOpen ? null : (values.onlineBookingWindowEnd || null),
        onlineBookingMaxAdvanceDays: values.onlineBookingMaxAdvanceDays === '' ? null : Number(values.onlineBookingMaxAdvanceDays),
      })
      setRulesSaved(true)
    } catch (err) {
      setRulesError(err.message || 'Could not save booking rules.')
    } finally {
      setRulesSubmitting(false)
    }
  }

  if (loading) return <Page title="Settings" subtitle="Persist platform identity, fees, and maintenance status."><LoadingSkeleton /></Page>

  return <Page title="Settings" subtitle="Persist platform identity, fees, and maintenance status.">
    <ErrorNote>{loadError}</ErrorNote>
    <form onSubmit={save} className="max-w-2xl rounded-card border border-border bg-white p-5 shadow-card">
      <div className="space-y-4">
        <FormField label="Platform name" name="platformName" defaultValue={systemSettings?.platformName || 'BookMyDoctor24'} required />
        <FormField label="Support email" name="supportEmail" type="email" defaultValue={systemSettings?.supportEmail || ''} />
        <FormField label="Support phone" name="supportPhone" defaultValue={systemSettings?.supportPhone || ''} />
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">Maintenance mode <input name="maintenanceMode" type="checkbox" defaultChecked={Boolean(systemSettings?.maintenanceMode)} /></label>
        <ErrorNote>{formError}</ErrorNote>
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save settings'}</Button>
        {saved && <p role="status" className="text-sm font-semibold text-success">Settings saved.</p>}
      </div>
    </form>
    <form onSubmit={saveRules} className="mt-6 max-w-2xl rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="mb-4 text-lg">Booking rules</h2>
      <div className="space-y-4">
        {/* Fallback must match the backend's real default (schema.prisma BookingRules.cancellationWindowHours
            @default(2), also the runtime fallback in appointments.service.js) — this was hard-coded to 24
            here (a plain copy/typo vs. the sibling fields below, which do match their schema defaults),
            found during the duplication/cross-stack drift audit (2026-09-05). */}
        <FormField label="Cancellation window (hours)" name="cancellationWindowHours" type="number" min="0" max="720" defaultValue={bookingRules?.cancellationWindowHours ?? 2} />
        <FormField label="Max bookings per patient" name="maxBookingsPerPatient" type="number" min="1" max="100" defaultValue={bookingRules?.maxBookingsPerPatient ?? 5} />
        <FormField label="Default slot length (minutes)" name="defaultSlotMinutes" type="number" min="5" max="120" defaultValue={bookingRules?.defaultSlotMinutes ?? 15} />
        <div className="border-t border-border pt-4">
          <p className="text-sm font-semibold text-ink">Online booking hours</p>
          <p className="mt-1 text-xs text-muted">Platform-wide — controls when PATIENTS can make an online booking. Walk-ins registered by staff at the clinic are never affected.</p>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={alwaysOpen} onChange={(event) => setAlwaysOpen(event.target.checked)} />
            Accept online bookings around the clock (full time)
          </label>
          {!alwaysOpen && <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <FormField label="Open from" name="onlineBookingWindowStart" type="time" defaultValue={bookingRules?.onlineBookingWindowStart || '09:00'} required={!alwaysOpen} />
            <FormField label="Open until" name="onlineBookingWindowEnd" type="time" defaultValue={bookingRules?.onlineBookingWindowEnd || '21:00'} required={!alwaysOpen} />
          </div>}
        </div>
        <div className="border-t border-border pt-4">
          <FormField label="Online booking allowed up to how many days ahead (optional)" name="onlineBookingMaxAdvanceDays" type="number" min="0" max="365" placeholder="No platform-wide limit" defaultValue={bookingRules?.onlineBookingMaxAdvanceDays ?? ''} />
          <p className="mt-1 text-xs text-muted">Platform-wide cap on ONLINE bookings only. Enter <strong>0</strong> to allow only today's date. Leave blank for no platform-wide limit (each doctor's own advance-booking setting still applies). Always the stricter of this and a doctor's own setting wins.</p>
        </div>
        <ErrorNote>{rulesError}</ErrorNote>
        <Button type="submit" disabled={rulesSubmitting}>{rulesSubmitting ? 'Saving…' : 'Save booking rules'}</Button>
        {rulesSaved && <p role="status" className="text-sm font-semibold text-success">Booking rules saved.</p>}
      </div>
    </form>
  </Page>
}
