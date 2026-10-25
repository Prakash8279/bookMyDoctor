import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { SiteHeader } from './PublicPages'
import { useAppStore } from '../store/useAppStore'

/* oxlint-disable react/jsx-key -- each static icon is selected individually inside a keyed card */
const SPECIALTY_ICONS = [
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-stethoscope"><path d="M11 2v2"></path><path d="M5 2v2"></path><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"></path><path d="M8 15a6 6 0 0 0 12 0v-3"></path><circle cx="20" cy="10" r="2"></circle></svg>,
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-heart"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"></path></svg>,
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-baby"><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"></path><path d="M15 12h.01"></path><path d="M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"></path><path d="M9 12h.01"></path></svg>,
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-sparkles"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"></path><path d="M20 2v4"></path><path d="M22 4h-4"></path><circle cx="4" cy="20" r="2"></circle></svg>,
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-bone"><path d="M17 10c.7-.7 1.69 0 2.5 0a2.5 2.5 0 1 0 0-5 .5.5 0 0 1-.5-.5 2.5 2.5 0 1 0-5 0c0 .81.7 1.8 0 2.5l-7 7c-.7.7-1.69 0-2.5 0a2.5 2.5 0 0 0 0 5c.28 0 .5.22.5.5a2.5 2.5 0 1 0 5 0c0-.81-.7-1.8 0-2.5Z"></path></svg>,
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-activity"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"></path></svg>,
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-brain"><path d="M12 18V5"></path><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"></path><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"></path><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"></path><path d="M18 18a4 4 0 0 0 2-7.464"></path><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"></path><path d="M6 18a4 4 0 0 1-2-7.464"></path><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"></path></svg>,
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-face-slightly-smiling"><path d="M15 10V9"></path><path d="M16.472 15a6 6 0 01-8.943 0"></path><path d="M9 10V9"></path><circle cx="12" cy="12" r="10"></circle></svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 9a5 5 0 0 1 10 0c0 4-4 5-4 8a2 2 0 0 1-4 0"/><path d="M6 12a6 6 0 0 0 3 5"/></svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3C4.5 3 3 5 3 8c0 4 2 6 3 10 .5 2 1.1 3 2.2 3 1.8 0 1.8-5 3.8-5s2 5 3.8 5c1.1 0 1.7-1 2.2-3 1-4 3-6 3-10 0-3-1.5-5-4-5-2 0-3 1-5 1S9 3 7 3Z"/></svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3v8l-4 4v6m10-18v8l4 4v6M9 11l3 3 3-3"/><path d="M5 21h4m6 0h4"/></svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M12 15v7m-4-3h8"/></svg>,
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3C5 3 3 7 3 12s2 9 6 9c3 0 5-2 5-5 0-2-1-3-3-4-2-1-2-3-1-4 1-2 2-3 0-5Zm4 0c5 0 7 4 7 9s-2 9-6 9c-3 0-5-2-5-5"/></svg>,
]
/* oxlint-enable react/jsx-key */

// Use a specialty's meaning, never its position in the alphabetically sorted API list.
const SPECIALTY_ICON_BY_NAME = {
  'General Physician': 0, Cardiologist: 1, Dermatologist: 3,
  Pediatrician: 2, Gynecologist: 12, 'Orthopedic Surgeon': 4,
  Neurologist: 6, Psychiatrist: 6, 'ENT Specialist': 9,
  Ophthalmologist: 8, Dentist: 10, Gastroenterologist: 5,
  Pulmonologist: 11, Nephrologist: 13, Urologist: 13,
  Endocrinologist: 5, Oncologist: 5, Rheumatologist: 4,
  'General Surgeon': 0, Diabetologist: 5,
}

function PatientStories({ reviews }) {
  // Admins can receive pending/rejected rows in the shared store. Never expose
  // those rows (or the old sample quote) on the public homepage.
  const approvedReviews = reviews.filter((review) =>
    review.status === 'approved' && typeof review.text === 'string' && review.text.trim()
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const reviewIds = approvedReviews.map((review) => review.id).join(',')

  useEffect(() => setActiveIndex(0), [reviewIds])

  useEffect(() => {
    if (approvedReviews.length < 2 || paused || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return undefined
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % approvedReviews.length), 5000)
    return () => window.clearInterval(timer)
  }, [approvedReviews.length, paused])

  if (!approvedReviews.length) return null

  const showPrevious = () => setActiveIndex((index) => (index - 1 + approvedReviews.length) % approvedReviews.length)
  const showNext = () => setActiveIndex((index) => (index + 1) % approvedReviews.length)

  return <section className="section testimonials">
    <div className="container">
      <div className="section-heading centered">
        <span className="kicker">Patient stories</span>
        <h2>Less waiting. Better care.</h2>
      </div>
      <div
        className="testimonial-carousel"
        role="region"
        aria-roledescription="carousel"
        aria-label="Approved patient reviews"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}
      >
        <div className="testimonial-viewport">
          <div className="testimonial-track" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
            {approvedReviews.map((review, index) => {
              const parts = (review.patient?.name || '').trim().split(/\s+/).filter(Boolean)
              const displayName = parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : parts[0] || 'Verified patient'
              const initials = parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || 'VP'
              const rating = Math.max(1, Math.min(5, Number(review.rating) || 1))
              return <blockquote key={review.id} className="testimonial-slide" aria-hidden={index !== activeIndex}>
                <div className="quote-stars" aria-label={`${rating} out of 5 stars`}>
                  <span aria-hidden="true">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
                </div>
                <p>“{review.text.trim()}”</p>
                <footer>
                  <span className="avatar avatar-sm" aria-hidden="true">{initials.toUpperCase()}</span>
                  <div><strong>{displayName}</strong><small>Verified appointment</small></div>
                </footer>
              </blockquote>
            })}
          </div>
        </div>
        {approvedReviews.length > 1 && <div className="testimonial-controls">
          <button type="button" className="testimonial-arrow" onClick={showPrevious} aria-label="Previous review">←</button>
          <span aria-live="off">{activeIndex + 1} / {approvedReviews.length}</span>
          <button type="button" className="testimonial-arrow" onClick={showNext} aria-label="Next review">→</button>
        </div>}
      </div>
    </div>
  </section>
}

export function PatientLanding() {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)
  const publicStats = data.publicStats
  const [term, setTerm] = useState('')
  const [city, setCity] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [clinic, setClinic] = useState('')
  const [booking, setBooking] = useState('today')
  const [showAllSpecialties, setShowAllSpecialties] = useState(false)

  // Was `(data.doctors||[]).filter(...)` re-run per specialization, per render — O(specializations
  // × doctors), unmemoized, on the page most likely to re-render from unrelated store writes.
  // One pass over doctors builds the whole count map instead.
  const doctorCountBySpecialization = useMemo(() => {
    const counts = new Map()
    for (const doctor of data.doctors || []) {
      const name = doctor.specialization?.name
      if (!name) continue
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    return counts
  }, [data.doctors])
  const orderedSpecializations = useMemo(() => [...(data.specializations || [])].sort((a, b) =>
    (doctorCountBySpecialization.get(b.name) || 0) - (doctorCountBySpecialization.get(a.name) || 0)
      || a.name.localeCompare(b.name)
  ), [data.specializations, doctorCountBySpecialization])

  const handleSearch = (e) => {
    e.preventDefault()
    const params = new URLSearchParams()
    if (term) params.set('q', term)
    if (city) params.set('city', city)
    if (specialty) params.set('specialty', specialty)
    if (clinic) params.set('clinic', clinic)
    if (booking === 'today') params.set('today', 'true')
    navigate(`/search?${params.toString()}`)
  }

  return <><SiteHeader /><main className="public-landing">
    {/* Hero Section */}
    <section className="hero">
      <div className="hero-orb hero-orb-one"></div>
      <div className="hero-orb hero-orb-two"></div>
      <div className="container hero-grid">
        <div className="hero-copy">
          <h1><span>BookADoctors:</span> Care without the waiting room.</h1>
          <p className="hero-lead">Find verified doctors, reserve your clinic slot, and follow your live queue token from home.</p>

          <form className="hero-search" onSubmit={handleSearch}>
            <label>
              <span>
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-map-pin"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg> City
              </span>
              <select name="city" value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="">All cities</option>
                {(data.cities || []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </label>

            <label>
              <span>
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-stethoscope"><path d="M11 2v2"></path><path d="M5 2v2"></path><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"></path><path d="M8 15a6 6 0 0 0 12 0v-3"></path><circle cx="20" cy="10" r="2"></circle></svg> Specialization
              </span>
              <select name="specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
                <option value="">All specializations</option>
                {(data.specializations || []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </label>

            <label>
              <span>
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12h4"></path><path d="M10 8h4"></path><path d="M14 21v-3a2 2 0 0 0-4 0v3"></path><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"></path><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"></path></svg> Clinic
              </span>
              <select name="clinic" value={clinic} onChange={(e) => setClinic(e.target.value)}>
                <option value="">All clinics</option>
                {(data.clinics || []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </label>

            <label className="search-keyword">
              <span>
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search"><path d="m21 21-4.34-4.34"></path><circle cx="11" cy="11" r="8"></circle></svg> Doctor or symptom
              </span>
              <input placeholder="e.g. fever, Dr. Sharma" name="q" value={term} onChange={(e) => setTerm(e.target.value)} />
            </label>

            <label>
              <span>
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path></svg> Booking
              </span>
              <select name="booking" value={booking} onChange={(e) => setBooking(e.target.value)}>
                <option value="today">Today booking</option>
                <option value="any">Any available date</option>
              </select>
            </label>

            <button className="btn btn-primary btn-search" type="submit">
              <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search"><path d="m21 21-4.34-4.34"></path><circle cx="11" cy="11" r="8"></circle></svg> Search
            </button>
          </form>

          <div className="trust-row">
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg> Verified clinicians</span>
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg> Transparent fees</span>
            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg> Live queue updates</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="Live appointment preview">
          <div className="hero-card hero-card-main">
              <div className="hero-card-head"><span className="live-dot"></span> Clinic queue<small>Browser saved</small></div>
            <div className="queue-empty">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-timer-reset"><path d="M10 2h4"></path><path d="M12 14v-4"></path><path d="M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6"></path><path d="M9 17H4v5"></path></svg>
              <strong>No active queue right now</strong>
               <small>New clinic tokens appear here after you book or check in.</small>
            </div>
          </div>

          <div className="hero-card floating-card floating-doctor">
            <div className="avatar">{(data.doctors || []).length || '+'}</div>
            <div>
              <strong>{(data.doctors || []).length ? `${(data.doctors || []).length} doctor profile${(data.doctors || []).length === 1 ? '' : 's'}` : 'No doctor profiles yet'}</strong>
              <small>{(data.doctors || []).length ? 'Added profiles appear in search' : 'Add a doctor profile to continue'}</small>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>
          </div>

          <div className="hero-card floating-card floating-alert">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-bell-ring"><path d="M10.268 21a2 2 0 0 0 3.464 0"></path><path d="M22 8c0-2.3-.8-4.3-2-6"></path><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path><path d="M4 2C2.8 3.7 2 5.7 2 8"></path></svg>
            <div><strong>Queue standing by</strong><small>No fabricated token data</small></div>
          </div>
        </div>
      </div>
    </section>

    {/* Stats Strip */}
    <section className="stats-strip">
      <div className="container stats-grid">
        <div><strong>{publicStats?.verifiedDoctors ?? '—'}</strong><span>Verified doctors</span></div>
        <div><strong>{publicStats?.partnerClinics ?? '—'}</strong><span>Partner clinics</span></div>
        <div><strong>{publicStats?.appointmentsManaged ?? '—'}</strong><span>Appointments managed</span></div>
        <div><strong>{publicStats?.patientRating == null ? '—' : Number(publicStats.patientRating).toFixed(1)}</strong><span>Patient rating</span></div>
      </div>
    </section>

    {/* Specializations Section */}
    <section className="section" id="specializations">
      <div className="container">
        <div className="section-heading split-heading">
          <div>
            <span className="kicker">Find the right care</span>
            <h2>Browse by specialization</h2>
            <p>Experienced doctors across the most requested areas of care.</p>
          </div>
          <Link to="/search" className="text-link">View all doctors <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-right"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></Link>
        </div>

        <div className={`specialty-grid${showAllSpecialties ? ' is-expanded' : ''}${orderedSpecializations.length > 8 ? ' has-more' : ''}`}>
          {(showAllSpecialties ? orderedSpecializations : orderedSpecializations.slice(0, 8)).map((specialization) => {
            const count = doctorCountBySpecialization.get(specialization.name) || 0
            return <Link key={specialization.id} to={`/search?specialization=${encodeURIComponent(specialization.name)}`} className="specialty-card">
              <span className="specialty-icon">
                {SPECIALTY_ICONS[SPECIALTY_ICON_BY_NAME[specialization.name] ?? 0]}
              </span>
              <strong>{specialization.name}</strong>
              <small>{count} {count === 1 ? 'doctor' : 'doctors'}</small>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-right specialty-arrow"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
            </Link>
          })}
        </div>
        {(data.specializations || []).length > 8 && <button type="button" className="specialty-show-all" onClick={() => setShowAllSpecialties((value) => !value)} aria-expanded={showAllSpecialties}>
          {showAllSpecialties ? 'Show fewer specialties' : `Show all ${data.specializations.length} specialties`}
        </button>}
      </div>
    </section>

    {/* Doctors Section */}
    <section className="section section-soft">
      <div className="container">
        <div className="section-heading split-heading">
          <div>
            <span className="kicker">Top-rated care</span>
            <h2>Doctors patients trust</h2>
            <p>Verified profiles, clear fees, and real availability.</p>
          </div>
          <Link to="/search" className="text-link">See all <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-right"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></Link>
        </div>

        <div className="doctor-grid">
          {(data.doctors || []).length ? (data.doctors || []).map((doctor) => <article className="doctor-card" key={doctor.id}>
            <div className="doctor-card-top">
              <div className="avatar avatar-lg">{doctor.name.split(' ').filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase() || 'DR'}</div>
              <div className="doctor-main">
                <div className="verified-line">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-shield-check"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg> Verified doctor
                </div>
                <h3>{doctor.name}</h3>
                <p>{doctor.specialization?.name || 'Specialization not added'} · {doctor.experienceYears || 0} years</p>
              </div>
              <div className="rating-pill">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"></path></svg> {doctor.rating || 0}
              </div>
            </div>

            <div className="doctor-meta">
              <span>{doctor.clinics?.[0]?.name || 'Clinic not added'} · {doctor.clinics?.[0]?.city || doctor.city || 'City not added'}</span>
              {/* `doctor.timings` never existed in the API response — this always showed
                  "Schedule not added" regardless of what a doctor actually configured.
                  `scheduleSummary` is the real one-line OPD-hours summary, now returned by
                  doctors.service.js#buildSchedule. */}
              <span>{doctor.scheduleSummary || 'Schedule not added'}</span>
            </div>

            <div className="doctor-card-footer">
              <div><small>Consultation</small><strong>₹{doctor.consultationFee || 0}</strong></div>
              <div className="card-actions">
                <Link to={`/doctors/${doctor.id}`} className="btn btn-ghost">View profile</Link>
                <Link to={`/patient/book?doctorId=${doctor.id}`} className="btn btn-primary">Book now</Link>
              </div>
            </div>
          </article>) : <div className="rounded-card border border-border bg-white p-8 text-center"><h3>No doctor profiles added yet</h3><p className="mt-2 text-sm text-muted">Doctor profiles added in this browser will appear here.</p><Link to="/register?role=doctor" className="btn btn-primary mt-5">Add a doctor</Link></div>}
        </div>
      </div>
    </section>

    {/* Three Simple Steps Section */}
    <section className="section" id="how-it-works">
      <div className="container">
        <div className="section-heading centered">
          <span className="kicker">Three simple steps</span>
          <h2>From search to consultation</h2>
          <p>Everything you need to visit a doctor, without wasting hours at the clinic.</p>
        </div>

        <div className="steps-grid">
          <div className="step-card">
            <span>01</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search"><path d="m21 21-4.34-4.34"></path><circle cx="11" cy="11" r="8"></circle></svg>
            <h3>Discover</h3>
            <p>Compare verified doctors by location, specialty, experience, fee, and availability.</p>
          </div>

          <div className="step-card">
            <span>02</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar-check2"><path d="M 19 3 L 5 3"></path><path d="M 21 13 L 21 5"></path><path d="M 21 5 A2 2 0 0 0 19 3"></path><path d="M 3 19 A2 2 0 0 0 5 21"></path><path d="M 3 5 L 3 19"></path><path d="M 5 3 A2 2 0 0 0 3 5"></path><path d="m16 19 2 2 4-4"></path><path d="M16 2v3"></path><path d="M3 9h18"></path><path d="M5 21 L12.5 21"></path><path d="M8 2v3"></path></svg>
            <h3>Book instantly</h3>
            <p>Choose a clinic slot for yourself or a family member and receive your queue token.</p>
          </div>

          <div className="step-card">
            <span>03</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-timer-reset"><path d="M10 2h4"></path><path d="M12 14v-4"></path><path d="M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6"></path><path d="M9 17H4v5"></path></svg>
            <h3>Follow live</h3>
            <p>Watch the queue move from home and arrive just before your consultation.</p>
          </div>
        </div>
      </div>
    </section>

    {/* Queue Feature Section */}
    <section className="section queue-feature">
      <div className="container queue-feature-grid">
        <div>
          <span className="kicker kicker-light">Built around your time</span>
          <h2>The waiting room, redesigned.</h2>
          <p>Patients get timely alerts while doctors and reception teams manage one synchronized clinic queue.</p>
          
          <ul className="feature-list">
            <li><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg> Token position and estimated waiting time</li>
            <li><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg> Delay broadcasts and turn reminders</li>
            <li><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-check"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg> Walk-in and online bookings in one queue</li>
          </ul>
          
          <Link to="/register" className="btn btn-light">Create free account <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-right"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></Link>
        </div>

        <div className="queue-panel">
          <div className="queue-panel-head">
            <div><span className="live-dot"></span> Clinic queue</div>
            <small>No active OPD</small>
          </div>
          <div className="queue-empty queue-empty-panel">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-timer-reset"><path d="M10 2h4"></path><path d="M12 14v-4"></path><path d="M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6"></path><path d="M9 17H4v5"></path></svg>
            <strong>No queued patients</strong>
             <small>This panel updates whenever a token changes in this browser.</small>
          </div>
        </div>
      </div>
    </section>

    <PatientStories reviews={data.reviews || []} />

    {/* Doctor CTA Section */}
    <section className="section doctor-cta">
      <div className="container doctor-cta-card">
        <div className="cta-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-users-round"><path d="M18 21a8 8 0 0 0-16 0"></path><circle cx="10" cy="8" r="5"></circle><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"></path></svg>
        </div>
        <div>
          <span className="kicker">For healthcare professionals</span>
          <h2>Run a calmer, smarter clinic.</h2>
          <p>Appointments, live queue, payments, and patient history in one workspace.</p>
        </div>
        <Link to="/register?role=doctor" className="btn btn-primary">Join as a doctor <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-right"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></Link>
      </div>
    </section>

    {/* Frequently Asked Questions (FAQ SEO Section) */}
    <section className="section faq-section py-16 bg-surface/60">
      <div className="container max-w-4xl mx-auto px-4">
        <div className="section-heading centered text-center mb-10">
          <span className="kicker">Questions &amp; Answers</span>
          <h2 className="text-3xl font-bold mt-2">Frequently Asked Questions about BookADoctors</h2>
          <p className="text-muted mt-2">Everything you need to know about booking verified doctors and tracking live OPD clinic queues.</p>
        </div>
        <div className="space-y-4">
          <details className="rounded-xl border border-border bg-white p-5 shadow-sm cursor-pointer group" open>
            <summary className="font-semibold text-lg text-charcoal list-none flex justify-between items-center">
              <span>What is BookADoctors?</span>
              <span className="text-primary font-bold group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p className="mt-3 text-muted text-sm leading-relaxed">
              BookADoctors (bookadoctors) is an online healthcare appointment platform that connects patients with verified doctors across multiple specialties. You can easily book OPD appointments, consult specialists, and track live clinic queues directly from your home.
            </p>
          </details>

          <details className="rounded-xl border border-border bg-white p-5 shadow-sm cursor-pointer group">
            <summary className="font-semibold text-lg text-charcoal list-none flex justify-between items-center">
              <span>Who founded BookADoctors?</span>
              <span className="text-primary font-bold group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p className="mt-3 text-muted text-sm leading-relaxed">
              <a href="/founder/prakash-kumar/" className="font-semibold text-primary-dark underline">Prakash Kumar</a> is the founder of BookADoctors. Read his official founder profile to learn about the platform.
            </p>
          </details>

          <details className="rounded-xl border border-border bg-white p-5 shadow-sm cursor-pointer group">
            <summary className="font-semibold text-lg text-charcoal list-none flex justify-between items-center">
              <span>How do I book a doctor appointment on BookADoctors?</span>
              <span className="text-primary font-bold group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p className="mt-3 text-muted text-sm leading-relaxed">
              Simply search by your city, doctor specialization, or clinic name on the BookADoctors homepage. Select a convenient date and time slot, enter patient details, and confirm your booking instantly.
            </p>
          </details>

          <details className="rounded-xl border border-border bg-white p-5 shadow-sm cursor-pointer group">
            <summary className="font-semibold text-lg text-charcoal list-none flex justify-between items-center">
              <span>How does the Live Clinic Queue Tracker work?</span>
              <span className="text-primary font-bold group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p className="mt-3 text-muted text-sm leading-relaxed">
              Once your appointment is confirmed, you receive a digital token. Our Live Queue system updates in real-time as the doctor sees each patient, allowing you to see current token numbers and arrive at the clinic right when your turn approaches.
            </p>
          </details>

          <details className="rounded-xl border border-border bg-white p-5 shadow-sm cursor-pointer group">
            <summary className="font-semibold text-lg text-charcoal list-none flex justify-between items-center">
              <span>Are all doctors and clinics verified?</span>
              <span className="text-primary font-bold group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p className="mt-3 text-muted text-sm leading-relaxed">
              Yes, all doctors, clinics, and medical practitioners listed on BookADoctors undergo verification of credentials, qualifications, and clinic registration before being published.
            </p>
          </details>

          <details className="rounded-xl border border-border bg-white p-5 shadow-sm cursor-pointer group">
            <summary className="font-semibold text-lg text-charcoal list-none flex justify-between items-center">
              <span>Can I find BookADoctors using its earlier or commonly searched names?</span>
              <span className="text-primary font-bold group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p className="mt-3 text-muted text-sm leading-relaxed">
              Yes. Searches for <strong>BookADoctor</strong>, <strong>BookMyDoctors</strong>, <strong>BookMyDoctor</strong>, <strong>BookMyDoc</strong>, <strong>BookMyDocr</strong>, <strong>bookmydocr</strong>, or <strong>bookmydocrs</strong> can refer to the BookADoctors healthcare appointment platform. The official website is <a href="https://bookadoctors.com" className="text-primary-dark font-medium underline">bookadoctors.com</a>.
            </p>
          </details>

          <details className="rounded-xl border border-border bg-white p-5 shadow-sm cursor-pointer group">
            <summary className="font-semibold text-lg text-charcoal list-none flex justify-between items-center">
              <span>Where can I find BookADoctors on Facebook &amp; Instagram?</span>
              <span className="text-primary font-bold group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p className="mt-3 text-muted text-sm leading-relaxed">
              Stay connected with us for doctor updates, health tips, and clinic schedules on our official social media channels:
              <br className="my-2" />
              • <strong>Facebook:</strong> <a href="https://www.facebook.com/BookADoctors" target="_blank" rel="me noopener noreferrer" className="text-primary-dark font-medium underline">BookADoctors on Facebook</a>
              <br />
              • <strong>Instagram:</strong> <a href="https://www.instagram.com/bookadoctors/" target="_blank" rel="me noopener noreferrer" className="text-primary-dark font-medium underline">@bookadoctors on Instagram</a>
              <br />
              • <strong>WhatsApp Support:</strong> <a href="https://wa.me/917323074966" target="_blank" rel="noopener noreferrer" className="text-primary-dark font-medium underline">+91 73230 74966</a>
            </p>
          </details>
        </div>
      </div>
    </section>
  </main></>
}



export function ProviderLanding() {
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submitContactRequest = useAppStore((state) => state.submitContactRequest)
  const submitDemo = async (event) => {
    event.preventDefault()
    const form = event.target
    const name = form.elements.name.value
    const email = form.elements.email.value
    const clinicName = form.elements.clinicName.value
    const phone = form.elements.phone.value
    const city = form.elements.city.value
    setSubmitting(true)
    setError('')
    try {
      await submitContactRequest({
        name,
        email,
        subject: 'Clinic demo request',
        message: `Clinic name: ${clinicName}\nPhone: ${phone}\nCity: ${city}`,
      })
      setSubmitted(true)
    } catch (submitError) {
      setError(submitError.message || 'Could not submit your demo request. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }
  return <><SiteHeader /><main>
    <section className="bg-charcoal px-4 py-14 text-white sm:py-20"><div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.1fr_.9fr] lg:items-center"><div><Badge tone="gold">For doctors & clinics</Badge><h1 className="mt-5 max-w-3xl text-4xl leading-tight text-white sm:text-6xl">A calmer clinic, from arrival to consultation.</h1><p className="mt-5 max-w-xl text-base leading-7 text-white/75 sm:text-lg">Bring appointments, walk-ins, check-ins, live tokens, payments, staff, and daily reports into one simple clinic workflow.</p><div className="mt-7 flex flex-wrap gap-3"><Link className="btn-primary" to="/register">Register your clinic</Link><a className="touch-target inline-flex items-center justify-center rounded-button border border-white/30 px-4 text-sm font-semibold text-white" href="#clinic-demo">Request a demo</a></div></div><div className="rounded-card bg-white p-5 text-charcoal shadow-card"><p className="text-sm font-semibold text-teal-dark">Today’s clinic flow</p><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-button bg-primary-light p-4"><p className="text-xs text-muted">Now serving</p><p className="mt-1 font-sans text-4xl text-primary-dark">15</p></div><div className="rounded-button bg-surface p-4"><p className="text-xs text-muted">Waiting</p><p className="mt-1 font-sans text-4xl">8</p></div></div><div className="mt-4 space-y-3 text-sm"><p className="flex justify-between border-b border-border pb-3"><span>Walk-ins checked in</span><strong>12</strong></p><p className="flex justify-between border-b border-border pb-3"><span>Payments received</span><strong>₹8,400</strong></p><p className="flex justify-between"><span>Doctor status</span><strong className="text-success">On duty</strong></p></div></div></div></section>
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6"><div className="max-w-2xl"><p className="text-sm font-semibold text-teal-dark">One operating view</p><h2 className="mt-2 text-3xl">Tools your team can use from day one.</h2></div><div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Live queue control', 'Call next, skip, pause, and keep patient tokens current.'], ['Walk-ins and check-in', 'Register arrivals quickly from the reception desk.'], ['Payments and receipts', 'Support cash and UPI with clear daily collection visibility.'], ['Team and branch setup', 'Manage schedules, fees, staff access, and multiple clinics.']].map(([title, text], index) => <article key={title} className="rounded-card border border-border bg-white p-5 shadow-card"><p className="font-sans text-2xl text-primary-dark">0{index + 1}</p><h2 className="mt-4 text-xl">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{text}</p></article>)}</div></section>
    <section className="bg-primary-light/45 py-12"><div className="mx-auto max-w-7xl px-4 sm:px-6"><p className="text-sm font-semibold text-primary-dark">Simple onboarding</p><h2 className="mt-2 text-3xl">Go live in three clear steps.</h2><div className="mt-7 grid gap-4 md:grid-cols-3">{[['01', 'Create your clinic profile', 'Add clinic details, branches, working hours, and doctors.'], ['02', 'Configure daily operations', 'Set fees, payment methods, queue rules, and team access.'], ['03', 'Verify and welcome patients', 'Complete verification and start receiving bookings and walk-ins.']].map(([number, title, text]) => <article key={number} className="rounded-card bg-white p-5 shadow-card"><p className="font-sans text-4xl text-primary-dark">{number}</p><h2 className="mt-4 text-xl">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{text}</p></article>)}</div></div></section>
    <section id="clinic-demo" className="mx-auto grid max-w-5xl gap-6 px-4 py-12 sm:px-6 lg:grid-cols-[.85fr_1.15fr]"><div><p className="text-sm font-semibold text-teal-dark">Clinic demo</p><h2 className="mt-2 text-3xl">See BookADoctors in your clinic flow.</h2><p className="mt-3 text-sm leading-7 text-muted">Tell us about your practice and we’ll show how queues, staff, payments, and appointments can work together.</p></div><form onSubmit={submitDemo} className="rounded-card border border-border bg-white p-5 shadow-card">{error && <p role="alert" className="form-message error">{error}</p>}<div className="grid gap-3 sm:grid-cols-2"><input required name="name" className="min-h-11 rounded-button border border-border px-3 text-sm" placeholder="Your name" aria-label="Your name" /><input required type="email" name="email" className="min-h-11 rounded-button border border-border px-3 text-sm" placeholder="Email address" aria-label="Email address" /><input required name="clinicName" className="min-h-11 rounded-button border border-border px-3 text-sm" placeholder="Clinic name" aria-label="Clinic name" /><input required name="phone" className="min-h-11 rounded-button border border-border px-3 text-sm" placeholder="Phone number" aria-label="Phone number" /><input required name="city" className="min-h-11 rounded-button border border-border px-3 text-sm" placeholder="City" aria-label="City" /></div><button className="btn-primary mt-5" type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Request a demo'}</button>{submitted && <p role="status" className="mt-3 text-sm font-semibold text-success">Thanks—your demo request has been received.</p>}</form></section>
  </main></>
}
