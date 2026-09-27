import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar, PortalHeader } from './Sidebar'
import { useAppStore } from '../store/useAppStore'

const initialStoreState = useAppStore.getState()

beforeEach(() => {
  useAppStore.setState(initialStoreState, true)
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('Sidebar', () => {
  it('renders the brand link pointing home', () => {
    render(
      <MemoryRouter>
        <Sidebar role="patient" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /BookMyDoctors/ })).toHaveAttribute('href', '/')
  })

  it('renders the nav items for the given role', () => {
    render(
      <MemoryRouter>
        <Sidebar role="patient" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'Book appointment' })).toHaveAttribute('href', '/patient/book')
    expect(screen.getByRole('link', { name: 'Queue tracker' })).toHaveAttribute('href', '/patient/queue')
    expect(screen.queryByRole('link', { name: 'Doctors' })).not.toBeInTheDocument()
  })

  it('shows the role label, portal suffix, and a fallback display name when no user is loaded', () => {
    render(
      <MemoryRouter>
        <Sidebar role="doctor" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('Doctor portal')).toBeInTheDocument()
    expect(screen.getByText('Doctor account')).toBeInTheDocument()
  })

  it('uses "control panel" as the suffix for admin and superadmin roles', () => {
    render(
      <MemoryRouter>
        <Sidebar role="admin" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('Admin control panel')).toBeInTheDocument()
  })

  it('falls back to a capitalized role label for an unmapped role', () => {
    render(
      <MemoryRouter>
        <Sidebar role="nurse" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('Nurse portal')).toBeInTheDocument()
  })

  it('shows the current user name instead of the fallback account label', () => {
    useAppStore.setState({ currentUser: { name: 'Asha Rao', role: 'doctor' } })
    render(
      <MemoryRouter>
        <Sidebar role="doctor" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
  })

  it('highlights the active nav link based on the current location', () => {
    render(
      <MemoryRouter initialEntries={['/patient/queue']}>
        <Sidebar role="patient" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'Queue tracker' })).toHaveClass('bg-primary-dark', 'text-white')
    expect(screen.getByRole('link', { name: 'Book appointment' })).toHaveClass('text-white/75')
  })

  it('inserts an "Admin workspace" divider before the admin-panel items in the superadmin menu', () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar role="superadmin" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('Admin workspace')).toBeInTheDocument()
    const navText = container.querySelector('nav').textContent
    expect(navText.indexOf('Admin workspace')).toBeLessThan(navText.indexOf('Doctors'))
  })

  it('does not show the "Admin workspace" divider for the plain admin role', () => {
    render(
      <MemoryRouter>
        <Sidebar role="admin" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.queryByText('Admin workspace')).not.toBeInTheDocument()
  })

  it('renders no nav items for an unknown role', () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar role="ghost" open onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(container.querySelectorAll('nav a')).toHaveLength(0)
  })

  it('shows the mobile close backdrop when open and calls onClose when it is clicked', () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <Sidebar role="patient" open onClose={onClose} onLogout={() => {}} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides the mobile close backdrop when closed', () => {
    render(
      <MemoryRouter>
        <Sidebar role="patient" open={false} onClose={() => {}} onLogout={() => {}} />
      </MemoryRouter>
    )
    expect(screen.queryByRole('button', { name: 'Close navigation' })).not.toBeInTheDocument()
  })

  it('signs out: clears local role/email storage, calls onLogout and onClose', async () => {
    localStorage.setItem('dc-role', 'patient')
    localStorage.setItem('dc-email', 'a@b.com')
    const onLogout = vi.fn().mockResolvedValue()
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <Sidebar role="patient" open onClose={onClose} onLogout={onLogout} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('dc-role')).toBeNull()
    expect(localStorage.getItem('dc-email')).toBeNull()
  })
})

describe('PortalHeader', () => {
  it('calls onMenu when the mobile menu button is clicked', () => {
    const onMenu = vi.fn()
    render(
      <MemoryRouter>
        <PortalHeader role="patient" onMenu={onMenu} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(onMenu).toHaveBeenCalledTimes(1)
  })

  it('shows the matching page label for the current location', () => {
    render(
      <MemoryRouter initialEntries={['/patient/queue']}>
        <PortalHeader role="patient" onMenu={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('Queue tracker')).toBeInTheDocument()
  })

  it('falls back to "Dashboard" for an unmatched path on a regular role', () => {
    render(
      <MemoryRouter initialEntries={['/patient/unmapped']}>
        <PortalHeader role="patient" onMenu={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('falls back to "Control center" for an unmatched path on the superadmin role', () => {
    render(
      <MemoryRouter initialEntries={['/nowhere']}>
        <PortalHeader role="superadmin" onMenu={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('Control center')).toBeInTheDocument()
  })

  it('links the profile avatar to the role profile page', () => {
    render(
      <MemoryRouter>
        <PortalHeader role="doctor" onMenu={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', '/doctor/profile')
  })

  it('links to the super-admin profile page for the superadmin role', () => {
    render(
      <MemoryRouter>
        <PortalHeader role="superadmin" onMenu={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', '/super-admin/profile')
  })

  it('shows initials derived from the display name when there is no profile photo', () => {
    useAppStore.setState({ currentUser: { name: 'Asha Rao', role: 'doctor' } })
    render(
      <MemoryRouter>
        <PortalHeader role="doctor" onMenu={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText('AR')).toBeInTheDocument()
  })

  it('renders the profile photo when the user has one', () => {
    useAppStore.setState({ currentUser: { name: 'Asha Rao', role: 'doctor', photoUrl: 'https://example.com/a.jpg' } })
    render(
      <MemoryRouter>
        <PortalHeader role="doctor" onMenu={() => {}} />
      </MemoryRouter>
    )
    const img = screen.getByRole('img', { name: 'Asha Rao profile' })
    expect(img).toHaveAttribute('src', 'https://example.com/a.jpg')
  })

  it('toggles the theme and persists it to localStorage', () => {
    render(
      <MemoryRouter>
        <PortalHeader role="patient" onMenu={() => {}} />
      </MemoryRouter>
    )
    const toggle = screen.getByRole('button', { name: 'Switch to dark theme' })
    fireEvent.click(toggle)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('dc-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
  })

  it('initializes dark mode from the document attribute already set', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    render(
      <MemoryRouter>
        <PortalHeader role="patient" onMenu={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
  })
})
