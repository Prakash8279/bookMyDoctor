import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LiveQueueWidget } from './LiveQueueWidget'

describe('LiveQueueWidget', () => {
  it('renders a loading skeleton while loading', () => {
    const { container } = render(<LiveQueueWidget loading />)
    expect(screen.getByLabelText('Loading live queue')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1)
  })

  it('renders an error state without a retry button when onRetry is not given', () => {
    render(<LiveQueueWidget error="boom" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Live queue is temporarily unavailable')
    expect(screen.queryByRole('button', { name: 'Refresh queue' })).not.toBeInTheDocument()
  })

  it('renders a retry button in the error state and calls onRetry when clicked', () => {
    const onRetry = vi.fn()
    render(<LiveQueueWidget error="boom" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh queue' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows a pre-check-in message when there is no queue data at all', () => {
    render(<LiveQueueWidget appointmentId="apt-1" />)
    expect(screen.getByText('Your token will appear after check-in')).toBeInTheDocument()
  })

  it('shows a pre-check-in message when initialQueue explicitly has a null token', () => {
    render(
      <LiveQueueWidget
        initialQueue={{ token: null, nowServing: null, patientsAhead: null, estimatedWait: null, doctorStatus: 'closed' }}
      />
    )
    expect(screen.getByText('Your token will appear after check-in')).toBeInTheDocument()
  })

  it('renders live queue details when a token is present', () => {
    render(
      <LiveQueueWidget
        initialQueue={{ token: 12, nowServing: 9, patientsAhead: 3, estimatedWait: '15 mins', doctorStatus: 'running' }}
      />
    )
    expect(screen.getByLabelText('Live queue status')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('15 mins')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('does not render an error or pre-check-in state once a token exists', () => {
    render(
      <LiveQueueWidget
        initialQueue={{ token: 12, nowServing: 9, patientsAhead: 3, estimatedWait: '15 mins', doctorStatus: 'running' }}
      />
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Your token will appear after check-in')).not.toBeInTheDocument()
  })

  it('updates its displayed queue when the initialQueue prop changes', () => {
    const { rerender } = render(
      <LiveQueueWidget initialQueue={{ token: 7, nowServing: 4, patientsAhead: 2, estimatedWait: '8 mins', doctorStatus: 'serving' }} />
    )
    expect(screen.getByText('7')).toBeInTheDocument()
    rerender(
      <LiveQueueWidget
        initialQueue={{ token: 20, nowServing: 15, patientsAhead: 5, estimatedWait: '2 mins', doctorStatus: 'serving' }}
      />
    )
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.queryByText('7')).not.toBeInTheDocument()
  })
})
