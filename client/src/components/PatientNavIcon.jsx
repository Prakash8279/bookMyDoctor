const PATIENT_ICONS = {
  'layout-dashboard': <><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>,
  'calendar-days': <><path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M8 13h.01" /><path d="M12 13h.01" /><path d="M16 13h.01" /><path d="M8 17h.01" /><path d="M12 17h.01" /><path d="M16 17h.01" /></>,
  'clipboard-list': <><rect width="8" height="4" x="8" y="2" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" /></>,
  'ticket-check': <><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="m9 12 2 2 4-4" /></>,
  'credit-card': <><rect width="20" height="14" x="2" y="5" rx="2" /><path d="M2 10h20" /></>,
  'users-round': <><path d="M18 21a8 8 0 0 0-16 0" /><circle cx="10" cy="8" r="5" /><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" /></>,
  bell: <><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>,
  'user-round': <><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
  'file-text': <><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5M8 13h8M8 17h8" /></>,
  'file-heart': <><path d="M13 22h5a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2v7" /><path d="M14 2v6h6" /><path d="M3.6 18.8A2.25 2.25 0 1 1 7 15.8a2.25 2.25 0 1 1 3.4 3L7 22z" /></>,
  activity: <path d="M22 12h-2.5a2 2 0 0 0-1.9 1.5l-2.4 8.3-6-19.6-2.8 8.3A2 2 0 0 1 4.5 12H2" />,
  'chart-no-axes-combined': <><path d="M12 16v5M16 14.639V21M20 10.656V21M4 18.463V21M8 14.656V21" /><path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15" /></>,
  'message-square-warning': <><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /><path d="M12 15h.01M12 7v4" /></>,
  building2: <><path d="M10 12h4M10 8h4M14 21v-3a2 2 0 0 0-4 0v3" /><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /></>,
  clock3: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6h4" /></>,
  'wallet-cards': <><path d="M3 11h3.75a2 2 0 0 1 1.6.8l.45.6a4 4 0 0 0 6.4 0l.45-.6a2 2 0 0 1 1.6-.8H21M3 7h18" /><rect x="3" y="3" width="18" height="18" rx="2" /></>,
}

export function PatientNavIcon({ name, className = 'h-[18px] w-[18px]' }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden="true">{PATIENT_ICONS[name]}</svg>
}
