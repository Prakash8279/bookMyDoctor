import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PortalLayout } from './PortalLayout'
import { useAppStore } from '../store/useAppStore'

const initialStoreState = useAppStore.getState()

beforeEach(() => {
  useAppStore.setState(initialStoreState, true)
})

function renderLayout(role, onLogout = () => {}) {
  return render(
    <MemoryRouter initialEntries={['/doctor/dashboard']}>
      <Routes>
        <Route path="/doctor/dashboard" element={<PortalLayout role={role} onLogout={onLogout} />}>
          <Route index element={<div>Page Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('PortalLayout', () => {
  it('renders the routed child content inside the main area', () => {
    renderLayout('doctor')
    expect(screen.getByText('Page Content')).toBeInTheDocument()
    expect(screen.getByRole('main')).toContainElement(screen.getByText('Page Content'))
  })

  it('renders the sidebar for the given role', () => {
    renderLayout('doctor')
    expect(screen.getByRole('link', { name: 'Queue management' })).toHaveAttribute('href', '/doctor/queue')
  })

  it('shows the sidebar collapsed by default and opens it via the header menu button', () => {
    const { container } = renderLayout('admin')
    const aside = container.querySelector('aside')
    expect(aside).toHaveClass('-translate-x-full')
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(aside).toHaveClass('translate-x-0')
    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeInTheDocument()
  })

  it('uses the compact mobile layout for doctor while retaining the desktop sidebar', () => {
    useAppStore.setState({ currentUser: { role: 'doctor', name: 'Dr. Rao' } })
    const { container } = renderLayout('doctor')
    expect(container.querySelector('aside').parentElement).toHaveClass('hidden', 'lg:block')
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Doctor bottom navigation' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('portal-content--with-bottom-nav')
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/doctor/schedule')
  })

  it('uses the compact mobile layout for receptionist while retaining the desktop sidebar', () => {
    useAppStore.setState({ currentUser: { role: 'receptionist', name: 'Meera' } })
    const { container } = render(
      <MemoryRouter initialEntries={['/receptionist/dashboard']}>
        <Routes><Route path="/receptionist/dashboard" element={<PortalLayout role="receptionist" onLogout={() => {}} />}><Route index element={<div>Reception Content</div>} /></Route></Routes>
      </MemoryRouter>
    )
    expect(container.querySelector('aside').parentElement).toHaveClass('hidden', 'lg:block')
    expect(screen.getByRole('navigation', { name: 'Receptionist bottom navigation' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Walk-in' })).toHaveAttribute('href', '/receptionist/walk-in')
  })

  it('overrides the passed-in role with superadmin when the signed-in user is a superadmin', () => {
    useAppStore.setState({ currentUser: { role: 'superadmin', name: 'Root' } })
    renderLayout('doctor')
    expect(screen.queryByRole('link', { name: 'Queue management' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Control center' })).toHaveAttribute('href', '/super-admin/dashboard')
  })

  it('uses the given role when the signed-in user is not a superadmin', () => {
    useAppStore.setState({ currentUser: { role: 'doctor', name: 'Dr. Rao' } })
    renderLayout('doctor')
    expect(screen.getByRole('link', { name: 'Queue management' })).toBeInTheDocument()
  })

  it('passes onLogout through to the sidebar sign-out action', async () => {
    const onLogout = vi.fn().mockResolvedValue()
    renderLayout('doctor', onLogout)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1))
  })

  it('keeps theme and sign-out actions out of the compact portal header', () => {
    useAppStore.setState({ currentUser: { role: 'doctor', name: 'Dr. Rao' } })
    renderLayout('doctor')
    expect(screen.queryByRole('button', { name: 'Sign out from account' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Switch to .* theme/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', '/doctor/profile')
  })

  it('hides the patient sidebar on mobile while preserving the original desktop sidebar', () => {
    useAppStore.setState({ currentUser: { role: 'patient', name: 'Asha Mehta' } })
    const { container } = render(
      <MemoryRouter initialEntries={['/patient/dashboard']}>
        <Routes>
          <Route path="/patient/dashboard" element={<PortalLayout role="patient" onLogout={() => {}} />}>
            <Route index element={<div>Patient Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    const aside = container.querySelector('aside')
    expect(aside).toBeInTheDocument()
    expect(aside.parentElement).toHaveClass('hidden', 'lg:block')
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Patient bottom navigation' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/patient/dashboard')
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/patient/profile')
    expect(screen.getByRole('link', { name: 'Book appointment' })).toHaveAttribute('href', '/patient/book')
  })
})
