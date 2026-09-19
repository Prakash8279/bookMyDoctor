import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('defaults to the neutral tone classes', () => {
    render(<Badge>Default</Badge>)
    expect(screen.getByText('Default')).toHaveClass('bg-surface', 'text-muted')
  })

  it('applies the classes for a known tone', () => {
    render(<Badge tone="success">Paid</Badge>)
    expect(screen.getByText('Paid')).toHaveClass('bg-success/10', 'text-success')
  })

  it('applies distinct classes per tone', () => {
    render(<Badge tone="error">Cancelled</Badge>)
    expect(screen.getByText('Cancelled')).toHaveClass('bg-error/10', 'text-error')
  })
})
