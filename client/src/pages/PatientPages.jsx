import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { FormField } from '../components/FormField'
import { LiveQueueWidget } from '../components/LiveQueueWidget'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { StatCard } from '../components/StatCard'
import { StatusPill } from '../components/StatusPill'
import { PaymentSourceBadge } from '../components/PaymentSourceBadge'
import { useAppStore } from '../store/useAppStore'
import { formatDate, sequenceId, shortId } from '../lib/format'
import { useDeleteWithConfirm } from '../hooks/useDeleteWithConfirm'
import { useIsMobile } from '../hooks/useIsMobile'
import { buildCsv, downloadCsv } from '../lib/csv'
import { buildBookingSlipPdfBlob, buildPatientReceiptPdfBlob } from '../lib/receiptPdf'
import { usePdfPreview } from '../hooks/usePdfPreview'
import { useRazorpayPayment } from '../hooks/useRazorpayPayment'
import { PdfPreviewModal } from '../components/PdfPreviewModal'
import { loadRazorpayScript } from '../lib/loadRazorpayScript'

const Page = ({ title, subtitle, children, action, kicker }) => <section><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div>{kicker && <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">{kicker}</p>}<h1 className="text-2xl sm:text-3xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>{action}</div>{children}</section>
const Button = ({ children, className = '', ...props }) => <button className={`touch-target rounded-button bg-primary-dark px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal disabled:cursor-not-allowed disabled:opacity-60 ${className}`} {...props}>{children}</button>

export function PatientDashboard({ data }) {
  const currentUser = useAppStore((state) => state.currentUser) || { name: 'Patient', city: '' }
  const fetchMyQueueStatus = useAppStore((state) => state.fetchMyQueueStatus)
  const userAppointments = data.appointments || []
  const upcomingAppointments = userAppointments.filter((item) => ['upcoming', 'confirmed'].includes(item.status))
  const upcoming = upcomingAppointments[0]
  const pendingPaymentCount = userAppointments.filter((appointment) => appointment.paymentStatus === 'pending').length
  const [queueStatus, setQueueStatus] = useState(null)
  const [queueStatusError, setQueueStatusError] = useState('')

  // `data.queueTokens` (GET /queue) is doctor/receptionist-only and never populated for a patient
  // — this dashboard's "Patients ahead" figure and Live queue widget used to read from it anyway,
  // so both silently showed nothing for every patient regardless of their real queue position.
  // fetchMyQueueStatus (GET /queue/mine/:appointmentId) is the patient-scoped fix; polled every
  // 15s while the dashboard is open, same as the dedicated /patient/queue tracker page.
  useEffect(() => {
    if (!upcoming) return undefined
    let cancelled = false
    const load = () => {
      fetchMyQueueStatus(upcoming.id)
        .then((result) => { if (!cancelled) { setQueueStatus(result); setQueueStatusError('') } })
        .catch((err) => { if (!cancelled) setQueueStatusError(err.message || 'Could not load live queue status.') })
    }
    load()
    const interval = setInterval(load, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [upcoming, fetchMyQueueStatus])

  return (
    <Page
      kicker="Production database"
      title={`Welcome, ${(currentUser.name || 'Patient').split(' ')[0]}.`}
      subtitle="Your authenticated workspace is connected to live records."
      action={
        <Link className="touch-target inline-flex items-center justify-center rounded-button bg-primary-dark px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal" to="/patient/book">
          Book appointment
        </Link>
      }
    >
      {/* Metric Cards Grid */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/patient/booking-history" className="block"><StatCard label="TOTAL APPOINTMENTS" value={userAppointments.length} icon="#" /></Link>
        <Link to="/patient/appointments" className="block"><StatCard label="UPCOMING" value={upcomingAppointments.length} icon="◷" /></Link>
        <Link to="/patient/payments" className="block"><StatCard label="PENDING PAYMENTS" value={pendingPaymentCount} icon="₹" /></Link>
      </div>

      <section className="mt-6 rounded-card border border-border bg-white p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg">Recent live records</h2><span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">Connected</span></div>
        <DataTable rows={userAppointments.slice(0, 5)} columns={[{ key: 'date', label: 'Time / ID', render: (item) => `${item.appointmentDate || 'Today'} ${item.appointmentTime || ''}` }, { key: 'doctor', label: 'Doctor', render: (item) => item.doctor?.name || '—' }, { key: 'clinic', label: 'Details', render: (item) => item.clinic?.name || '—' }, { key: 'status', label: 'Status', render: (item) => <StatusPill status={item.status} /> }]} />
      </section>

      {/* Active Appointment & Live Queue Widget */}
      {upcoming ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_380px]">
          <article className="rounded-card border border-border bg-white p-6 shadow-card flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-dark/10 px-3 py-1 text-xs font-semibold text-teal-dark">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" /> Live Next Visit
                </span>
                <StatusPill status={upcoming.status || 'upcoming'} />
              </div>

              <h2 className="mt-4 text-2xl font-bold font-sans text-ink">{upcoming.doctor?.name || '—'}</h2>
              <p className="mt-1 text-sm text-muted">{upcoming.clinic?.name || '—'} · {upcoming.appointmentDate}, {upcoming.appointmentTime}</p>

              <div className="mt-5 grid grid-cols-2 gap-3 text-xs sm:text-sm">
                <div className="rounded-button border border-border bg-surface p-3">
                  <span className="text-muted block text-xs">Token number</span>
                  <strong className="text-xl font-sans text-primary-dark">#{upcoming.tokenNumber ?? '—'}</strong>
                </div>
                <div className="rounded-button border border-border bg-surface p-3">
                  <span className="text-muted block text-xs">Patients ahead</span>
                  <strong className="text-xl font-sans text-ink">{queueStatus?.patientsAhead ?? '—'} patients</strong>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Link to="/patient/appointments" className="text-sm font-semibold text-primary-dark hover:underline">
                View appointment details & QR →
              </Link>
              <div className="flex gap-2">
                <a href="tel:+912240001111" className="touch-target inline-flex items-center rounded-button border border-border bg-white px-3 text-xs font-semibold text-ink hover:bg-surface">
                  📞 Call clinic
                </a>
                <Link to="/patient/appointments" className="touch-target inline-flex items-center rounded-button bg-primary-dark px-3 text-xs font-semibold text-white hover:bg-charcoal">
                  Arrive at clinic
                </Link>
              </div>
            </div>
          </article>

          <LiveQueueWidget
            appointmentId={upcoming.id}
            initialQueue={queueStatus ? { appointmentId: upcoming.id, token: queueStatus.token, nowServing: queueStatus.nowServing, patientsAhead: queueStatus.patientsAhead, estimatedWait: queueStatus.estimatedWaitMinutes, doctorStatus: queueStatus.status } : null}
            error={queueStatusError}
            onRetry={() => fetchMyQueueStatus(upcoming.id).then(setQueueStatus).catch((err) => setQueueStatusError(err.message))}
          />
        </div>
      ) : (
        <div className="mt-6 rounded-card border border-border bg-white p-8 text-center shadow-card">
          <p className="text-4xl">🏥</p>
          <h2 className="mt-3 text-xl font-bold font-sans">No upcoming appointments scheduled</h2>
          <p className="mt-1 text-sm text-muted">Book a visit with verified doctors in Mumbai, follow your live queue token, and skip waiting room delays.</p>
          <Link to="/search" className="btn-primary mt-5">Find a doctor near you</Link>
        </div>
      )}

      {/* Recent Notifications */}
      <div className="mt-8">
        <section className="rounded-card border border-border bg-white p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold font-sans text-ink">Queue & Care Alerts</h2>
            <Link to="/patient/notifications" className="text-xs font-semibold text-primary-dark hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {(data.notifications || []).slice(0, 2).map((item) => (
              <article key={item.id} className={`rounded-button border border-border p-3.5 ${!item.readAt ? 'bg-primary-light/40 border-l-4 border-l-primary' : 'bg-surface'}`}>
                <div className="flex justify-between gap-2">
                  <h3 className="font-bold text-xs text-ink">{item.title}</h3>
                  <span className="text-[11px] text-muted whitespace-nowrap">{formatDate(item.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-muted leading-relaxed">{item.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </Page>
  )
}

// yyyy-mm-dd in the browser's own local time (not UTC — `toISOString()` would drift a day near
// midnight for users east of UTC, which is most of this app's audience).
const todayStr = () => {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function Booking({ data }) {
  const [params] = useSearchParams()
  const [booked, setBooked] = useState(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const createAppointment = useAppStore((state) => state.createAppointment)
  const bookingQueueInfo = useAppStore((state) => state.bookingQueueInfo)
  const createRazorpayOrder = useAppStore((state) => state.createRazorpayOrder)
  const verifyRazorpayPayment = useAppStore((state) => state.verifyRazorpayPayment)
  const getAppointment = useAppStore((state) => state.getAppointment)
  const currentUser = useAppStore((state) => state.currentUser) || {}
  const [payingNow, setPayingNow] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const platformCharges = data.platformCharges
  const [doctorId, setDoctorId] = useState(params.get('doctorId') || params.get('doctor') || '')
  const doctor = (data.doctors || []).find((item) => item.id === doctorId)
  // Clinic is never chosen by the patient — it's always the doctor's primary (first) clinic,
  // derived automatically the moment a doctor is picked (matches the mobile app's behaviour).
  const primaryClinic = doctor?.clinics?.[0] || null
  // Defaults to today, as requested — there is no Slot time field any more (see below): the
  // patient only picks a date, and appointments.service.js#runBookingJob auto-assigns the
  // doctor's next free slot on that date server-side. What the patient actually cares about is
  // their queue/token number, not a clock time.
  const [date, setDate] = useState(params.get('date') || todayStr())
  // Controlled (was an uncontrolled defaultChecked input) so the price preview below can react to
  // it live — platform charge and emergency fee are mutually exclusive (see
  // appointments.service.js#runBookingJob), so the preview needs to know the current checked
  // state, not just what it started as.
  const [isEmergency, setIsEmergency] = useState(params.get('emergency') === '1')
  // NEW (patient request — "public page pe jaise filter hai waisa yaha bhi do"): the Doctor
  // dropdown used to be one flat alphabetical list of every doctor. This mirrors the public
  // search page's own filter panel (SearchResults, above) field-for-field — same keys, same
  // predicate, same draft-vs-applied pattern — so a patient can narrow it down by city, area,
  // specialization, clinic, fee, experience, rating, and the three checkboxes before picking.
  const emptyDoctorFilters = { name: '', city: '', area: '', specialization: '', clinic: '', fee: '', maxFee: '', experience: '', rating: '', today: false, activeClinic: false, emergency: false, sort: '' }
  const [doctorFilters, setDoctorFilters] = useState(emptyDoctorFilters)
  const [appliedDoctorFilters, setAppliedDoctorFilters] = useState(emptyDoctorFilters)
  const updateDoctorFilter = (key) => (event) => setDoctorFilters((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))
  const doctorAreaOptions = useMemo(() => {
    const selectedCity = (data.cities || []).find((item) => item.name === doctorFilters.city)
    const scoped = selectedCity ? (data.areas || []).filter((area) => area.cityId === selectedCity.id) : (data.areas || [])
    return scoped.map((area) => area.name)
  }, [(data.cities || []), (data.areas || []), doctorFilters.city])
  const filteredDoctors = useMemo(() => {
    const result = (data.doctors || []).filter((item) => {
      const specializationName = item.specialization?.name || ''
      const itemClinics = item.clinics || []
      const fee = Number(item.consultationFee) || 0
      const maxFee = Number(appliedDoctorFilters.maxFee)
      return (!appliedDoctorFilters.name || `${item.name} ${specializationName}`.toLowerCase().includes(appliedDoctorFilters.name.trim().toLowerCase())) && (!appliedDoctorFilters.city || item.city === appliedDoctorFilters.city || itemClinics.some((clinic) => clinic.city === appliedDoctorFilters.city)) && (!appliedDoctorFilters.area || itemClinics.some((clinic) => clinic.area === appliedDoctorFilters.area)) && (!appliedDoctorFilters.specialization || specializationName === appliedDoctorFilters.specialization) && (!appliedDoctorFilters.clinic || itemClinics.some((clinic) => clinic.name === appliedDoctorFilters.clinic)) && (!appliedDoctorFilters.emergency || item.emergencyAvailable) && (!appliedDoctorFilters.activeClinic || itemClinics.length > 0) && (!appliedDoctorFilters.today || item.onlineBooking !== false) && (!appliedDoctorFilters.experience || (item.experienceYears || 0) >= Number(appliedDoctorFilters.experience)) && (!appliedDoctorFilters.rating || (item.rating || 0) >= Number(appliedDoctorFilters.rating)) && (!appliedDoctorFilters.maxFee || fee <= maxFee) && (!appliedDoctorFilters.fee || (appliedDoctorFilters.fee === 'Under ₹600' ? fee < 600 : appliedDoctorFilters.fee === '₹600–₹900' ? fee >= 600 && fee <= 900 : fee > 900))
    })
    return [...result].sort((left, right) => appliedDoctorFilters.sort === 'rating' ? (right.rating || 0) - (left.rating || 0) : appliedDoctorFilters.sort === 'fee' ? (Number(left.consultationFee) || 0) - (Number(right.consultationFee) || 0) : appliedDoctorFilters.sort === 'experience' ? (right.experienceYears || 0) - (left.experienceYears || 0) : 0)
  }, [data, appliedDoctorFilters])
  const clearDoctorFilters = () => { setDoctorFilters(emptyDoctorFilters); setAppliedDoctorFilters(emptyDoctorFilters) }
  const submit = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    const familyMember = values.patient && values.patient !== 'Myself'
      ? (data.familyMembers || []).find((item) => `${item.name} · ${item.relation}` === values.patient)
      : null
    setError('')
    setConfirming(true)
    try {
      const appointment = await createAppointment({
        doctorUserId: values.doctor,
        clinicId: primaryClinic?.id,
        appointmentDate: values.date,
        reason: values.reason || '',
        isEmergency,
        familyMemberId: familyMember?.id,
      })
      setBooked(appointment)
    } catch (bookingError) {
      setError(bookingError.message)
    } finally {
      setConfirming(false)
    }
  }
  // Warm up Razorpay's Checkout script in the background as soon as a patient reaches this
  // "payment required" screen, so it's already loaded by the time they actually click "Pay now"
  // — without blocking the homepage or any other page the way the old global <script> tag in
  // index.html used to (see razorpay-script-loading-fix-plan.md). Best-effort: any failure here
  // is silently ignored and payNow below will retry and surface a real error if it still fails.
  useEffect(() => {
    if (booked?.status === 'pending_payment') {
      loadRazorpayScript().catch(() => {})
    }
  }, [booked?.status])
  // Opens Razorpay's Checkout widget (loaded on demand via loadRazorpayScript, above) against an
  // order created server-side, then hands whatever Checkout returns to the backend for HMAC
  // signature verification — see razorpay.service.js#verifyAndRecordPayment. Online payment is
  // now MANDATORY for an online booking with a non-zero fee: the appointment is created as
  // `pending_payment` (no token yet) and only flips to a confirmed, token-bearing booking once
  // this succeeds — see appointments.service.js#runBookingJob and
  // payments.service.js#createPaymentForAppointment. `paymentOption` is 'full' (pay the whole
  // consultation amount) or 'minimum' (pay just the doctor's configured minimum booking amount,
  // rest collected at the clinic).
  const payNow = async (paymentOption = 'full') => {
    setPaymentError('')
    setPayingNow(true)
    try {
      await loadRazorpayScript().catch(() => {
        throw new Error('Payment gateway failed to load. Check your internet connection and try again.')
      })
      const order = await createRazorpayOrder(booked.id, paymentOption)
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'BookMyDoctor24',
        description: `Consultation with ${doctor?.name || booked.doctor?.name || 'doctor'}${paymentOption === 'minimum' ? ' · Booking amount' : ''}`,
        prefill: { name: currentUser.name || '', email: currentUser.email || '', contact: currentUser.phone || '' },
        theme: { color: '#ad5d3b' },
        modal: { ondismiss: () => setPayingNow(false) },
        handler: async (response) => {
          try {
            // Backend returns the authoritative, freshly re-fetched appointment (status may have
            // just flipped pending_payment -> upcoming, with a newly-minted token number) — trust
            // that instead of guessing the new shape ourselves.
            const { appointment } = await verifyRazorpayPayment({
              appointmentId: booked.id,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            })
            setBooked(appointment)
          } catch (verifyError) {
            // RESUME/RECONCILE FIX (senior-dev payment audit, "payment sahi nahi hua hai"): this
            // handler only ever fires after Razorpay has already captured the payment — a failure
            // in THIS call (request timeout, dropped connection, a transient server error after the
            // backend's own transaction actually committed) does not mean the money wasn't taken.
            // Re-check the appointment's real status before showing a scary "payment failed"
            // message: if it already moved off pending_payment, the payment WAS recorded despite
            // this call failing, and telling the patient to pay again here would risk a double
            // charge.
            try {
              const fresh = await getAppointment(booked.id)
              if (fresh && fresh.status !== 'pending_payment') {
                setBooked(fresh)
                return
              }
            } catch {
              /* couldn't even re-check — fall through to showing the original error below */
            }
            setPaymentError(verifyError.message)
          } finally {
            setPayingNow(false)
          }
        },
      })
      checkout.on('payment.failed', (failure) => {
        setPaymentError(failure?.error?.description || 'Payment failed. Please try again.')
        setPayingNow(false)
      })
      checkout.open()
    } catch (orderError) {
      setPaymentError(orderError.message)
      setPayingNow(false)
    }
  }
  if (booked) {
    const pendingPayment = booked.status === 'pending_payment'
    const totalAmount = Number(booked.fees?.totalAmount) || 0
    // MIN-BOOKING-AMOUNT FIX (superadmin request): this used to be the doctor's raw
    // minBookingAdvanceAmount, which left the platform's own cut out of the "pay minimum now"
    // option entirely. booked.fees.minBookingAmount is now computed server-side as the doctor's
    // minimum fee + this booking's platform charge + GST on just that minimum fee — see
    // appointments.service.js#shapeFees / utils/minBookingAmount.js — and Razorpay is charged
    // that exact same figure (razorpay.service.js#createOrder), so what's shown here always
    // matches what's actually charged.
    const minAmount = Number(booked.fees?.minBookingAmount) || 0
    // MIN-BOOKING-REMAINDER FIX (superadmin request: "309 kyu bach raha hai 300 bachna chahiye")
    // — this used to be computed here as totalAmount - minAmount, which double-subtracted the
    // platform charge/GST that are already fully settled by the online minimum payment. The
    // clinic only ever collects the doctor's own remaining consultation-fee share; see
    // appointments.service.js#shapeFees / utils/minBookingAmount.js#computeMinBookingRemainder.
    const minRemainder = Number(booked.fees?.minBookingRemainder) || 0
    if (pendingPayment) {
      // No token yet — an online booking with a fee must be paid before one is issued (see
      // appointments.service.js#runBookingJob). Offer the two payment choices: full amount, or
      // just the doctor's configured minimum booking amount (only shown when the doctor has set
      // one) with the remainder collected at the clinic.
      return <Page title="Payment required" subtitle="Pay online to confirm your booking and get your token number.">
        <div className="max-w-xl rounded-card border border-primary-dark/30 bg-white p-6 shadow-card">
          <p className="text-4xl text-primary-dark">₹</p>
          <h2 className="mt-3 text-2xl">Payment required to confirm</h2>
          <p className="mt-2 text-sm text-muted">{doctor?.name || '—'} · {booked.appointmentDate}</p>
          <p className="mt-2 text-sm text-muted">Your token number will be issued as soon as payment is received.</p>
          <div className="mt-5 space-y-3">
            <div className="rounded-button bg-surface p-4">
              <div className="flex items-center justify-between"><span className="text-sm font-medium">Full consultation amount</span><strong className="text-lg">₹{totalAmount}</strong></div>
              <Button className="mt-3 w-full" onClick={() => payNow('full')} disabled={payingNow}>{payingNow ? 'Opening payment…' : `Pay ₹${totalAmount} now`}</Button>
            </div>
            {minAmount > 0 && <div className="rounded-button bg-surface p-4">
              <div className="flex items-center justify-between"><span className="text-sm font-medium">Minimum booking amount</span><strong className="text-lg">₹{minAmount}</strong></div>
              <p className="mt-1 text-xs text-muted">Remaining ₹{minRemainder} to be paid at the clinic.</p>
              <Button className="mt-3 w-full" onClick={() => payNow('minimum')} disabled={payingNow}>{payingNow ? 'Opening payment…' : `Pay ₹${minAmount} now`}</Button>
            </div>}
          </div>
          {paymentError && <p role="alert" className="mt-3 text-sm text-error">{paymentError}</p>}
        </div>
      </Page>
    }
    return <Page title="Appointment booked" subtitle="Your booking has been confirmed."><div className="max-w-xl rounded-card border border-success/30 bg-white p-6 shadow-card"><p className="text-4xl text-success">✓</p><h2 className="mt-3 text-2xl">Booking confirmed</h2><p className="mt-2 text-sm text-muted">{booked.doctor?.name || doctor?.name || '—'} · {booked.appointmentDate}</p><p className="mt-4 text-3xl font-bold text-primary-dark">Token #{booked.tokenNumber ?? '—'}</p><p className="mt-1 text-sm text-muted">You'll be seen in this order after check-in — track live queue status under My Appointments.</p><div className="mt-5 rounded-button bg-surface p-4"><div className="flex items-center justify-between"><span className="text-sm font-medium">Consultation amount</span><strong className="text-lg">₹{totalAmount}</strong></div>{booked.paymentStatus === 'paid' ? <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-success">✓ Paid online</p> : booked.paymentStatus === 'partial' ? <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-success">✓ Booking amount paid online — balance due at the clinic</p> : <p className="mt-3 text-xs text-muted">No online payment was required for this booking.</p>}</div><Link className="btn-primary mt-6 inline-flex" to="/patient/appointments">View my appointments</Link></div></Page>
  }
  const previewConsultation = Number(doctor?.consultationFee) || 0
  // MUTUAL-EXCLUSIVITY FIX (superadmin request): the platform charge and the emergency charge
  // never stack on a real booking (see appointments.service.js#runBookingJob) — this preview
  // shows 0 platform charge the moment "Emergency booking" is checked, since the emergency fee
  // (shown next to that checkbox) applies instead.
  const previewConvenience = isEmergency || platformCharges?.applyConvenienceFee === false ? 0 : Number(platformCharges?.patientConvenienceFee) || 0
  return <Page title="Book an appointment" subtitle="Choose a verified doctor; the clinic, visit time, and queue token are assigned automatically.">
    <div className="max-w-2xl rounded-card border border-border bg-white p-5 shadow-card mb-5">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-sans text-lg">Filters</h2><button type="button" className="text-sm font-semibold text-primary-dark" onClick={clearDoctorFilters}>Clear</button></div>
      {/* TRIMMED (superadmin request — "filter me city aur specialization hi rakho, emergency"):
          this booking-page doctor-finder only needs enough to narrow the Doctor dropdown down to
          a short list, not the full public search page's whole filter set — City, Specialization,
          and the 24/7 emergency checkbox stay; Doctor-or-symptom/Area/Clinic/Fee range/Maximum
          fee/Experience/Rating/Sort by/Today booking/Active clinic are gone. The underlying
          doctorFilters/appliedDoctorFilters state and _filteredDoctors predicate (above) still
          support every one of those keys unchanged, so a future request to bring one back is just
          re-adding its FormField/checkbox here, not touching the filtering logic. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="City" type="select" options={(data.cities || []).map((item) => item.name)} value={doctorFilters.city} onChange={updateDoctorFilter('city')} />
        <FormField label="Specialization" type="select" options={(data.specializations || []).map((item) => item.name)} value={doctorFilters.specialization} onChange={updateDoctorFilter('specialization')} />
      </div>
      <div className="mt-4 flex flex-wrap gap-4">
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={doctorFilters.emergency} onChange={updateDoctorFilter('emergency')} /> 24/7 emergency</label>
      </div>
      <button type="button" className="btn-primary mt-4" onClick={() => setAppliedDoctorFilters({ ...doctorFilters })}>Apply filters</button>
      <p className="mt-3 text-sm text-muted">{filteredDoctors.length} doctor{filteredDoctors.length === 1 ? '' : 's'} match — pick one below.</p>
    </div>
    <form onSubmit={submit} className="max-w-2xl rounded-card border border-border bg-white p-5 shadow-card"><div className="grid gap-4 sm:grid-cols-2"><FormField label="Doctor" name="doctorLabel" type="select" options={filteredDoctors.map((item) => item.name)} value={doctor ? doctor.name : ''} onChange={(event) => { const selected = (data.doctors || []).find((item) => item.name === event.target.value); setDoctorId(selected?.id || '') }} required /><input type="hidden" name="doctor" value={doctorId} /><label className="block"><span className="mb-1.5 block text-sm font-medium text-ink">Clinic</span><div className="flex min-h-11 items-center rounded-button border border-border bg-surface px-3 text-sm text-muted">{primaryClinic ? primaryClinic.name : 'Select a doctor first'}</div></label><FormField label="Patient" name="patient" type="select" options={['Myself', ...(data.familyMembers || []).map((item) => `${item.name} · ${item.relation}`)]} required /><FormField label="Appointment date" name="date" type="date" required value={date} min={todayStr()} onChange={(event) => setDate(event.target.value)} /><div className="sm:col-span-2"><FormField label="Reason for visit" name="reason" type="textarea" placeholder="Symptoms or follow-up details" /></div><label className="flex min-h-11 items-center justify-between gap-3 rounded-button bg-surface px-3 text-sm font-medium sm:col-span-2">Emergency booking<input name="isEmergency" type="checkbox" checked={isEmergency} onChange={(event) => setIsEmergency(event.target.checked)} />{platformCharges?.applyEmergencyFee !== false && <span className="ml-auto text-xs text-muted">+₹{Number(platformCharges?.emergencyFee) || 0}</span>}</label></div>{doctor && <div className="mt-4 rounded-button bg-primary-light p-3 text-sm"><div className="flex justify-between"><span>Consultation</span><strong>₹{previewConsultation}</strong></div><div className="mt-1 flex justify-between"><span>Platform charge</span><strong>₹{previewConvenience}</strong></div><div className="mt-1 flex justify-between"><span>Transaction charge</span><strong>{Number(platformCharges?.gstPercent) || 0}%</strong></div></div>}{error && <p role="alert" className="mt-4 text-sm text-error">{error}</p>}{confirming && <div className="mt-4" role="status" aria-live="polite"><p className="text-sm font-semibold text-primary-dark">{bookingQueueInfo && bookingQueueInfo.aheadOfYou > 0 ? `${bookingQueueInfo.aheadOfYou} ${bookingQueueInfo.aheadOfYou === 1 ? 'person' : 'people'} ahead of you — assigning your token…` : 'Confirming your booking…'}</p><LoadingSkeleton rows={1} /></div>}<Button type="submit" className="mt-5" disabled={confirming}>{confirming ? 'Confirming…' : 'Confirm booking'}</Button>{!(data.doctors || []).length && <p className="mt-4 text-sm text-muted">No verified doctors are available yet. Add a doctor profile from the admin workspace first.</p>}</form></Page>
}
export function PatientAppointments({ data, history = false }) {
  const isMobile = useIsMobile()
  const [reviewAppointment, setReviewAppointment] = useState('')
  const [rating, setRating] = useState('')
  const [reviewText, setReviewText] = useState('')
  const [saved, setSaved] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const addReview = useAppStore((state) => state.addReview)
  const fetchAppointments = useAppStore((state) => state.fetchAppointments)
  const fetchPayments = useAppStore((state) => state.fetchPayments)
  const cancelAppointment = useAppStore((state) => state.cancelAppointment)
  const currentUser = useAppStore((state) => state.currentUser) || {}
  // PENDING-PAYMENT RESUME FIX (multi-agent senior-dev payment audit, "payment sahi nahi hua
  // hai"): a `pending_payment` appointment used to have NO way back to a Pay button once the
  // patient left the one-shot post-booking screen — see hooks/useRazorpayPayment.js's header
  // comment for the full failure scenario. This list now offers "Resume payment"/"Cancel" for
  // any pending_payment row it renders.
  const { payNow, payingId, paymentError, setPaymentError } = useRazorpayPayment()
  const [cancelError, setCancelError] = useState('')
  const { deletingId: cancellingId, remove: cancelPendingBooking } = useDeleteWithConfirm({
    deleteFn: (appointment) => cancelAppointment(appointment.id),
    confirmMessage: () => 'Cancel this booking? This cannot be undone — you\'ll need to book again if you change your mind.',
    errorFallback: 'Could not cancel this booking.',
    setError: setCancelError,
  })
  const resumePayment = (appointment, paymentOption) => {
    setCancelError('')
    payNow(appointment, paymentOption, { currentUser })
  }
  const owned = data.appointments || []
  const completed = owned.filter((item) => item.status === 'completed')
  const selectedReviewId = reviewAppointment || completed[0]?.id || ''
  const hasPendingPayment = owned.some((item) => item.status === 'pending_payment')
  useEffect(() => {
    if (hasPendingPayment) loadRazorpayScript().catch(() => {})
  }, [hasPendingPayment])
  const records = owned.map((appointment) => {
    // PAID/DUE FIX (multi-agent payment audit): an appointment can have TWO payment rows — an
    // online advance (doctor's minimum booking amount) plus the remainder collected later at the
    // clinic (see payments.service.js#createPaymentForAppointment's 'partial' handling). Every
    // Payment row is always status:'paid' the instant it exists (it records one transaction that
    // succeeded, not "is the appointment fully settled" — see that file's own header comment), so
    // picking `payment?.status` first made a partial (advance-only) booking show "Paid in full,
    // Due ₹0" here, on the exported CSV, and on the downloadable booking-slip PDF, the moment ANY
    // payment row existed. `appointment.paymentStatus` ('pending'/'partial'/'paid') is the real
    // source of truth for whether the appointment itself is settled, so it's checked first now;
    // `payment?.status` only backfills older/unusual rows that never set paymentStatus at all.
    // `paid` is now the sum of every payment row actually recorded for this appointment (there can
    // be up to two), not an all-or-nothing fee/0 toggle — so a partial payment shows its real
    // paid/due split instead of a false Due ₹0.
    const appointmentPayments = (data.payments || []).filter((item) => item.appointment?.id === appointment.id)
    const payment = appointmentPayments[0]
    const fee = Number(appointment.fees?.totalAmount ?? payment?.fees?.amount ?? appointment.fees?.consultationFee ?? 0)
    const status = appointment.paymentStatus || payment?.status || 'pending'
    // PAID-AMOUNT ACCURACY FIX (user request: "eshme 437 kyu aa raha hai jabki maine to 428 hi
    // payment kiya hai jisme 128 online booking ke time hai 300 clinic pe receptionist se") —
    // once fully settled ('paid'), this used to always show Paid = the FULL online total
    // (fees.totalAmount/`fee`), even when the patient actually paid LESS overall by choosing the
    // minimum-booking path: the doctor's minimum online + the remainder at the clinic, with the
    // platform convenience/GST charge collected exactly once (see utils/minBookingAmount.js's
    // worked example — that path totals 128 + 300 = 428, genuinely less than paying 437.75 in one
    // shot online, never more). Sum what was ACTUALLY collected across every payment row instead
    // — the same real-money figure receptionist/doctor/admin payment tables already show per row
    // (payments.service.js#shapePaymentFees's exact-split fix) — falling back to the full fee
    // only when no payment rows have loaded at all yet, so a still-fetching page never flashes a
    // false "Paid ₹0" for an appointment the server already says is 'paid'.
    const paidFromRecords = appointmentPayments.reduce((sum, item) => sum + (Number(item.fees?.amount ?? item.amount) || 0), 0)
    const paid = appointmentPayments.length ? paidFromRecords : (status === 'paid' ? fee : paidFromRecords)
    // MIN-BOOKING-REMAINDER FIX ("309 kyu bach raha hai 300 bachna chahiye" — same bug, second
    // spot): this list re-derived "Due" as fee(totalAmount) - paid, which still counted the
    // platform's convenience/emergency charge and its GST as owed even though that's fully
    // collected online the moment the doctor's minimum advance is paid. For a 'partial' booking,
    // what's actually left for the clinic to collect is the doctor's own remaining consultation-fee
    // share — server-computed as fees.minBookingRemainder (appointments.service.js#shapeFees /
    // utils/minBookingAmount.js#computeMinBookingRemainder) — so use that instead whenever it's
    // available, and keep the old fee-paid fallback only for appointments where the doctor's
    // minimum booking amount was never configured (computeMinBookingRemainder returns null then).
    const minRemainder = appointment.fees?.minBookingRemainder != null ? Number(appointment.fees.minBookingRemainder) : null
    // DUE-AFTER-SETTLEMENT FIX (user request: "due 9 rupya kyu o to zero hoga" — a direct
    // follow-up to the PAID-AMOUNT ACCURACY FIX above): fixing `paid` to the real, lesser
    // minimum-path total (428) broke this line for a fully 'paid' booking — `fee` here is still
    // the FULL online total (437.75), so `fee - paid` came out to ₹9.75 owed on a booking that is
    // completely settled. Once status is 'paid', nothing is owed, full stop — same rule
    // appointments.service.js#shapeFees already applies for the doctor/receptionist `due` figure
    // (`row.paymentStatus === 'paid' -> due = 0`) — so that case is checked first, before ever
    // falling back to a fee/paid subtraction that only makes sense while still mid-payment.
    const due = status === 'paid' ? 0 : status === 'partial' && minRemainder != null ? minRemainder : Math.max(0, fee - paid)
    // ONE-FEE-COLUMN FIX (user request, in two rounds: "full fee ko minimum ke anusar kro and
    // complete fee ke anusar v calculate karke show kro", then "ye dono hata kar ek kro jis
    // tarah se payment ho ushka amount show ho agar minimum ke sath booking kar raha hai to
    // minimum wala agar full pay kar raha hai to full wala", then "slip v sahi kro eshi taarat")
    // — `fee` above is the COMPLETE-payment total (fees.totalAmount). `feeMinimumPath` is what
    // the total comes to on the MINIMUM-booking path instead: the doctor's minBookingAmount
    // (already includes the platform convenience/emergency charge + GST, collected once) plus
    // whatever's left of the consultation fee (minBookingRemainder), collected later at the
    // clinic — both raw figures already sent to patients by appointments.service.js#shapeFees,
    // so this is a pure display computation, no backend change needed. null whenever the doctor
    // never configured a minimum booking option for this appointment, so an absent option is
    // never treated as if it equalled the full fee. `displayFee` is the single figure actually
    // shown — on the table, its CSV export, AND the booking slip (buildBookingSlipPdfBlob) — and
    // follows how the booking is actually being paid: the minimum-booking-path total while it
    // sits at 'partial' (the doctor's minimum was paid online, the rest still due at the clinic
    // — same signal `due` above already keys off), the full online-payment total for a
    // 'pending'/'pending_payment' one where nothing's been decided yet, and — continuing the
    // PAID-AMOUNT ACCURACY FIX above — the appointment's ACTUAL `paid` total once fully settled,
    // instead of unconditionally falling back to the full online total. `paid` already equals the
    // true minimum-path total (428) when settled that way, and the full total (437.75) when
    // settled by a single online payment, so this single field now covers both without needing to
    // separately re-detect which path was taken.
    const minBookingAmount = appointment.fees?.minBookingAmount != null ? Number(appointment.fees.minBookingAmount) : null
    const feeMinimumPath = minBookingAmount != null && minRemainder != null ? minBookingAmount + minRemainder : null
    const displayFee = status === 'partial' && feeMinimumPath != null ? feeMinimumPath : status === 'paid' ? paid : fee
    return { appointment, payment, fee, displayFee, paid, due, status, mode: payment?.mode || appointment.paymentMethod || 'pay_at_clinic' }
  })
  const paymentReference = (payment) => payment?.transactionRef || '—'
  const displayDate = formatDate
  // Proper PDF booking slip (see lib/receiptPdf.js) — previously a plain .txt Blob, missing the
  // clinic address/doctor specialization a real slip should carry.
  //
  // VIEW-THEN-DOWNLOAD (request: "booking slip ke jagah view ka option do view open hone ke bad
  // download ka option ho", applied everywhere per "baki jagah v same kar do jaha slip download
  // ho raha hai") — clicking the row action no longer saves a file straight away; it builds the
  // PDF and opens it in an in-page preview (see hooks/usePdfPreview.js + components/PdfPreviewModal.jsx,
  // shared with Payments below and StaffPages.jsx's CashPayment), and the actual save-to-disk
  // action lives inside that preview.
  const slip = usePdfPreview()
  // ONE-FEE-COLUMN FIX ("slip v sahi kro eshi taarat" — same treatment as the table's single
  // Fee column): pass `displayFee` (payment-path-aware — the minimum-booking-path total while
  // 'partial', otherwise the full online-payment total), not the always-full `fee`, so the
  // slip's "Total amount" row reconciles with Paid + Due exactly like the table does.
  const viewSlip = ({ appointment, displayFee, paid, due }) =>
    slip.open(() => buildBookingSlipPdfBlob({ appointment, fee: displayFee, paid, due, patientName: appointment.patient?.name || appointment.familyMember?.name || currentUser.name || '—' }))
  // COLUMN-CLARITY FIX (user request: "feec column ka matlab clear kro" — the "Fee" column shows
  // the FULL fee as if paid entirely online (consultationFee + platform convenience/emergency
  // charge + GST — see utils/minBookingAmount.js's worked example), which is deliberately MORE
  // than Paid+Due whenever the patient only paid the doctor's minimum booking amount online: the
  // platform charge/GST is collected exactly once either way, so choosing "pay minimum" settles
  // for less overall (Paid+Due), never leaving anything actually uncollected. Renamed to "Full
  // Fee (online)" everywhere this column appears — in the on-screen table below AND this
  // exported CSV — so the number reads correctly without needing this comment.
  // BOOKING-ID VISIBILITY FIX (user request: "bookinh id ko slip pe dikhai and my bookong me v
  // dikhao") — the booking slip already printed this (buildBookingSlipSections's `meta` line,
  // now also its own "Appointment" row), but this table itself never showed it anywhere — the
  // 'ID' column is just this page's own row sequence number (#1, #2...), not the real booking
  // id a patient would need to reference at the clinic counter or read off the slip. Same
  // shortId(appointment.id) format already used for "Booking ID" on the Payments table below.
  const exportCsv = () => downloadCsv('my-appointments.csv', buildCsv(['ID', 'Booking ID', 'Token', 'Date', 'Time', 'Doctor', 'Patient', 'Clinic', 'Status', 'Payment', 'Payment method', 'Transaction', 'Fee', 'Paid', 'Due', 'Notes'], records.map(({ appointment, payment, displayFee, paid, due, status, mode }, index) => [sequenceId(index), shortId(appointment.id), appointment.tokenNumber != null ? `#${appointment.tokenNumber}` : '', appointment.appointmentDate || '', appointment.appointmentTime || '', appointment.doctor?.name || '', appointment.patient?.name || appointment.familyMember?.name || currentUser.name || '', appointment.clinic?.name || '', appointment.status || '', status, mode, paymentReference(payment), displayFee, paid, due, appointment.reason || appointment.notes || ''])))
  const submitReview = async (event) => {
    event.preventDefault()
    const appointment = completed.find((item) => item.id === selectedReviewId)
    if (!appointment || !rating || !reviewText.trim()) return
    setReviewError('')
    try {
      await addReview({ appointmentId: appointment.id, rating: Number(rating), text: reviewText.trim() })
      setSaved(true)
      setRating('')
      setReviewText('')
    } catch (err) {
      setReviewError(err.message)
    }
  }
  const refresh = async () => {
    setRefreshError('')
    setRefreshing(true)
    try {
      await Promise.all([fetchAppointments(), fetchPayments()])
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setRefreshError(err.message)
    } finally {
      setRefreshing(false)
    }
  }
  const selectedCompleted = completed.find((item) => item.id === selectedReviewId)
  return <>
  <Page title={history ? 'Booking history' : 'My appointments'} subtitle={history ? 'Review every clinic visit and view/download booking slips.' : 'View upcoming bookings, view/download slips, and review completed consultations.'} action={<div className="flex flex-wrap items-center gap-2"><span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 text-sm font-semibold text-success"><span className="h-2 w-2 rounded-full bg-success" />Live</span><button type="button" className="touch-target rounded-button border border-border bg-white px-4 text-sm font-semibold text-ink disabled:opacity-60" onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button><button type="button" className="touch-target rounded-button bg-charcoal px-4 text-sm font-semibold text-white" onClick={exportCsv}>↓ Export CSV</button></div>}>
    {refreshError && <p role="alert" className="mb-4 text-sm text-error">{refreshError}</p>}
    {paymentError && <p role="alert" className="mb-4 text-sm text-error">{paymentError}</p>}
    {cancelError && <p role="alert" className="mb-4 text-sm text-error">{cancelError}</p>}
    {!history && completed.length > 0 && <form onSubmit={submitReview} className="mb-6 rounded-card border border-border bg-white p-6 shadow-card"><h2 className="mb-5 text-xl">Review a completed consultation</h2><div className="grid gap-4 sm:grid-cols-2"><FormField label="Completed appointment" type="select" options={completed.map((item) => `#${item.tokenNumber ?? item.id} · ${item.doctor?.name || 'Doctor'} · ${displayDate(item.appointmentDate)}`)} value={selectedCompleted ? `#${selectedCompleted.tokenNumber ?? selectedCompleted.id} · ${selectedCompleted.doctor?.name || 'Doctor'} · ${displayDate(selectedCompleted.appointmentDate)}` : ''} onChange={(event) => { const index = event.target.selectedIndex - 1; setReviewAppointment(completed[index]?.id || '') }} required /><FormField label="Rating" type="select" options={['1', '2', '3', '4', '5']} value={rating} onChange={(event) => setRating(event.target.value)} required /><div className="sm:col-span-2"><FormField label="Review" type="textarea" value={reviewText} onChange={(event) => setReviewText(event.target.value)} required /></div></div><Button type="submit" className="mt-5">Submit review</Button>{reviewError && <p role="alert" className="mt-3 text-sm text-error">{reviewError}</p>}{saved && <p role="status" className="mt-3 text-sm font-semibold text-success">Review submitted — pending moderation before it appears publicly.</p>}</form>}
    <section key={refreshKey} className="rounded-card border border-border bg-white p-6 shadow-card"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl">{history ? 'Booking history' : 'Live records'}</h2><span className="text-sm font-semibold text-muted">{records.length} record(s)</span></div>{isMobile ? <ul className="grid gap-3">{records.map(({ appointment, payment, fee, displayFee, paid, due, status, mode }, index) => <li key={appointment.id} className="rounded-button border border-border p-3"><dl className="grid gap-2 text-sm"><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">ID</dt><dd className="text-right">{sequenceId(index)}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Booking ID</dt><dd className="text-right font-mono text-[11px]">{shortId(appointment.id)}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Token</dt><dd className="text-right">{appointment.tokenNumber != null ? `#${appointment.tokenNumber}` : '—'}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Date</dt><dd className="text-right">{displayDate(appointment.appointmentDate)}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Time</dt><dd className="text-right">{appointment.appointmentTime || '—'}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Doctor</dt><dd className="text-right font-semibold">{appointment.doctor?.name || '—'}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Patient</dt><dd className="text-right">{appointment.patient?.name || appointment.familyMember?.name || currentUser.name || '—'}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Clinic</dt><dd className="text-right">{appointment.clinic?.name || '—'}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Status</dt><dd className="text-right"><StatusPill status={appointment.status} /></dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Payment</dt><dd className="text-right"><StatusPill status={status} /></dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Payment method</dt><dd className="text-right">{mode}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Transaction</dt><dd className="max-w-[60%] break-all text-right font-mono text-[11px]">{paymentReference(payment)}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Fee</dt><dd className="text-right">₹{displayFee}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Paid</dt><dd className="text-right">₹{paid}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Due</dt><dd className="text-right">₹{due}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Notes</dt><dd className="max-w-[60%] text-right">{appointment.reason || appointment.notes || '—'}</dd></div></dl><div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">{appointment.status === 'pending_payment' && <>
    {/* PENDING-PAYMENT RESUME FIX — see hooks/useRazorpayPayment.js. Without this, a
        pending_payment booking (payment never finished) had no Pay/Cancel action anywhere
        outside the one-shot post-booking screen and sat stuck forever. */}
    <button type="button" className="whitespace-nowrap rounded-button bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" onClick={() => resumePayment(appointment, 'full')} disabled={payingId === appointment.id || cancellingId === appointment.id}>{payingId === appointment.id ? 'Opening…' : `Pay ₹${fee} now`}</button>
    {appointment.fees?.minBookingAmount != null && <button type="button" className="whitespace-nowrap rounded-button border border-primary px-3 py-2 text-xs font-semibold text-primary-dark disabled:opacity-60" onClick={() => resumePayment(appointment, 'minimum')} disabled={payingId === appointment.id || cancellingId === appointment.id}>{payingId === appointment.id ? 'Opening…' : `Pay min ₹${Number(appointment.fees.minBookingAmount)} now`}</button>}
    <button type="button" className="whitespace-nowrap rounded-button border border-error px-3 py-2 text-xs font-semibold text-error disabled:opacity-60" onClick={() => cancelPendingBooking(appointment)} disabled={payingId === appointment.id || cancellingId === appointment.id}>{cancellingId === appointment.id ? 'Cancelling…' : 'Cancel'}</button>
  </>}<button type="button" className="whitespace-nowrap rounded-button border border-border px-3 py-2 text-xs font-semibold text-primary-dark disabled:opacity-60" onClick={() => viewSlip({ appointment, displayFee, paid, due })} disabled={slip.loading}>{slip.loading ? 'Opening…' : '👁 View slip'}</button></div></li>)}</ul> : <div className="overflow-x-auto rounded-button border border-border"><table className="min-w-[1400px] w-full text-left text-xs"><thead className="bg-surface uppercase tracking-wide text-muted"><tr>{['ID', 'Booking ID', 'Token', 'Date', 'Time', 'Doctor', 'Patient', 'Clinic', 'Status', 'Payment', 'Payment method', 'Transaction', 'Fee', 'Paid', 'Due', 'Notes', 'Actions'].map((heading) => <th className="px-3 py-3" key={heading} title={heading === 'Fee' ? 'The total for this booking, matching how it\'s actually being paid: the minimum booking amount + remaining balance while only the minimum has been paid online (rest due at the clinic), or the full online-payment total once it\'s paid in full.' : undefined}>{heading}</th>)}</tr></thead><tbody>{records.map(({ appointment, payment, fee, displayFee, paid, due, status, mode }, index) => <tr className="border-t border-border align-top" key={appointment.id}><td className="px-3 py-4 font-semibold text-muted">{sequenceId(index)}</td><td className="px-3 py-4 font-mono text-[11px]">{shortId(appointment.id)}</td><td className="px-3 py-4">{appointment.tokenNumber != null ? `#${appointment.tokenNumber}` : '—'}</td><td className="px-3 py-4">{displayDate(appointment.appointmentDate)}</td><td className="px-3 py-4">{appointment.appointmentTime || '—'}</td><td className="px-3 py-4 font-semibold">{appointment.doctor?.name || '—'}</td><td className="px-3 py-4">{appointment.patient?.name || appointment.familyMember?.name || currentUser.name || '—'}</td><td className="px-3 py-4">{appointment.clinic?.name || '—'}</td><td className="px-3 py-4"><StatusPill status={appointment.status} /></td><td className="px-3 py-4"><StatusPill status={status} /></td><td className="px-3 py-4">{mode}</td><td className="max-w-64 break-all px-3 py-4 font-mono text-[11px]">{paymentReference(payment)}</td><td className="px-3 py-4">₹{displayFee}</td><td className="px-3 py-4">₹{paid}</td><td className="px-3 py-4">₹{due}</td><td className="max-w-48 px-3 py-4">{appointment.reason || appointment.notes || '—'}</td><td className="px-3 py-4"><div className="flex flex-wrap gap-2">{appointment.status === 'pending_payment' && <>
    {/* PENDING-PAYMENT RESUME FIX — see hooks/useRazorpayPayment.js. Without this, a
        pending_payment booking (payment never finished) had no Pay/Cancel action anywhere
        outside the one-shot post-booking screen and sat stuck forever. */}
    <button type="button" className="whitespace-nowrap rounded-button bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" onClick={() => resumePayment(appointment, 'full')} disabled={payingId === appointment.id || cancellingId === appointment.id}>{payingId === appointment.id ? 'Opening…' : `Pay ₹${fee} now`}</button>
    {appointment.fees?.minBookingAmount != null && <button type="button" className="whitespace-nowrap rounded-button border border-primary px-3 py-2 text-xs font-semibold text-primary-dark disabled:opacity-60" onClick={() => resumePayment(appointment, 'minimum')} disabled={payingId === appointment.id || cancellingId === appointment.id}>{payingId === appointment.id ? 'Opening…' : `Pay min ₹${Number(appointment.fees.minBookingAmount)} now`}</button>}
    <button type="button" className="whitespace-nowrap rounded-button border border-error px-3 py-2 text-xs font-semibold text-error disabled:opacity-60" onClick={() => cancelPendingBooking(appointment)} disabled={payingId === appointment.id || cancellingId === appointment.id}>{cancellingId === appointment.id ? 'Cancelling…' : 'Cancel'}</button>
  </>}<button type="button" className="whitespace-nowrap rounded-button border border-border px-3 py-2 text-xs font-semibold text-primary-dark disabled:opacity-60" onClick={() => viewSlip({ appointment, displayFee, paid, due })} disabled={slip.loading}>{slip.loading ? 'Opening…' : '👁 View slip'}</button></div></td></tr>)}</tbody></table></div>}{!records.length && <p className="p-8 text-center text-sm text-muted">No appointments found.</p>}</section>
  </Page>
  <PdfPreviewModal preview={slip.preview} onClose={slip.close} title="Booking slip preview" />
  </>
}
export function BookingHistory({ data }) { return <PatientAppointments data={data} history /> }
export function Family({ data }) {
  const isMobile = useIsMobile()
  const emptyMember = { name: '', relation: '', dateOfBirth: '', gender: '', bloodGroup: '' }
  const [editingId, setEditingId] = useState(null)
  const [member, setMember] = useState(emptyMember)
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const addFamilyMember = useAppStore((state) => state.addFamilyMember)
  const updateFamilyMember = useAppStore((state) => state.updateFamilyMember)
  const removeFamilyMember = useAppStore((state) => state.removeFamilyMember)
  const fetchFamilyMembers = useAppStore((state) => state.fetchFamilyMembers)
  const update = (key) => (event) => setMember((current) => ({ ...current, [key]: event.target.value }))
  const closeForm = () => { setEditingId(null); setMember(emptyMember) }
  const save = async (event) => {
    event.preventDefault()
    if (!member.name.trim() || !member.relation.trim()) return
    const values = { name: member.name.trim(), relation: member.relation.trim(), dateOfBirth: member.dateOfBirth || undefined, gender: member.gender || undefined, bloodGroup: member.bloodGroup || undefined }
    setError('')
    setSaving(true)
    try {
      if (editingId) await updateFamilyMember(editingId, values)
      else await addFamilyMember(values)
      closeForm()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  const edit = (item) => { setEditingId(item.id); setMember({ name: item.name || '', relation: item.relation || '', dateOfBirth: item.dateOfBirth || '', gender: item.gender || '', bloodGroup: item.bloodGroup || '' }) }
  // Was previously missing a busy/deletingId state entirely (unlike every other delete-with-confirm
  // flow in this app) — a double-click on "Remove" could fire removeFamilyMember twice before the
  // first request resolved. Fixed as part of extracting the shared hook (duplication audit, 2026-09-05).
  const { deletingId, remove } = useDeleteWithConfirm({
    setError,
    confirmMessage: (item) => `Delete ${item.name}'s family profile?`,
    errorFallback: 'Could not delete this family member.',
    deleteFn: async (item) => { await removeFamilyMember(item.id); if (editingId === item.id) closeForm() },
  })
  const exportCsv = () => downloadCsv('family-members.csv', buildCsv(['ID', 'Full name', 'Relationship', 'Date of birth', 'Gender', 'Blood group', 'Age'], (data.familyMembers || []).map((item, index) => [sequenceId(index), item.name, item.relation, item.dateOfBirth || '', item.gender || '', item.bloodGroup || '', item.age ?? ''])))
  const refresh = async () => {
    setError('')
    setRefreshing(true)
    try {
      await fetchFamilyMembers()
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }
  return <Page title="Family members" subtitle="Manage dependents for appointment booking." action={<div className="flex flex-wrap items-center gap-2"><span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 text-sm font-semibold text-success"><span className="h-2 w-2 rounded-full bg-success" />Live</span><button type="button" className="touch-target rounded-button border border-border bg-white px-4 text-sm font-semibold text-ink disabled:opacity-60" onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button><button type="button" className="touch-target rounded-button bg-charcoal px-4 text-sm font-semibold text-white" onClick={exportCsv}>↓ Export CSV</button></div>}>
    <form onSubmit={save} className="mb-6 rounded-card border border-border bg-white p-6 shadow-card"><h2 className="mb-5 text-xl">{editingId ? 'Edit family member' : 'Add family member'}</h2><div className="grid gap-4 sm:grid-cols-2"><FormField label="Full name" value={member.name} onChange={update('name')} required /><FormField label="Relationship" value={member.relation} onChange={update('relation')} required /><FormField label="Date of birth" type="date" value={member.dateOfBirth} onChange={update('dateOfBirth')} /><FormField label="Gender" type="select" options={['Female', 'Male', 'Other', 'Prefer not to say']} value={member.gender} onChange={update('gender')} /><FormField label="Blood group" placeholder="e.g. B+" value={member.bloodGroup} onChange={update('bloodGroup')} /><div className="flex items-end gap-2"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editingId ? 'Update member' : 'Add member')}</Button>{editingId && <button type="button" className="touch-target rounded-button border border-border px-4 text-sm font-semibold text-ink" onClick={closeForm}>Cancel</button>}</div></div>{error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}</form>
    <section key={refreshKey} className="rounded-card border border-border bg-white p-6 shadow-card"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl">Live records</h2><span className="text-sm font-semibold text-muted">{(data.familyMembers || []).length} record(s)</span></div>{isMobile ? <ul className="grid gap-3">{(data.familyMembers || []).map((item, index) => <li key={item.id} className="rounded-button border border-border p-3"><dl className="grid gap-2 text-sm">
      {/* RESPONSIVE-CARDS FIX (user request: "patient and receptionist and admin panel ko fully
          resposive bnao mobile view v best ho") — same stacked label/value card treatment as
          components/DataTable.jsx, applied here by hand since this table predates that shared
          component and is hand-rolled rather than DataTable-backed. */}
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">ID</dt><dd className="text-right">{sequenceId(index)}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Full name</dt><dd className="text-right font-semibold">{item.name}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Relationship</dt><dd className="text-right">{item.relation}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Date of birth</dt><dd className="text-right">{item.dateOfBirth || '—'}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Gender</dt><dd className="text-right">{item.gender || '—'}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Blood group</dt><dd className="text-right">{item.bloodGroup || '—'}</dd></div>
    </dl><div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3"><button type="button" className="touch-target rounded-button border border-border px-3 text-xs font-semibold text-primary-dark" onClick={() => edit(item)}>Edit</button><button type="button" disabled={deletingId === item.id} className="touch-target rounded-button border border-error/30 px-3 text-xs font-semibold text-error disabled:opacity-50" onClick={() => remove(item)}>{deletingId === item.id ? 'Removing…' : 'Remove'}</button></div></li>)}</ul> : <div className="overflow-x-auto rounded-button border border-border"><table className="min-w-[850px] w-full text-left text-sm"><thead className="bg-surface text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-3">ID</th><th className="px-3 py-3">Full name</th><th className="px-3 py-3">Relationship</th><th className="px-3 py-3">Date of birth</th><th className="px-3 py-3">Gender</th><th className="px-3 py-3">Blood group</th><th className="px-3 py-3">Actions</th></tr></thead><tbody>{(data.familyMembers || []).map((item, index) => <tr className="border-t border-border" key={item.id}><td className="px-3 py-4 font-semibold text-muted">{sequenceId(index)}</td><td className="px-3 py-4 font-semibold">{item.name}</td><td className="px-3 py-4">{item.relation}</td><td className="px-3 py-4">{item.dateOfBirth || '—'}</td><td className="px-3 py-4">{item.gender || '—'}</td><td className="px-3 py-4">{item.bloodGroup || '—'}</td><td className="px-3 py-4"><div className="flex gap-2"><button type="button" className="touch-target rounded-button border border-border px-3 text-xs font-semibold text-primary-dark" onClick={() => edit(item)}>Edit</button><button type="button" disabled={deletingId === item.id} className="touch-target rounded-button border border-error/30 px-3 text-xs font-semibold text-error disabled:opacity-50" onClick={() => remove(item)}>{deletingId === item.id ? 'Removing…' : 'Remove'}</button></div></td></tr>)}</tbody></table></div>}{!(data.familyMembers || []).length && <p className="p-8 text-center text-sm text-muted">No family members added yet.</p>}</section>
  </Page>
}
export function Payments({ data }) {
  const isMobile = useIsMobile()
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const fetchPayments = useAppStore((state) => state.fetchPayments)
  const currentUser = useAppStore((state) => state.currentUser) || {}
  const payments = data.payments || []
  const rows = payments.map((payment) => {
    const appointment = (data.appointments || []).find((item) => item.id === payment.appointment?.id)
    return {
      ...payment,
      appointment,
      doctorName: payment.doctor?.name || appointment?.doctor?.name || '—',
      clinicName: payment.clinic?.name || appointment?.clinic?.name || '—',
      patientName: payment.patient?.name || currentUser.name || '—',
      amount: Number(payment.fees?.amount ?? 0),
      transactionId: payment.transactionRef || '—',
    }
  })
  const pending = (data.appointments || []).filter((item) => item.paymentStatus === 'pending')
  // Proper PDF receipt (see lib/receiptPdf.js) — previously a plain .txt Blob missing the full
  // fee breakdown, clinic address, doctor specialization and token number.
  //
  // VIEW-THEN-DOWNLOAD, same pattern as the booking slip above (request: "baki jagah v same kar do
  // jaha slip download ho raha hai") — opens the PDF in an in-page preview instead of saving it
  // straight away; the actual save-to-disk action lives inside that preview.
  const receipt = usePdfPreview()
  const viewReceipt = (item) => receipt.open(() => buildPatientReceiptPdfBlob(item))
  const refresh = async () => {
    setRefreshError('')
    setRefreshing(true)
    try {
      await fetchPayments()
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setRefreshError(err.message)
    } finally {
      setRefreshing(false)
    }
  }
  return <>
  <Page title="Payment history" subtitle="Review clinic receipts and payment status." action={<div className="flex flex-wrap items-center gap-2"><span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 text-sm font-semibold text-success"><span className="h-2 w-2 rounded-full bg-success" />Live</span><button type="button" className="touch-target rounded-button border border-border bg-white px-4 text-sm font-semibold text-ink disabled:opacity-60" onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button></div>}>
    <section className="mb-6 rounded-card border border-border bg-white p-5 shadow-card"><p className="text-sm font-semibold text-primary-dark">Payment status</p><h2 className="mt-2 text-xl">Pending clinic payments</h2><p className="mt-1 text-sm font-semibold text-muted">{pending.length ? `${pending.length} visit${pending.length === 1 ? '' : 's'} awaiting payment` : 'No pending payments'}</p><p className="mt-2 text-sm text-muted">Payments are collected and recorded by clinic staff at your visit — online self-payment isn't available. This list updates once staff record a payment for a booking.</p></section>
    {refreshError && <p role="alert" className="mb-4 text-sm text-error">{refreshError}</p>}
    <section key={refreshKey} className="rounded-card border border-border bg-white p-6 shadow-card"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl">Live records</h2><span className="text-sm font-semibold text-muted">{rows.length} record(s)</span></div>{isMobile ? <ul className="grid gap-3">{rows.map((item, index) => <li key={item.id} className="rounded-button border border-border p-3"><dl className="grid gap-2 text-sm"><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">ID</dt><dd className="text-right">{sequenceId(index)}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Receipt</dt><dd className="text-right">{item.receiptNumber || shortId(item.id)}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Booking ID</dt><dd className="text-right">{item.appointment?.id ? shortId(item.appointment.id) : '—'}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Token</dt><dd className="text-right">{item.appointment?.tokenNumber != null ? `#${item.appointment.tokenNumber}` : '—'}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Payment date</dt><dd className="text-right">{formatDate(item.createdAt)}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Time</dt><dd className="text-right">{item.appointment?.appointmentTime || '—'}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Patient</dt><dd className="text-right">{item.patientName}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Doctor</dt><dd className="text-right font-semibold">{item.doctorName}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Clinic</dt><dd className="text-right">{item.clinicName}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Amount</dt><dd className="text-right">₹{item.amount}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Method</dt><dd className="text-right"><span className="inline-flex items-center gap-1.5">{item.mode || '—'}<PaymentSourceBadge payment={item} /></span></dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Purpose</dt><dd className="text-right">{item.appointment?.isEmergency ? 'Emergency consultation' : 'Consultation'}</dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Appointment status</dt><dd className="text-right"><StatusPill status={item.appointment?.status || '—'} /></dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Payment status</dt><dd className="text-right"><StatusPill status={item.status} /></dd></div><div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Transaction</dt><dd className="max-w-[60%] break-all text-right font-mono text-[11px]">{item.transactionId}</dd></div></dl><div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3"><button type="button" className="whitespace-nowrap rounded-button border border-border px-3 py-2 text-xs font-semibold text-primary-dark disabled:opacity-60" onClick={() => viewReceipt(item)} disabled={receipt.loading}>{receipt.loading ? 'Opening…' : '👁 View receipt'}</button></div></li>)}</ul> : <div className="overflow-x-auto rounded-button border border-border"><table className="min-w-[1400px] w-full text-left text-xs"><thead className="bg-surface uppercase tracking-wide text-muted"><tr>{['ID', 'Receipt', 'Booking ID', 'Token', 'Payment date', 'Time', 'Patient', 'Doctor', 'Clinic', 'Amount', 'Method', 'Purpose', 'Appointment status', 'Payment status', 'Transaction', 'Actions'].map((heading) => <th className="px-3 py-3" key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((item, index) => <tr className="border-t border-border align-top" key={item.id}><td className="px-3 py-4 font-semibold text-muted">{sequenceId(index)}</td><td className="px-3 py-4">{item.receiptNumber || shortId(item.id)}</td><td className="px-3 py-4">{item.appointment?.id ? shortId(item.appointment.id) : '—'}</td><td className="px-3 py-4">{item.appointment?.tokenNumber != null ? `#${item.appointment.tokenNumber}` : '—'}</td><td className="px-3 py-4">{formatDate(item.createdAt)}</td><td className="px-3 py-4">{item.appointment?.appointmentTime || '—'}</td><td className="px-3 py-4">{item.patientName}</td><td className="px-3 py-4 font-semibold">{item.doctorName}</td><td className="px-3 py-4">{item.clinicName}</td><td className="px-3 py-4">₹{item.amount}</td><td className="px-3 py-4"><span className="inline-flex items-center gap-1.5">{item.mode || '—'}<PaymentSourceBadge payment={item} /></span></td><td className="px-3 py-4">{item.appointment?.isEmergency ? 'Emergency consultation' : 'Consultation'}</td><td className="px-3 py-4"><StatusPill status={item.appointment?.status || '—'} /></td><td className="px-3 py-4"><StatusPill status={item.status} /></td><td className="max-w-56 break-all px-3 py-4 font-mono text-[11px]">{item.transactionId}</td><td className="px-3 py-4"><button type="button" className="whitespace-nowrap rounded-button border border-border px-3 py-2 text-xs font-semibold text-primary-dark disabled:opacity-60" onClick={() => viewReceipt(item)} disabled={receipt.loading}>{receipt.loading ? 'Opening…' : '👁 View receipt'}</button></td></tr>)}</tbody></table></div>}{!rows.length && <p className="p-8 text-center text-sm text-muted">No payment records yet.</p>}</section>
  </Page>
  <PdfPreviewModal preview={receipt.preview} onClose={receipt.close} title="Payment receipt preview" />
  </>
}
export function Notifications({ data }) {
  const isMobile = useIsMobile()
  const markRead = useAppStore((state) => state.markNotificationRead)
  const markAll = useAppStore((state) => state.markAllNotificationsRead)
  const fetchNotifications = useAppStore((state) => state.fetchNotifications)
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [error, setError] = useState('')

  // loadUserData() only fetches notifications once, right after login — this page's "Live" badge
  // was misleading without this: anything raised AFTER login (a new booking, a payment, the queue
  // calling this patient's token — see notifications.service.js#notifySystemEvent's callers)
  // stayed invisible here until the patient clicked "↻ Refresh" themselves. Fetch fresh on mount,
  // then poll every 30s (matching the backend's own MY_LIST_CACHE_TTL_SECONDS, so this never asks
  // more often than the cache can actually answer with anything new) while this page stays open.
  useEffect(() => {
    let cancelled = false
    fetchNotifications().catch((err) => { if (!cancelled) setError(err.message || 'Could not load notifications.') })
    const interval = setInterval(() => { fetchNotifications().catch(() => {}) }, 30000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [fetchNotifications])

  const handleMarkRead = async (id) => {
    setError('')
    try {
      await markRead(id)
    } catch (err) {
      setError(err.message)
    }
  }
  const handleMarkAll = async () => {
    setError('')
    setMarkingAll(true)
    try {
      await markAll()
    } catch (err) {
      setError(err.message)
    } finally {
      setMarkingAll(false)
    }
  }
  const refresh = async () => {
    setError('')
    setRefreshing(true)
    try {
      await fetchNotifications()
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }
  const exportCsv = () => downloadCsv('notifications.csv', buildCsv(['ID', 'Date', 'Title', 'Message', 'Type', 'Status'], (data.notifications || []).map((item, index) => [sequenceId(index), item.createdAt || '', item.title || '', item.body || '', item.type || 'system', item.readAt ? 'read' : 'unread'])))
  return <Page title="Notifications" subtitle="Appointment confirmations, queue alerts, and reminders." action={<div className="flex flex-wrap items-center gap-2"><span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 text-sm font-semibold text-success"><span className="h-2 w-2 rounded-full bg-success" />Live</span><button type="button" className="touch-target rounded-button border border-border bg-white px-4 text-sm font-semibold text-ink disabled:opacity-60" onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button><button type="button" className="touch-target rounded-button bg-charcoal px-4 text-sm font-semibold text-white" onClick={exportCsv}>↓ Export CSV</button></div>}>
    <section className="mb-6 rounded-card border border-border bg-white p-5 shadow-card"><h2 className="text-lg">Notification controls</h2><Button className="mt-4" onClick={handleMarkAll} disabled={markingAll}>{markingAll ? 'Marking…' : 'Mark all as read'}</Button>{error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}</section>
    <section key={refreshKey} className="rounded-card border border-border bg-white p-6 shadow-card"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl">Live records</h2><span className="text-sm font-semibold text-muted">{(data.notifications || []).length} record(s)</span></div>{isMobile ? <ul className="grid gap-3">{(data.notifications || []).map((item, index) => <li key={item.id} className={`rounded-button border border-border p-3 ${!item.readAt ? 'bg-primary-light/20' : ''}`}><dl className="grid gap-2 text-sm">
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">ID</dt><dd className="text-right">{sequenceId(index)}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Date</dt><dd className="text-right">{formatDate(item.createdAt)}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Title</dt><dd className="text-right font-semibold">{item.title || 'Notification'}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Message</dt><dd className="text-right">{item.body || '—'}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Type</dt><dd className="text-right">{item.type || 'system'}</dd></div>
      <div className="flex items-start justify-between gap-3"><dt className="shrink-0 font-semibold text-muted">Status</dt><dd className="text-right"><StatusPill status={item.readAt ? 'read' : 'unread'} /></dd></div>
    </dl>{!item.readAt && <div className="mt-3 flex justify-end border-t border-border pt-3"><button type="button" className="touch-target text-xs font-semibold text-primary-dark" onClick={() => handleMarkRead(item.id)}>Mark read</button></div>}</li>)}</ul> : <div className="overflow-x-auto rounded-button border border-border"><table className="min-w-[850px] w-full text-left text-sm"><thead className="bg-surface text-xs uppercase tracking-wide text-muted"><tr>{['ID', 'Date', 'Title', 'Message', 'Type', 'Status', 'Actions'].map((heading) => <th className="px-3 py-3" key={heading}>{heading}</th>)}</tr></thead><tbody>{(data.notifications || []).map((item, index) => <tr className={`border-t border-border align-top ${!item.readAt ? 'bg-primary-light/20' : ''}`} key={item.id}><td className="px-3 py-4 font-semibold text-muted">{sequenceId(index)}</td><td className="px-3 py-4">{formatDate(item.createdAt)}</td><td className="px-3 py-4 font-semibold">{item.title || 'Notification'}</td><td className="max-w-80 px-3 py-4">{item.body || '—'}</td><td className="px-3 py-4">{item.type || 'system'}</td><td className="px-3 py-4"><StatusPill status={item.readAt ? 'read' : 'unread'} /></td><td className="px-3 py-4">{!item.readAt && <button type="button" className="touch-target text-xs font-semibold text-primary-dark" onClick={() => handleMarkRead(item.id)}>Mark read</button>}</td></tr>)}</tbody></table></div>}{!(data.notifications || []).length && <p className="p-8 text-center text-sm text-muted">No notifications yet.</p>}</section>
  </Page>
}
export function PatientSettings({ data }) {
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const updateProfile = useAppStore((state) => state.updateProfile)
  const currentUser = useAppStore((state) => state.currentUser) || {}
  const save = async (event) => {
    event.preventDefault()
    const fields = Object.fromEntries(new FormData(event.currentTarget).entries())
    setSaved(false)
    setError('')
    setSaving(true)
    try {
      await updateProfile(fields)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  return <Page title="Profile & settings"><form onSubmit={save} className="max-w-2xl rounded-card border border-border bg-white p-5 shadow-card"><div className="grid gap-4 sm:grid-cols-2"><FormField label="Full name" name="name" defaultValue={currentUser.name || ''} required /><FormField label="Mobile number" name="phone" defaultValue={currentUser.phone || ''} /><FormField label="Email" name="email" type="email" defaultValue={currentUser.email || ''} /><FormField label="City" name="city" defaultValue={currentUser.city || ''} /></div><Button type="submit" className="mt-5" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>{saved && <p role="status" className="mt-3 text-sm font-semibold text-success">Profile updated.</p>}{error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}</form></Page>
}
