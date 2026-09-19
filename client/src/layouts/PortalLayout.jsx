import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import { PortalHeader, Sidebar } from '../components/Sidebar'
import { useAppStore } from '../store/useAppStore'

export function PortalLayout({ role, onLogout }) { const [open, setOpen] = useState(false); const authRole = useAppStore((state) => state.currentUser?.role); const displayRole = authRole === 'superadmin' ? 'superadmin' : role; return <div className="min-h-screen bg-surface md:flex"><Sidebar role={displayRole} open={open} onClose={() => setOpen(false)} onLogout={onLogout} /><div className="min-w-0 flex-1"><PortalHeader role={displayRole} onMenu={() => setOpen(true)} onLogout={onLogout} /><main className="mx-auto max-w-7xl p-4 sm:p-6"><Outlet /></main></div></div> }

