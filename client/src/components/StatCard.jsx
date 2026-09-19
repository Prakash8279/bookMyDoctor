import { Link } from 'react-router-dom'
export function StatCard({ label, value, detail, icon = '•', to }) {
  const content = <><div className="flex items-start justify-between"><p className="text-sm font-medium text-muted">{label}</p><span className="grid h-9 w-9 place-items-center rounded-button bg-primary-light font-bold text-primary-dark">{icon}</span></div><p className="mt-3 font-sans text-2xl font-bold text-charcoal">{value}</p>{detail && <p className="mt-1 text-xs text-success">{detail}</p>}</>
  if (to) return <Link to={to} className="block rounded-card border border-border bg-white p-4 shadow-card transition hover:border-primary-dark hover:shadow-md">{content}</Link>
  return <article className="rounded-card border border-border bg-white p-4 shadow-card">{content}</article>
}

