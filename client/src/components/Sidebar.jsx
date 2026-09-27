import { Fragment, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import brandLogoUrl from '../assets/brand-logo.png'

const ICONS = {
  'layout-dashboard': <><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>,
  'file-heart': <><path d="M13 22h5a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v7" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M3.62 18.8A2.25 2.25 0 1 1 7 15.836a2.25 2.25 0 1 1 3.38 2.966l-2.626 2.856a1 1 0 0 1-1.507 0z" /></>,
  'ticket-check': <><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="m9 12 2 2 4-4" /></>,
  'calendar-days': <><path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M8 13h.01" /><path d="M12 13h.01" /><path d="M16 13h.01" /><path d="M8 17h.01" /><path d="M12 17h.01" /><path d="M16 17h.01" /></>,
  'clipboard-list': <><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></>,
  'file-text': <><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></>,
  'credit-card': <><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></>,
  'users-round': <><path d="M18 21a8 8 0 0 0-16 0" /><circle cx="10" cy="8" r="5" /><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" /></>,
  bell: <><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>,
  'user-round': <><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
  'chart-no-axes-combined': <><path d="M12 16v5" /><path d="M16 14.639V21" /><path d="M20 10.656V21" /><path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15" /><path d="M4 18.463V21" /><path d="M8 14.656V21" /></>,
  'message-square-warning': <><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /><path d="M12 15h.01" /><path d="M12 7v4" /></>,
  building2: <><path d="M10 12h4" /><path d="M10 8h4" /><path d="M14 21v-3a2 2 0 0 0-4 0v3" /><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" /><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /></>,
  clock3: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6h4" /></>,
  'wallet-cards': <><path d="M3 11h3.75a2 2 0 0 1 1.6.8l.45.6a4 4 0 0 0 6.4 0l.45-.6a2 2 0 0 1 1.6-.8H21" /><path d="M3 7h18" /><rect x="3" y="3" width="18" height="18" rx="2" /></>,
  stethoscope: <><path d="M11 2v2" /><path d="M5 2v2" /><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" /><path d="M8 15a6 6 0 0 0 12 0v-3" /><circle cx="20" cy="10" r="2" /></>,
  'map-pinned': <><path d="M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0" /><circle cx="12" cy="8" r="2" /><path d="M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712" /></>,
  activity: <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />,
  'receipt-indian-rupee': <><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" /><path d="M8 11h8" /><path d="M8 7h8" /><path d="M9 7a4 4 0 0 1 0 8H8l3 2" /></>,
  settings: <><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></>,
  'log-out': <><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /></>,
  gauge: <><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></>,
  percent: <><line x1="19" x2="5" y1="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
  'shield-check': <><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>,
  megaphone: <><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>,
}

function NavIcon({ name }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">{ICONS[name]}</svg>
}

const menu = {
  patient: [['Dashboard', '/patient/dashboard', 'layout-dashboard'], ['Book appointment', '/patient/book', 'calendar-days'], ['My appointments', '/patient/appointments', 'clipboard-list'], ['Queue tracker', '/patient/queue', 'ticket-check'], ['Payments', '/patient/payments', 'credit-card'], ['Family members', '/patient/family', 'users-round'], ['Notifications', '/patient/notifications', 'bell'], ['My profile', '/patient/profile', 'user-round']],
  doctor: [['Dashboard', '/doctor/dashboard', 'layout-dashboard'], ['Queue management', '/doctor/queue', 'ticket-check'], ['Appointments', '/doctor/appointments', 'calendar-days'], ['Analytics', '/doctor/analytics', 'chart-no-axes-combined'], ['Patient reviews', '/doctor/reviews', 'message-square-warning'], ['Notifications', '/doctor/notifications', 'bell'], ['Clinic settings', '/doctor/clinic', 'building2'], ['OPD schedule', '/doctor/schedule', 'clock3'], ['Receptionists', '/doctor/receptionists', 'users-round'], ['Reports', '/doctor/reports', 'file-text'], ['My profile', '/doctor/profile', 'user-round']],
  receptionist: [['Dashboard', '/receptionist/dashboard', 'layout-dashboard'], ['Walk-in registration', '/receptionist/walk-in', 'user-round'], ['Queue monitor', '/receptionist/queue', 'ticket-check'], ['Appointments', '/receptionist/appointments', 'calendar-days'], ['Payments', '/receptionist/payments', 'wallet-cards'], ['Patients', '/receptionist/patients', 'users-round'], ['Notifications', '/receptionist/notifications', 'bell'], ['Reports', '/receptionist/reports', 'chart-no-axes-combined'], ['My profile', '/receptionist/profile', 'user-round']],
  admin: [['Dashboard', '/admin/dashboard', 'layout-dashboard'], ['Doctors', '/admin/doctors', 'stethoscope'], ['Patients', '/admin/patients', 'users-round'], ['Receptionists', '/admin/receptionists', 'users-round'], ['Clinics', '/admin/clinics', 'building2'], ['Cities & areas', '/admin/cities', 'map-pinned'], ['Specializations', '/admin/specializations', 'activity'], ['Appointments', '/admin/appointments', 'calendar-days'], ['Revenue', '/admin/revenue', 'receipt-indian-rupee'], ['Review moderation', '/admin/reviews', 'message-square-warning'], ['Complaints', '/admin/complaints', 'message-square-warning'], ['Contact inbox', '/admin/contacts', 'file-text'], ['Notifications', '/admin/notifications', 'bell'], ['Activity logs', '/admin/activity-logs', 'clipboard-list'], ['Settings', '/admin/settings', 'settings'], ['My profile', '/admin/profile', 'user-round']],
  // The first 10 entries are Super Admin's own pages. Everything after that (rendered under the
  // "Admin workspace" divider below — kept in sync with this array's length, see index === 10 in
  // the render below) is admin-panel functionality a super admin also needs but that has no
  // super-admin-native equivalent page. Deliberately EXCLUDES every admin item that leads to the
  // exact same component as one of the 10 super-admin items above (Clinics/Cities/Revenue/
  // Platform fee/Notifications/Broadcast/Activity logs/Audit log/Settings all duplicated a page
  // already reachable from this same sidebar under a different label) — those were dead weight,
  // not extra functionality.
  // COMPLETENESS FIX (audit Priority 1 #4): also dropped 'Users' (was a stub duplicate of
  // 'Patients', which is already listed here) and 'Roles & permissions' (was a stub duplicate of
  // 'Receptionists', also already listed here) for the same reason — both /admin/users and
  // /admin/roles still redirect to their real equivalents for anyone with an old bookmark, but
  // there's no reason to list two nav entries that land on the same page.
  superadmin: [['Control center', '/super-admin/dashboard', 'gauge'], ['People & clinics', '/super-admin/entities', 'users-round'], ['Payments & revenue', '/super-admin/revenue', 'receipt-indian-rupee'], ['Platform charges', '/super-admin/charges', 'percent'], ['Cities & service areas', '/super-admin/cities', 'map-pinned'], ['Clinic tenants', '/super-admin/tenants', 'building2'], ['Security & activity', '/super-admin/security', 'shield-check'], ['Content & broadcasts', '/super-admin/cms', 'megaphone'], ['System settings', '/super-admin/settings', 'settings'], ['My profile', '/super-admin/profile', 'user-round'], ['Dashboard', '/admin/dashboard', 'layout-dashboard'], ['Doctors', '/admin/doctors', 'stethoscope'], ['Clinic verification', '/admin/clinic-verification', 'building2'], ['Patients', '/admin/patients', 'users-round'], ['Specializations', '/admin/specializations', 'activity'], ['Appointments', '/admin/appointments', 'calendar-days'], ['Booking rules', '/admin/booking-rules', 'clipboard-list'], ['Receptionists', '/admin/receptionists', 'users-round'], ['Reviews', '/admin/reviews', 'message-square-warning'], ['Complaints', '/admin/complaints', 'message-square-warning'], ['Contact inbox', '/admin/contacts', 'file-text']],
}

const ROLE_LABELS = { admin: 'Admin', doctor: 'Doctor', patient: 'Patient', receptionist: 'Reception', superadmin: 'Super Admin' }
const roleLabelFor = (role) => ROLE_LABELS[role] || (role.charAt(0).toUpperCase() + role.slice(1))
const roleSuffixFor = (role) => (role === 'admin' || role === 'superadmin' ? 'control panel' : 'portal')

export function Sidebar({ role, open, onClose, onLogout }) {
  const items = menu[role] || []
  const currentUser = useAppStore((state) => state.currentUser)
  const roleLabel = roleLabelFor(role)
  const displayName = currentUser?.name || `${roleLabel} account`
  // logout() is async (POST /auth/logout, best-effort) but never throws — it
  // always clears local session state even if the server call fails, so no
  // try/catch is needed at this call site.
  const logout = async () => { localStorage.removeItem('dc-role'); localStorage.removeItem('dc-email'); await onLogout?.(); onClose?.() }
  return <><aside className={`fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto bg-charcoal p-4 text-white transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}><Link to="/" className="flex items-center gap-3 px-2 py-3" onClick={onClose}>{/* BUG FIX ("galat logo use kiye ho"): this was a generic Lucide "heart-pulse" stock icon, not
    the app's real logo (a heart with an ECG line through it — see mobile/assets/branding/app_icon.png,
    the app's actual icon everywhere else) — swapped for the real mark, same as the PDF receipts. */}
<span className="brand-mark"><img src={brandLogoUrl} alt="BookMyDoctors" className="h-full w-full rounded-[13px] object-cover" /></span><span className="font-sans text-lg">BookMyDoctors</span></Link><div className="mt-6 rounded-button border border-white/10 bg-white/5 px-3 py-2.5"><p className="text-sm font-bold text-white">{roleLabel} {roleSuffixFor(role)}</p><p className="mt-0.5 truncate text-xs text-white/60">{displayName}</p></div><nav className="mt-3 space-y-1">{items.map(([label, path, icon], index) => <Fragment key={path}>{role === 'superadmin' && index === 10 && <p className="px-3 pb-1 pt-6 text-[11px] font-semibold uppercase tracking-wider text-white/40">Admin workspace</p>}<NavLink end={path.endsWith('/dashboard')} to={path} onClick={onClose} className={({ isActive }) => `touch-target flex items-center gap-3 rounded-button px-3 text-sm font-medium ${isActive ? 'bg-primary-dark text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}><NavIcon name={icon} /><span>{label}</span></NavLink></Fragment>)}</nav><button onClick={logout} className="mt-8 flex w-full items-center gap-3 rounded-button px-3 py-2.5 text-left text-sm font-medium text-white/75 hover:bg-white/10 hover:text-white"><NavIcon name="log-out" /><span>Sign out</span></button></aside>{open && <button aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-30 bg-charcoal/40 md:hidden" />}</>
}

export function PortalHeader({ role, onMenu }) {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')
  const currentUser = useAppStore((state) => state.currentUser)
  const location = useLocation()
  const toggleTheme = () => { const next = !dark; setDark(next); document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light'); localStorage.setItem('dc-theme', next ? 'dark' : 'light') }
  const roleLabel = roleLabelFor(role)
  const displayName = currentUser?.name || `${roleLabel} account`
  const initials = displayName.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || role.slice(0, 2).toUpperCase()
  const profilePath = role === 'superadmin' ? '/super-admin/profile' : `/${role}/profile`
  const pageLabel = (menu[role] || []).find(([, path]) => path === location.pathname)?.[0] || (role === 'superadmin' ? 'Control center' : 'Dashboard')
  return <header className="portal-header sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur md:px-7"><button onClick={onMenu} className="touch-target grid place-items-center rounded-button md:hidden" aria-label="Open navigation"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button><div className="hidden min-w-0 md:block"><p className="text-base text-charcoal">{pageLabel}</p></div><div className="flex items-center gap-3"><button onClick={toggleTheme} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} className="touch-target grid h-10 w-10 place-items-center rounded-button border border-border bg-white text-ink">{dark ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"></path></svg>}</button><Link to={profilePath} aria-label="Open profile" title={displayName} className="grid h-9 w-9 overflow-hidden place-items-center rounded-full bg-primary-light font-semibold uppercase text-primary-dark">{currentUser?.photoUrl ? <img src={currentUser.photoUrl} alt={`${displayName} profile`} className="h-full w-full object-cover" /> : initials}</Link><div className="hidden min-w-0 sm:block"><p className="truncate text-sm font-bold text-charcoal">{displayName}</p><p className="text-xs text-muted">{roleLabel} {roleSuffixFor(role)}</p></div></div></header>
}
