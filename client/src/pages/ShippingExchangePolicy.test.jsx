import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ShippingExchangePolicy } from './ShippingExchangePolicy'

vi.mock('./PublicPages', () => ({ SiteHeader: () => <header>BookADoctors</header> }))

describe('ShippingExchangePolicy', () => {
  it('explains that shipping and product exchanges do not apply to appointment services', () => {
    render(<MemoryRouter><ShippingExchangePolicy /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Shipping & Exchange Policy' })).toBeInTheDocument()
    expect(screen.getByText(/We do not sell or ship physical products/)).toBeInTheDocument()
    expect(screen.getByText(/confirmation and token allocation depend on successful payment verification/)).toBeInTheDocument()
    expect(screen.getByText('Last updated: 21 October 2026')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancellation & Refund Policy' })).toHaveAttribute('href', '/cancellation-refund-policy')
    expect(screen.getByRole('link', { name: 'contact support' })).toHaveAttribute('href', '/contact')
  })
})
