import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * React Router preserves the current document scroll position between routes.
 * Footer navigation therefore used to open the next legal page at its footer,
 * which looked like the tap had done nothing on a phone. Reset both scrolling
 * elements whenever the pathname changes so every page opens from its heading.
 */
export function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [pathname])

  return null
}
