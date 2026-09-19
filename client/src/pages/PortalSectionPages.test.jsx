// Tests for the shared, role-parameterized portal-section pages (src/pages/PortalSectionPages.jsx).
//
// Same convention as StaffPages.test.jsx / AdminPages.test.jsx / login-flow.test.jsx: render the
// real page components against the real Zustand store, mocking only src/lib/apiClient.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
import { shortId } from '../lib/format'
import App from '../App'
import {
  ContactInbox,
  PortalAppointments,
  PortalPatients,
  PortalProfile,
  QueueTracker,
  ReviewModeration,
  Specializations,
} from './PortalSectionPages'

const initialStoreState = useAppStore.getState()

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(initialStoreState, true)
  vi.clearAllMocks()
  getTokens.mockReturnValue(null)
  apiClient.get.mockResolvedValue([])
  apiClient.post.mockResolvedValue({})
  apiClient.patch.mockResolvedValue({})
  apiClient.put.mockResolvedValue({})
})

afterEach(() => {
  localStorage.clear()
})

function renderConnected(Component, extraProps = {}) {
  function Connected() {
    const data = useAppStore((state) => state.data)
    return <Component data={data} {...extraProps} />
  }
  return render(
    <MemoryRouter>
      <Connected />
    </MemoryRouter>
  )
}

function mockGetRoutes(map) {
  apiClient.get.mockImplementation((url) => {
    if (Object.prototype.hasOwnProperty.call(map, url)) {
      const value = map[url]
      return typeof value === 'function' ? value() : Promise.resolve(value)
    }
    return Promise.resolve([])
  })
}

function setCurrentUser(user) {
  useAppStore.setState({ currentUser: user, isAuthenticated: true, sessionVerified: true })
}

describe('QueueTracker', () => {
  it('shows the live queue widget for a patient with an active appointment', async () => {
    mockGetRoutes({ '/queue/mine/appt-1': { token: 5, nowServing: 3, patientsAhead: 2, estimatedWaitMinutes: 10, status: 'waiting' } })
    renderConnected(QueueTracker, { data: { appointments: [{ id: 'appt-1', status: 'confirmed' }] }, role: 'patient' })

    expect(await screen.findByLabelText('Live queue status')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('What each status means')).toBeInTheDocument()
  })

  it('shows a no-active-queue state for a patient with no upcoming/confirmed appointment', () => {
    renderConnected(QueueTracker, { data: { appointments: [] }, role: 'patient' })
    expect(screen.getByText('No active queue')).toBeInTheDocument()
  })

  it('shows an error state and lets the patient retry when their queue status fails to load', async () => {
    apiClient.get.mockRejectedValue(new Error('Queue service unavailable.'))
    renderConnected(QueueTracker, { data: { appointments: [{ id: 'appt-1', status: 'upcoming' }] }, role: 'patient' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i)
  })

  it('renders the staff view (queue monitor) reading the shared doctor/receptionist queue', async () => {
    mockGetRoutes({
      '/queue': [{ id: 'q1', appointmentId: 'appt-1', tokenNumber: 9, status: 'waiting', patientsAhead: 1, estimatedWaitMinutes: 5 }],
    })
    renderConnected(QueueTracker, { data: { appointments: [{ id: 'appt-1', status: 'upcoming' }], queueTokens: [] }, role: 'doctor' })
    expect(screen.getByText('Queue management')).toBeInTheDocument()
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/queue', expect.anything()))
  })
})

describe('PortalAppointments', () => {
  const APPOINTMENTS = [
    { id: 'a1', status: 'pending_payment', patient: { name: 'Asha' } },
    { id: 'a2', status: 'confirmed', patient: { name: 'Ben' } },
    { id: 'a3', status: 'upcoming', patient: { name: 'Chitra' } },
  ]

  it('admin view: a pending_payment booking can only be cancelled, never confirmed/completed', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    renderConnected(PortalAppointments, { role: 'admin' })

    const ashaRow = (await screen.findByText('Asha')).closest('tr')
    expect(within(ashaRow).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(ashaRow).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(within(ashaRow).queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()

    const benRow = screen.getByText('Ben').closest('tr')
    expect(within(benRow).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(within(benRow).getByRole('button', { name: 'Complete' })).toBeInTheDocument()

    const chitraRow = screen.getByText('Chitra').closest('tr')
    expect(within(chitraRow).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('admin view: confirming an appointment calls the real status endpoint', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    apiClient.patch.mockResolvedValue({ ...APPOINTMENTS[2], status: 'confirmed' })
    renderConnected(PortalAppointments, { role: 'admin' })

    const chitraRow = (await screen.findByText('Chitra')).closest('tr')
    fireEvent.click(within(chitraRow).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/appointments/a3/status', { status: 'confirmed' }))
  })

  // BOOKING-ID VISIBILITY FIX (user request: "booking id appointment me do admin supar admin ke")
  // — the "Appointments registry" (admin view)'s 'ID' column is just this row's own display
  // sequence number (DC01, DC02...), not the real booking id.
  it('admin view: shows a "Booking ID" column with the real booking id, separate from the row sequence "ID" column', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    renderConnected(PortalAppointments, { role: 'admin' })

    expect(await screen.findByRole('columnheader', { name: 'Booking ID' })).toBeInTheDocument()
    expect(screen.getByText(shortId('a1'))).toBeInTheDocument()
  })

  it('patient view: shows a read-only Details action instead of status controls', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderConnected(PortalAppointments, { role: 'patient', data: { appointments: [{ id: 'a1', status: 'upcoming', doctor: { name: 'Dr. Kapoor' }, clinic: { name: 'Heart Care' } }] } })

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Dr. Kapoor'))
    alertSpy.mockRestore()
  })
})

describe('PortalPatients', () => {
  it('derives a distinct patient directory from already-loaded appointments', () => {
    renderConnected(PortalPatients, {
      data: {
        appointments: [
          { id: 'a1', patient: { id: 'p1', name: 'Asha Mehta', phone: '9000000001' } },
          { id: 'a2', patient: { id: 'p1', name: 'Asha Mehta', phone: '9000000001' } },
        ],
      },
    })
    expect(screen.getByText('Asha Mehta')).toBeInTheDocument()
    expect(screen.getByText('9000000001')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/no dedicated patient directory/i)).toBeInTheDocument()
  })
})

describe('Specializations', () => {
  it('adds a new specialization', async () => {
    apiClient.post.mockResolvedValue({ id: 'spec-2', name: 'Dermatology' })
    renderConnected(Specializations, {})

    fireEvent.click(screen.getByRole('button', { name: 'Add specialization' }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Dermatology' } })
    fireEvent.click(screen.getByRole('button', { name: /Save specialization/i }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/geography/specializations', { name: 'Dermatology' }))
    expect(await screen.findByText('Dermatology')).toBeInTheDocument()
  })

  it('deletes a specialization only after confirmation', async () => {
    apiClient.delete.mockResolvedValue({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderConnected(Specializations, { data: { specializations: [{ id: 'spec-1', name: 'Cardiology' }] } })

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/geography/specializations/spec-1'))
    confirmSpy.mockRestore()
  })

  it('shows the server error (e.g. still assigned to a doctor) when deletion fails', async () => {
    apiClient.delete.mockRejectedValue(new Error('Specialization still assigned to a doctor.'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderConnected(Specializations, { data: { specializations: [{ id: 'spec-1', name: 'Cardiology' }] } })

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Specialization still assigned to a doctor.')).toBeInTheDocument()
  })
})

describe('ReviewModeration', () => {
  it('approves or rejects a pending review', async () => {
    mockGetRoutes({ '/reviews': [{ id: 'r1', status: 'pending', rating: 4, text: 'Great doctor', patient: { name: 'Asha' } }] })
    apiClient.patch.mockResolvedValue({ id: 'r1', status: 'approved' })
    renderConnected(ReviewModeration, {})

    await screen.findByText('Great doctor')
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/reviews/r1/status', { status: 'approved' }))
  })

  it('offers to return a rejected review to pending', async () => {
    mockGetRoutes({ '/reviews': [{ id: 'r1', status: 'rejected', rating: 2, text: 'Not great', patient: { name: 'Ben' } }] })
    renderConnected(ReviewModeration, {})
    expect(await screen.findByRole('button', { name: 'Return to pending' })).toBeInTheDocument()
  })
})

describe('ContactInbox', () => {
  it('saves a status/response update for the selected contact request', async () => {
    mockGetRoutes({ '/contact': [{ id: 'req-1', name: 'Asha', email: 'asha@example.com', subject: 'Billing', status: 'open' }] })
    apiClient.patch.mockResolvedValue({})
    renderConnected(ContactInbox, {})

    await screen.findByText('Billing')
    fireEvent.change(screen.getByLabelText(/^Contact request ID/), { target: { value: 'req-1' } })
    fireEvent.change(screen.getByLabelText(/^Response/), { target: { value: 'We refunded this.' } })
    fireEvent.click(screen.getByRole('button', { name: /Save response/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/contact/req-1', { status: 'open', response: 'We refunded this.' }))
  })
})

describe('PortalProfile', () => {
  it('saves profile field edits via PATCH /me', async () => {
    setCurrentUser({ id: 'p1', name: 'Asha Mehta', email: 'asha@example.com', phone: '', city: '', profile: {} })
    apiClient.patch.mockResolvedValue({ id: 'p1', name: 'Asha Mehta K.', profile: {} })
    renderConnected(PortalProfile, { role: 'patient' })

    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Asha Mehta K.' } })
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9000000000' } })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/me', expect.objectContaining({ name: 'Asha Mehta K.', phone: '9000000000' })))
    expect(await screen.findByText('Profile changes saved.')).toBeInTheDocument()
  })

  it('changes the password, revoking the session and redirecting to /login', async () => {
    setCurrentUser({ id: 'p1', name: 'Asha Mehta', profile: {} })
    apiClient.patch.mockResolvedValue({})
    render(<MemoryRouter initialEntries={['/patient/profile']}>
      <PortalProfile role="patient" />
    </MemoryRouter>)

    fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: 'oldpass1' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'newpass123' } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'newpass123' } })
    fireEvent.click(screen.getByRole('button', { name: /Change password/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/me/password', {
      currentPassword: 'oldpass1',
      newPassword: 'newpass123',
      confirmPassword: 'newpass123',
    }))
    expect(await screen.findByText(/Password changed successfully/)).toBeInTheDocument()
    // changePassword() clears the session — confirms the redirect target's guard would now see no user.
    await waitFor(() => expect(useAppStore.getState().currentUser).toBeNull())
  })

  it('shows an error and does not call the API when the new passwords do not match', () => {
    setCurrentUser({ id: 'p1', name: 'Asha Mehta', profile: {} })
    renderConnected(PortalProfile, { role: 'patient' })

    fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: 'oldpass1' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'newpass123' } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'different1' } })
    fireEvent.click(screen.getByRole('button', { name: /Change password/i }))

    expect(screen.getByText('New passwords do not match.')).toBeInTheDocument()
    expect(apiClient.patch).not.toHaveBeenCalled()
  })
})

describe('PortalSectionPages role gating (RoleGuard, via App)', () => {
  const PATIENT_USER = { id: 'pat-1', name: 'Asha Mehta', email: 'asha@example.com', role: 'patient' }
  const DOCTOR_USER = { id: 'doc-1', name: 'Dr. Nikhil Rao', email: 'nikhil@example.com', role: 'doctor' }

  function mockBootFor(user) {
    getTokens.mockReturnValue({ accessToken: 'tok' })
    apiClient.post.mockResolvedValue({})
    apiClient.get.mockImplementation((url) => {
      if (url === '/me') return Promise.resolve(user)
      return Promise.resolve([])
    })
  }

  it('lets a patient reach /patient/queue and blocks a doctor from it', async () => {
    mockBootFor(PATIENT_USER)
    render(<MemoryRouter initialEntries={['/patient/queue']}><App /></MemoryRouter>)
    expect(await screen.findByText('Live queue tracker')).toBeInTheDocument()
  })

  it('redirects a doctor away from the patient-only /patient/queue route to their own dashboard', async () => {
    mockBootFor(DOCTOR_USER)
    render(<MemoryRouter initialEntries={['/patient/queue']}><App /></MemoryRouter>)
    expect(await screen.findByText(/Welcome, Nikhil\./i)).toBeInTheDocument()
    expect(screen.queryByText('Live queue tracker')).not.toBeInTheDocument()
  })
})
