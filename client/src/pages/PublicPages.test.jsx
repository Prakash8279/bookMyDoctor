// Unit tests for the guest-facing/marketing page components in PublicPages.jsx.
//
// Follows the convention from src/integration/login-flow.test.jsx: only the network boundary
// (src/lib/apiClient.js) is mocked, everything else (React Router, the real Zustand store) runs
// for real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

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

// GOOGLE SIGN-IN FEATURE — the picker itself (loading Google's script, rendering its real hidden
// button, waiting for the credential) is browser/GIS machinery with nothing to do with React;
// these tests mock it at this boundary and exercise everything downstream for real (the store's
// loginWithGoogle action, the actual POST /auth/google call, navigation).
vi.mock('../lib/googleSignIn', () => ({
  signInWithGoogle: vi.fn(),
}))

import apiClient, { getTokens } from '../lib/apiClient'
import { signInWithGoogle } from '../lib/googleSignIn'
import { useAppStore } from '../store/useAppStore'
import {
  SiteHeader,
  DoctorCard,
  SearchResults,
  DoctorProfile,
  EmergencyPage,
  Login,
  Register,
  ForgotPassword,
  ResetPassword,
} from './PublicPages'

const initialStoreState = useAppStore.getState()

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(initialStoreState, true)
  vi.clearAllMocks()
  getTokens.mockReturnValue(null)
  apiClient.get.mockImplementation(() => Promise.resolve([]))
  apiClient.post.mockImplementation(() => Promise.resolve({}))
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

// Renders `ui` plus an always-mounted probe that exposes the router's current location, so tests
// can assert where a navigate()/redirect actually landed without needing a full <Routes> tree.
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe" data-pathname={location.pathname} data-search={location.search} />
}
function renderWithLocation(ui, { initialEntries = ['/'] } = {}) {
  render(
    <MemoryRouter initialEntries={initialEntries}>
      {ui}
      <LocationProbe />
    </MemoryRouter>
  )
}

const doctor = {
  id: 'doc-1',
  name: 'Dr. Asha Rao',
  specialization: { name: 'Cardiology' },
  experienceYears: 8,
  rating: 4.7,
  consultationFee: 700,
  onlineBooking: true,
  clinics: [{ id: 'clinic-1', name: 'Heart Care Clinic', area: 'Andheri', city: 'Mumbai' }],
}

describe('SiteHeader', () => {
  it('shows guest navigation (Log in / Get started) when no user is signed in', () => {
    render(<MemoryRouter><SiteHeader /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/register')
    expect(screen.queryByLabelText('Open profile')).not.toBeInTheDocument()
  })

  it('shows the signed-in profile link with initials when a user is authenticated', () => {
    useAppStore.setState({ currentUser: { name: 'Asha Mehta', role: 'patient' } })
    render(<MemoryRouter><SiteHeader /></MemoryRouter>)
    const profileLink = screen.getByLabelText('Open profile')
    expect(profileLink).toHaveAttribute('href', '/patient/profile')
    expect(screen.getByText('AM')).toBeInTheDocument()
    expect(screen.getByText('Asha Mehta')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument()
  })

  it('routes a superadmin profile link to /super-admin/profile', () => {
    useAppStore.setState({ currentUser: { name: 'Root Admin', role: 'superadmin' } })
    render(<MemoryRouter><SiteHeader /></MemoryRouter>)
    expect(screen.getByLabelText('Open profile')).toHaveAttribute('href', '/super-admin/profile')
  })

  it('toggles the mobile navigation drawer open and closed', () => {
    render(<MemoryRouter><SiteHeader /></MemoryRouter>)
    // Desktop nav always renders one "Find doctors" link; the mobile drawer adds a second when open.
    expect(screen.getAllByText('Find doctors')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Toggle navigation'))
    expect(screen.getAllByText('Find doctors')).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('Toggle navigation'))
    expect(screen.getAllByText('Find doctors')).toHaveLength(1)
  })

  it('toggles the theme between light and dark', () => {
    render(<MemoryRouter><SiteHeader /></MemoryRouter>)
    const toggle = screen.getByLabelText('Switch to dark theme')
    fireEvent.click(toggle)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('dc-theme')).toBe('dark')
    fireEvent.click(screen.getByLabelText('Switch to light theme'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

describe('DoctorCard', () => {
  it('renders doctor details, fee, and links to the doctor profile', () => {
    render(<MemoryRouter><DoctorCard doctor={doctor} /></MemoryRouter>)
    expect(screen.getByText('Dr. Asha Rao')).toBeInTheDocument()
    expect(screen.getByText(/Cardiology/)).toBeInTheDocument()
    expect(screen.getByText('★ 4.7')).toBeInTheDocument()
    expect(screen.getByText('₹700')).toBeInTheDocument()
    expect(screen.getByText('Today queue open')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/doctors/doc-1')
    expect(screen.getByRole('link', { name: 'Book now' })).toHaveAttribute('href', '/doctors/doc-1')
    expect(screen.getByRole('link', { name: /Heart Care Clinic/ })).toHaveAttribute('href', expect.stringContaining('/clinics?clinic='))
  })

  it('shows the emergency badge only when the doctor is marked emergency-available', () => {
    const { rerender } = render(<MemoryRouter><DoctorCard doctor={doctor} /></MemoryRouter>)
    expect(screen.queryByText('Emergency available')).not.toBeInTheDocument()
    rerender(<MemoryRouter><DoctorCard doctor={{ ...doctor, emergencyAvailable: true }} /></MemoryRouter>)
    expect(screen.getByText('Emergency available')).toBeInTheDocument()
  })

  it('shows "Not accepting bookings today" when online booking is disabled', () => {
    render(<MemoryRouter><DoctorCard doctor={{ ...doctor, onlineBooking: false }} /></MemoryRouter>)
    expect(screen.getByText('Not accepting bookings today')).toBeInTheDocument()
  })
})

describe('SearchResults', () => {
  const data = {
    cities: [{ id: 'c1', name: 'Mumbai' }],
    areas: [{ id: 'a1', name: 'Andheri', cityId: 'c1' }],
    specializations: [{ id: 'spec-1', name: 'Cardiology' }, { id: 'spec-2', name: 'Dermatology' }],
    clinics: [{ id: 'clinic-1', name: 'Heart Care Clinic' }],
    doctors: [
      doctor,
      { ...doctor, id: 'doc-2', name: 'Dr. Vikram Shah', specialization: { name: 'Dermatology' }, consultationFee: 400, experienceYears: 3, rating: 4.1, emergencyAvailable: true, clinics: [] },
    ],
  }

  it('lists every doctor by default and narrows by the "24/7 emergency" filter', () => {
    render(<MemoryRouter initialEntries={['/search']}><SearchResults data={data} /></MemoryRouter>)
    expect(screen.getByText('2 doctors found')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('24/7 emergency'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(screen.getByText('1 doctors found')).toBeInTheDocument()
    expect(screen.getByText('Dr. Vikram Shah')).toBeInTheDocument()
  })

  it('sorts by fee (low to high) when selected', () => {
    render(<MemoryRouter initialEntries={['/search']}><SearchResults data={data} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'Fee: low to high' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    const names = screen.getAllByRole('heading', { level: 2 }).map((el) => el.textContent)
    expect(names.indexOf('Dr. Vikram Shah')).toBeLessThan(names.indexOf('Dr. Asha Rao'))
  })

  it('shows an empty state when no doctor matches the filters', () => {
    render(<MemoryRouter initialEntries={['/search']}><SearchResults data={data} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Doctor or symptom'), { target: { value: 'nobody-matches-this' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(screen.getByText('No doctors match these filters')).toBeInTheDocument()
  })

  it('clears applied filters back to the full list', () => {
    render(<MemoryRouter initialEntries={['/search']}><SearchResults data={data} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Specialization'), { target: { value: 'Cardiology' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(screen.getByText('1 doctors found')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('2 doctors found')).toBeInTheDocument()
  })
})

describe('DoctorProfile', () => {
  it('renders full profile details, real OPD schedule, and the booking advance amount', async () => {
    const data = {
      doctors: [{
        ...doctor,
        bio: 'Senior cardiologist.',
        languages: ['English', 'Hindi'],
        minBookingAdvanceAmount: 150,
        schedule: [{ day: 'Monday', hours: '9am - 1pm' }],
      }],
      appointments: [],
      reviews: [],
    }
    apiClient.get.mockImplementation((url) => (url === '/doctors/doc-1' ? Promise.resolve(data.doctors[0]) : Promise.resolve([])))
    render(
      <MemoryRouter initialEntries={['/doctors/doc-1']}>
        <Routes><Route path="/doctors/:doctorId" element={<DoctorProfile data={data} />} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByRole('heading', { name: 'Dr. Asha Rao' })).toBeInTheDocument()
    expect(screen.getByText('Senior cardiologist.')).toBeInTheDocument()
    expect(screen.getByText('English, Hindi')).toBeInTheDocument()
    expect(screen.getByText('Monday')).toBeInTheDocument()
    expect(screen.getByText('9am - 1pm')).toBeInTheDocument()
    expect(screen.getByText(/₹150 online advance/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue to booking' })).toHaveAttribute(
      'href',
      '/patient/book?doctorId=doc-1&clinicId=clinic-1'
    )
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/doctors/doc-1'))
  })

  it('requires full online payment when no minimum advance is configured', async () => {
    const data = { doctors: [doctor], appointments: [], reviews: [] }
    render(
      <MemoryRouter initialEntries={['/doctors/doc-1']}>
        <Routes><Route path="/doctors/:doctorId" element={<DoctorProfile data={data} />} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText(/full consultation fee/)).toBeInTheDocument()
  })

  it('shows an empty state and the load error when the doctor cannot be found or loaded', async () => {
    apiClient.get.mockImplementation((url) => (url === '/doctors/missing' ? Promise.reject(new Error('Doctor not found')) : Promise.resolve([])))
    render(
      <MemoryRouter initialEntries={['/doctors/missing']}>
        <Routes><Route path="/doctors/:doctorId" element={<DoctorProfile data={{ doctors: [], appointments: [], reviews: [] }} />} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('No doctor profile yet')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Doctor not found')
  })
})

describe('EmergencyPage', () => {
  it('lists only emergency-available doctors with a call and booking action', () => {
    const data = { doctors: [{ ...doctor, emergencyAvailable: true }, { ...doctor, id: 'doc-2', name: 'Dr. Vikram Shah', emergencyAvailable: false }] }
    render(<MemoryRouter><EmergencyPage data={data} /></MemoryRouter>)
    expect(screen.getByText('Dr. Asha Rao')).toBeInTheDocument()
    expect(screen.queryByText('Dr. Vikram Shah')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call clinic' })).toHaveAttribute('href', 'tel:+912240001111')
    expect(screen.getByRole('link', { name: 'Book now' })).toHaveAttribute('href', '/patient/emergency')
  })

  it('shows an empty state when no doctor is emergency-available', () => {
    render(<MemoryRouter><EmergencyPage data={{ doctors: [doctor] }} /></MemoryRouter>)
    expect(screen.getByText('No emergency doctors available right now')).toBeInTheDocument()
  })
})

describe('Login', () => {
  it('logs a patient in via the real store and navigates to their dashboard', async () => {
    apiClient.post.mockImplementation((url) => (url === '/auth/login' ? Promise.resolve({ accessToken: 'tok', refreshToken: 'ref' }) : Promise.resolve({})))
    apiClient.get.mockImplementation((url) => (url === '/me' ? Promise.resolve({ id: 'u1', name: 'Asha', role: 'patient' }) : Promise.resolve([])))
    renderWithLocation(<Login />)
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'asha@example.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/patient/dashboard'))
    expect(apiClient.post).toHaveBeenCalledWith('/auth/login', { email: 'asha@example.com', password: 'secret123' })
    expect(useAppStore.getState().isAuthenticated).toBe(true)
  })

  it('shows the server error message on a failed login', async () => {
    apiClient.post.mockImplementation((url) => (url === '/auth/login' ? Promise.reject(new Error('Invalid email or password.')) : Promise.resolve({})))
    renderWithLocation(<Login />)
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'asha@example.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.')
    expect(useAppStore.getState().isAuthenticated).toBe(false)
  })

  // GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix kro") — replaces the
  // old stub test (the button used to always show "Google sign-in is unavailable..." and never
  // actually attempt anything). Real Google Sign-In now covers login AND first-time
  // account-linking AND self-registration in a single POST /auth/google call.
  it('signs in with the Google ID token and navigates to the role home on success', async () => {
    signInWithGoogle.mockResolvedValue('fake-google-id-token')
    apiClient.post.mockImplementation((url) => (url === '/auth/google' ? Promise.resolve({ accessToken: 'tok', refreshToken: 'ref' }) : Promise.resolve({})))
    apiClient.get.mockImplementation((url) => (url === '/me' ? Promise.resolve({ id: 'u1', name: 'Asha', role: 'patient' }) : Promise.resolve([])))
    renderWithLocation(<Login />)
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }))
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/patient/dashboard'))
    expect(apiClient.post).toHaveBeenCalledWith('/auth/google', { idToken: 'fake-google-id-token' })
    expect(useAppStore.getState().isAuthenticated).toBe(true)
  })

  it('shows the real error message when Google sign-in fails (e.g. not configured, or the picker was cancelled)', async () => {
    signInWithGoogle.mockRejectedValue(new Error('Google sign-in is not configured for this deployment yet.'))
    renderWithLocation(<Login />)
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in is not configured for this deployment yet.')
    expect(apiClient.post).not.toHaveBeenCalledWith('/auth/google', expect.anything())
    expect(useAppStore.getState().isAuthenticated).toBe(false)
  })

  it('shows a one-shot success notice handed in via router state', () => {
    renderWithLocation(<Login />, { initialEntries: [{ pathname: '/login', state: { message: 'Password reset. Please sign in.' } }] })
    expect(screen.getByRole('status')).toHaveTextContent('Password reset. Please sign in.')
  })

  it('links to registration and forgot-password', () => {
    renderWithLocation(<Login />)
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  })
})

describe('Register', () => {
  it('registers a new patient and navigates to the patient dashboard', async () => {
    apiClient.post.mockImplementation((url) => (url === '/auth/register' ? Promise.resolve({ accessToken: 'tok', refreshToken: 'ref' }) : Promise.resolve({})))
    apiClient.get.mockImplementation((url) => (url === '/me' ? Promise.resolve({ id: 'u1', name: 'New Patient', role: 'patient' }) : Promise.resolve([])))
    renderWithLocation(<Register />)
    fireEvent.change(screen.getByPlaceholderText('Enter your full name'), { target: { value: 'New Patient' } })
    fireEvent.change(screen.getByPlaceholderText('Enter mobile number'), { target: { value: '9998887777' } })
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Create password'), { target: { value: 'password1' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'password1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/patient/dashboard'))
    expect(apiClient.post).toHaveBeenCalledWith('/auth/register', expect.objectContaining({ email: 'new@example.com', role: 'patient' }))
  })

  it('blocks submission with a client-side error when passwords do not match', () => {
    renderWithLocation(<Register />)
    fireEvent.change(screen.getByPlaceholderText('Enter your full name'), { target: { value: 'New Patient' } })
    fireEvent.change(screen.getByPlaceholderText('Enter mobile number'), { target: { value: '9998887777' } })
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Create password'), { target: { value: 'password1' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'password2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.')
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('switches to the doctor tab, loads specializations, and registers via /doctors/register', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/geography/specializations') return Promise.resolve([{ id: 'spec-1', name: 'Cardiology' }])
      if (url === '/me') return Promise.resolve({ id: 'doc-9', name: 'New Doctor', role: 'doctor' })
      return Promise.resolve([])
    })
    apiClient.post.mockImplementation((url) => (url === '/doctors/register' ? Promise.resolve({ accessToken: 'tok', refreshToken: 'ref' }) : Promise.resolve({})))
    renderWithLocation(<Register />)
    fireEvent.click(screen.getByRole('tab', { name: "I'm a doctor" }))
    expect(await screen.findByText('Cardiology')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Enter your full name'), { target: { value: 'New Doctor' } })
    fireEvent.change(screen.getByPlaceholderText('Enter mobile number'), { target: { value: '9998887777' } })
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'doc@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Create password'), { target: { value: 'password1' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'password1' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'spec-1' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 500'), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for verification' }))

    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/doctor/dashboard'))
    expect(apiClient.post).toHaveBeenCalledWith('/doctors/register', expect.objectContaining({ email: 'doc@example.com', specializationId: 'spec-1' }))
  })

  it('links back to sign in', () => {
    renderWithLocation(<Register />)
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  // GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix kro") — replaces the
  // old stub test ("Google sign-up needs an OAuth provider..."). Uses the SAME POST /auth/google
  // call as Login (it transparently registers a brand-new person server-side) — deliberately
  // fired even from the "I'm a doctor" tab to confirm Google sign-up always lands as a patient,
  // same rule the email/password doctor form is exempt from only via its own dedicated endpoint.
  it('signs up with Google and navigates to the patient dashboard, even from the doctor tab', async () => {
    signInWithGoogle.mockResolvedValue('fake-google-id-token')
    apiClient.post.mockImplementation((url) => (url === '/auth/google' ? Promise.resolve({ accessToken: 'tok', refreshToken: 'ref' }) : Promise.resolve({})))
    apiClient.get.mockImplementation((url) => (url === '/me' ? Promise.resolve({ id: 'u1', name: 'New Patient', role: 'patient' }) : Promise.resolve([])))
    renderWithLocation(<Register />)
    fireEvent.click(screen.getByRole('tab', { name: "I'm a doctor" }))
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }))
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/patient/dashboard'))
    expect(apiClient.post).toHaveBeenCalledWith('/auth/google', { idToken: 'fake-google-id-token' })
  })
})

describe('ForgotPassword', () => {
  it('shows a generic confirmation after a successful submission, regardless of whether the account exists', async () => {
    renderWithLocation(<ForgotPassword />)
    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'someone@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByText(/reset instructions have been sent/i)).toBeInTheDocument()
    expect(apiClient.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'someone@example.com' })
  })

  it('shows the real error message on a genuine failure (not "no such account")', async () => {
    apiClient.post.mockImplementation(() => Promise.reject(new Error('Too many requests. Try again later.')))
    renderWithLocation(<ForgotPassword />)
    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'someone@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again later.')
  })
})

describe('ResetPassword', () => {
  it('shows an error when the reset link is missing its token', () => {
    renderWithLocation(<ResetPassword />, { initialEntries: ['/reset-password'] })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'password1' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'password1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/missing its token/i)
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('shows an error when the two passwords do not match', () => {
    renderWithLocation(<ResetPassword />, { initialEntries: ['/reset-password?token=abc123'] })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'password1' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'password2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.')
  })

  it('resets the password and redirects to /login with a success message in router state', async () => {
    renderWithLocation(<ResetPassword />, { initialEntries: ['/reset-password?token=abc123'] })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'password1' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'password1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    await waitFor(() => expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/login'))
    expect(apiClient.post).toHaveBeenCalledWith('/auth/reset-password', { token: 'abc123', newPassword: 'password1' })
  })
})
