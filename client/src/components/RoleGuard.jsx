import { Navigate, useLocation } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import { LoadingSkeleton } from './LoadingSkeleton'
import { getTokens } from '../lib/apiClient'

export function ProtectedRoute({ children, role, currentRole }) {
  const location = useLocation()
  const authLoading = useAppStore((state) => state.authLoading)
  const sessionVerified = useAppStore((state) => state.sessionVerified)
  // NOTE (security): `currentRole` must come only from the real session
  // (`currentUser.role`, passed down from App.jsx) — never from a
  // localStorage fallback. This is UX-only gating regardless (every
  // sensitive action is re-enforced server-side by `authorize()`), but a
  // client-readable/writable role source would let a visitor with no valid
  // token spoof their way into a protected portal's UI shell.
  const activeRole = currentRole

  // zustand's `persist` middleware rehydrates `currentUser`/`isAuthenticated`
  // synchronously on load, straight from localStorage — before boot-time
  // session restore (GET /me, triggered from App.jsx) has had a chance to
  // re-confirm the token is still valid. `sessionVerified` is the in-memory,
  // never-persisted flag that only flips true once that confirmation has
  // actually happened this app load (or a fresh login()/register() ran it
  // itself) — wait for it instead of trusting the persisted/rehydrated state,
  // so a stale or revoked session never briefly renders protected UI, and a
  // session that may turn out valid doesn't flash a redirect to /login either.
  if ((!sessionVerified || authLoading) && getTokens()?.accessToken) {
    return <div className="grid min-h-[40vh] place-items-center p-6"><div className="w-full max-w-sm"><LoadingSkeleton rows={3} /></div></div>
  }

  if (!activeRole) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  // Super Admin is the platform owner and can inspect every role workspace.
  if (role && activeRole !== role && activeRole !== 'superadmin') {
    const home = activeRole === 'superadmin' ? '/super-admin/dashboard' : `/${activeRole}/dashboard`
    return <Navigate to={home} replace />
  }
  return children
}

