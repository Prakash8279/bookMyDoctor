import { useEffect, useRef, useState } from 'react'

// LOAD-REVIEW FIX (audit finding: "admin list pages refetch their full list on every mount" —
// DoctorVerification/ManagePatients/ManageClinics in AdminPages.jsx each page-load their entire
// dataset from scratch every time an admin navigates to them, even seconds after leaving and
// coming back). A light time-to-live cache, module-scoped so it's shared across every mount of
// the same page within this browser tab's session: within `ttlMs` of the last successful fetch
// for a given `cacheKey`, mounting the page skips the network call entirely and trusts the data
// already sitting in the store (fetched moments ago) instead of refetching it. Past the TTL, or
// on the very first visit this session, it fetches normally.
//
// Deliberately a plain in-memory Map, not localStorage/sessionStorage: this is a same-tab,
// same-session freshness hint, not data meant to survive a reload or be shared across tabs/
// devices — a hard reload always shows truly fresh data, and two admins in two tabs never share
// a stale timestamp from one another.
const lastFetchedAt = new Map()

// Test-only escape hatch: the whole point of this cache is to survive across mounts of the SAME
// page within one browser session, but that's exactly what breaks test isolation — two tests in
// the same file mounting the same page (e.g. ManagePatients) within milliseconds of each other
// would otherwise have the second one silently skip its fetch, "inheriting" the first test's
// freshness. Call this from a global `beforeEach`/`afterEach` in tests, the same way the app's own
// test suites already reset the Zustand store between tests.
export function resetAllListLoadCachesForTests() {
  lastFetchedAt.clear()
}

/**
 * @param {string} cacheKey - identifies this page's base (unfiltered) list, e.g. 'admin:doctors'.
 * @param {(...args:any[]) => Promise<any>} fetchFn - performs the actual fetch(es); called with no
 *   arguments for the automatic on-mount load, or with whatever `refresh(...)` is called with.
 * @param {{ttlMs?: number}} [options]
 * @returns {{loading: boolean, error: string, refresh: (...args:any[]) => Promise<void>}}
 *   `refresh` ALWAYS bypasses the cache and fetches — a manual "↻ Refresh" click must never be a
 *   no-op just because the TTL hasn't expired yet.
 */
export function useListLoad(cacheKey, fetchFn, { ttlMs = 30000 } = {}) {
  const isFresh = () => {
    const last = lastFetchedAt.get(cacheKey)
    return typeof last === 'number' && Date.now() - last < ttlMs
  }

  const [loading, setLoading] = useState(!isFresh())
  const [error, setError] = useState('')
  const cancelledRef = useRef(false)
  const fetchFnRef = useRef(fetchFn)
  useEffect(() => {
    fetchFnRef.current = fetchFn
  })
  useEffect(() => () => {
    cancelledRef.current = true
  }, [])

  const run = (...args) => {
    // BUG FIX ("admin app me clinic doctor patient show nahi ho raha hai" — Doctors/Clinics/
    // Patients admin pages all got stuck on "Refreshing…" forever, showing the loading skeleton
    // even after the data had actually arrived): in dev, React 18 StrictMode intentionally
    // mounts every component twice (mount -> run the [] cleanup below as if unmounting -> mount
    // again) to catch exactly this kind of bug. That phantom "unmount" set cancelledRef.current
    // to true, and NOTHING ever reset it back to false afterwards — so the second (genuinely
    // mounted) run() below always found cancelledRef.current already true by the time its fetch
    // resolved, and permanently skipped setLoading(false)/setError(...) in the .finally()/.catch()
    // below. Every admin list page using this hook (ManageDoctors/ManageClinics/ManagePatients,
    // cacheKeys 'admin:doctors'/'admin:clinics'/'admin:patients') hit this on first load. A fresh
    // run() only ever starts while this hook instance is genuinely mounted (from the mount effect
    // below, or from the `refresh` a live button click calls), so it's always correct to clear any
    // stale cancellation here — a REAL unmount that happens while this run is still in flight will
    // still set cancelledRef.current back to true via the effect's own cleanup further down.
    cancelledRef.current = false
    setLoading(true)
    setError('')
    return Promise.resolve(fetchFnRef.current(...args))
      .then(() => {
        lastFetchedAt.set(cacheKey, Date.now())
      })
      .catch((err) => {
        if (!cancelledRef.current) setError(err.message || 'Could not load data.')
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false)
      })
  }

  useEffect(() => {
    if (isFresh()) {
      setLoading(false)
      return
    }
    run()
    // Intentionally keyed only on cacheKey — fetchFn's latest closure is always read via the ref
    // above, so an identity change in the caller's fetchFn (a new function on every render) never
    // re-triggers this effect or restarts anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])

  return { loading, error, refresh: (...args) => run(...args) }
}
