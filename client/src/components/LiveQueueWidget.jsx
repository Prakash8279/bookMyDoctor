import { useEffect, useMemo, useState } from 'react'
import { StatusPill } from './StatusPill'
import { LoadingSkeleton } from './LoadingSkeleton'

/** Browser-persisted queue state. Queue actions update the shared Zustand store immediately. */
export function LiveQueueWidget({ appointmentId, initialQueue, loading = false, error, onRetry }) {
  const initial = useMemo(() => initialQueue || { appointmentId, token: null, nowServing: null, patientsAhead: null, estimatedWait: null, doctorStatus: 'closed' }, [initialQueue, appointmentId])
  const [queue, setQueue] = useState(initial)
  useEffect(() => { setQueue(initial) }, [initial])
  if (loading) return <section aria-label="Loading live queue"><LoadingSkeleton rows={1} /></section>
  if (error) return <section className="rounded-card border border-error/30 bg-white p-5 text-center shadow-card" role="alert"><p className="font-semibold text-charcoal">Live queue is temporarily unavailable</p><p className="mt-1 text-sm text-muted">Your appointment is confirmed. Please try again shortly.</p>{onRetry && <button className="btn-primary mt-4" onClick={onRetry}>Refresh queue</button>}</section>
  if (queue.token == null) return <section className="rounded-card border border-border bg-white p-5 text-center shadow-card"><p className="font-semibold text-charcoal">Your token will appear after check-in</p><p className="mt-1 text-sm text-muted">We’ll show your live position as soon as the clinic issues it.</p></section>
  return <section className="rounded-card border border-border bg-white p-5 shadow-card" aria-label="Live queue status" aria-live="polite"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-teal-dark">Live queue</p><StatusPill status={queue.doctorStatus} /></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-button bg-charcoal p-4 text-center"><p className="text-xs font-medium uppercase tracking-wide text-white/70">Your token</p><p className="mt-1 font-sans text-4xl font-bold text-gold">{queue.token}</p></div><div className="rounded-button bg-primary-light p-4 text-center"><p className="text-xs font-medium uppercase tracking-wide text-muted">Now serving</p><p className="mt-1 font-sans text-4xl font-bold text-primary-dark">{queue.nowServing}</p></div></div><div className="mt-4 grid grid-cols-2 gap-3 text-center"><div><p className="text-xs text-muted">Patients ahead</p><p className="font-sans text-xl text-charcoal">{queue.patientsAhead}</p></div><div><p className="text-xs text-muted">Estimated wait</p><p className="font-sans text-xl text-charcoal">{queue.estimatedWait}</p></div></div></section>
}

