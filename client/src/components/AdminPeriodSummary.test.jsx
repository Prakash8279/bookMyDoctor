import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import apiClient from '../lib/apiClient'
import { indiaTodayDate } from '../lib/doctorAppointmentsExport'
import { AdminPeriodSummary } from './AdminPeriodSummary'
import { AdminRecordTable } from './AdminRecordTable'
vi.mock('../lib/apiClient', () => ({ default: { get: vi.fn() } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('keeps dashboard summary and record date controls synchronized', async () => {
  apiClient.get.mockResolvedValue([])
  function Dashboard() {
    const [range, setRange] = useState({ from: indiaTodayDate(), to: indiaTodayDate() })
    return <><AdminPeriodSummary dateRange={range} onDateRangeChange={setRange} /><AdminRecordTable dateRange={range} onDateRangeChange={setRange} rows={[]} columns={[{ key: 'createdAt', label: 'Date' }]} /></>
  }
  render(<MemoryRouter initialEntries={['/admin/dashboard']}><Dashboard /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Records start date'), { target: { value: '2025-01-01' } })
  expect(screen.getByLabelText('Summary start date').value).toBe('2025-01-01')
  fireEvent.change(screen.getByLabelText('Summary end date'), { target: { value: '2025-01-02' } })
  expect(screen.getByLabelText('Records end date').value).toBe('2025-01-02')
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/appointments', { params: { dateFrom: '2025-01-01', dateTo: '2025-01-02', page: 1, pageSize: 100 } }))
})
it('starts Today, updates range, excludes refunds and reads all payment pages', async () => {
  apiClient.get.mockImplementation(async (path, { params }) => {
    if (path === '/appointments') return [{ id: 'appointment' }]
    const rows = params.page === 1 ? [{ id: 'payment1', createdAt: indiaTodayDate(), status: 'paid', fees: { amount: 500 } }]
      : [{ id: 'refund', createdAt: indiaTodayDate(), status: 'refunded', fees: { amount: 500 } }, { id: 'old', createdAt: '2025-01-01', status: 'paid', fees: { amount: 100 } }]
    Object.defineProperty(rows, '__pagination', { value: { page: params.page, totalPages: 2 } })
    return rows
  })
  render(<MemoryRouter><AdminPeriodSummary /></MemoryRouter>)
  expect(screen.getByLabelText('Summary start date').value).toBe(indiaTodayDate())
  expect(await screen.findByText('₹500')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Summary start date'), { target: { value: '2025-01-01' } })
  await waitFor(() => expect(screen.getByText('₹600')).toBeTruthy())
  expect(apiClient.get).toHaveBeenCalledWith('/appointments', { params: { dateFrom: '2025-01-01', dateTo: indiaTodayDate(), page: 1, pageSize: 100 } })
})
