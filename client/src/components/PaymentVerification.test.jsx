import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PaymentVerification } from './PaymentVerification'

describe('payment waiting screen', () => {
  it('shows a one-minute countdown without claiming success or inventing a token', () => {
    render(<MemoryRouter><PaymentVerification verification={{ phase: 'verifying', secondsLeft: 60 }} /></MemoryRouter>)
    expect(screen.getByRole('timer')).toHaveTextContent('1:00')
    expect(screen.getByRole('status')).toHaveTextContent('Please do not pay again')
    expect(screen.queryByText(/Payment successful|Token #/)).not.toBeInTheDocument()
  })
  it('offers status retry, not another payment, after the waiting budget expires', () => {
    const retry = vi.fn()
    render(<MemoryRouter><PaymentVerification verification={{ phase: 'pending', secondsLeft: 0 }} onRetry={retry} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Check status again' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: 'View my appointments' })).toHaveAttribute('href', '/patient/appointments')
  })
})
