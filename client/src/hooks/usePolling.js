import { useEffect, useRef } from 'react'

// LOAD-REVIEW FIX (audit finding: "4 independent 15s polling loops, each hand-rolling its own
// setInterval/clearInterval, none of them pausing when the tab isn't even visible" — see
// docs/load-balancing-check-2026-09-20.md / docs/data-load-review-2026-09-20.md). Consolidates
// PatientPages.jsx's own-queue-status poll, PortalSectionPages.jsx's two polls (patient
// own-status + staff full-queue), and PublicPages.jsx's PatientLiveQueuePreview poll into one
// shared timing mechanism, so a fix to the polling behavior (this pause-on-hidden-tab change
// itself being the first one) lands in every caller at once instead of needing four edits.
//
// This hook owns ONLY the timing (when to call `loadFn`) — it does not touch component state, so
// every call site keeps its own existing "don't setState after unmount / after a newer request
// started" guard around whatever `loadFn` does internally (the same `let cancelled` pattern each
// call site already used before this hook existed). `loadFn` is read from a ref updated on every
// render, so callers can pass a fresh closure each render (capturing current props/state) without
// needing to memoize it themselves or restart the interval every time it changes.
//
// PAUSE-ON-HIDDEN: while `document.hidden` is true (tab backgrounded, minimized, another tab
// focused) the interval keeps ticking but skips actually calling `loadFn` — no wasted request, no
// wasted server-side work for a screen nobody is looking at. The moment the tab becomes visible
// again, a poll fires immediately (via the `visibilitychange` listener) so whatever's on screen
// isn't left showing stale data from before the tab was backgrounded.
/**
 * @param {() => void} loadFn - called immediately, then on a timer. Owns its own error handling
 *   and any unmount/staleness guard around state it sets.
 * @param {{intervalMs?: number, enabled?: boolean}} [options]
 */
export function usePolling(loadFn, { intervalMs = 15000, enabled = true } = {}) {
  const loadFnRef = useRef(loadFn)
  useEffect(() => {
    loadFnRef.current = loadFn
  })

  useEffect(() => {
    if (!enabled) return undefined

    loadFnRef.current()

    const tick = () => {
      if (!document.hidden) loadFnRef.current()
    }
    const interval = setInterval(tick, intervalMs)

    const onVisibilityChange = () => {
      if (!document.hidden) loadFnRef.current()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, intervalMs])
}
