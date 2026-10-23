import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { DataTable } from './DataTable'
import { downloadCsv } from '../lib/csv'
import { adminTableCsv, indiaRecordDate } from '../lib/adminRecords'
import { indiaTodayDate } from '../lib/doctorAppointmentsExport'


// Admin lists load every API page before filtering. Pagination is presentation-only:
// exports always use the entire matching set, never just the 20 visible records.
export function AdminRecordTable({ rows = [], columns, dateField, exportable = true, dateRange, onDateRangeChange, ...props }) {
  const { pathname } = useLocation()
  const admin = /^\/(admin|super-admin)(\/|$)/.test(pathname)
  const [localRange, setLocalRange] = useState(() => ({ from: indiaTodayDate(), to: indiaTodayDate() }))
  const range = dateRange || localRange
  const setRange = onDateRangeChange || setLocalRange
  const [position, setPosition] = useState({ signature: '', page: 1 })
  if (!admin || props.pagination) return <DataTable {...props} rows={rows} columns={columns} />
  const field = dateField === false ? null : (dateField || (columns.some((column) => column.key === 'createdAt') ? 'createdAt' : null))
  const invalid = Boolean(field && (!range.from || !range.to || range.from > range.to))
  const filtered = field ? rows.filter((row) => {
    const day = indiaRecordDate(row[field])
    return !invalid && day && day >= range.from && day <= range.to
  }) : rows
  const signature = `${range.from}:${range.to}:${filtered.map((row) => row.id).join(',')}`
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20))
  const page = Math.min(position.signature === signature ? position.page : 1, totalPages)
  const offset = (page - 1) * 20
  const noExport = !exportable || /\/(notifications|cms)$/.test(pathname)
  return <div className="min-w-0">
    <div className="mb-3 flex flex-wrap items-end gap-2">
      {field && <>
        <label className="min-w-0 text-xs font-semibold text-muted">From<input aria-label="Records start date" type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} className="mt-1 block min-h-11 w-full min-w-0 rounded-button border border-border bg-white px-2 text-sm" /></label>
        <label className="min-w-0 text-xs font-semibold text-muted">To<input aria-label="Records end date" type="date" min={range.from} value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} className="mt-1 block min-h-11 w-full min-w-0 rounded-button border border-border bg-white px-2 text-sm" /></label>
        <button type="button" className="touch-target px-2 text-sm font-semibold text-primary-dark" onClick={() => setRange({ from: indiaTodayDate(), to: indiaTodayDate() })}>Today</button>
      </>}
      {!noExport && <button type="button" disabled={props.loading || Boolean(props.error) || invalid || !filtered.length} className="touch-target rounded-button border border-border bg-white px-3 text-sm font-semibold disabled:opacity-50" onClick={() => downloadCsv(`bookadoctors-${pathname.split('/').filter(Boolean).pop() || 'records'}${field ? `-${range.from}-to-${range.to}` : ''}.csv`, adminTableCsv(columns, filtered))}>Download CSV</button>}
      {!props.loading && !props.error && <span className="self-center text-xs text-muted">{filtered.length} matching records</span>}
    </div>
    {invalid && <p role="alert" className="mb-3 text-sm text-error">Select a valid start and end date; start must not be after end.</p>}
    <DataTable {...props} rows={filtered.slice(offset, offset + 20)} columns={columns.map((column) => column.render ? { ...column, render: (row, index) => column.render(row, index + offset) } : column)} pagination={{ page, totalPages }} onPageChange={(next) => setPosition({ signature, page: next })} />
  </div>
}
