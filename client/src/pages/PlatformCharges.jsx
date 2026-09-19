import { useEffect, useState } from 'react'
import { FormField } from '../components/FormField'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { useAppStore } from '../store/useAppStore'
import { formatMoney } from '../lib/format'

const Page = ({ title, subtitle, children }) => <section><div className="mb-5"><h1 className="text-2xl sm:text-3xl">{title}</h1><p className="mt-1 text-sm text-muted">{subtitle}</p></div>{children}</section>
// `role="alert"` red inline text matches the error-display idiom already
// used across AdminPages.jsx/PatientPages.jsx.
const ErrorNote = ({ children }) => children ? <p role="alert" className="mt-3 text-sm font-semibold text-error">{children}</p> : null
// Field-name/type rename table vs the mock (plan §1.13):
//   commission (string) -> commissionPercent (float)
//   patientFee (string) -> patientConvenienceFee (float)
//   gst (string) -> gstPercent (float)
//   applyPatientFee -> applyConvenienceFee
//   emergencyFee / applyEmergencyFee keep their names, but emergencyFee is a float now.
// BUG FIX (found while writing tests): the `= {}` default parameter only kicks in for an
// `undefined` argument, never for `null` — but `state.data.platformCharges` (this component's
// `savedCharges`, passed straight in below) starts life as `null` (see useAppStore.js's
// DEFAULT_DATA_SHAPE) and only ever becomes an object once fetchPlatformCharges()'s effect
// resolves. The very first render's `useState(() => normalizeCharges(savedCharges))` runs
// synchronously before that effect has a chance to fire, so any admin/superadmin landing here
// directly (a refresh, a bookmark, a deep link) with the store still at its initial state hit
// `value.commissionPercent` on `null` and crashed the whole page instead of showing the loading
// skeleton. Coalescing `null`/`undefined` to `{}` up front covers both cases.
const normalizeCharges = (value) => {
  const source = value || {}
  return {
    commissionPercent: String(source.commissionPercent ?? '10'),
    patientConvenienceFee: String(source.patientConvenienceFee ?? '25'),
    emergencyFee: String(source.emergencyFee ?? '50'),
    gstPercent: String(source.gstPercent ?? '18'),
    applyConvenienceFee: source.applyConvenienceFee !== false,
    applyEmergencyFee: source.applyEmergencyFee !== false,
  }
}

export function PlatformCharges({ audience = 'admin' }) {
  const savedCharges = useAppStore((state) => state.data.platformCharges)
  const fetchPlatformCharges = useAppStore((state) => state.fetchPlatformCharges)
  const updatePlatformCharges = useAppStore((state) => state.updatePlatformCharges)
  const [charges, setCharges] = useState(() => normalizeCharges(savedCharges))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Lets the example bill demonstrate the mutual-exclusivity rule below: an emergency booking
  // pays the emergency fee INSTEAD OF the platform charge, never both.
  const [previewEmergency, setPreviewEmergency] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    fetchPlatformCharges()
      .then((result) => { if (!cancelled) setCharges(normalizeCharges(result)) })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load platform charges.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchPlatformCharges])

  const change = (key) => (event) => { setSaved(false); setCharges((current) => ({ ...current, [key]: event.target.value })) }
  const toggle = (key) => (event) => { setSaved(false); setCharges((current) => ({ ...current, [key]: event.target.checked })) }
  const save = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setFormError('')
    setSaved(false)
    try {
      // PUT /platform-charges is a full-replace — all 6 fields required every call (plan §1.13),
      // even though "Clinic commission (%)" is no longer shown/editable on this page (superadmin
      // request — commission is a platform-internal figure, not something patients pay). We keep
      // sending back exactly the value that was loaded so the stored commission rate is left
      // untouched by a save here, instead of silently zeroing it out.
      const payload = {
        commissionPercent: Number(charges.commissionPercent) || 0,
        patientConvenienceFee: Number(charges.patientConvenienceFee) || 0,
        emergencyFee: Number(charges.emergencyFee) || 0,
        gstPercent: Number(charges.gstPercent) || 0,
        applyConvenienceFee: Boolean(charges.applyConvenienceFee),
        applyEmergencyFee: Boolean(charges.applyEmergencyFee),
      }
      const result = await updatePlatformCharges(payload)
      setCharges(normalizeCharges(result))
      setSaved(true)
    } catch (err) {
      setFormError(err.message || 'Could not save platform charges.')
    } finally {
      setSubmitting(false)
    }
  }

  const consultation = 900
  // MUTUAL-EXCLUSIVITY FIX (superadmin request): the platform charge and the emergency charge
  // never stack on a real booking (see appointments.service.js#runBookingJob) — an emergency
  // booking pays the emergency surcharge instead of the platform charge, not both.
  const convenienceFee = !previewEmergency && charges.applyConvenienceFee ? Number(charges.patientConvenienceFee) || 0 : 0
  const emergencyFee = previewEmergency && charges.applyEmergencyFee ? Number(charges.emergencyFee) || 0 : 0
  const subtotal = consultation + convenienceFee + emergencyFee
  const gstAmount = subtotal * ((Number(charges.gstPercent) || 0) / 100)
  const total = subtotal + gstAmount

  if (loading) return <Page title="Platform charges" subtitle={audience === 'superadmin' ? 'Set the global pricing rules used across every clinic and online booking.' : 'Set the platform fee and commission rules for BookMyDoctor24.'}><LoadingSkeleton /></Page>

  return <Page title="Platform charges" subtitle={audience === 'superadmin' ? 'Set the global pricing rules used across every clinic and online booking.' : 'Set the platform fee and commission rules for BookMyDoctor24.'}>
    <ErrorNote>{loadError}</ErrorNote>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <form onSubmit={save} className="rounded-card border border-border bg-white p-5 shadow-card">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg">Charge configuration</h2><p className="mt-1 text-sm text-muted">These values apply to every future booking platform-wide.</p></div><span className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-semibold text-primary-dark">Global rules</span></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FormField label="Platform charge (₹)" type="number" min="0" step="0.01" value={charges.patientConvenienceFee} onChange={change('patientConvenienceFee')} required />
          <FormField label="Emergency booking fee (₹)" type="number" min="0" step="0.01" value={charges.emergencyFee} onChange={change('emergencyFee')} required />
          <FormField label="Transaction charge (%)" type="number" min="0" max="100" step="0.01" value={charges.gstPercent} onChange={change('gstPercent')} required />
        </div>
        <p className="mt-2 text-xs text-muted">Transaction charge applies only to the portion of a doctor's fee paid online through the website — a walk-in payment collected in cash/card/UPI at the clinic counter is never charged it. Platform charge and emergency fee never stack on the same booking — an emergency booking pays the emergency fee instead of the platform charge.</p>
        <div className="mt-5 space-y-2">
          <label className="flex min-h-11 items-center justify-between gap-4 rounded-button bg-surface px-3 text-sm font-medium text-ink">Apply platform charge to online bookings<input type="checkbox" checked={charges.applyConvenienceFee} onChange={toggle('applyConvenienceFee')} /></label>
          <label className="flex min-h-11 items-center justify-between gap-4 rounded-button bg-surface px-3 text-sm font-medium text-ink">Apply emergency fee to urgent bookings<input type="checkbox" checked={charges.applyEmergencyFee} onChange={toggle('applyEmergencyFee')} /></label>
        </div>
        <button className="btn-primary mt-5" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save platform charges'}</button>
        <ErrorNote>{formError}</ErrorNote>
        {saved && <p role="status" className="mt-3 text-sm font-semibold text-success">Charges saved and connected to future bookings.</p>}
      </form>
      <aside className="rounded-card bg-charcoal p-5 text-white shadow-card">
        <p className="text-sm font-semibold uppercase tracking-wider text-white/60">Live example patient bill</p>
        <p className="mt-1 text-xs text-white/60">Based on a ₹900 consultation</p>
        <label className="mt-4 flex min-h-11 items-center gap-2 text-sm font-medium text-white/80">
          <input type="checkbox" checked={previewEmergency} onChange={(event) => setPreviewEmergency(event.target.checked)} /> This is an emergency booking
        </label>
        <div className="mt-3 space-y-3 text-sm">
          <p className="flex justify-between"><span>Consultation</span><strong>{formatMoney(consultation)}</strong></p>
          <p className="flex justify-between"><span>Platform charge</span><strong>{formatMoney(convenienceFee)}</strong></p>
          <p className="flex justify-between"><span>Emergency fee</span><strong>{formatMoney(emergencyFee)}</strong></p>
          <p className="flex justify-between"><span>Transaction charge ({Number(charges.gstPercent) || 0}%)</span><strong>{formatMoney(gstAmount)}</strong></p>
          <div className="border-t border-white/20 pt-3"><p className="flex justify-between font-sans text-lg"><span>Patient total</span><strong className="text-gold">{formatMoney(total)}</strong></p></div>
        </div>
      </aside>
    </div>
  </Page>
}
