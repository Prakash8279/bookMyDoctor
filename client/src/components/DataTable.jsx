import { EmptyState } from './EmptyState'
import { LoadingSkeleton } from './LoadingSkeleton'
import { useIsMobile } from '../hooks/useIsMobile'
// `render(row, index)` — index (0-based, position within the currently displayed `rows`) was
// added so a column can show a running DC01/DC02/DC03… sequence number (see lib/format.js's
// sequenceId) instead of the raw database id. Existing render functions that only take `row`
// are unaffected — the extra argument is simply ignored by them.
//
// RESPONSIVE-CARDS FIX (user request: "patient and receptionist and admin panel ko fully
// resposive bnao mobile view v best ho") — this ONE shared component backs every doctor/
// receptionist/admin data table in the app (appointments, payments, doctors, patients, clinics,
// revenue reports, …), so teaching IT to lay rows out as stacked "label: value" cards below the
// same 768px breakpoint the rest of the app already uses (see hooks/useIsMobile.js) fixes every
// one of those tables' mobile view in a single place, instead of a bespoke mobile layout per
// page. `useIsMobile()` picks ONE layout to actually render (never both at once) — every column
// already carries the {key, label, render} shape needed to lay the exact same data out either
// way, so this needs zero changes at any of this component's call sites. A trailing Actions
// column (key 'actionCol' or 'actions' — the two spellings already used across the app) renders
// full-width below the rest of a card's fields instead of squeezed into a label/value row, since
// it usually holds several buttons.
//
// OFF-SCREEN VALUE FIX (user report: "ye fix karo", screenshot of a card whose long clinic/doctor
// name and "Public profile" booking-link URL ran off the right edge of the card) — a flex item's
// default `min-width: auto` refuses to shrink below its content's UNBROKEN width, so a value with
// no natural spaces (a URL, a long joined name) pushed the whole row wider than the card instead
// of wrapping. `min-w-0` lets the value column actually shrink to the row's real width, and
// `break-words` (plus `break-all` as a second line of defense for a value with literally no word
// boundaries at all, like a query string) wraps it inside that width instead of overflowing.
const isActionColumn = (column) => column.key === 'actionCol' || column.key === 'actions'
export function DataTable({ columns, rows = [], pagination, loading = false, error, onRetry, onPageChange }) {
  const isMobile = useIsMobile()
  if (loading) return <LoadingSkeleton />
  if (error) return <EmptyState title="Couldn’t load this list" message={error}><button className="btn-primary mt-4" onClick={onRetry}>Try again</button></EmptyState>
  if (!rows.length) return <EmptyState />
  const page = pagination?.page || 1
  const totalPages = pagination?.totalPages || 1
  const detailColumns = columns.filter((column) => !isActionColumn(column))
  const actionColumn = columns.find(isActionColumn)
  return <div className="rounded-card border border-border bg-white shadow-card">
    {isMobile
      ? <ul className="grid gap-3 p-3">{rows.map((row, index) => <li key={row.id} className="rounded-button border border-border p-3">
          <dl className="grid gap-2">{detailColumns.map((column) => <div key={column.key} className="flex items-start justify-between gap-3 text-sm"><dt className="shrink-0 font-semibold text-muted">{column.label}</dt><dd className="min-w-0 flex-1 text-right text-ink [overflow-wrap:anywhere]">{column.render ? column.render(row, index) : row[column.key]}</dd></div>)}</dl>
          {actionColumn && <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">{actionColumn.render ? actionColumn.render(row, index) : row[actionColumn.key]}</div>}
        </li>)}</ul>
      : <div className="data-scroll"><table className="min-w-full text-left text-sm"><thead className="bg-primary-light/50 text-muted"><tr>{columns.map((column) => <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id} className="border-t border-border">{columns.map((column) => <td className="whitespace-nowrap px-4 py-3" key={column.key}>{column.render ? column.render(row, index) : row[column.key]}</td>)}</tr>)}</tbody></table></div>}
    {totalPages > 1 && <nav aria-label="Table pagination" className="flex items-center justify-between border-t border-border px-4 py-3"><span className="text-xs text-muted">Page {page} of {totalPages}</span><div className="flex gap-2"><button className="touch-target rounded-button border border-border px-3 text-sm disabled:opacity-40" disabled={page === 1} onClick={() => onPageChange?.(page - 1)}>Previous</button><button className="touch-target rounded-button border border-border px-3 text-sm disabled:opacity-40" disabled={page === totalPages} onClick={() => onPageChange?.(page + 1)}>Next</button></div></nav>}
  </div>
}

