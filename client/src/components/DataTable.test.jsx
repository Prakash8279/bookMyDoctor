import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DataTable } from './DataTable'

// Simulates a phone-width viewport for useIsMobile()'s (max-width: 767px) query — see
// hooks/useIsMobile.test.js for why jsdom needs this stubbed at all (window.matchMedia doesn't
// exist here otherwise).
function mockMobileViewport(matches) {
  window.matchMedia = vi.fn().mockReturnValue({ matches, media: '(max-width: 767px)', addEventListener: () => {}, removeEventListener: () => {} })
}

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status', render: (row) => `[${row.status}]` },
]

describe('DataTable', () => {
  it('renders a loading skeleton while loading', () => {
    const { container } = render(<DataTable columns={columns} loading />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders an error state with a retry button', () => {
    const onRetry = vi.fn()
    render(<DataTable columns={columns} error="Network error" onRetry={onRetry} />)
    expect(screen.getByText('Network error')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders an empty state when there are no rows', () => {
    render(<DataTable columns={columns} rows={[]} />)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
  })

  it('renders column headers and row cells, using a column render function when given', () => {
    const rows = [{ id: 1, name: 'Alice', status: 'active' }]
    render(<DataTable columns={columns} rows={rows} />)
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('[active]')).toBeInTheDocument()
  })

  it('hides pagination controls when there is only one page', () => {
    const rows = [{ id: 1, name: 'Alice', status: 'active' }]
    render(<DataTable columns={columns} rows={rows} pagination={{ page: 1, totalPages: 1 }} />)
    expect(screen.queryByLabelText('Table pagination')).not.toBeInTheDocument()
  })

  it('renders pagination controls and calls onPageChange', () => {
    const rows = [{ id: 1, name: 'Alice', status: 'active' }]
    const onPageChange = vi.fn()
    render(<DataTable columns={columns} rows={rows} pagination={{ page: 2, totalPages: 3 }} onPageChange={onPageChange} />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(3)
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('disables Previous on the first page and Next on the last page', () => {
    const rows = [{ id: 1, name: 'Alice', status: 'active' }]
    render(<DataTable columns={columns} rows={rows} pagination={{ page: 1, totalPages: 3 }} />)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
  })

  // RESPONSIVE-CARDS FIX (user request: "patient and receptionist and admin panel ko fully
  // resposive bnao mobile view v best ho") — below the app's 768px breakpoint, every table this
  // shared component renders switches to a stacked "label: value" card per row instead of a wide
  // table that would force horizontal scrolling on a phone.
  describe('mobile card layout (viewport below 768px)', () => {
    afterEach(() => { delete window.matchMedia })

    it('renders rows as cards, not a table, when the mobile query matches', () => {
      mockMobileViewport(true)
      const rows = [{ id: 1, name: 'Alice', status: 'active' }]
      render(<DataTable columns={columns} rows={rows} />)

      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('[active]')).toBeInTheDocument()
      // Column labels still appear, as each card's own field labels.
      expect(screen.getByText('Name')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
    })

    it('still renders the real table (not cards) when the mobile query does not match', () => {
      mockMobileViewport(false)
      const rows = [{ id: 1, name: 'Alice', status: 'active' }]
      render(<DataTable columns={columns} rows={rows} />)

      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    })

    it('renders a trailing "actionCol"/"actions" column full-width below a card\'s fields, not as another label/value row', () => {
      mockMobileViewport(true)
      const actionColumns = [
        { key: 'name', label: 'Name' },
        { key: 'actionCol', label: 'Actions', render: () => <button type="button">Confirm</button> },
      ]
      const rows = [{ id: 1, name: 'Asha' }]
      render(<DataTable columns={actionColumns} rows={rows} />)

      // No "Actions" field label rendered as a card row — the action column is singled out.
      expect(screen.queryByText('Actions')).not.toBeInTheDocument()
      const card = screen.getByText('Asha').closest('li')
      expect(within(card).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    })

    it('paginates the same way in card view', () => {
      mockMobileViewport(true)
      const rows = [{ id: 1, name: 'Alice', status: 'active' }]
      const onPageChange = vi.fn()
      render(<DataTable columns={columns} rows={rows} pagination={{ page: 2, totalPages: 3 }} onPageChange={onPageChange} />)
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      expect(onPageChange).toHaveBeenCalledWith(3)
    })
  })
})
