import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPill } from './StatusPill'

describe('StatusPill', () => {
  it('renders the status text with underscores turned into spaces', () => {
    render(<StatusPill status="no_show" />)
    expect(screen.getByText('no show')).toBeInTheDocument()
  })

  it('only replaces the first underscore (current String.replace behavior)', () => {
    render(<StatusPill status="pending_payment" />)
    expect(screen.getByText('pending payment')).toBeInTheDocument()
  })

  it('maps a known status to its tone class', () => {
    render(<StatusPill status="completed" />)
    // completed -> tone 'success'
    expect(screen.getByText('completed')).toHaveClass('bg-success/10', 'text-success')
  })

  it('falls back to the neutral tone for an unmapped status', () => {
    render(<StatusPill status="totally_unknown" />)
    expect(screen.getByText('totally unknown')).toHaveClass('bg-surface', 'text-muted')
  })

  it('stringifies a non-string status before rendering it', () => {
    render(<StatusPill status={undefined} />)
    expect(screen.getByText('undefined')).toBeInTheDocument()
  })
})
