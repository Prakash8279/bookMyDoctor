import { useEffect, useState } from 'react'

// RESPONSIVE-CARDS FIX (user request: "patient and receptionist and admin panel ko fully
// resposive bnao mobile view v best ho") — a shared hook so any component can pick between a
// desktop table layout and a mobile-friendly stacked-card layout at the SAME breakpoint
// Tailwind's own `md:` prefix already uses everywhere else in the app (768px — see
// layouts/PortalLayout.jsx / components/Sidebar.jsx's mobile drawer), instead of relying on CSS
// alone to hide/show BOTH layouts at once. Rendering both would duplicate every row's real data
// in the DOM — a screen reader would announce each row twice, and it also breaks single-result
// DOM queries like getByText/getByRole the existing test suite already relies on everywhere.
//
// `window.matchMedia` does not exist at all in this project's jsdom test environment (confirmed
// directly: `typeof window.matchMedia` is `undefined`, not just "always false") — the fallback
// below always resolves to `false` (desktop) in that case, so every EXISTING test keeps rendering
// exactly the table layout it always did, with zero changes needed to any existing test. A test
// that wants to exercise the mobile card layout mocks `window.matchMedia` explicitly (see
// DataTable.test.jsx / PatientPages.test.jsx for the pattern).
const MOBILE_QUERY = '(max-width: 767px)'

function matchesMobile() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(MOBILE_QUERY).matches
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(matchesMobile)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    // Older Safari only supports addListener/removeListener; every current browser supports
    // addEventListener — support both rather than assuming one.
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else if (mql.addListener) mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else if (mql.removeListener) mql.removeListener(onChange)
    }
  }, [])

  return isMobile
}
