import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SiteFooter } from './SiteFooter'

function renderFooter() {
  return render(
    <MemoryRouter>
      <SiteFooter />
    </MemoryRouter>
  )
}

describe('SiteFooter', () => {
  it('renders the brand name linking home', () => {
    renderFooter()
    expect(screen.getByRole('link', { name: /BookMyDoctor24/ })).toHaveAttribute('href', '/')
  })

  it('renders the patient section links', () => {
    renderFooter()
    expect(screen.getByRole('link', { name: 'Find a doctor' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'My appointments' })).toHaveAttribute('href', '/patient/appointments')
    expect(screen.getByRole('link', { name: 'Live queue' })).toHaveAttribute('href', '/patient/queue')
    expect(screen.getByRole('link', { name: 'Health records' })).toHaveAttribute('href', '/patient/records')
  })

  it('renders the professionals section links', () => {
    renderFooter()
    expect(screen.getByRole('link', { name: 'Join as a doctor' })).toHaveAttribute('href', '/register?role=doctor')
    expect(screen.getByRole('link', { name: 'Doctor portal' })).toHaveAttribute('href', '/doctor/dashboard')
    expect(screen.getByRole('link', { name: 'Reception portal' })).toHaveAttribute('href', '/receptionist/dashboard')
    expect(screen.getByRole('link', { name: 'Admin portal' })).toHaveAttribute('href', '/admin/dashboard')
  })

  it('renders contact details and a support link', () => {
    renderFooter()
    expect(screen.getByText('India')).toBeInTheDocument()
    expect(screen.getByText('Support available 9 AM–8 PM')).toBeInTheDocument()
    expect(screen.getByText('bookmydoctor24@gmail.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/contact')
  })

  it('renders the copyright line and legal links', () => {
    renderFooter()
    expect(screen.getByText('© 2026 BookMyDoctor24. All rights reserved.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    expect(screen.getByText(/Accessibility/)).toBeInTheDocument()
  })
})
