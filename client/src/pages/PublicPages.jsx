import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import brandLogoUrl from '../assets/brand-logo.png'
import { Badge } from '../components/Badge'
import { EmptyState } from '../components/EmptyState'
import { FormField } from '../components/FormField'
import { LiveQueueWidget } from '../components/LiveQueueWidget'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { signInWithGoogle } from '../lib/googleSignIn'
import { useAppStore } from '../store/useAppStore'

const roleHome = (role) => role === 'superadmin' ? '/super-admin/dashboard' : `/${role}/dashboard`

const Button = ({ children, className = '', ...props }) => <button className={`btn-primary ${className}`} {...props}>{children}</button>

// `data.queueTokens` (GET /queue) is doctor/receptionist-only and never populated for a patient —
// both LiveQueueWidget usages below used to read from it anyway, so they always rendered the
// widget's empty "no active queue" state for a real patient, even when they genuinely had a live
// token. fetchMyQueueStatus (GET /queue/mine/:appointmentId — patient-only) is the real fix.
// Isolated into its own component (rather than inlined into Home/DoctorDetail's already-giant
// bodies) so its hooks stay unconditional regardless of how those callers are laid out.
function PatientLiveQueuePreview({ appointment }) {
  const fetchMyQueueStatus = useAppStore((state) => state.fetchMyQueueStatus)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!appointment) return undefined
    let cancelled = false
    const load = () => {
      fetchMyQueueStatus(appointment.id)
        .then((result) => { if (!cancelled) { setStatus(result); setError('') } })
        .catch((err) => { if (!cancelled) setError(err.message || 'Could not load live queue status.') })
    }
    load()
    const interval = setInterval(load, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [appointment, fetchMyQueueStatus])
  return <LiveQueueWidget
    appointmentId={appointment?.id}
    initialQueue={appointment && status ? { appointmentId: appointment.id, token: status.token, nowServing: status.nowServing, patientsAhead: status.patientsAhead, estimatedWait: status.estimatedWaitMinutes, doctorStatus: status.status } : null}
    error={error}
    onRetry={() => appointment && fetchMyQueueStatus(appointment.id).then(setStatus).catch((err) => setError(err.message))}
  />
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')
  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
    localStorage.setItem('dc-theme', next ? 'dark' : 'light')
  }
  return { dark, toggle }
}

export function SiteHeader() { 
  const { dark, toggle } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const authRole = useAppStore((state) => state.currentUser?.role || '')
  const currentUser = useAppStore((state) => state.currentUser)
  const profilePath = authRole ? (authRole === 'superadmin' ? '/super-admin/profile' : `/${authRole}/profile`) : '/login'
  const profileName = currentUser?.name || (authRole ? `${authRole} account` : '')
  const profileInitials = profileName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'

  return (
    <header className="site-header relative">
      <div className="container nav-wrap">
        <Link to="/" className="brand [grid-column:1]" aria-label="BookMyDoctor24 home" onClick={() => setMobileOpen(false)}>
          {/* BUG FIX ("galat logo use kiye ho"): real app logo, not the generic Lucide
              heart-pulse stock icon this used to be — see lib/brandLogo.js for the same fix on
              the PDF receipts. */}
          <span className="brand-mark">
            <img src={brandLogoUrl} alt="BookMyDoctor24" className="h-full w-full rounded-[13px] object-cover" />
          </span>
          <span><strong>BookMyDoctor24</strong></span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="main-nav hidden md:flex items-center gap-6 [grid-column:2]" aria-label="Main navigation">
          <Link to="/search">Find doctors</Link>
          <a href="/#specializations">Specialties</a>
          <a href="/#how-it-works">How it works</a>
          <Link to="/contact">Contact</Link>
              {authRole ? <Link to={profilePath} className="btn btn-ghost inline-flex items-center gap-2" aria-label="Open profile"><span className="grid h-7 w-7 overflow-hidden place-items-center rounded-full bg-primary-light text-xs font-bold text-primary-dark">{currentUser?.photoUrl ? <img src={currentUser.photoUrl} alt={`${profileName} profile`} className="h-full w-full object-cover" /> : profileInitials}</span><span>{profileName}</span></Link> : <><Link to="/login" className="btn btn-ghost">Log in</Link><Link to="/register" className="btn btn-primary">Get started</Link></>}
        </nav>

        {/* Header Utilities: Theme Toggle & Mobile Menu Hamburger.
            SIDEBAR-TOGGLE POSITION FIX (user report: "side bar sahi jagah karo" → tried moving the
            hamburger to the top-left next to the brand → user confirmed that was wrong, hamburger
            should stay on the top-RIGHT here, next to the dark-mode toggle, same as before).
            RIGHT-CORNER GAP FIX (user report: "right cornor me karo, name pe bad space do" — the
            hamburger sat ~65px short of the true right edge with an oddly small gap after the
            brand name). Root cause: .nav-wrap is a 3-column grid (brand | nav | utilities), but on
            mobile the middle <nav> is `display:none`, and CSS Grid auto-placement skips it
            entirely — so this utilities div silently landed in the MIDDLE (flexible 1fr) column
            instead of its own last column, leaving the real last column empty/0-width at the true
            edge and stranding a chunk of dead space after the icons instead of after the name.
            Pinning every child to its explicit grid-column (see brand's and nav's [grid-column:*]
            below) fixes both symptoms at once: the empty middle column now correctly absorbs all
            the leftover width BETWEEN the name and the icons (more space after the name), and this
            utilities block sits in the real last column, flush against the true right edge/corner. */}
        <div className="header-utilities flex items-center gap-2 [grid-column:3]">
          <button type="button" className="theme-toggle" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle}>
            {dark ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-sun"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-moon"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"></path></svg>
            )}
            <span>{dark ? 'Light' : 'Dark'}</span>
          </button>

          <button
            type="button"
            className="md:hidden touch-target grid h-10 w-10 place-items-center rounded-button border border-border bg-white text-ink hover:bg-surface"
            aria-label="Toggle navigation"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-menu"><path d="M4 5h16"></path><path d="M4 12h16"></path><path d="M4 19h16"></path></svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 z-50 border-b border-border bg-surface p-4 shadow-card">
          <nav className="flex flex-col gap-3 font-semibold text-ink text-sm">
            <Link to="/search" onClick={() => setMobileOpen(false)} className="rounded-button p-2.5 hover:bg-white">Find doctors</Link>
            <a href="/#specializations" onClick={() => setMobileOpen(false)} className="rounded-button p-2.5 hover:bg-white">Specialties</a>
            <a href="/#how-it-works" onClick={() => setMobileOpen(false)} className="rounded-button p-2.5 hover:bg-white">How it works</a>
            <Link to="/contact" onClick={() => setMobileOpen(false)} className="rounded-button p-2.5 hover:bg-white">Contact</Link>
            <div className="flex gap-2 pt-2 border-t border-border">
              {authRole ? <Link to={profilePath} onClick={() => setMobileOpen(false)} className="touch-target flex-1 flex items-center justify-center gap-2 rounded-button border border-border bg-white text-ink font-semibold"><span className="grid h-7 w-7 overflow-hidden place-items-center rounded-full bg-primary-light text-xs font-bold text-primary-dark">{currentUser?.photoUrl ? <img src={currentUser.photoUrl} alt={`${profileName} profile`} className="h-full w-full object-cover" /> : profileInitials}</span>{profileName}</Link> : <><Link to="/login" onClick={() => setMobileOpen(false)} className="touch-target flex-1 flex items-center justify-center rounded-button border border-border bg-white text-ink font-semibold">Log in</Link><Link to="/register" onClick={() => setMobileOpen(false)} className="touch-target flex-1 flex items-center justify-center rounded-button bg-primary-dark text-white font-semibold">Get started</Link></>}
            </div>
          </nav>
        </div>
      )}
    </header> 
  )
}




export function DoctorCard({ doctor }) {
  const initials = (doctor.name || '').split(' ').filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase() || 'DR'
  const primaryClinic = doctor.clinics?.[0]
  const specializationName = doctor.specialization?.name || 'General practice'
  const location = [primaryClinic?.name || 'Clinic not added', [primaryClinic?.area, primaryClinic?.city || doctor.city].filter(Boolean).join(', ')].filter(Boolean).join(', ')
  const queueOpen = doctor.onlineBooking !== false
  return <article className="rounded-card border border-border bg-white p-4 shadow-card">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-light font-semibold uppercase text-primary-dark">{initials}</span>
        <div>
          <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-primary-dark"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg> Verified doctor</p>
          <h2 className="mt-0.5 text-lg">{doctor.name}</h2>
          <p className="text-sm text-muted">{specializationName} · {doctor.experienceYears || 0} years</p>
        </div>
      </div>
      <Badge tone="gold">★ {doctor.rating || 0}</Badge>
    </div>
    <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm text-muted">
      <p className="flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg>{primaryClinic ? <Link className="font-semibold text-primary-dark" to={`/clinics?clinic=${encodeURIComponent(primaryClinic.name)}`}>{location}</Link> : location}</p>
      <p className="flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>{queueOpen ? 'Today queue open' : 'Not accepting bookings today'}</p>
    </div>
    {doctor.emergencyAvailable && <p className="mt-2 text-sm font-semibold text-error">Emergency available</p>}
    <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
      <div><span className="block text-xs text-muted">Consultation</span><strong className="text-lg">₹{Number(doctor.consultationFee) || 0}</strong></div>
      <div className="flex gap-2">
        <Link className="touch-target inline-flex items-center rounded-button border border-border bg-white px-3 text-sm font-semibold text-ink hover:bg-surface" to={`/doctors/${doctor.id}`}>View profile</Link>
        <Link className="touch-target inline-flex items-center rounded-button bg-primary-dark px-3 text-sm font-semibold text-white hover:bg-charcoal" to={`/doctors/${doctor.id}`}>Book now</Link>
      </div>
    </div>
  </article>
}
const parseSearchFilters = (queryKey) => { const query = new URLSearchParams(queryKey); return { name: query.get('q') || '', city: query.get('city') || '', area: query.get('area') || '', specialization: query.get('specialization') || query.get('specialty') || '', clinic: query.get('clinic') || '', fee: query.get('fee') || '', maxFee: query.get('maxFee') || '', experience: query.get('experience') || '', rating: query.get('rating') || '', today: query.get('today') === 'true', activeClinic: query.get('activeClinic') === 'true', emergency: query.get('emergency') === 'true', sort: query.get('sort') || '' } }

export function SearchResults({ data }) {
  const [params] = useSearchParams()
  const queryKey = params.toString()
  const [filters, setFilters] = useState(() => parseSearchFilters(queryKey))
  const [appliedFilters, setAppliedFilters] = useState(() => parseSearchFilters(queryKey))
  useEffect(() => { const next = parseSearchFilters(queryKey); setFilters(next); setAppliedFilters(next) }, [queryKey])
  const update = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))
  const areaOptions = useMemo(() => {
    const selectedCity = (data.cities || []).find((item) => item.name === filters.city)
    const scoped = selectedCity ? (data.areas || []).filter((area) => area.cityId === selectedCity.id) : (data.areas || [])
    return scoped.map((area) => area.name)
  }, [(data.cities || []), (data.areas || []), filters.city])
  const doctors = useMemo(() => {
    const result = (data.doctors || []).filter((doctor) => {
      const specializationName = doctor.specialization?.name || ''
      const doctorClinics = doctor.clinics || []
      const fee = Number(doctor.consultationFee) || 0
      const maxFee = Number(appliedFilters.maxFee)
      return (!appliedFilters.name || `${doctor.name} ${specializationName}`.toLowerCase().includes(appliedFilters.name.trim().toLowerCase())) && (!appliedFilters.city || doctor.city === appliedFilters.city || doctorClinics.some((clinic) => clinic.city === appliedFilters.city)) && (!appliedFilters.area || doctorClinics.some((clinic) => clinic.area === appliedFilters.area)) && (!appliedFilters.specialization || specializationName === appliedFilters.specialization) && (!appliedFilters.clinic || doctorClinics.some((clinic) => clinic.name === appliedFilters.clinic)) && (!appliedFilters.emergency || doctor.emergencyAvailable) && (!appliedFilters.activeClinic || doctorClinics.length > 0) && (!appliedFilters.today || doctor.onlineBooking !== false) && (!appliedFilters.experience || (doctor.experienceYears || 0) >= Number(appliedFilters.experience)) && (!appliedFilters.rating || (doctor.rating || 0) >= Number(appliedFilters.rating)) && (!appliedFilters.maxFee || fee <= maxFee) && (!appliedFilters.fee || (appliedFilters.fee === 'Under ₹600' ? fee < 600 : appliedFilters.fee === '₹600–₹900' ? fee >= 600 && fee <= 900 : fee > 900))
    })
    return [...result].sort((left, right) => appliedFilters.sort === 'rating' ? (right.rating || 0) - (left.rating || 0) : appliedFilters.sort === 'fee' ? (Number(left.consultationFee) || 0) - (Number(right.consultationFee) || 0) : appliedFilters.sort === 'experience' ? (right.experienceYears || 0) - (left.experienceYears || 0) : 0)
  }, [data, appliedFilters])
  const clearFilters = () => { const empty = { name: '', city: '', area: '', specialization: '', clinic: '', fee: '', maxFee: '', experience: '', rating: '', today: false, activeClinic: false, emergency: false, sort: '' }; setFilters(empty); setAppliedFilters(empty) }
  return <><SiteHeader /><main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
    <p className="text-xs font-semibold uppercase tracking-widest text-primary-dark">Verified healthcare network</p>
    <h1 className="mt-2 text-3xl font-bold font-sans">Find your doctor</h1>
    <p className="mt-1 text-muted text-sm">Compare expertise, location, fees, and live availability before you book.</p>
    <div className="mt-5 grid gap-5 lg:grid-cols-[260px_1fr]">
      <aside className="rounded-card border border-border bg-white p-4 shadow-card">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-sans text-lg">Filters</h2><button type="button" className="text-sm font-semibold text-primary-dark" onClick={clearFilters}>Clear</button></div>
        <div className="space-y-4">
          <FormField label="Doctor or symptom" placeholder="Search name or specialty" value={filters.name} onChange={update('name')} />
          <FormField label="City" type="select" options={(data.cities || []).map((item) => item.name)} value={filters.city} onChange={update('city')} />
          <FormField label="Area" type="select" options={areaOptions} value={filters.area} onChange={update('area')} />
          <FormField label="Specialization" type="select" options={(data.specializations || []).map((item) => item.name)} value={filters.specialization} onChange={update('specialization')} />
          <FormField label="Clinic" type="select" options={(data.clinics || []).map((item) => item.name)} value={filters.clinic} onChange={update('clinic')} />
          <FormField label="Fee range" type="select" options={['Under ₹600', '₹600–₹900', 'Above ₹900']} value={filters.fee} onChange={update('fee')} />
          <FormField label="Maximum fee" type="select" options={['Up to ₹500', 'Up to ₹1,000', 'Up to ₹1,500']} value={filters.maxFee ? `Up to ₹${Number(filters.maxFee).toLocaleString('en-IN')}` : ''} onChange={(event) => setFilters((current) => ({ ...current, maxFee: event.target.value.replace(/\D/g, '') }))} />
          <FormField label="Experience" type="select" options={['5', '10']} value={filters.experience} onChange={update('experience')} />
          <FormField label="Rating" type="select" options={['4.5', '4']} value={filters.rating} onChange={update('rating')} />
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={filters.today} onChange={update('today')} /> Today booking</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={filters.activeClinic} onChange={update('activeClinic')} /> Active clinic</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={filters.emergency} onChange={update('emergency')} /> 24/7 emergency</label>
          <FormField label="Sort by" type="select" options={['Top rated', 'Fee: low to high', 'Experience']} value={filters.sort === 'rating' ? 'Top rated' : filters.sort === 'fee' ? 'Fee: low to high' : filters.sort === 'experience' ? 'Experience' : ''} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value === 'Top rated' ? 'rating' : event.target.value === 'Fee: low to high' ? 'fee' : event.target.value === 'Experience' ? 'experience' : '' }))} />
          <button type="button" className="btn-primary w-full" onClick={() => setAppliedFilters({ ...filters })}>Apply filters</button>
        </div>
      </aside>
      <div>
        <h2 className="mb-1 text-xl font-sans">{doctors.length} doctors found</h2>
        <p className="mb-3 text-sm text-muted">Live verified profiles with transparent fees</p>
        {doctors.length ? <div className="grid gap-4 sm:grid-cols-2">{doctors.map((doctor) => <DoctorCard key={doctor.id} doctor={doctor} />)}</div> : <EmptyState title="No doctors match these filters" message="Try another name or remove a filter." />}
      </div>
    </div>
  </main></> 
}

export function DoctorProfile({ data }) {
  const { doctorId } = useParams()
  const getDoctor = useAppStore((state) => state.getDoctor)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  useEffect(() => {
    let cancelled = false
    setProfileLoading(true)
    setProfileError('')
    getDoctor(doctorId)
      .catch((err) => { if (!cancelled) setProfileError(err.message || 'Could not load this doctor profile.') })
      .finally(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [doctorId, getDoctor])
  const doctor = (data.doctors || []).find((item) => item.id === doctorId)
  if (!doctor) return <><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">{profileLoading ? <LoadingSkeleton rows={4} /> : <>{profileError && <p role="alert" className="mb-4 text-sm text-error">{profileError}</p>}<EmptyState title="No doctor profile yet" message="Doctor profiles added in this browser will appear here." /></>}</main></>
  const primaryClinic = doctor.clinics?.[0]
  const appointment = (data.appointments || []).find((item) => item.doctor?.id === doctor.id)
  const clinic = (data.clinics || []).find((item) => item.id === primaryClinic?.id)
  const reviews = (data.reviews || []).filter((item) => (item.status || 'approved') === 'approved' && (!item.doctor || item.doctor.id === doctor.id))
  // Real weekly OPD hours for the doctor's primary clinic, now returned by the API
  // (doctors.service.js#buildSchedule) — this used to be a hardcoded empty array, which is why
  // this section always showed "Weekly OPD schedule not added yet." even for a doctor who had
  // actually set one.
  const schedule = doctor.schedule || []
  // Online payment is mandatory for a paid online booking (see appointments.service.js's
  // AppointmentStatus.pending_payment) — a patient either pays the full consultation fee, or, if
  // the doctor has configured one, just this minimum advance amount (remainder due at the
  // clinic). This used to be a hardcoded "min(₹100, fee)" placeholder unrelated to the doctor's
  // actual configured amount.
  const minAdvance = Number(doctor.minBookingAdvanceAmount) || 0
  const clinicAddress = clinic?.address || [primaryClinic?.area, primaryClinic?.city || doctor.city].filter(Boolean).join(', ') || 'Clinic address not added'
  return <><SiteHeader /><section className="bg-charcoal px-4 py-8 text-white sm:px-6"><div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-6"><div className="flex items-start gap-4"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-card bg-white text-xl font-semibold uppercase text-primary-dark">{doctor.name.split(' ').filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase() || 'DR'}</div><div><p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-white/70"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg> Verified practitioner</p><h1 className="mt-1 text-3xl text-white">{doctor.name}</h1><p className="mt-1 text-lg text-white/70">{doctor.qualification || doctor.specialization?.name || 'General practice'}</p><p className="mt-2 flex items-center gap-1.5 text-sm text-white/60"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg>{primaryClinic?.name || 'Clinic not added'}{clinicAddress ? `, ${clinicAddress}` : ''}</p>{doctor.emergencyAvailable && <div className="mt-3"><Badge tone="error">Emergency available</Badge></div>}</div></div><div className="text-left sm:text-right"><strong className="text-4xl font-sans text-white">{doctor.rating || 0}</strong><p className="mt-1 flex items-center gap-1 text-sm text-gold sm:justify-end">★ Patient rating</p><p className="mt-1 text-xs text-white/60">{doctor.reviewCount || reviews.length || 0} verified review(s)</p></div></div></section><main className="mx-auto max-w-6xl px-4 py-8 sm:px-6"><div className="grid gap-5 lg:grid-cols-[1fr_360px]"><div className="space-y-5"><article className="rounded-card border border-border bg-white p-6 shadow-card"><h2 className="text-xl">About {doctor.name}</h2><p className="mt-2 leading-7 text-muted">{doctor.bio || 'No description added yet.'}</p><div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-3"><div><span className="block text-sm text-muted">Experience</span><strong>{doctor.experienceYears || 0} years</strong></div><div><span className="block text-sm text-muted">Languages</span><strong>{doctor.languages?.length ? doctor.languages.join(', ') : 'Not added yet'}</strong></div><div><span className="block text-sm text-muted">Availability</span><strong>{doctor.scheduleSummary || (doctor.onlineBooking === false ? 'Not accepting online bookings' : 'Schedule not added')}</strong></div></div></article><article className="rounded-card border border-border bg-white p-6 shadow-card"><div className="flex items-center justify-between gap-3"><h2 className="text-xl">Clinic information</h2>{primaryClinic && <Link className="text-sm font-semibold text-primary-dark" to={`/clinics?clinic=${encodeURIComponent(primaryClinic.name)}`}>View clinic team</Link>}</div><h3 className="mt-4 text-lg">{primaryClinic?.name || 'Clinic not added'}</h3><p className="mt-1 text-sm text-muted">{clinicAddress}</p>{clinic?.phone && <p className="mt-1 text-sm text-muted">{clinic.phone}</p>}<div className="mt-5 space-y-2">{schedule.length ? schedule.slice(0, 7).map((slot, index) => <div className="flex items-center justify-between gap-3 rounded-button bg-surface px-3 py-2 text-sm" key={`${slot.day || 'slot'}-${index}`}><span className="text-muted">{slot.day || 'OPD schedule'}</span><strong>{slot.hours || slot.time || slot}</strong></div>) : <p className="text-sm text-muted">Weekly OPD schedule not added yet.</p>}</div></article><article className="rounded-card border border-border bg-white p-6 shadow-card"><h2 className="text-xl">Patient reviews</h2><div className="mt-4 flex items-center gap-3"><strong className="text-xl">{doctor.rating || 0} / 5</strong><span className="text-sm text-muted">{reviews.length || doctor.reviewCount || 0} verified review(s)</span></div>{reviews.length ? <div className="mt-4 space-y-3">{reviews.slice(0, 3).map((review) => <div className="rounded-button bg-surface p-4" key={review.id}><div className="flex items-center justify-between gap-2"><strong>{review.patient?.name || 'Verified patient'}</strong><span className="text-sm">★★★★★ · Verified appointment</span></div><p className="mt-2 text-sm text-muted">{review.text || 'No written comment.'}</p></div>)}</div> : <p className="mt-3 text-sm text-muted">Reviews will appear after completed appointments.</p>}</article></div><aside className="space-y-4"><div className="rounded-card border border-border bg-white p-6 shadow-card"><p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary-dark"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path></svg> Book clinic appointment</p><p className="mt-2 text-3xl font-sans">₹{Number(doctor.consultationFee) || 0}</p><p className="mt-2 text-sm text-muted">{minAdvance > 0 ? <><strong>₹{minAdvance} online advance</strong> confirms the booking — the remaining fee is payable at the clinic.</> : <>Online payment of the <strong>full consultation fee</strong> confirms the booking.</>}</p><p className="mt-3 text-sm leading-6 text-muted">Your visit time and queue token are assigned from the doctor's OPD schedule.</p><Link className="btn-primary mt-5 w-full" to={`/patient/book?doctorId=${doctor.id}${primaryClinic ? `&clinicId=${primaryClinic.id}` : ''}`}>Continue to booking</Link></div><PatientLiveQueuePreview appointment={appointment} /></aside></div></main></>
}
export function EmergencyPage({ data }) { const doctors = (data.doctors || []).filter((doctor) => doctor.emergencyAvailable); return <><SiteHeader /><main className="mx-auto max-w-5xl px-4 py-8 sm:px-6"><Badge tone="error">Emergency care</Badge><h1 className="mt-3 text-3xl">Doctors and clinics available now</h1>{doctors.length ? <div className="mt-5 grid gap-4">{doctors.map((doctor) => <article className="rounded-card border border-error/30 bg-white p-5 shadow-card" key={doctor.id}><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl">{doctor.name}</h2><p className="text-sm text-muted">{doctor.specialization?.name || 'General practice'} · {doctor.clinics?.[0]?.name || 'Clinic not added'}</p></div><Badge tone="error">Available now</Badge></div><div className="mt-4 grid grid-cols-2 gap-3"><a className="touch-target flex items-center justify-center rounded-button border border-error text-sm font-semibold text-error" href="tel:+912240001111">Call clinic</a><Link className="btn-primary" to="/patient/emergency">Book now</Link></div></article>)}</div> : <div className="mt-5"><EmptyState title="No emergency doctors available right now" message="Emergency-ready doctors will appear here when marked available." /></div>}</main></> }
export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // GOOGLE SIGN-IN FEATURE — separate loading flag from `submitting` (the email/password form's
  // own submit state) so the two buttons never show each other's spinner.
  const [googleSubmitting, setGoogleSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAppStore((state) => state.login)
  const loginWithGoogle = useAppStore((state) => state.loginWithGoogle)
  // One-shot success banner handed in via router state — currently only ResetPassword uses
  // this (after POST /auth/reset-password succeeds), but any future redirect-with-message flow
  // can reuse the same `state: { message }` convention. Read once into local state rather than
  // straight from `location.state` so it doesn't reappear if the user navigates away and back
  // with the same location (React Router keeps state on back/forward navigation).
  const [notice] = useState(location.state?.message || '')

  const handleLogin = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const account = await login(email, password)
      setError('')
      navigate(location.state?.from || roleHome(account.role), { replace: true })
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setSubmitting(false)
    }
  }

  // GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix kro") — replaces the
  // old stub that only ever showed "Google sign-in is unavailable in this browser-only
  // workspace." One backend call (POST /auth/google) covers login, first-time account-linking,
  // and self-registration together, so this same handler is reused as-is on the Register page
  // below.
  const handleGoogleSignIn = async () => {
    setGoogleSubmitting(true)
    try {
      const idToken = await signInWithGoogle()
      const account = await loginWithGoogle(idToken)
      setError('')
      navigate(location.state?.from || roleHome(account.role), { replace: true })
    } catch (googleError) {
      setError(googleError.message)
    } finally {
      setGoogleSubmitting(false)
    }
  }

  const { dark, toggle } = useTheme()

  return (
    <main className="auth-page">
      <Link to="/" className="back-home back-home-mobile">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg> Back to home
      </Link>
      <section className="auth-brand-panel">
        <Link to="/" className="back-home">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg> Back to home
        </Link>
        <div>
          <Link to="/" className="brand brand-light">
            {/* BUG FIX ("galat logo use kiye ho"): real app logo, not the generic Lucide
                heart-pulse stock icon this used to be. */}
            <span className="brand-mark">
              <img src={brandLogoUrl} alt="BookMyDoctor24" className="h-full w-full rounded-[13px] object-cover" />
            </span>
            <span><strong>BookMyDoctor24</strong></span>
          </Link>
          <h1>Healthcare that moves with you.</h1>
          <p>Book care, follow your queue, and keep your family health records together.</p>
          <div className="auth-benefits">
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-shield-check"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg> Verified doctor network</span>
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar-check2"><path d="M 19 3 L 5 3"></path><path d="M 21 13 L 21 5"></path><path d="M 21 5 A2 2 0 0 0 19 3"></path><path d="M 3 19 A2 2 0 0 0 5 21"></path><path d="M 3 5 L 3 19"></path><path d="M 5 3 A2 2 0 0 0 3 5"></path><path d="m16 19 2 2 4-4"></path><path d="M16 2v3"></path><path d="M3 9h18"></path><path d="M5 21 L12.5 21"></path><path d="M8 2v3"></path></svg> Instant clinic bookings</span>
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-timer-reset"><path d="M10 2h4"></path><path d="M12 14v-4"></path><path d="M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6"></path><path d="M9 17H4v5"></path></svg> Live queue visibility</span>
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg> Secure role-based access</span>
          </div>
        </div>
        <small>BookMyDoctor24 · India</small>
      </section>

      <section className="auth-form-panel">
        <div className="auth-theme-toggle">
          <button type="button" className="theme-toggle" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle}>
            {dark ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-sun"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-moon"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"></path></svg>
            )}
            <span>{dark ? 'Light' : 'Dark'}</span>
          </button>
        </div>
        <div className="auth-box">
          <h2>Welcome back</h2>
          <p>Sign in to manage appointments, queues, and health records.</p>
          <form onSubmit={handleLogin}>
            <button type="button" onClick={handleGoogleSignIn} disabled={googleSubmitting} className="google-auth-button">
              <span className="google-g" aria-hidden="true">G</span>{googleSubmitting ? 'Signing in…' : 'Continue with Google'}
            </button>
            <div className="oauth-divider"><span>or continue with email</span></div>

            {notice && !error && <p role="status" className="form-message success">{notice}</p>}
            {error && <p role="alert" className="form-message error">{error}</p>}

            <label className="form-field">Email address
              <input type="email" autoComplete="email" required placeholder="you@example.com" name="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>

            <label className="form-field">Password
              <input type="password" autoComplete="current-password" required placeholder="Enter your password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>

            <div className="form-help">
              <label className="checkbox-row"><input type="checkbox" name="remember" defaultChecked /> Remember me</label>
              <Link to="/forgot-password">Forgot password?</Link>
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-right"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button>
            
            <div className="auth-switch">New to BookMyDoctor24? <Link to="/register">Create an account</Link></div>

          </form>
        </div>
      </section>
    </main>
  )
}

export function Register() {
  // 'patient' registers via POST /auth/register (instant, active account). 'doctor' registers
  // via POST /doctors/register (also instant login, but lands in doctorProfile.status:'pending'
  // — invisible to patient search/booking until an admin verifies them from the admin Doctors
  // panel, same queue an admin-created doctor account lands in).
  const [accountType, setAccountType] = useState('patient')
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', confirm: '' })
  const [doctorForm, setDoctorForm] = useState({ specializationId: '', qualification: '', registrationNumber: '', experienceYears: '', consultationFee: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // GOOGLE SIGN-IN FEATURE — separate loading flag, same reasoning as Login above.
  const [googleSubmitting, setGoogleSubmitting] = useState(false)
  const navigate = useNavigate()
  const register = useAppStore((state) => state.register)
  const registerDoctor = useAppStore((state) => state.registerDoctor)
  const loginWithGoogle = useAppStore((state) => state.loginWithGoogle)
  const specializations = useAppStore((state) => state.data.specializations)
  const fetchSpecializations = useAppStore((state) => state.fetchSpecializations)
  useEffect(() => {
    if (accountType === 'doctor' && !specializations.length) fetchSpecializations().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountType])
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const updateDoctor = (key) => (event) => setDoctorForm((current) => ({ ...current, [key]: event.target.value }))
  const handleSubmit = async (event) => {
    event.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
    setSubmitting(true)
    try {
      const account = accountType === 'doctor'
        ? await registerDoctor({
            name: form.name,
            phone: form.phone,
            email: form.email,
            password: form.password,
            specializationId: doctorForm.specializationId,
            qualification: doctorForm.qualification || undefined,
            registrationNumber: doctorForm.registrationNumber || undefined,
            experienceYears: doctorForm.experienceYears ? Number(doctorForm.experienceYears) : undefined,
            consultationFee: Number(doctorForm.consultationFee) || 0,
          })
        : await register({ name: form.name, phone: form.phone, email: form.email, password: form.password })
      setError('')
      navigate(roleHome(account.role), { replace: true })
    } catch (registrationError) {
      setMessage('')
      setError(registrationError.message)
    } finally {
      setSubmitting(false)
    }
  }

  // GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix kro") — replaces the
  // old stub ("Google sign-up needs an OAuth provider..."). Note this always self-registers as a
  // `patient` regardless of the accountType tab the person has selected — same rule POST
  // /auth/register already enforces for the email/password form (a doctor account can only ever
  // be created via the dedicated "Submit for verification" doctor form below, never a generic
  // sign-up button).
  const handleGoogleSignIn = async () => {
    setGoogleSubmitting(true)
    try {
      const idToken = await signInWithGoogle()
      const account = await loginWithGoogle(idToken)
      setError('')
      setMessage('')
      navigate(roleHome(account.role), { replace: true })
    } catch (googleError) {
      setMessage('')
      setError(googleError.message)
    } finally {
      setGoogleSubmitting(false)
    }
  }

  const { dark, toggle } = useTheme()

  return (
    <main className="auth-page">
      <Link to="/" className="back-home back-home-mobile">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg> Back to home
      </Link>
      <section className="auth-brand-panel">
        <Link to="/" className="back-home">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg> Back to home
        </Link>
        <div>
          <Link to="/" className="brand brand-light">
            {/* BUG FIX ("galat logo use kiye ho"): real app logo, not the generic Lucide
                heart-pulse stock icon this used to be. */}
            <span className="brand-mark">
              <img src={brandLogoUrl} alt="BookMyDoctor24" className="h-full w-full rounded-[13px] object-cover" />
            </span>
            <span><strong>BookMyDoctor24</strong></span>
          </Link>
          <h1>Healthcare that moves with you.</h1>
          <p>Book care, follow your queue, and keep your family health records together.</p>
          <div className="auth-benefits">
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-shield-check"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg> Verified doctor network</span>
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar-check2"><path d="M 19 3 L 5 3"></path><path d="M 21 13 L 21 5"></path><path d="M 21 5 A2 2 0 0 0 19 3"></path><path d="M 3 19 A2 2 0 0 0 5 21"></path><path d="M 3 5 L 3 19"></path><path d="M 5 3 A2 2 0 0 0 3 5"></path><path d="m16 19 2 2 4-4"></path><path d="M16 2v3"></path><path d="M3 9h18"></path><path d="M5 21 L12.5 21"></path><path d="M8 2v3"></path></svg> Instant clinic bookings</span>
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-timer-reset"><path d="M10 2h4"></path><path d="M12 14v-4"></path><path d="M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6"></path><path d="M9 17H4v5"></path></svg> Live queue visibility</span>
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg> Secure role-based access</span>
          </div>
        </div>
        <small>BookMyDoctor24 · India</small>
      </section>

      <section className="auth-form-panel">
        <div className="auth-theme-toggle">
          <button type="button" className="theme-toggle" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle}>
            {dark ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-sun"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-moon"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"></path></svg>
            )}
            <span>{dark ? 'Light' : 'Dark'}</span>
          </button>
        </div>
        <div className="auth-box">
          <h2>Create your account</h2>
          <p>Join as a patient or healthcare professional.</p>

          <div className="mt-3 grid grid-cols-2 gap-2" role="tablist" aria-label="Account type">
            <button type="button" role="tab" aria-selected={accountType === 'patient'} onClick={() => setAccountType('patient')} className={`touch-target rounded-button border px-3 py-2 text-sm font-semibold ${accountType === 'patient' ? 'border-primary-dark bg-primary-light text-primary-dark' : 'border-border bg-white text-muted'}`}>I'm a patient</button>
            <button type="button" role="tab" aria-selected={accountType === 'doctor'} onClick={() => setAccountType('doctor')} className={`touch-target rounded-button border px-3 py-2 text-sm font-semibold ${accountType === 'doctor' ? 'border-primary-dark bg-primary-light text-primary-dark' : 'border-border bg-white text-muted'}`}>I'm a doctor</button>
          </div>

          <button type="button" className="google-auth-button mt-3" onClick={handleGoogleSignIn} disabled={googleSubmitting}>
            <span className="google-g" aria-hidden="true">G</span>{googleSubmitting ? 'Signing in…' : 'Continue with Google'}
          </button>
          <p className="mt-2 text-center text-xs text-muted">
            {accountType === 'doctor'
              ? 'Your account will be reviewed by an admin before you appear in patient search — you can sign in right away to check your status.'
              : 'Registration creates a patient account, active immediately.'}
          </p>

          <div className="oauth-divider"><span>or continue with email</span></div>

          {error && <p role="alert" className="form-message error">{error}</p>}
          {message && <p role="status" className="mt-2 text-center text-xs text-success">{message}</p>}

          <form className="space-y-3" onSubmit={handleSubmit}>
            <label className="form-field">Full name<input type="text" value={form.name} onChange={update('name')} placeholder="Enter your full name" required /></label>
            <label className="form-field">Phone<input type="tel" value={form.phone} onChange={update('phone')} placeholder="Enter mobile number" required /></label>
            <label className="form-field">Email address<input type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" required /></label>
            <label className="form-field">Password<input type="password" value={form.password} onChange={update('password')} placeholder="Create password" minLength="8" required /></label>
            <label className="form-field">Confirm password<input type="password" value={form.confirm} onChange={update('confirm')} placeholder="Confirm password" minLength="8" required /></label>

            {accountType === 'doctor' && (
              <>
                <label className="form-field">Specialization
                  <select value={doctorForm.specializationId} onChange={updateDoctor('specializationId')} required>
                    <option value="">Select specialization</option>
                    {specializations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="form-field">Qualification<input type="text" value={doctorForm.qualification} onChange={updateDoctor('qualification')} placeholder="e.g. MBBS, MD" /></label>
                <label className="form-field">Registration number<input type="text" value={doctorForm.registrationNumber} onChange={updateDoctor('registrationNumber')} placeholder="Medical council registration no." /></label>
                <label className="form-field">Years of experience<input type="number" min="0" max="80" value={doctorForm.experienceYears} onChange={updateDoctor('experienceYears')} placeholder="e.g. 5" /></label>
                <label className="form-field">Consultation fee (₹)<input type="number" min="0" value={doctorForm.consultationFee} onChange={updateDoctor('consultationFee')} placeholder="e.g. 500" required /></label>
              </>
            )}

            <button type="submit" className="btn btn-primary w-full mt-4" disabled={submitting}>{submitting ? 'Creating account…' : accountType === 'doctor' ? 'Submit for verification' : 'Create account'}</button>
          </form>

          <div className="auth-switch">Already registered? <Link to="/login">Sign in</Link></div>
        </div>
      </section>
    </main>
  )
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const forgotPassword = useAppStore((state) => state.forgotPassword)
  // POST /auth/forgot-password ALWAYS responds 200 with the same generic message whether or
  // not `email` belongs to a real account (server-side enumeration avoidance — see
  // auth.service.js#forgotPassword) — so `sent` flips on any successful response, never on a
  // per-account "found"/"not found" branch, which the server deliberately never reports.
  const submit = async (event) => {
    event.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    try {
      await forgotPassword(email.trim())
      setError('')
      setSent(true)
    } catch (submitError) {
      // A genuine failure (network/server error, rate-limited, etc.) — distinct from "no such
      // account", which never reaches here because the server doesn't distinguish it either.
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }
  return <main className="auth-page"><section className="auth-brand-panel"><Link to="/" className="back-home">← Back to home</Link><div><Link to="/" className="brand brand-light"><span className="brand-mark"><img src={brandLogoUrl} alt="BookMyDoctor24" className="h-full w-full rounded-[13px] object-cover" /></span><span><strong>BookMyDoctor24</strong></span></Link><h1>Healthcare that moves with you.</h1><p>Reset access to your account securely.</p></div><small>BookMyDoctor24 · India</small></section><section className="auth-form-panel"><div className="auth-box"><h2>Reset your password</h2><p>We will email you a secure link to choose a new password.</p>{sent ? <div className="mt-6 rounded-button border border-success/30 bg-success/10 p-4 text-sm text-success">If an account exists for <strong>{email}</strong>, reset instructions have been sent. Check your inbox (and the server logs, in this local/dev environment) for the reset link.</div> : <form className="mt-6 space-y-4" onSubmit={submit}>{error && <p role="alert" className="form-message error">{error}</p>}<label className="form-field">Account email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label><button className="btn btn-primary w-full" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send reset link'}</button></form>}<div className="auth-switch"><Link to="/login">Return to sign in</Link></div></div></section></main>
}

export function ResetPassword() {
  const [searchParams] = useSearchParams()
  // The link auth.service.js#forgotPassword builds is `${clientOrigin}/reset-password?token=…`
  // — read that same `token` query param here. An empty token is caught at submit time (below)
  // rather than blocking the whole page, so a mistyped/truncated URL still shows the form and a
  // clear inline error instead of a blank page.
  const token = searchParams.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const resetPassword = useAppStore((state) => state.resetPassword)

  const submit = async (event) => {
    event.preventDefault()
    if (!token) { setError('This reset link is missing its token. Request a new one from the forgot password page.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSubmitting(true)
    try {
      await resetPassword(token, password)
      // Success is shown on /login itself (via router state) rather than here — this page's
      // job ends the moment the password is actually changed server-side, and the token is
      // single-use/short-lived anyway so there's nothing useful left to do on this page.
      navigate('/login', { replace: true, state: { message: 'Your password has been reset. Please sign in with your new password.' } })
    } catch (submitError) {
      // Covers an invalid/expired/already-used token (server responds 400 INVALID_RESET_TOKEN
      // for all of those, deliberately without distinguishing which — see tokenService.js).
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="auth-page"><section className="auth-brand-panel"><Link to="/" className="back-home">← Back to home</Link><div><Link to="/" className="brand brand-light"><span className="brand-mark"><img src={brandLogoUrl} alt="BookMyDoctor24" className="h-full w-full rounded-[13px] object-cover" /></span><span><strong>BookMyDoctor24</strong></span></Link><h1>Healthcare that moves with you.</h1><p>Choose a new password to get back into your account.</p></div><small>BookMyDoctor24 · India</small></section><section className="auth-form-panel"><div className="auth-box"><h2>Choose a new password</h2><p>This link is valid for a limited time. If it has expired, request a new one from the forgot password page.</p>{error && <p role="alert" className="form-message error">{error}</p>}<form className="mt-6 space-y-4" onSubmit={submit}><label className="form-field">New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter new password" minLength="8" required /></label><label className="form-field">Confirm new password<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Confirm new password" minLength="8" required /></label><button className="btn btn-primary w-full" type="submit" disabled={submitting}>{submitting ? 'Resetting…' : 'Reset password'}</button></form><div className="auth-switch"><Link to="/login">Return to sign in</Link></div></div></section></main>
}
