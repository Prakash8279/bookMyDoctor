import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the default title and message when none are given', () => {
    render(<EmptyState />)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
    expect(screen.getByText('New items will appear here when available.')).toBeInTheDocument()
  })

  it('renders a custom title and message', () => {
    render(<EmptyState title="No results" message="Try a different search." />)
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByText('Try a different search.')).toBeInTheDocument()
  })

  it('renders children after the message', () => {
    render(
      <EmptyState>
        <button>Retry</button>
      </EmptyState>
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('exposes a status role for accessibility', () => {
    render(<EmptyState />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
