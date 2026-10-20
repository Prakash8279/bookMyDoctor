import { useEffect, useState } from 'react'
import apiClient from '../lib/apiClient'
import { fetchAllClinicRows } from '../lib/clinicWorkspace'
import { indiaTodayDate } from '../lib/doctorAppointmentsExport'
import { indiaRecordDate } from '../lib/adminRecords'
import { StatCard } from './StatCard'

export function AdminPeriodSummary({ dateRange, onDateRangeChange }) {
  const [localRange, setLocalRange] = useState(() => ({ from: indiaTodayDate(), to: indiaTodayDate() }))
  const range = dateRange || localRange
  const setRange = onDateRangeChange || setLocalRange
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const invalid = !range.from || !range.to || range.from > range.to
  useEffect(() => {
    let cancelled = false
    setResult(null); setError('')
    if (invalid) return undefined
    Promise.all([
      fetchAllClinicRows(apiClient, '/appointments', { dateFrom: range.from, dateTo: range.to }),
      fetchAllClinicRows(apiClient, '/payments'),
    ]).then(([appointments, payments]) => {
      const matching = payments.filter((row) => {
        const day = indiaRecordDate(row.createdAt)
        return day && day >= range.from && day <= range.to && row.status === 'paid'
      })
      if (!cancelled) setResult({ bookings: appointments.length, revenue: matching.reduce((sum, row) => sum + Math.max(0, Number(row.fees?.amount) || 0), 0) })
    }).catch((err) => { if (!cancelled) setError(err.message || 'Could not load the selected period.') })
    return () => { cancelled = true }
  }, [range.from, range.to, invalid])
  return <section aria-label="Selected period summary" className="mt-4">
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <label className="min-w-0 text-xs font-semibold text-muted">From<input type="date" aria-label="Summary start date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} className="mt-1 block min-h-11 min-w-0 w-full rounded-button border border-border bg-white px-2" /></label>
      <label className="min-w-0 text-xs font-semibold text-muted">To<input type="date" aria-label="Summary end date" min={range.from} value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} className="mt-1 block min-h-11 min-w-0 w-full rounded-button border border-border bg-white px-2" /></label>
      <button type="button" className="touch-target px-2 text-sm font-semibold text-primary-dark" onClick={() => setRange({ from: indiaTodayDate(), to: indiaTodayDate() })}>Today</button>
    </div>
    {(invalid || error) && <p role="alert" className="mb-3 text-sm text-error">{invalid ? 'Select a valid date range.' : error}</p>}
    <div className="admin-dashboard-stats grid grid-cols-2 gap-3">
      <StatCard label="Selected period bookings" value={result?.bookings ?? '—'} detail="By visit date" icon="📅" />
      <StatCard label="Selected period revenue" value={result ? `₹${result.revenue.toLocaleString('en-IN')}` : '—'} detail="Paid collections only, by payment date" icon="₹" />
    </div>
  </section>
}
