// Unit/integration tests for the admin-only platform-fee/commission settings page.
//
// Direct-renders the real PlatformCharges component (no router hooks used inside it) backed by
// the real Zustand store, mocking only the network boundary (src/lib/apiClient.js) — same
// convention as src/integration/login-flow.test.jsx. A separate suite at the bottom renders the
// real <App> to exercise RoleGuard's role gating for this page's two routes
// (/admin/platform-fee, /super-admin/charges).
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
import { PlatformCharges } from './PlatformCharges'
import App from '../App'

const initialStoreState = useAppStore.getState()

const SAVED_CHARGES = {
  commissionPercent: 12,
  patientConvenienceFee: 30,
  emergencyFee: 60,
  gstPercent: 18,
  applyConvenienceFee: true,
  applyEmergencyFee: true,
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(initialStoreState, true)
  vi.clearAllMocks()
  getTokens.mockReturnValue(null)
})

afterEach(() => {
  localStorage.clear()
})

describe('PlatformCharges', () => {
  // Regression test for a real bug found while writing these tests: see the fix comment above
  // `normalizeCharges` in PlatformCharges.jsx. `state.data.platformCharges` starts as `null`
  // (useAppStore.js's DEFAULT_DATA_SHAPE) until the fetch effect resolves — mounting the page
  // fresh (the store's real initial state, no pre-population) used to throw synchronously on the
  // very first render instead of showing the loading skeleton.
  it('does not crash when mounted before any platform-charges fetch has resolved', () => {
    apiClient.get.mockImplementation(() => new Promise(() => {})) // never resolves
    expect(useAppStore.getState().data.platformCharges).toBeNull()

    render(<PlatformCharges />)

    expect(screen.getByText('Platform charges')).toBeInTheDocument()
  })

  it('shows a loading skeleton and no form while the fetch is in flight', async () => {
    let resolveFetch
    apiClient.get.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))

    render(<PlatformCharges />)

    expect(screen.getByText('Platform charges')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save platform charges/i })).not.toBeInTheDocument()

    resolveFetch(SAVED_CHARGES)
    expect(await screen.findByRole('button', { name: /Save platform charges/i })).toBeInTheDocument()
  })

  it('renders fetched charges into the form and computes the live example bill', async () => {
    apiClient.get.mockResolvedValue(SAVED_CHARGES)

    render(<PlatformCharges />)

    // "Clinic commission (%)" is no longer shown/editable on this page (superadmin request —
    // commission is a platform-internal figure, not something patients pay), so it's
    // deliberately not asserted here.
    expect(await screen.findByLabelText(/Platform charge \(₹\)/)).toHaveValue(30)
    expect(screen.getByLabelText(/Emergency booking fee \(₹\)/)).toHaveValue(60)
    expect(screen.getByLabelText(/^Transaction charge \(%\)/)).toHaveValue(18)
    expect(screen.getByLabelText('Apply platform charge to online bookings')).toBeChecked()
    expect(screen.getByLabelText('Apply emergency fee to urgent bookings')).toBeChecked()

    // The example bill defaults to a non-emergency booking: consultation 900 + platform charge 30
    // = 930 subtotal; GST 18% of 930 = 167.4; total = 1097.4 -> formatMoney rounds to 2 decimal
    // places, en-IN grouping. Platform charge and emergency fee are mutually exclusive (see
    // appointments.service.js#runBookingJob) — the emergency fee only appears once the "This is an
    // emergency booking" toggle below is checked, at which point the platform charge drops to 0.
    expect(screen.getByText('₹1,097.4')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('This is an emergency booking'))
    // consultation 900 + emergency 60 (platform charge now 0) = 960 subtotal; GST 18% of 960 =
    // 172.8; total = 1132.8.
    expect(screen.getByText('₹1,132.8')).toBeInTheDocument()
  })

  it('shows an inline error when the initial fetch fails', async () => {
    apiClient.get.mockRejectedValue(new Error('Network down'))

    render(<PlatformCharges />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
  })

  it('submits the full-replace payload, leaving commissionPercent untouched since it is not editable here', async () => {
    apiClient.get.mockResolvedValue(SAVED_CHARGES)
    apiClient.put.mockResolvedValue({ ...SAVED_CHARGES, applyEmergencyFee: false })

    render(<PlatformCharges />)
    await screen.findByLabelText(/Platform charge \(₹\)/)

    fireEvent.click(screen.getByLabelText('Apply emergency fee to urgent bookings'))
    fireEvent.click(screen.getByRole('button', { name: /Save platform charges/i }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1))
    // PUT /platform-charges is still a full-replace (all 6 fields required server-side), so the
    // page keeps sending back the commissionPercent it loaded (12) unchanged, even though there's
    // no field on screen to edit it any more.
    expect(apiClient.put).toHaveBeenCalledWith('/platform-charges', {
      commissionPercent: 12,
      patientConvenienceFee: 30,
      emergencyFee: 60,
      gstPercent: 18,
      applyConvenienceFee: true,
      applyEmergencyFee: false,
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Charges saved and connected to future bookings.')
  })

  it('shows an inline error and leaves the form editable when saving fails', async () => {
    apiClient.get.mockResolvedValue(SAVED_CHARGES)
    apiClient.put.mockRejectedValue(new Error('Commission must be between 0 and 100.'))

    render(<PlatformCharges />)
    await screen.findByLabelText(/Platform charge \(₹\)/)
    fireEvent.click(screen.getByRole('button', { name: /Save platform charges/i }))

    expect(await screen.findByText('Commission must be between 0 and 100.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save platform charges/i })).not.toBeDisabled()
  })

  it('shows the superadmin-facing subtitle when rendered for that audience', async () => {
    apiClient.get.mockResolvedValue(SAVED_CHARGES)

    render(<PlatformCharges audience="superadmin" />)

    expect(await screen.findByText(/Set the global pricing rules used across every clinic and online booking\./)).toBeInTheDocument()
  })
})

describe('PlatformCharges role gating (RoleGuard, via App)', () => {
  const ADMIN_USER = { id: 'admin-1', name: 'Priya Admin', email: 'priya@example.com', role: 'admin' }
  const DOCTOR_USER = { id: 'doc-1', name: 'Dr. Nikhil Rao', email: 'nikhil@example.com', role: 'doctor' }

  function mockBootFor(user) {
    getTokens.mockReturnValue({ accessToken: 'tok' })
    apiClient.post.mockResolvedValue({})
    apiClient.get.mockImplementation((url) => {
      if (url === '/me') return Promise.resolve(user)
      return Promise.resolve([])
    })
  }

  it('lets an admin reach /admin/platform-fee and see the real page', async () => {
    mockBootFor(ADMIN_USER)

    render(
      <MemoryRouter initialEntries={['/admin/platform-fee']}>
        <App />
      </MemoryRouter>
    )

    expect(await screen.findByText('Platform charges')).toBeInTheDocument()
    expect(screen.getByText('Set the platform fee and commission rules for BookADoctors.')).toBeInTheDocument()
  })

  it('redirects a doctor away from the admin-only /admin/platform-fee route', async () => {
    mockBootFor(DOCTOR_USER)

    render(
      <MemoryRouter initialEntries={['/admin/platform-fee']}>
        <App />
      </MemoryRouter>
    )

    // RoleGuard bounces a role mismatch to that role's own dashboard instead of showing the
    // admin-only page.
    expect(await screen.findByText(/Welcome, Nikhil\./i)).toBeInTheDocument()
    expect(screen.queryByText('Platform charges')).not.toBeInTheDocument()
  })
})
