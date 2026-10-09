// Integration test: successful login flow.
//
// Exercises together, for real: React Router navigation (MemoryRouter + App's own <Routes>),
// the real Zustand store (src/store/useAppStore.js — its `login`/`loadUserData` actions, and the
// route guards in RoleGuard.jsx reading `currentUser`/`sessionVerified` from it), and the real
// page composition (App -> Login (src/pages/PublicPages.jsx) -> post-login redirect ->
// ProtectedRoute -> PortalLayout -> PatientDashboard (src/pages/PatientPages.jsx)).
//
// Only the network boundary (src/lib/apiClient.js's default-exported axios instance) is mocked —
// per that file, every store action calls `apiClient.get/post/patch/put/delete` and never touches
// axios directly, so mocking just this one module lets the real store/router/component code run.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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

import apiClient, { getTokens } from '../lib/apiClient'
import { useAppStore } from '../store/useAppStore'
import App from '../App'

// Snapshot of the store's state exactly as it is right after module load (before any test has
// touched it) — used to fully reset the real, singleton store between tests without mocking it.
const initialStoreState = useAppStore.getState()

const PATIENT_USER = {
  id: 'user-1',
  name: 'Asha Mehta',
  email: 'asha@example.com',
  role: 'patient',
}

function mockAnonymousBoot() {
  // No stored session — App.jsx's boot effect takes the `loadPublicDirectory()` branch, which
  // fires several GETs (cities/areas/specializations/doctors/clinics/reviews) via
  // Promise.allSettled. Everything not explicitly matched below resolves to an empty list so
  // that code doing `(data.xxx || []).map(...)` never crashes.
  getTokens.mockReturnValue(null)
  apiClient.get.mockImplementation(() => Promise.resolve([]))
  apiClient.post.mockImplementation(() => Promise.resolve({}))
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(initialStoreState, true)
  vi.clearAllMocks()
  mockAnonymousBoot()
})

afterEach(() => {
  localStorage.clear()
})

describe('login flow', () => {
  it('logs a patient in and lands on the patient dashboard', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/auth/login') {
        return Promise.resolve({ accessToken: 'access-token-1', refreshToken: 'refresh-token-1' })
      }
      return Promise.resolve({})
    })
    apiClient.get.mockImplementation((url) => {
      if (url === '/me') return Promise.resolve(PATIENT_USER)
      // loadPublicDirectory + loadUserData(patient) endpoints — plain empty lists are enough for
      // the dashboard to render without crashing.
      return Promise.resolve([])
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    )

    // Wait past the initial public-directory bulk load splash and the lazy-loaded Login chunk.
    const emailInput = await screen.findByLabelText(/Email address/i)
    const passwordInput = screen.getByLabelText(/Password/i)

    fireEvent.change(emailInput, { target: { value: 'asha@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'correct-horse-battery-staple' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))

    // Real store.login() -> POST /auth/login -> GET /me -> currentUser set -> Login navigates to
    // roleHome('patient') = '/patient/dashboard' -> ProtectedRoute (real RoleGuard) lets it
    // through because currentRole now matches -> the real, lazy-loaded PatientDashboard renders.
    expect(await screen.findByText(/Welcome, Asha\./i, {}, { timeout: 5000 })).toBeInTheDocument()

    // Confirm the store itself (not just the DOM) reflects a real, verified session.
    const state = useAppStore.getState()
    expect(state.currentUser).toEqual(PATIENT_USER)
    expect(state.isAuthenticated).toBe(true)
    expect(state.sessionVerified).toBe(true)

    // The login POST really carried the credentials typed into the real form.
    expect(apiClient.post).toHaveBeenCalledWith('/auth/login', {
      email: 'asha@example.com',
      password: 'correct-horse-battery-staple',
    })

    // The Login page (and its "Sign in" button) is gone — we've actually navigated away.
    expect(screen.queryByLabelText(/Email address/i)).not.toBeInTheDocument()
  })

  it('routes a doctor to the doctor dashboard instead of the patient one', async () => {
    const doctorUser = { id: 'doc-1', name: 'Dr. Nikhil Rao', email: 'nikhil@example.com', role: 'doctor' }
    apiClient.post.mockImplementation((url) => {
      if (url === '/auth/login') return Promise.resolve({ accessToken: 'tok', refreshToken: 'reftok' })
      return Promise.resolve({})
    })
    apiClient.get.mockImplementation((url) => {
      if (url === '/me') return Promise.resolve(doctorUser)
      return Promise.resolve([])
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    )

    fireEvent.change(await screen.findByLabelText(/Email address/i), { target: { value: 'nikhil@example.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'whatever-1' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))

    await waitFor(() => expect(useAppStore.getState().currentUser?.role).toBe('doctor'))
    // DoctorDashboard (src/pages/StaffPages.jsx) strips a leading "Dr." honorific and greets by
    // first name only: `Welcome, ${firstName}.` where firstName = "Nikhil" here.
    expect(await screen.findByText(/Welcome, Nikhil\./i)).toBeInTheDocument()
  })
})
