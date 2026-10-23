import { indiaTodayDate } from '../lib/doctorAppointmentsExport'

export function IndiaDateRangeFilter({ from, to, onChange, label = 'Filter records' }) {
  const incomplete = Boolean(from) !== Boolean(to)
  const invalid = incomplete || Boolean(from && to && from > to)
  const change = (nextFrom, nextTo) => onChange({ from: nextFrom, to: nextTo })
  const today = () => {
    const value = indiaTodayDate()
    change(value, value)
  }

  return <div className="mb-4 rounded-card border border-border bg-white p-3 shadow-card sm:p-4">
    <div className="grid min-w-0 grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
      <label className="min-w-0 text-xs font-semibold text-muted">
        From
        <input aria-label={`${label} start date`} type="date" value={from} onChange={(event) => change(event.target.value, to)} className="mt-1 block min-h-11 w-full min-w-0 rounded-button border border-border bg-white px-2 text-sm text-ink sm:w-auto sm:px-3" />
      </label>
      <label className="min-w-0 text-xs font-semibold text-muted">
        To
        <input aria-label={`${label} end date`} type="date" min={from || undefined} value={to} onChange={(event) => change(from, event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-button border border-border bg-white px-2 text-sm text-ink sm:w-auto sm:px-3" />
      </label>
      <button type="button" className="touch-target rounded-button border border-border bg-white px-3 text-sm font-semibold text-ink hover:border-primary-dark" onClick={today}>Today</button>
      <button type="button" className="touch-target rounded-button border border-border bg-white px-3 text-sm font-semibold text-ink hover:border-primary-dark" onClick={() => change('', '')}>All dates</button>
    </div>
    {invalid && <p role="alert" className="mt-2 text-sm font-semibold text-error">{incomplete ? 'Select both From and To dates, or use All dates.' : 'From date must be before To date.'}</p>}
  </div>
}

