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
    const { container } = renderLayout('doctor')
    const aside = container.querySelector('aside')
    expect(aside).toHaveClass('-translate-x-full')
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(aside).toHaveClass('translate-x-0')
    expect(screen.getByRole('button', { name: 'Close navigation' })).toBeInTheDocument()
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
})
