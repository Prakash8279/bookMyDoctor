import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DataTable } from './DataTable'

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
})
