import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminRecordTable } from './AdminRecordTable'
import { adminTableCsv, indiaRecordDate } from '../lib/adminRecords'
import { indiaTodayDate } from '../lib/doctorAppointmentsExport'
import { downloadCsv } from '../lib/csv'

vi.mock('../lib/csv', async (original) => ({ ...await original(), downloadCsv: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const columns = [{ key: 'name', label: 'Name' }, { key: 'createdAt', label: 'Date' }]
const rows = Array.from({ length: 45 }, (_, index) => ({ id: String(index), name: `Patient ${index}`, createdAt: `${indiaTodayDate()}T10:00:00+05:30` }))
const mount = (props = {}, path = '/admin/security') => render(<MemoryRouter initialEntries={[path]}><AdminRecordTable columns={columns} rows={rows} {...props} /></MemoryRouter>)

it.each(['/admin/security', '/super-admin/security'])('defaults to Today, pages every match, exports the whole range: %s', (path) => {
  mount({}, path)
  expect(screen.getByLabelText('Records start date').value).toBe(indiaTodayDate())
  expect(screen.getByText('Patient 19')).toBeTruthy()
  expect(screen.queryByText('Patient 20')).toBeNull()
  fireEvent.click(screen.getByText('Next'))
  expect(screen.getByText('Patient 20')).toBeTruthy()
  expect(screen.getByText('Page 2 of 3')).toBeTruthy()
  fireEvent.click(screen.getByText('Download CSV'))
  expect(downloadCsv.mock.calls[0][1]).toContain('Patient 0')
  expect(downloadCsv.mock.calls[0][1]).toContain('Patient 44')
})

it('filters full history, resets pagination, and includes the end date in India time', () => {
  mount({ rows: [...rows, { id: 'past', name: 'Older patient', createdAt: '2025-01-01T18:29:59Z' }, { id: 'next', name: 'Next day', createdAt: '2025-01-01T18:30:00Z' }] })
  fireEvent.click(screen.getByText('Next'))
  fireEvent.change(screen.getByLabelText('Records start date'), { target: { value: '2025-01-01' } })
  fireEvent.change(screen.getByLabelText('Records end date'), { target: { value: '2025-01-01' } })
  expect(screen.getByText('Older patient')).toBeTruthy()
  expect(screen.queryByText('Next day')).toBeNull()
  expect(screen.queryByText('Page 2 of 3')).toBeNull()
  fireEvent.change(screen.getByLabelText('Records start date'), { target: { value: '2025-01-02' } })
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getByText('Download CSV').disabled).toBe(true)
})

it('does not hide master records or offer notification CSV', () => {
  mount({ columns: [{ key: 'name', label: 'Name' }] }, '/admin/notifications')
  expect(screen.getByText('Patient 0')).toBeTruthy()
  expect(screen.queryByLabelText('Records start date')).toBeNull()
  expect(screen.queryByText('Download CSV')).toBeNull()
})

it('CSV escapes formulas, preserves quotes/newlines, omits actions and serializes status', () => {
  const csv = adminTableCsv([...columns, { key: 'status', label: 'Status', render: () => <span>paid</span> }, { key: 'actions', label: 'Actions' }], [{ name: '=HYPERLINK("bad")\nvalue' }])
  expect(csv).toContain("'=" )
  expect(csv).toContain('""bad""')
  expect(csv).toContain('paid')
  expect(csv).not.toContain('Actions')
  expect(indiaRecordDate('invalid')).toBe('')
})
