import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../lib/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  getTokens: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  registerUnauthorizedHandler: vi.fn(),
}))

import { getTokens } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import { ProtectedRoute } from './RoleGuard'

const initialStoreState = useAppStore.getState()

function renderAt(path, { role, currentRole } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path}
          element={
            <ProtectedRoute role={role} currentRole={currentRole}>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/patient/dashboard" element={<div>Patient Dashboard</div>} />
        <Route path="/doctor/dashboard" element={<div>Doctor Dashboard</div>} />
        <Route path="/super-admin/dashboard" element={<div>Super Admin Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  useAppStore.setState(initialStoreState, true)
  getTokens.mockReturnValue(null)
})

describe('ProtectedRoute', () => {
  it('shows a loading skeleton while the session is unverified and a token exists', () => {
    getTokens.mockReturnValue({ accessToken: 'tok-123' })
    useAppStore.setState({ sessionVerified: false, authLoading: false })
    const { container } = renderAt('/doctor/queue', { role: 'doctor', currentRole: 'doctor' })
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('shows a loading skeleton while auth is in flight and a token exists', () => {
    getTokens.mockReturnValue({ accessToken: 'tok-123' })
    useAppStore.setState({ sessionVerified: true, authLoading: true })
    const { container } = renderAt('/doctor/queue', { role: 'doctor', currentRole: 'doctor' })
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
  })

  it('does not show the loading skeleton when there is no stored access token, even if unverified', () => {
    getTokens.mockReturnValue(null)
    useAppStore.setState({ sessionVerified: false, authLoading: false })
    renderAt('/doctor/queue', { role: 'doctor', currentRole: 'doctor' })
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('redirects to /login when there is no active role', () => {
    useAppStore.setState({ sessionVerified: true, authLoading: false })
    renderAt('/doctor/queue', { role: 'doctor', currentRole: undefined })
    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('redirects to the role-appropriate dashboard when the active role does not match', () => {
    useAppStore.setState({ sessionVerified: true, authLoading: false })
    renderAt('/doctor/queue', { role: 'doctor', currentRole: 'patient' })
    expect(screen.getByText('Patient Dashboard')).toBeInTheDocument()
  })

  it('renders the protected children when the active role matches', () => {
    useAppStore.setState({ sessionVerified: true, authLoading: false })
    renderAt('/doctor/queue', { role: 'doctor', currentRole: 'doctor' })
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('lets a superadmin through regardless of the required role', () => {
    useAppStore.setState({ sessionVerified: true, authLoading: false })
    renderAt('/doctor/queue', { role: 'doctor', currentRole: 'superadmin' })
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('renders children when no specific role is required', () => {
    useAppStore.setState({ sessionVerified: true, authLoading: false })
    renderAt('/doctor/queue', { role: undefined, currentRole: 'patient' })
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })
})
