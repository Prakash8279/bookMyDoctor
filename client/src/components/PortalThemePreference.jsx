import { useState } from 'react'

export function PortalThemePreference({ className = '' }) {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
    localStorage.setItem('dc-theme', next ? 'dark' : 'light')
  }

  return <div className={`rounded-card border border-border bg-white p-5 shadow-card ${className}`}>
    <h2 className="text-lg">Appearance</h2>
    <p className="mt-1 text-sm text-muted">Choose the theme used inside your account.</p>
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="mt-4 touch-target inline-flex items-center gap-2 rounded-button border border-border bg-white px-4 py-2.5 text-sm font-semibold text-ink"
    >
      {dark ? <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2m-7.07-2.93 1.41-1.41m11.32-11.32 1.41-1.41M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" /></svg>}
      {dark ? 'Use light theme' : 'Use dark theme'}
    </button>
  </div>
}
