// Integration test: failed login shows an inline error and does not navigate.
//
// Exercises together, for real: the real store's login() action rejecting and re-throwing (it
// deliberately swallows nothing — see useAppStore.js's login comment), the real Login page
// component's try/catch -> setError() -> role="alert" banner, and React Router NOT navigating
// away from /login. Only apiClient.post (the network boundary) is mocked, rejecting the way a
// real 401 from POST /auth/login would surface once axios's interceptor has already unwrapped it
// into a plain Error with a `.message` (see apiClient.js's shapeError).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

const initialStoreState = useAppStore.getState()

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(initialStoreState, true)
  vi.clearAllMocks()
  getTokens.mockReturnValue(null)
  apiClient.get.mockImplementation(() => Promise.resolve([]))
  apiClient.post.mockImplementation(() => Promise.resolve({}))
})

afterEach(() => {
  localStorage.clear()
})

describe('login flow — invalid credentials', () => {
  it('shows an inline error banner and stays on /login', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/auth/login') return Promise.reject(new Error('Invalid email or password.'))
      return Promise.resolve({})
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    )

    const emailInput = await screen.findByLabelText(/Email address/i)
    fireEvent.change(emailInput, { target: { value: 'asha@example.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))

    // Real store.login() rethrows; the real Login component's catch block surfaces it.
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.')

    // Still on the login page — the email field the user typed into is still there, and no
    // protected/dashboard content ever mounted.
    expect(screen.getByLabelText(/Email address/i)).toBeInTheDocument()
    expect(screen.queryByText(/Welcome,/i)).not.toBeInTheDocument()

    // The store itself never entered an authenticated state.
    const state = useAppStore.getState()
    expect(state.currentUser).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.authLoading).toBe(false)

    // GET /me must never have been reached — login() throws before that call when the
    // credentials POST itself rejects.
    expect(apiClient.get).not.toHaveBeenCalledWith('/me')
  })

  it('re-enables the form and clears the busy state after the failed attempt', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/auth/login') return Promise.reject(new Error('Invalid email or password.'))
      return Promise.resolve({})
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    )

    fireEvent.change(await screen.findByLabelText(/Email address/i), { target: { value: 'x@example.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'bad' } })
    const submitButton = screen.getByRole('button', { name: /Sign in/i })
    fireEvent.click(submitButton)

    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: /Sign in/i })).not.toBeDisabled()
  })
})
