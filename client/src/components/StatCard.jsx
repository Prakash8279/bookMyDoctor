import { Link } from 'react-router-dom'
export function StatCard({ label, value, detail, icon = '•', to, compactOnMobile = false }) {
  const content = <><div className="flex items-start justify-between"><p className={compactOnMobile ? 'text-[11px] font-medium leading-tight text-muted sm:text-sm' : 'text-sm font-medium text-muted'}>{label}</p><span className={compactOnMobile ? 'hidden h-9 w-9 place-items-center rounded-button bg-primary-light font-bold text-primary-dark sm:grid' : 'grid h-9 w-9 place-items-center rounded-button bg-primary-light font-bold text-primary-dark'}>{icon}</span></div><p className={compactOnMobile ? 'mt-2 font-sans text-xl font-bold text-charcoal sm:mt-3 sm:text-2xl' : 'mt-3 font-sans text-2xl font-bold text-charcoal'}>{value}</p>{detail && <p className="mt-1 text-xs text-success">{detail}</p>}</>
  const cardClass = `rounded-card border border-border bg-white shadow-card ${compactOnMobile ? 'min-h-[84px] p-2.5 sm:min-h-0 sm:p-4' : 'p-4'}`
  if (to) return <Link to={to} className={`block ${cardClass} transition hover:border-primary-dark hover:shadow-md`}>{content}</Link>
  return <article className={cardClass}>{content}</article>
}

