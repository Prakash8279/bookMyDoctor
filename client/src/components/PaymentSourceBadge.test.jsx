import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaymentSourceBadge } from './PaymentSourceBadge'

describe('PaymentSourceBadge', () => {
  it('shows "At booking" for a Razorpay-verified online payment', () => {
    render(<PaymentSourceBadge payment={{ mode: 'online', transactionRef: 'pay_xyz789' }} />)
    expect(screen.getByText('At booking')).toBeInTheDocument()
  })

  it('shows "At clinic" for cash', () => {
    render(<PaymentSourceBadge payment={{ mode: 'cash' }} />)
    expect(screen.getByText('At clinic')).toBeInTheDocument()
  })

  it('shows "At clinic" for a receptionist-recorded online/UPI/card payment (not a Razorpay id)', () => {
    render(<PaymentSourceBadge payment={{ mode: 'upi', transactionRef: 'UTR998877' }} />)
    expect(screen.getByText('At clinic')).toBeInTheDocument()
  })

  it('renders nothing when there is no payment mode at all', () => {
    const { container } = render(<PaymentSourceBadge payment={{}} />)
    expect(container).toBeEmptyDOMElement()
    const { container: container2 } = render(<PaymentSourceBadge payment={null} />)
    expect(container2).toBeEmptyDOMElement()
  })
})
