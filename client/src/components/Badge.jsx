const colors = { primary: 'bg-primary-light text-primary-dark', teal: 'bg-teal/10 text-teal-dark', gold: 'bg-gold/15 text-gold-dark', success: 'bg-success/10 text-success', error: 'bg-error/10 text-error', neutral: 'bg-surface text-muted' }
export function Badge({ children, tone = 'neutral' }) { return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${colors[tone]}`}>{children}</span> }

