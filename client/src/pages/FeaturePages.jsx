import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { FormField } from '../components/FormField'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { Select } from '../components/Select'
import { StatCard } from '../components/StatCard'
import { StatusPill } from '../components/StatusPill'
import { DoctorCard, SiteHeader } from './PublicPages'
import { doctorCharge, isOnlineBookingPayment } from '../lib/paymentVisibility'
import { useAppStore } from '../store/useAppStore'
import { formatDate, sequenceId } from '../lib/format'
import { buildCsv, downloadCsv } from '../lib/csv'

const Page = ({ title, subtitle, action, kicker, children }) => <section><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div>{kicker && <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">{kicker}</p>}<h1 className="text-2xl sm:text-3xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>{action}</div>{children}</section>
const Button = ({ children, className = '', ...props }) => <button className={`btn-primary ${className}`} {...props}>{children}</button>
const ToneButton = ({ children, tone = 'secondary', className = '', ...props }) => <button className={`touch-target rounded-button px-4 py-2.5 text-sm font-semibold ${tone === 'dark' ? 'bg-charcoal text-white hover:bg-ink' : 'border border-border bg-white text-ink hover:border-primary-dark'} ${className}`} {...props}>{children}</button>
const EMPTY_DRAFT = {}
// `role="alert"` red inline text matches the error-display idiom already used
// across AdminPages.jsx/PatientPages.jsx — reused here rather than inventing
// a new pattern for this file.
const ErrorNote = ({ children }) => children ? <p role="alert" className="mt-3 text-sm font-semibold text-error">{children}</p> : null

function ClinicProfile({ clinic, data }) {
  // `doctor.clinics` is now a real array of {id,name,city,area} (plan §8) —
  // no more flat `doctor.clinicId`/`clinicName`.
  const clinicDoctors = (data.doctors || []).filter((doctor) => (doctor.clinics || []).some((item) => item.id === clinic.id))
  return <><SiteHeader /><section className="bg-charcoal px-4 py-8 text-white sm:px-6"><div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-6"><div className="flex items-start gap-4"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-card bg-white text-primary-dark"><svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M9 22V12h6v10"></path><path d="M9 8h1"></path><path d="M14 8h1"></path><path d="M9 12h1"></path><path d="M14 12h1"></path></svg></div><div><p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-white/70"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg> {clinic.approvalStatus === 'disabled' ? 'Inactive clinic' : 'Active clinic'}</p><h1 className="mt-1 text-3xl text-white">{clinic.name}</h1><p className="mt-2 flex items-center gap-1.5 text-sm text-white/60"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg>{clinic.address || [clinic.area?.name, clinic.city?.name].filter(Boolean).join(', ')}</p>{clinic.phone && <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"></path></svg>{clinic.phone}</p>}</div></div><div className="text-left sm:text-right"><strong className="text-4xl font-sans text-white">{clinicDoctors.length}</strong><p className="mt-1 flex items-center gap-1.5 text-sm text-gold sm:justify-end"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2v2"></path><path d="M5 2v2"></path><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"></path><path d="M8 15a6 6 0 0 0 12 0v-3"></path><circle cx="20" cy="10" r="2"></circle></svg> Verified doctor(s)</p></div></div></section><main className="mx-auto max-w-6xl px-4 py-8 sm:px-6"><p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">Clinic team</p><h2 className="mt-1 text-2xl">Doctors at {clinic.name}</h2><p className="mt-1 text-sm text-muted">Select a doctor to review experience, fees, availability, and book this clinic.</p><div className="mt-6 grid gap-4 sm:grid-cols-2">{clinicDoctors.length ? clinicDoctors.map((doctor) => <div key={doctor.id}><DoctorCard doctor={doctor} /></div>) : <EmptyState title="No doctors listed" message="Doctors added to this clinic will appear here." />}</div></main></>
}

export function ClinicSearch({ data }) {
  const [params] = useSearchParams()
  const [filters, setFilters] = useState(() => ({ city: params.get('city') || '', area: params.get('area') || '', clinic: params.get('clinic') || '', emergency: false }))
  const [applied, setApplied] = useState(filters)
  // `clinic.city`/`clinic.area` are nested {id,name} objects now, not flat
  // strings (plan §8) — and areas are a flat top-level resource (§1.3), never
  // nested under a city.
  const clinics = (data.clinics || []).filter((clinic) => (!applied.city || clinic.city?.name === applied.city) && (!applied.area || clinic.area?.name === applied.area) && (!applied.clinic || clinic.name === applied.clinic) && (!applied.emergency || clinic.emergencyAvailable))
  const areaOptions = (data.areas || []).map((area) => area.name)
  if (applied.clinic && clinics.length === 1) return <ClinicProfile clinic={clinics[0]} data={data} />
  return <><SiteHeader /><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><h1 className="text-3xl">Find a clinic</h1><p className="mt-2 text-sm text-muted">Search trusted clinics and hospital branches in your city.</p><div className="mt-5 grid gap-4 lg:grid-cols-[280px_1fr]"><aside className="rounded-card border border-border bg-white p-4 shadow-card"><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); setApplied(filters) }}><FormField label="Clinic" type="select" options={(data.clinics || []).map((clinic) => clinic.name)} value={filters.clinic} onChange={(event) => setFilters({ ...filters, clinic: event.target.value })} /><FormField label="City" type="select" options={(data.cities || []).map((city) => city.name)} value={filters.city} onChange={(event) => setFilters({ ...filters, city: event.target.value })} /><FormField label="Area" type="select" options={areaOptions} value={filters.area} onChange={(event) => setFilters({ ...filters, area: event.target.value })} /><label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={filters.emergency} onChange={(event) => setFilters({ ...filters, emergency: event.target.checked })} /> Emergency services</label><Button type="submit" className="w-full">Apply filters</Button></form></aside><div><p className="mb-3 text-sm text-muted">{clinics.length} clinics found</p><div className="grid gap-4 sm:grid-cols-2">{clinics.map((clinic) => <article key={clinic.id} className="rounded-card border border-border bg-white p-5 shadow-card"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg">{clinic.name}</h2><p className="mt-1 text-sm text-muted">{clinic.area?.name}, {clinic.city?.name}</p></div><StatusPill status={clinic.approvalStatus} /></div><p className="mt-4 text-sm text-muted">{clinic.address}</p>{clinic.emergencyAvailable && <p className="mt-3 text-sm font-semibold text-error">Emergency services available</p>}{clinic.phone && <a href={`tel:${clinic.phone.replace(/\s/g, '')}`} className="mt-4 inline-flex text-sm font-semibold text-primary-dark">Call clinic</a>}</article>)}</div></div></div></main></>
}
const CONTACT_ROWS = [
  { label: 'Email', value: 'bookmydoctors@gmail.com', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path><rect x="2" y="4" width="20" height="16" rx="2"></rect></svg> },
  { label: 'Support hours', value: 'Monday–Saturday, 9 AM–8 PM', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6h4"></path></svg> },
  { label: 'Service region', value: 'India', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg> },
  { label: 'Urgent medical help', value: 'Contact local emergency services. This platform is not an emergency helpline.', icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"></path></svg> },
]
export function PublicContent({ kind }) {
  const content = { about: ['About BookADoctors', 'We help patients find care and track their clinic queue from anywhere.'], blog: ['BookADoctors Blog', 'Guides for healthier choices, clinic visits, and managing your care.'], contact: ['Contact BookADoctors', 'Get help with appointments, accounts, doctor onboarding, or clinic operations.'] }[kind]
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submitContactRequest = useAppStore((state) => state.submitContactRequest)
  const send = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    const form = event.currentTarget
    setSubmitting(true)
    setError('')
    try {
      await submitContactRequest({ name: values.name || 'Visitor', email: values.email || '', subject: values.subject || 'General enquiry', message: values.message || '' })
      setSent(true)
      form.reset()
    } catch (err) {
      setError(err.message || 'Could not send this message. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }
  if (kind === 'contact') return <><SiteHeader /><section className="bg-surface px-4 py-14 sm:px-6"><div className="mx-auto max-w-5xl"><p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">We are here to help</p><h1 className="mt-3 text-4xl sm:text-5xl">{content[0]}</h1><p className="mt-4 max-w-xl text-sm text-muted">{content[1]}</p></div></section><main className="mx-auto max-w-5xl px-4 pb-14 sm:px-6"><div className="grid gap-6 lg:grid-cols-[.8fr_1.2fr]"><article className="rounded-card bg-charcoal p-6 text-white"><h2 className="text-xl text-white">Support that listens</h2><p className="mt-2 text-sm text-white/70">Send your query and our team will route it to the right specialist.</p><div className="mt-6 divide-y divide-white/10 border-t border-white/10">{CONTACT_ROWS.map((row) => <div key={row.label} className="flex items-start gap-3 py-4"><span className="mt-0.5 text-white/70">{row.icon}</span><div><p className="font-semibold text-white">{row.label}</p><p className="mt-0.5 text-sm text-white/60">{row.value}</p></div></div>)}</div></article><form onSubmit={send} className="rounded-card border border-border bg-white p-6 shadow-card"><div className="grid gap-4 sm:grid-cols-2"><FormField label="Name" name="name" required /><FormField label="Email" name="email" type="email" required /></div><div className="mt-4"><FormField label="Subject" name="subject" type="select" options={['Appointment support', 'Doctor registration', 'Payment or billing', 'Technical issue', 'Other']} defaultValue="Appointment support" required /></div><div className="mt-4"><FormField label="How can we help?" name="message" type="textarea" required /></div><Button type="submit" className="mt-4 inline-flex items-center gap-2" disabled={submitting}><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"></path><path d="m21.854 2.147-10.94 10.939"></path></svg>{submitting ? 'Sending…' : 'Send message'}</Button><ErrorNote>{error}</ErrorNote>{sent && <p role="status" className="mt-3 text-sm font-semibold text-success">Message sent.</p>}</form></div></main></>
  return <><SiteHeader /><main className="mx-auto max-w-5xl px-4 py-12 sm:px-6"><article className="rounded-card border border-border bg-white p-6 shadow-card"><h1 className="text-3xl">{content[0]}</h1><p className="mt-4 leading-7 text-muted">{content[1]}</p>{kind === 'blog' && <div className="mt-6 space-y-3">{['How to prepare for a specialist visit', 'What live queues mean for patients', 'Choosing an emergency clinic'].map((title) => <article className="rounded-button bg-surface p-4" key={title}><h2 className="text-lg">{title}</h2><p className="mt-1 text-sm text-muted">A practical BookADoctors guide.</p></article>)}</div>}</article></main></>
}
export function PatientReviews({ data }) {
  // Real reviews require a completed appointment id (`POST /reviews` body:
  // {appointmentId, rating, text}) — there is no doctorId-only review path
  // any more (plan §1.14), so this now lists completed appointments rather
  // than the first 2 doctors in the directory.
  const [activeId, setActiveId] = useState(null)
  const [text, setText] = useState('')
  const [rating, setRating] = useState('5')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submittedIds, setSubmittedIds] = useState([])
  const addReview = useAppStore((state) => state.addReview)
  const completed = (data.appointments || []).filter((item) => item.status === 'completed')
  const save = async (event, appointment) => {
    event.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await addReview({ appointmentId: appointment.id, rating: Number(rating) || 5, text: text.trim() })
      setText('')
      setRating('5')
      setActiveId(null)
      setSubmittedIds((ids) => [...ids, appointment.id])
    } catch (err) {
      setError(err.message || 'Could not submit this review.')
    } finally {
      setSubmitting(false)
    }
  }
  return <Page title="My reviews" subtitle="Share feedback for a doctor you've consulted."><div className="space-y-4">{completed.map((appointment) => <article key={appointment.id} className="rounded-card border border-border bg-white p-5 shadow-card"><h2 className="text-lg">{appointment.doctor?.name || 'Doctor'}</h2><p className="text-sm text-muted">{appointment.doctor?.specialization?.name || ''}</p>{submittedIds.includes(appointment.id) ? <p role="status" className="mt-3 text-sm font-semibold text-success">Review submitted — pending moderation before it appears publicly.</p> : activeId === appointment.id ? <form onSubmit={(event) => save(event, appointment)} className="mt-4 space-y-3"><FormField label="Rating" type="select" options={['5', '4', '3', '2', '1']} value={rating} onChange={(event) => setRating(event.target.value)} required /><FormField label="Your feedback" value={text} onChange={(event) => setText(event.target.value)} type="textarea" required /><Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save review'}</Button><ErrorNote>{error}</ErrorNote></form> : <button type="button" onClick={() => setActiveId(appointment.id)} className="btn-primary mt-4">Write a review</button>}</article>)}{!completed.length && <EmptyState title="No completed visits yet" message="Reviews can be added once a booked consultation is marked completed." />}</div></Page>
}
export function DoctorReviews({ data }) {
  const currentUser = useAppStore((state) => state.currentUser)
  const fetchReviews = useAppStore((state) => state.fetchReviews)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    if (!currentUser?.id) { setLoading(false); return undefined }
    setLoading(true)
    setError('')
    fetchReviews({ doctorId: currentUser.id })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load reviews.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchReviews, currentUser?.id])
  // §1.14: doctor/patient/receptionist callers always see approved-only
  // reviews, forced server-side — this list can never include a doctor's
  // own pending/rejected reviews.
  const reviews = (data.reviews || []).filter((item) => item.doctor?.id === currentUser?.id)
  const average = reviews.length ? (reviews.reduce((sum, item) => sum + (Number(item.rating) || 0), 0) / reviews.length).toFixed(1) : '0.0'
  return <Page title="Patient reviews" subtitle="Feedback your patients have left after completed consultations.">
    <ErrorNote>{error}</ErrorNote>
    <div className="mb-5 flex items-center gap-3 rounded-card border border-border bg-white p-5 shadow-card"><strong className="text-2xl">★ {average}</strong><span className="text-sm text-muted">{reviews.length} review(s)</span></div>
    {loading ? <LoadingSkeleton /> : reviews.length ? <div className="space-y-3">{reviews.map((review) => <article key={review.id} className="rounded-card border border-border bg-white p-4 shadow-card"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{review.patient?.name || 'Verified patient'}</strong><span className="text-sm text-muted">{'★'.repeat(Math.max(0, Number(review.rating) || 0))}{'☆'.repeat(Math.max(0, 5 - (Number(review.rating) || 0)))} · {formatDate(review.createdAt)}</span></div><p className="mt-2 text-sm text-muted">{review.text}</p></article>)}</div> : <EmptyState title="No reviews yet" message="Reviews from your completed appointments will appear here." />}
  </Page>
}
export function PatientEmergencyBooking({ data }) { return <Page title="Emergency booking" subtitle="For life-threatening emergencies, contact local emergency services immediately."><div className="grid gap-4">{(data.clinics || []).filter((clinic) => clinic.emergencyAvailable).map((clinic) => <article className="rounded-card border border-error/30 bg-white p-5 shadow-card" key={clinic.id}><h2 className="text-xl">{clinic.name}</h2><p className="mt-1 text-sm text-muted">{clinic.address}</p><div className="mt-4 flex gap-3">{clinic.phone && <a className="btn-primary bg-error hover:bg-error" href={`tel:${clinic.phone.replace(/\s/g, '')}`}>Call now</a>}<Link className="btn-primary" to="/patient/book?emergency=1">Book urgent visit</Link></div></article>)}</div></Page> }
export function QuickClinicBooking({ data }) { const [phone, setPhone] = useState(''); const [clinic, setClinic] = useState(null); const [scanning, setScanning] = useState(false); const navigate = useNavigate(); const lookup = (event) => { event.preventDefault(); setClinic((data.clinics || []).find((item) => (item.phone || '').replace(/\D/g, '').includes(phone.replace(/\D/g, ''))) || null) }; return <Page title="Quick clinic booking" subtitle="Scan a clinic QR code or enter its registered phone number."><div className="grid gap-5 lg:grid-cols-2"><section className="rounded-card border border-border bg-white p-5 shadow-card"><p className="text-sm font-semibold text-teal-dark">Option 1</p><h2 className="mt-2 text-xl">Scan clinic QR</h2><div className="mt-4 grid h-48 place-items-center rounded-button border-2 border-dashed border-border bg-surface"><div className="text-center"><p className="text-4xl">▣</p><button type="button" onClick={() => setScanning(true)} className="btn-primary mt-3">{scanning ? 'Scanner ready' : 'Open QR scanner'}</button>{scanning && <p className="mt-2 text-xs text-muted">Camera access is unavailable in this local browser demo. Enter the clinic number instead.</p>}</div></div></section><section className="rounded-card border border-border bg-white p-5 shadow-card"><p className="text-sm font-semibold text-teal-dark">Option 2</p><h2 className="mt-2 text-xl">Clinic registered number</h2><form className="mt-5 space-y-4" onSubmit={lookup}><FormField label="Phone number" type="tel" placeholder="e.g. +91 22 4000 1111" value={phone} onChange={(event) => setPhone(event.target.value)} /><Button className="w-full">Find clinic</Button></form>{phone && !clinic && <p className="mt-4 text-sm text-muted">Enter a registered clinic number to continue.</p>}{clinic && <div className="mt-5 rounded-button bg-primary-light p-4"><h3 className="font-sans text-lg">{clinic.name}</h3><p className="mt-1 text-sm text-muted">{clinic.area?.name}, {clinic.city?.name}</p><div className="mt-4 flex flex-wrap gap-2">{(data.doctors || []).filter((doctor) => (doctor.clinics || []).some((item) => item.id === clinic.id)).map((doctor) => <button type="button" key={doctor.id} onClick={() => navigate(`/patient/book?doctorId=${doctor.id}`)} className="touch-target rounded-button border border-primary-dark px-3 text-sm font-semibold text-primary-dark">Book {doctor.name}</button>)}</div></div>}</section></div></Page> }
const clinicRecordsCsv = (rows) => buildCsv(['Id', 'Clinic', 'Doctor', 'Owner', 'Primary', 'Online booking', 'Public profile'], rows.map((row) => [row.displayId, row.clinicName, row.doctorLabel, row.owner, row.primary, row.onlineBooking, row.publicProfile]))
export function DoctorClinics({ data }) {
  // `currentUser` lives at the top level of the store, not inside `data`.
  const currentUser = useAppStore((state) => state.currentUser)
  const fetchClinics = useAppStore((state) => state.fetchClinics)
  const getClinic = useAppStore((state) => state.getClinic)
  const createClinic = useAppStore((state) => state.createClinic)
  const updateClinic = useAppStore((state) => state.updateClinic)
  const assignDoctorToClinic = useAppStore((state) => state.assignDoctorToClinic)
  const updateDoctorClinicAssignment = useAppStore((state) => state.updateDoctorClinicAssignment)
  const removeDoctorFromClinic = useAppStore((state) => state.removeDoctorFromClinic)

  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [savedClinic, setSavedClinic] = useState(false)
  const [clinicError, setClinicError] = useState('')
  const [savingClinic, setSavingClinic] = useState(false)
  const [savedAssign, setSavedAssign] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignClinicId, setAssignClinicId] = useState('')
  const [assignDoctorId, setAssignDoctorId] = useState('')
  const [busyDoctorKey, setBusyDoctorKey] = useState(null)
  const [rowError, setRowError] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', cityId: '', areaId: '', address: '' })

  // GET /clinics has no `doctors` field on list rows (only the single-clinic
  // detail endpoint does) — fetch full detail for each of "my" clinics so
  // the team table below has real assignment rows (plan §1.5).
  const load = () => {
    setLoading(true)
    setListError('')
    return fetchClinics({ mine: true })
      .then((rows) => Promise.all((rows || []).map((row) => getClinic(row.id).catch(() => {}))))
      .catch((err) => setListError(err.message || 'Could not load your clinics.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const clinics = data.clinics || []
  const clinic = clinics[0] || null
  useEffect(() => {
    if (clinic) setForm({ name: clinic.name || '', phone: clinic.phone || '', cityId: clinic.city?.id || '', areaId: clinic.area?.id || '', address: clinic.address || '' })
  }, [clinic?.id])
  const areaOptions = (data.areas || []).filter((area) => !form.cityId || area.cityId === form.cityId)

  const saveClinic = async (event) => {
    event.preventDefault()
    if (!form.name.trim() || !form.cityId) { setClinicError('Clinic name and city are required.'); return }
    setSavingClinic(true)
    setClinicError('')
    try {
      const fields = { name: form.name.trim(), phone: form.phone || undefined, cityId: form.cityId, areaId: form.areaId || undefined, address: form.address || undefined }
      if (clinic) {
        await updateClinic(clinic.id, fields)
      } else {
        const created = await createClinic(fields)
        // The doctor who creates a clinic must also be explicitly linked to
        // it via POST /clinics/:id/doctors — best-effort self-assign as
        // owner; if the backend doesn't allow this before any assignment
        // exists, this silently no-ops and the clinic can still be linked
        // later from the "Add a doctor" form below.
        if (currentUser?.id) await assignDoctorToClinic(created.id, { doctorUserId: currentUser.id, isOwner: true, isPrimary: true, onlineBooking: true }).catch(() => {})
      }
      await load()
      setSavedClinic(true)
    } catch (err) {
      setClinicError(err.message || 'Could not save this clinic.')
    } finally {
      setSavingClinic(false)
    }
  }

  const assignDoctor = async (event) => {
    event.preventDefault()
    if (!assignClinicId || !assignDoctorId) return
    setAssigning(true)
    setAssignError('')
    try {
      await assignDoctorToClinic(assignClinicId, { doctorUserId: assignDoctorId, isOwner: false, isPrimary: false, onlineBooking: true })
      setAssignClinicId('')
      setAssignDoctorId('')
      setSavedAssign(true)
      await load()
    } catch (err) {
      setAssignError(err.message || 'Could not add this doctor to the clinic.')
    } finally {
      setAssigning(false)
    }
  }

  const toggleOnlineBooking = async (clinicId, doctorUserId, nextValue) => {
    setBusyDoctorKey(`${clinicId}_${doctorUserId}_booking`)
    setRowError('')
    try {
      await updateDoctorClinicAssignment(clinicId, doctorUserId, { onlineBooking: nextValue })
      await load()
    } catch (err) {
      setRowError(err.message || 'Could not update online booking for this doctor.')
    } finally {
      setBusyDoctorKey(null)
    }
  }

  const removeAssignment = async (clinicId, doctorUserId) => {
    setBusyDoctorKey(`${clinicId}_${doctorUserId}_remove`)
    setRowError('')
    try {
      await removeDoctorFromClinic(clinicId, doctorUserId)
      await load()
    } catch (err) {
      setRowError(err.message || 'Could not remove this doctor from the clinic.')
    } finally {
      setBusyDoctorKey(null)
    }
  }

  const rows = clinics.flatMap((item, clinicIndex) => (item.doctors || []).map((member, memberIndex) => ({
    id: `${item.id}_${member.doctorUserId}`,
    displayId: `${clinicIndex + 1}-${memberIndex + 1}`,
    clinicName: item.name,
    doctorLabel: member.name,
    owner: member.isOwner ? 'yes' : 'no',
    primary: member.isPrimary ? 'yes' : 'no',
    onlineBooking: member.onlineBooking === false ? 'disabled' : 'enabled',
    publicProfile: `/clinics?clinic=${encodeURIComponent(item.name)}`,
    clinicId: item.id,
    doctorUserId: member.doctorUserId,
    bookingDisabled: member.onlineBooking === false,
  })))
  const exportCsv = () => downloadCsv('clinic-settings.csv', clinicRecordsCsv(rows))
  return <Page kicker="Production database" title="Clinic settings" subtitle="Manage clinic details and see every doctor practising at the clinic." action={<div className="flex flex-wrap items-center gap-2"><ToneButton type="button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</ToneButton><ToneButton type="button" tone="dark" onClick={exportCsv}>Export CSV</ToneButton></div>}>
    <ErrorNote>{listError}</ErrorNote>
    <form onSubmit={saveClinic} className="rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg">Clinic information</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormField label="Clinic name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        <FormField label="Clinic phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">City<span className="text-error"> *</span></span>
          <Select label="city" placeholder="Select city" required options={(data.cities || []).map((city) => ({ value: city.id, label: city.name }))} value={form.cityId} onChange={(event) => setForm({ ...form, cityId: event.target.value, areaId: '' })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Area</span>
          <Select label="area" placeholder="Select area" options={areaOptions.map((area) => ({ value: area.id, label: area.name }))} value={form.areaId} onChange={(event) => setForm({ ...form, areaId: event.target.value })} />
        </label>
        <div className="sm:col-span-2"><FormField label="Full address" type="textarea" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></div>
      </div>
      <Button type="submit" className="mt-4" disabled={savingClinic}>{savingClinic ? 'Saving…' : 'Save clinic'}</Button>
      <ErrorNote>{clinicError}</ErrorNote>
      {savedClinic && <p role="status" className="mt-3 text-sm font-semibold text-success">Clinic saved.</p>}
    </form>
    <div className="mt-5 rounded-card border border-border bg-white p-5 shadow-card">
      <h2 className="text-lg">Add a doctor to the clinic team</h2>
      <form onSubmit={assignDoctor} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Clinic<span className="text-error"> *</span></span>
          <Select placeholder="Select clinic" required options={clinics.map((item) => ({ value: item.id, label: item.name }))} value={assignClinicId} onChange={(event) => setAssignClinicId(event.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Verified doctor<span className="text-error"> *</span></span>
          <Select placeholder="Select doctor" required options={(data.doctors || []).map((member) => ({ value: member.id, label: `${member.name} (${member.specialization?.name || 'General Medicine'}, ${member.experienceYears || 0} years)` }))} value={assignDoctorId} onChange={(event) => setAssignDoctorId(event.target.value)} />
        </label>
        <Button type="submit" className="sm:col-span-2 sm:w-max" disabled={assigning}>{assigning ? 'Adding…' : 'Add doctor'}</Button>
      </form>
      <ErrorNote>{assignError}</ErrorNote>
      {savedAssign && <p role="status" className="mt-3 text-sm font-semibold text-success">Doctor added to the clinic team.</p>}
    </div>
    <div className="mt-5 rounded-card border border-border bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg">Live records</h2><span className="text-xs font-semibold uppercase tracking-widest text-muted">{rows.length} record(s)</span></div>
      <ErrorNote>{rowError}</ErrorNote>
      {loading ? <LoadingSkeleton /> : rows.length ? <DataTable rows={rows} columns={[
        { key: 'displayId', label: 'Id' },
        { key: 'clinicName', label: 'Clinic' },
        { key: 'doctorLabel', label: 'Doctor' },
        { key: 'owner', label: 'Owner' },
        { key: 'primary', label: 'Primary' },
        { key: 'onlineBooking', label: 'Online booking' },
        { key: 'publicProfile', label: 'Public profile' },
        { key: 'actionCol', label: 'Actions', render: (item) => <div className="flex gap-3"><button type="button" disabled={busyDoctorKey === `${item.clinicId}_${item.doctorUserId}_booking`} onClick={() => toggleOnlineBooking(item.clinicId, item.doctorUserId, item.bookingDisabled)} className="touch-target text-xs font-semibold text-primary-dark">{item.bookingDisabled ? 'Enable booking' : 'Disable booking'}</button><button type="button" disabled={busyDoctorKey === `${item.clinicId}_${item.doctorUserId}_remove`} onClick={() => removeAssignment(item.clinicId, item.doctorUserId)} className="touch-target text-xs font-semibold text-error">Remove</button></div> },
      ]} /> : <EmptyState title="No clinic team records yet" message="Save your clinic details and add doctors above to see them here." />}
    </div>
  </Page>
}
export function DoctorFees() {
  const currentUser = useAppStore((state) => state.currentUser)
  const updateDoctorProfile = useAppStore((state) => state.updateDoctorProfile)
  const profile = currentUser?.profile || {}
  const [form, setForm] = useState({ consultationFee: profile.consultationFee ?? '', emergencyFee: profile.emergencyFee ?? '' })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Fees live on the doctor's own /me profile, not a separate module (plan
  // §6.4) — this merges into the same `updateDoctorProfile` submit path used
  // elsewhere for doctor profile edits.
  const save = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSaved(false)
    try {
      await updateDoctorProfile({ consultationFee: Number(form.consultationFee) || 0, emergencyFee: Number(form.emergencyFee) || 0 })
      setSaved(true)
    } catch (err) {
      setError(err.message || 'Could not save your fee schedule.')
    } finally {
      setSubmitting(false)
    }
  }
  return <Page title="Fee management"><form onSubmit={save} className="max-w-xl rounded-card border border-border bg-white p-5 shadow-card"><div className="space-y-4"><FormField label="Consultation fee (₹)" type="number" min="0" step="0.01" value={form.consultationFee} onChange={(event) => setForm({ ...form, consultationFee: event.target.value })} required /><FormField label="Emergency consultation fee (₹)" type="number" min="0" step="0.01" value={form.emergencyFee} onChange={(event) => setForm({ ...form, emergencyFee: event.target.value })} /><Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save fee schedule'}</Button><ErrorNote>{error}</ErrorNote>{saved && <p role="status" className="text-sm font-semibold text-success">Fee schedule saved.</p>}</div></form></Page>
}
export function DoctorPaymentSetup() {
  const fetchClinics = useAppStore((state) => state.fetchClinics)
  const updateClinic = useAppStore((state) => state.updateClinic)
  const uploadClinicQr = useAppStore((state) => state.uploadClinicQr)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [clinic, setClinic] = useState(null)
  const [form, setForm] = useState({ cash: true, upi: true, upiId: '', qrUrl: '' })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploadingQr, setUploadingQr] = useState(false)
  const [qrError, setQrError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    fetchClinics({ mine: true })
      .then((rows) => {
        if (cancelled) return
        const first = (rows || [])[0] || null
        setClinic(first)
        if (first) setForm({ cash: first.paymentCashEnabled !== false, upi: first.paymentUpiEnabled !== false, upiId: first.paymentUpiId || '', qrUrl: first.paymentQrUrl || '' })
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load your clinic payment setup.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchClinics])

  // COMPLETENESS FIX (audit Priority 4): POST /media/qr is a real endpoint — see
  // useAppStore.js#uploadClinicQr's doc comment for why the old "paste a hosted URL, no upload
  // endpoint exists" placeholder below it was stale.
  const uploadQr = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !clinic) return
    setUploadingQr(true)
    setQrError('')
    try {
      const url = await uploadClinicQr(clinic.id, file)
      setForm((prev) => ({ ...prev, qrUrl: url }))
    } catch (err) {
      setQrError(err.message || 'Could not upload this QR code image.')
    } finally {
      setUploadingQr(false)
    }
  }

  // §6.2/§1.5: no dedicated payment-setup endpoint — this maps onto the
  // general clinic PATCH (updatePaymentSetup was dropped per the store's
  // action list; repointed to updateClinic here).
  const save = async (event) => {
    event.preventDefault()
    if (!clinic) { setError('No clinic found for your account yet — add a clinic first.'); return }
    setSubmitting(true)
    setError('')
    setSaved(false)
    try {
      await updateClinic(clinic.id, { paymentCashEnabled: form.cash, paymentUpiEnabled: form.upi, paymentUpiId: form.upiId || undefined, paymentQrUrl: form.qrUrl || undefined })
      setSaved(true)
    } catch (err) {
      setError(err.message || 'Could not save payment setup.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Page title="Payment setup" subtitle="Choose how patients can pay at your clinic."><LoadingSkeleton /></Page>

  return <Page title="Payment setup" subtitle="Choose how patients can pay at your clinic.">
    <ErrorNote>{loadError}</ErrorNote>
    <form onSubmit={save} className="max-w-2xl rounded-card border border-border bg-white p-5 shadow-card"><div className="space-y-4"><label className="flex min-h-11 items-center justify-between rounded-button bg-surface px-3 text-sm font-medium">Accept cash payments<input type="checkbox" checked={form.cash} onChange={(event) => setForm({ ...form, cash: event.target.checked })} /></label><label className="flex min-h-11 items-center justify-between rounded-button bg-surface px-3 text-sm font-medium">Accept UPI payments<input type="checkbox" checked={form.upi} onChange={(event) => setForm({ ...form, upi: event.target.checked })} /></label><FormField label="UPI ID" value={form.upiId} onChange={(event) => setForm({ ...form, upiId: event.target.value })} placeholder="clinic@upi" />
      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink">UPI QR code image</span>
        <div className="flex flex-wrap items-center gap-3">
          {form.qrUrl && <img src={form.qrUrl} alt="Clinic payment QR code" className="h-20 w-20 rounded-button border border-border object-contain" />}
          <label className="touch-target inline-flex cursor-pointer items-center justify-center rounded-button border border-border bg-white px-4 text-sm font-semibold text-ink hover:border-primary-dark">
            {uploadingQr ? 'Uploading…' : form.qrUrl ? 'Replace QR code' : 'Upload QR code'}
            <input type="file" accept="image/*" className="hidden" disabled={uploadingQr || !clinic} onChange={uploadQr} />
          </label>
        </div>
        <ErrorNote>{qrError}</ErrorNote>
      </div>
      <p className="text-xs leading-5 text-muted">Payment preferences are saved to your clinic record.</p><Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save payment setup'}</Button><ErrorNote>{error}</ErrorNote>{saved && <p role="status" className="text-sm font-semibold text-success">Payment setup saved.</p>}</div></form>
  </Page>
}
export function DoctorEmr({ data }) {
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const addRecord = useAppStore((state) => state.addRecord)
  // §6.7 — no /patients endpoint exists; derive a best-effort distinct
  // patient list from appointments already bulk-loaded for the doctor role.
  const patientMap = new Map()
  for (const appointment of data.appointments || []) {
    if (appointment.patient?.id) patientMap.set(appointment.patient.id, appointment.patient)
  }
  const patients = Array.from(patientMap.values())
  const save = async (event) => {
    event.preventDefault()
    // Captured before the `await` below — a DOM event's `currentTarget` goes back to null once
    // the event finishes dispatching, which for an async handler is well before
    // `await addRecord(...)` resolves. Reading `event.currentTarget` after that was throwing
    // "Cannot read properties of null (reading 'reset')" on every successful save (the save
    // itself worked; only the post-save form reset crashed and showed a scary error).
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form).entries())
    if (!values.diagnosis?.trim() || !selectedPatientId) { setError('Select a patient and enter a diagnosis before saving.'); return }
    setSubmitting(true)
    setError('')
    try {
      // Real endpoint field is `title`, not `name` — and `notes`/`carePlan`
      // are now actually persisted (plan §1.11).
      await addRecord({ patientUserId: selectedPatientId, title: values.diagnosis.trim(), type: 'Consultation note', notes: values.notes || undefined, carePlan: values.carePlan || undefined })
      setSaved(true)
      form.reset()
    } catch (err) {
      setError(err.message || 'Could not save this consultation record.')
    } finally {
      setSubmitting(false)
    }
  }
  return <Page title="Consultation & EMR" subtitle="Capture clinical notes securely for each visit.">
    <p className="mb-4 rounded-button border border-dashed border-border bg-surface px-3 py-2.5 text-sm text-muted">This patient list is built from appointments already loaded — the API has no dedicated patient directory (plan §6.7).</p>
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <DataTable rows={patients} columns={[{ key: 'name', label: 'Patient', render: (item) => <button type="button" onClick={() => setSelectedPatientId(item.id)} className={`text-left text-sm font-semibold ${selectedPatientId === item.id ? 'text-primary-dark' : 'text-ink'}`}>{item.name}</button> }]} />
      <form onSubmit={save} className="rounded-card border border-border bg-white p-5 shadow-card"><div className="space-y-4"><FormField label="Consultation notes" name="notes" type="textarea" placeholder="History, examination and assessment" /><FormField label="Diagnosis" name="diagnosis" required /><FormField label="Care plan" name="carePlan" type="textarea" /><Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save consultation'}</Button><ErrorNote>{error}</ErrorNote>{saved && <p role="status" className="text-sm font-semibold text-success">Consultation saved.</p>}</div></form>
    </div>
  </Page>
}
// DoctorFollowUps removed (completeness audit Priority 1 #5) — it only ever local-drafted a
// "scheduled" status with zero backend effect and zero user feedback. The route at
// /doctor/follow-ups now redirects to the real Appointments page instead (see App.jsx).
export function DoctorStaff() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', clinicId: '' })
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [clinics, setClinics] = useState([])
  const [receptionists, setReceptionists] = useState([])
  const createReceptionistAccount = useAppStore((state) => state.createReceptionistAccount)
  const fetchClinics = useAppStore((state) => state.fetchClinics)
  const fetchReceptionists = useAppStore((state) => state.fetchReceptionists)

  const load = () => {
    setLoading(true)
    setListError('')
    return fetchClinics({ mine: true })
      .then((rows) => {
        setClinics(rows || [])
        const firstClinicId = rows?.[0]?.id || ''
        setForm((current) => ({ ...current, clinicId: current.clinicId || firstClinicId }))
        return fetchReceptionists(firstClinicId ? { clinicId: firstClinicId } : {})
      })
      .then((rows) => setReceptionists(rows || []))
      .catch((err) => setListError(err.message || 'Could not load clinic staff.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // Convergence note (plan §1.7): both legacy call sites (here and
  // AdminPages' ManageReceptionists) now hit the same real endpoint, which
  // requires clinicId + email + password.
  const save = async (event) => {
    event.preventDefault()
    if (!form.name.trim() || !form.email.trim() || !form.password.trim() || !form.clinicId) {
      setFormError('Name, email, password, and clinic are required.')
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      const created = await createReceptionistAccount({ name: form.name.trim(), email: form.email.trim(), password: form.password, phone: form.phone || undefined, clinicId: form.clinicId })
      setReceptionists((rows) => [...rows, created])
      setForm({ name: '', email: '', phone: '', password: '', clinicId: form.clinicId })
      setSaved(true)
    } catch (err) {
      setFormError(err.message || 'Could not create this receptionist account.')
    } finally {
      setSubmitting(false)
    }
  }
  return <Page title="Receptionist accounts" subtitle="Create clinic team logins and assignments.">
    <form onSubmit={save} className="mb-5 grid max-w-2xl gap-4 rounded-card border border-border bg-white p-5 shadow-card sm:grid-cols-2">
      <h2 className="text-lg sm:col-span-2">Create receptionist login</h2>
      <FormField label="Full name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      <FormField label="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
      <FormField label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
      <FormField label="Temporary password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
      <label className="block sm:col-span-2">
        <span className="mb-1.5 block text-sm font-medium text-ink">Clinic<span className="text-error"> *</span></span>
        <Select placeholder="Select clinic" required options={clinics.map((item) => ({ value: item.id, label: item.name }))} value={form.clinicId} onChange={(event) => setForm({ ...form, clinicId: event.target.value })} />
      </label>
      <div className="sm:col-span-2"><ErrorNote>{formError}</ErrorNote></div>
      <Button type="submit" className="sm:col-span-2" disabled={submitting}>{submitting ? 'Saving…' : 'Create account'}</Button>
      {saved && <p role="status" className="text-sm font-semibold text-success sm:col-span-2">Receptionist account created.</p>}
    </form>
    <DataTable loading={loading} error={listError} onRetry={load} rows={receptionists} columns={[{ key: 'id', label: 'ID', render: (item, index) => sequenceId(index) }, { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> }, { key: 'since', label: 'Since', render: (item) => item.since ? formatDate(item.since) : '—' }]} />
  </Page>
}
export function SimpleInbox({ data, title = 'Notifications' }) {
  const fetchNotifications = useAppStore((state) => state.fetchNotifications)
  const markAll = useAppStore((state) => state.markAllNotificationsRead)
  const markOne = useAppStore((state) => state.markNotificationRead)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [markingId, setMarkingId] = useState(null)

  const load = () => {
    setLoading(true)
    setError('')
    return fetchNotifications().catch((err) => setError(err.message || 'Could not load notifications.')).finally(() => setLoading(false))
  }

  // loadUserData() only fetches notifications once, right after login — this page never re-fetched
  // on its own, so anything raised AFTER login (a new booking, a payment, a queue-token call, a
  // doctor verification — see notifications.service.js#notifySystemEvent's callers) stayed
  // invisible here until the next full login/page reload. Fetch fresh on mount, then poll every
  // 30s (matching the backend's own MY_LIST_CACHE_TTL_SECONDS, so this never asks more often than
  // the cache can actually answer with anything new) while this page stays open — real-time enough
  // for a patient sitting on this screen waiting for their token to be called, without a websocket.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchNotifications()
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load notifications.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    const interval = setInterval(() => { fetchNotifications().catch(() => {}) }, 30000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [fetchNotifications])

  const handleMarkAll = async () => {
    setMarkingAll(true)
    setError('')
    try {
      await markAll()
    } catch (err) {
      setError(err.message || 'Could not mark notifications as read.')
    } finally {
      setMarkingAll(false)
    }
  }
  // `id` here MUST be the NotificationRecipient row's own id (already on
  // rows from fetchNotifications), not `notificationId` (plan §1.15).
  const handleMarkOne = async (id) => {
    setMarkingId(id)
    setError('')
    try {
      await markOne(id)
    } catch (err) {
      setError(err.message || 'Could not mark this notification as read.')
    } finally {
      setMarkingId(null)
    }
  }
  return <Page title={title} subtitle="New bookings, queue activity, reviews, and system updates." action={<div className="flex flex-wrap items-center gap-2"><ToneButton type="button" disabled={loading} onClick={load}>{loading ? 'Refreshing…' : '↻ Refresh'}</ToneButton><Button onClick={handleMarkAll} disabled={markingAll}>{markingAll ? 'Marking…' : 'Mark all as read'}</Button></div>}>
    <ErrorNote>{error}</ErrorNote>
    {loading && !(data.notifications || []).length ? <LoadingSkeleton /> : <div className="space-y-3">{(data.notifications || []).map((item) => <button type="button" disabled={markingId === item.id} onClick={() => handleMarkOne(item.id)} className={`block w-full rounded-card border border-border bg-white p-4 text-left shadow-card ${!item.readAt ? 'border-l-4 border-l-primary' : ''}`} key={item.id}><div className="flex items-start justify-between gap-3"><div><h2 className="text-base">{item.title}</h2><p className="mt-1 text-sm text-muted">{item.body}</p></div><span className="text-xs text-muted">{formatDate(item.createdAt)}</span></div></button>)}{!(data.notifications || []).length && <EmptyState title="No notifications yet" message="Updates and alerts will appear here." />}</div>}
  </Page>
}
export function ReceptionAvailability({ data }) { return <Page title="Doctor availability"><DataTable rows={data.doctors || []} columns={[
  { key: 'name', label: 'Doctor' },
  { key: 'clinics', label: 'Clinic', render: (item) => (item.clinics || []).map((c) => c.name).join(', ') || '—' },
  { key: 'specialization', label: 'Specialization', render: (item) => item.specialization?.name || '—' },
  { key: 'onlineBooking', label: 'Online booking', render: (item) => <StatusPill status={item.onlineBooking ? 'active' : 'closed'} /> },
]} /></Page> }
export function ReceptionEmergency({ data }) {
  // The queue row shape has no `isEmergency` field of its own (plan §1.9) —
  // cross-reference the linked appointment (also bulk-loaded for the
  // receptionist role) to find the true emergency tokens.
  const emergencyAppointmentIds = new Set((data.appointments || []).filter((appointment) => appointment.isEmergency).map((appointment) => appointment.id))
  const tokens = (data.queueTokens || []).filter((token) => token.status !== 'completed' && emergencyAppointmentIds.has(token.appointmentId))
  return <Page title="Emergency queue" subtitle="Urgent walk-ins are prioritised and visible to the assigned doctor."><DataTable rows={tokens} columns={[
    { key: 'tokenNumber', label: 'Emergency token', render: (item) => `#${item.tokenNumber}` },
    { key: 'patient', label: 'Patient', render: (item) => item.patient?.name || '—' },
    { key: 'patientsAhead', label: 'Ahead in queue' },
    { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> },
  ]} /></Page>
}
export function ReceptionReports({ data }) {
  // `payment.fees`/`appointment.fees` are the role-masked nested objects now
  // (plan §1.8/§1.12) — `doctorCharge` (lib/paymentVisibility.js) still
  // reads flat `consultationFee`-style keys, so pass the `.fees` sub-objects
  // through rather than the raw records.
  const clinicPayments = (data.payments || []).map((payment) => {
    const appointment = (data.appointments || []).find((item) => item.id === payment.appointment?.id)
    return { ...payment, appointment, doctorCharge: doctorCharge(payment.fees, appointment?.fees) }
  })
  // COMPLETENESS ADD (request: "receptionist and doctor ke pass show ho online payment kitna hua
  // cash ye proper way me", then "eshme ye show hona chahiye ki online booking ke time pe kitna
  // payment hua hai and second clinic pe aake cash ya online ye v to confirm hona chahiye") — this
  // stat row only ever showed "Cash collected". Now a three-way split matching CashPayment's own
  // (StaffPages.jsx): paid online at booking (Razorpay, before the patient ever arrives) is money
  // this clinic never had to collect at all, so it's kept out of "collected at clinic" — only cash
  // and in-person online/upi/card taken at the counter count as that.
  const bookingCollected = clinicPayments.filter(isOnlineBookingPayment).reduce((sum, item) => sum + Number(item.doctorCharge || 0), 0)
  const cashCollected = clinicPayments.filter((item) => String(item.mode || '').toLowerCase() === 'cash' && !isOnlineBookingPayment(item)).reduce((sum, item) => sum + Number(item.doctorCharge || 0), 0)
  const onlineCollected = clinicPayments.filter((item) => String(item.mode || '').toLowerCase() !== 'cash' && !isOnlineBookingPayment(item)).reduce((sum, item) => sum + Number(item.doctorCharge || 0), 0)
  // `checkedIns` has no dedicated endpoint — derive from
  // `appointment.checkedInAt` per plan §5.
  const checkedInCount = (data.appointments || []).filter((item) => item.checkedInAt).length
  return <Page title="Reception reports" subtitle="Export clinic appointment and flow records.">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><StatCard label="Walk-ins" value={(data.queueTokens || []).length} icon="+" /><StatCard label="Check-ins" value={checkedInCount} icon="✓" /><StatCard label="Paid online at booking" value={`₹${bookingCollected}`} icon="🌐" /><StatCard label="Cash collected" value={`₹${cashCollected}`} icon="₹" /><StatCard label="Online collected at clinic" value={`₹${onlineCollected}`} icon="📶" /></div>
    <div className="mt-5"><DataTable rows={clinicPayments} columns={[{ key: 'createdAt', label: 'Date', render: (item) => formatDate(item.createdAt) }, { key: 'receiptNumber', label: 'Receipt' }, { key: 'mode', label: 'Mode' }, { key: 'doctorCharge', label: 'Doctor charge', render: (item) => `₹${item.doctorCharge}` }]} /></div>
  </Page>
}
export function AdminForm({ title, subtitle, fields = [], rows, columns }) { const [saved, setSaved] = useState(false); const drafts = useAppStore((state) => state.drafts); const saveDraft = useAppStore((state) => state.saveDraft); const draft = drafts[title] || EMPTY_DRAFT; const save = (event) => { event.preventDefault(); saveDraft(title, Object.fromEntries(new FormData(event.currentTarget).entries())); setSaved(true) }; return <Page title={title} subtitle={subtitle}>{rows ? <DataTable rows={rows} columns={columns} /> : <form onSubmit={save} className="max-w-2xl rounded-card border border-border bg-white p-5 shadow-card"><div className="space-y-4">{fields.map((field) => { const name = field.name || field.label; return <FormField key={field.label} {...field} name={name} defaultValue={draft[name] || field.defaultValue} /> })}<Button type="submit">Save changes</Button>{saved && <p role="status" className="text-sm font-semibold text-success">Changes saved in this browser.</p>}</div></form>}</Page> }
const superAdminLinks = [
  ['People & clinics', '/super-admin/entities', 'Create and control doctors, patients, receptionists, and clinics.', '👥'],
  ['Payments & revenue', '/super-admin/revenue', 'Review every saved payment and the platform total.', '₹'],
  ['Cities & service areas', '/super-admin/cities', 'Add supported cities, areas, and pincodes.', '⌖'],
  ['Clinic tenants', '/super-admin/tenants', 'Enable or disable clinics and emergency service.', '🏥'],
  ['Security & activity', '/super-admin/security', 'Review browser-saved audit activity.', '◌'],
  ['Content & broadcasts', '/super-admin/cms', 'Send announcements visible to platform users.', '📢'],
  ['System settings', '/super-admin/settings', 'Update platform identity and maintenance mode.', '⚙'],
]

export function SuperAdminDashboard({ data }) {
  const fetchDashboardStats = useAppStore((state) => state.fetchDashboardStats)
  const fetchReceptionists = useAppStore((state) => state.fetchReceptionists)
  const fetchActivityLog = useAppStore((state) => state.fetchActivityLog)
  const [error, setError] = useState('')
  const [receptionistCount, setReceptionistCount] = useState((data.receptionists || []).length)

  // Dashboard stats/activity/receptionists aren't part of the admin bulk
  // load (plan §4.2 admin branch) — fetch them here, belt-and-suspenders
  // with the bulk load, same pattern as AdminPages' AdminDashboard.
  useEffect(() => {
    let cancelled = false
    fetchDashboardStats().catch((err) => { if (!cancelled) setError(err.message || 'Could not load platform stats.') })
    fetchReceptionists({}).then((rows) => { if (!cancelled) setReceptionistCount((rows || []).length) }).catch(() => {})
    fetchActivityLog({}).catch(() => {})
    return () => { cancelled = true }
  }, [fetchDashboardStats, fetchReceptionists, fetchActivityLog])

  const stats = data.dashboardStats
  // `data.patients` has no real backend equivalent (plan §6.7) — use the
  // authoritative server-computed count instead.
  const users = (stats?.registeredPatientsCount || 0) + (data.doctors || []).length + receptionistCount
  // No admin bypass exists to list pending doctors (plan §6.1); pending
  // clinics can only be derived from clinics already known locally.
  const pendingClinics = (data.clinics || []).filter((clinic) => clinic.approvalStatus === 'pending').length
  return <Page title="Super Admin control center" subtitle="One clear place to manage the complete BookADoctors platform.">
    <ErrorNote>{error}</ErrorNote>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Link to="/super-admin/entities"><StatCard label="Doctors & clinics" value={`${stats?.verifiedDoctorsCount ?? (data.doctors || []).length} / ${(data.clinics || []).length}`} detail="Doctors / clinics" icon="🏥" /></Link>
      <Link to="/super-admin/entities"><StatCard label="Platform users" value={users} detail="Patients, doctors, staff" icon="♧" /></Link>
      <Link to="/super-admin/revenue"><StatCard label="Monthly revenue" value={`₹${Number(stats?.monthlyRevenue || 0).toLocaleString('en-IN')}`} detail="From platform-recorded payments" icon="₹" /></Link>
    </div>
    {pendingClinics > 0 && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-gold/40 bg-gold/10 p-4"><div><p className="font-semibold text-charcoal">{pendingClinics} clinic approval{pendingClinics === 1 ? '' : 's'} waiting for review</p><p className="mt-1 text-sm text-charcoal/70">Review clinic submissions before making them available.</p></div><Link to="/super-admin/entities" className="touch-target inline-flex items-center rounded-button bg-primary-dark px-4 py-2.5 text-sm font-semibold text-white">Review approvals</Link></div>}
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{superAdminLinks.map(([label, path, description, icon]) => <Link key={path} to={path} className="rounded-card border border-border bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-primary"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-button bg-primary-light text-lg">{icon}</span><div><h2 className="text-lg">{label}</h2><p className="mt-1 text-sm leading-5 text-muted">{description}</p></div></div></Link>)}</div>
    <div className="mt-6 rounded-card border border-border bg-white p-5 shadow-card"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg">Recent activity</h2><p className="mt-1 text-sm text-muted">Latest platform actions.</p></div><Link to="/super-admin/security" className="text-sm font-semibold text-primary-dark">View all</Link></div>{(data.activity || []).length ? <div className="mt-4 space-y-2">{(data.activity || []).slice(0, 5).map((item) => <div className="flex flex-wrap items-center justify-between gap-2 rounded-button bg-surface px-3 py-2.5 text-sm" key={item.id}><span>{item.description || item.actionType}</span><span className="text-xs text-muted">{formatDate(item.createdAt)}</span></div>)}</div> : <EmptyState title="No activity yet" message="Actions taken in this panel will appear here." />}</div>
    <div className="mt-6 rounded-card border border-border bg-white p-5 shadow-card"><h2 className="text-lg">Role workspaces</h2><p className="mt-1 text-sm text-muted">Super Admin can inspect every role workspace without leaving this login.</p><div className="mt-4 flex flex-wrap gap-2">{[['Admin operations', '/admin/dashboard'], ['Doctor workspace', '/doctor/dashboard'], ['Reception desk', '/receptionist/dashboard'], ['Patient view', '/patient/dashboard']].map(([label, path]) => <Link key={path} to={path} className="touch-target inline-flex items-center rounded-button border border-border bg-white px-3.5 py-2 text-sm font-semibold text-ink hover:border-primary">{label}</Link>)}</div></div>
  </Page>
}

export function SuperAdminEntities({ data }) {
  const fetchDashboardStats = useAppStore((state) => state.fetchDashboardStats)
  const fetchReceptionists = useAppStore((state) => state.fetchReceptionists)
  const [receptionistCount, setReceptionistCount] = useState((data.receptionists || []).length)
  useEffect(() => {
    let cancelled = false
    fetchDashboardStats().catch(() => {})
    fetchReceptionists({}).then((rows) => { if (!cancelled) setReceptionistCount((rows || []).length) }).catch(() => {})
    return () => { cancelled = true }
  }, [fetchDashboardStats, fetchReceptionists])
  const stats = data.dashboardStats
  const pendingClinicsCount = (data.clinics || []).filter((clinic) => clinic.approvalStatus === 'pending').length
  const cards = [
    ['Doctors', '/super-admin/doctors', stats?.verifiedDoctorsCount ?? (data.doctors || []).length, 'Create accounts, verify profiles, and enable or disable access.'],
    ['Patients', '/super-admin/patients', stats?.registeredPatientsCount ?? '—', 'Review registered patients and account status.'],
    ['Clinics', '/super-admin/clinics', (data.clinics || []).length, 'Control clinic availability and emergency services.'],
    ['Receptionists', '/super-admin/receptionists', receptionistCount, 'Manage front-desk staff linked to clinics.'],
  ]
  return <Page title="People & clinics" subtitle="Choose what you want to manage.">
    <div className="grid gap-4 sm:grid-cols-2">{cards.map(([label, path, count, description]) => <Link key={path} to={path} className="rounded-card border border-border bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-primary"><div className="flex items-center justify-between gap-3"><h2 className="text-xl">{label}</h2><span className="grid h-10 min-w-10 place-items-center rounded-full bg-primary-light px-2 font-sans text-lg font-bold text-primary-dark">{count}</span></div><p className="mt-3 text-sm leading-6 text-muted">{description}</p><span className="mt-4 inline-flex text-sm font-semibold text-primary-dark">Open {label.toLowerCase()} →</span></Link>)}</div>
    <div className="mt-6 rounded-card border border-border bg-white p-5 shadow-card"><h2 className="text-lg">Pending approvals</h2><p className="mt-1 text-sm text-muted">New clinic requests stay separate until approved.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-button bg-surface p-4"><p className="text-sm text-muted">Doctors waiting</p><p className="mt-1 text-sm text-muted">Not available in this version of the API</p></div><div className="rounded-button bg-surface p-4"><p className="text-sm text-muted">Clinics waiting</p><p className="mt-1 font-sans text-2xl">{pendingClinicsCount}</p></div></div></div>
  </Page>
}
