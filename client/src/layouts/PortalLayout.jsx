import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { PortalHeader, Sidebar } from '../components/Sidebar'
import { PatientNavIcon } from '../components/PatientNavIcon'
import { useAppStore } from '../store/useAppStore'

const COMPACT_PORTAL_ROLES = new Set(['patient', 'doctor', 'receptionist'])
const FOOTER_NAV = {
  patient: [['Home', '/patient/dashboard', 'layout-dashboard'], ['Appointments', '/patient/appointments', 'clipboard-list'], ['Book', '/patient/book', 'calendar-days'], ['Queue', '/patient/queue', 'ticket-check'], ['Profile', '/patient/profile', 'user-round']],
  doctor: [['Home', '/doctor/dashboard', 'layout-dashboard'], ['Appointments', '/doctor/appointments', 'clipboard-list'], ['Queue', '/doctor/queue', 'ticket-check'], ['Schedule', '/doctor/schedule', 'clock3'], ['Profile', '/doctor/profile', 'user-round']],
  receptionist: [['Home', '/receptionist/dashboard', 'layout-dashboard'], ['Appointments', '/receptionist/appointments', 'clipboard-list'], ['Walk-in', '/receptionist/walk-in', 'user-round'], ['Queue', '/receptionist/queue', 'ticket-check'], ['Profile', '/receptionist/profile', 'user-round']],
}

function PortalBottomNav({ role }) {
  const items = FOOTER_NAV[role] || []
  const roleLabel = role === 'receptionist' ? 'Receptionist' : role.charAt(0).toUpperCase() + role.slice(1)
  return <nav aria-label={`${roleLabel} bottom navigation`} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-white/95 shadow-[0_-4px_16px_rgba(35,30,28,0.08)] backdrop-blur lg:hidden [padding-bottom:env(safe-area-inset-bottom)]">{items.map(([label, path, icon]) => <NavLink key={path} end={path.endsWith('/dashboard')} to={path} className={({ isActive }) => `flex min-h-[62px] min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold transition ${isActive ? 'text-primary-dark' : 'text-muted'}`}><PatientNavIcon name={icon} /><span className="max-w-full truncate">{label}</span></NavLink>)}</nav>
}

export function PortalLayout({ role, onLogout }) {
  const [open, setOpen] = useState(false)
  const authRole = useAppStore((state) => state.currentUser?.role)
  const displayRole = authRole === 'superadmin' ? 'superadmin' : role
  const compactPortal = COMPACT_PORTAL_ROLES.has(displayRole)
  const sidebar = <Sidebar role={displayRole} open={open} onClose={() => setOpen(false)} onLogout={onLogout} />

  return <div className={`min-h-screen bg-surface ${compactPortal ? 'lg:flex' : 'md:flex'}`}>
    {compactPortal ? <div className="hidden lg:block">{sidebar}</div> : sidebar}
    <div className="min-w-0 flex-1">
      <PortalHeader role={displayRole} showMenu={!compactPortal} onMenu={() => setOpen(true)} />
      <main className={`portal-content mx-auto max-w-7xl p-4 sm:p-6 ${compactPortal ? 'portal-content--with-bottom-nav' : ''}`}><Outlet /></main>
    </div>
    {compactPortal && <PortalBottomNav role={displayRole} />}
  </div>
}

