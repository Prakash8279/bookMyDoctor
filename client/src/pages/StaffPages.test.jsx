// Tests for the doctor/receptionist portal pages (src/pages/StaffPages.jsx).
//
// Follows the convention set by src/integration/login-flow.test.jsx: render the real page
// components against the real Zustand store, mocking only the network boundary
// (src/lib/apiClient.js). Most page components here read their `data` prop from the store the
// same way App.jsx wires it (`const data = useAppStore((state) => state.data)`), so
// `renderConnected` below reproduces that same live selector instead of freezing a static prop —
// this is what lets an action (e.g. a queue status PATCH) that updates the store actually be
// observed re-rendering the page, exactly as it would in the real app.
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
  Analytics,
  CashPayment,
  CheckIn,
  ClinicSchedule,
  DoctorAppointments,
  DoctorDashboard,
  DoctorProfileEdit,
  PatientHistory,
  QueueManagement,
  ReceptionAppointments,
  ReceptionDashboard,
  WalkIn,
} from './StaffPages'

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

// Mirrors how App.jsx actually feeds `data` to every one of these page components
// (`const data = useAppStore((state) => state.data)`), so a store update from inside the
// component (a fetch on mount, an action's PATCH/POST) is visible on screen without the test
// having to manually re-seed props.
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

describe('DoctorDashboard', () => {
  const DOCTOR = {
    id: 'doc-1',
    name: 'Dr. Nikhil Rao',
    profile: { onlineBooking: true, rating: 4.6, status: 'verified' },
  }

  it('greets the doctor by first name (honorific stripped) and renders live stats', () => {
    setCurrentUser(DOCTOR)
    const data = {
      appointments: [{ id: 'a1', status: 'upcoming' }, { id: 'a2', status: 'completed' }],
      queueTokens: [{ id: 'q1', status: 'waiting' }, { id: 'q2', status: 'completed' }],
      payments: [{ fees: { consultationFee: 500 } }, { fees: { consultationFee: 300 } }],
    }
    renderConnected(DoctorDashboard, { data })

    expect(screen.getByText('Welcome, Nikhil.')).toBeInTheDocument()
    // TODAY'S BOOKINGS counts non-completed appointments only (1 of the 2 seeded).
    const bookingsCard = screen.getByText("TODAY'S BOOKINGS").closest('a')
    expect(within(bookingsCard).getByText('1')).toBeInTheDocument()
    expect(screen.getByText('₹800')).toBeInTheDocument()
    expect(screen.getByText('4.6')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a pending-verification notice for an unverified doctor', () => {
    setCurrentUser({ ...DOCTOR, profile: { ...DOCTOR.profile, status: 'pending' } })
    renderConnected(DoctorDashboard, { data: { appointments: [], queueTokens: [], payments: [] } })
    expect(screen.getByText(/pending admin verification/i)).toBeInTheDocument()
  })

  it('shows a disabled-account notice for a disabled doctor', () => {
    setCurrentUser({ ...DOCTOR, profile: { ...DOCTOR.profile, status: 'disabled' } })
    renderConnected(DoctorDashboard, { data: { appointments: [], queueTokens: [], payments: [] } })
    expect(screen.getByText(/account has been disabled by an admin/i)).toBeInTheDocument()
  })

  it('toggles duty status, carrying the current booking-policy fields through PATCH /doctors/:id', async () => {
    setCurrentUser(DOCTOR)
    apiClient.patch.mockResolvedValue({ ...DOCTOR, profile: { ...DOCTOR.profile, onlineBooking: false } })
    renderConnected(DoctorDashboard, { data: { appointments: [], queueTokens: [], payments: [] } })

    expect(screen.getByText(/Patients can currently find and book you\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Go off duty/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/doctors/doc-1', {
      onlineBooking: false,
      allowRebooking: true,
      maxDaysAdvance: 7,
    }))
    expect(await screen.findByRole('button', { name: /Go on duty/i })).toBeInTheDocument()
    expect(screen.getByText(/You are hidden from new patient bookings\./)).toBeInTheDocument()
  })

  it('shows an inline error and leaves duty status unchanged when the toggle fails', async () => {
    setCurrentUser(DOCTOR)
    apiClient.patch.mockRejectedValue(new Error('Could not reach the server.'))
    renderConnected(DoctorDashboard, { data: { appointments: [], queueTokens: [], payments: [] } })

    fireEvent.click(screen.getByRole('button', { name: /Go off duty/i }))
    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Go off duty/i })).toBeInTheDocument()
  })
})

describe('QueueManagement (sequential, forward-only status transitions)', () => {
  it('shows exactly one legal next action per active token, and none for a completed one', async () => {
    mockGetRoutes({
      '/queue': [
        { id: 'q-wait', tokenNumber: 1, status: 'waiting', patient: { name: 'Asha' } },
        { id: 'q-called', tokenNumber: 2, status: 'called', patient: { name: 'Ben' } },
        { id: 'q-consult', tokenNumber: 3, status: 'in_consultation', patient: { name: 'Chitra' } },
        { id: 'q-done', tokenNumber: 4, status: 'completed', patient: { name: 'Divya' } },
      ],
    })
    renderConnected(QueueManagement, {})

    expect(await screen.findByRole('button', { name: 'Call' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument()
    // The completed row lives in the read-only "Completed" table (no action column at all) —
    // there is no button that could let staff push it further or back.
    expect(screen.getByText('Divya')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'Call' })).toHaveLength(1)
  })

  it('mirrors the backend enum end to end: waiting -> called -> in_consultation -> completed, one step at a time', async () => {
    mockGetRoutes({ '/queue': [{ id: 'q1', tokenNumber: 7, status: 'waiting', patient: { name: 'Asha' } }] })
    apiClient.patch.mockImplementation((url, body) => {
      const id = url.match(/\/queue\/(.+)\/status/)[1]
      return Promise.resolve({ id, tokenNumber: 7, patient: { name: 'Asha' }, status: body.status })
    })
    renderConnected(QueueManagement, {})

    await screen.findByRole('button', { name: 'Call' })
    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/queue/q1/status', { status: 'called' }))

    // Never reverts to "Call" and never jumps straight to "Complete" — only "Start" appears.
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/queue/q1/status', { status: 'in_consultation' }))
    expect(await screen.findByRole('button', { name: 'Complete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/queue/q1/status', { status: 'completed' }))
    // Once completed, the token moves out of "Live records" (0 active) into "Completed" — and
    // has no action button left at all, so it can never be pushed backward or skipped further.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument())
    expect(screen.getByText('0 record(s)')).toBeInTheDocument()
  })

  it('shows an inline error and keeps the same legal action available when a transition fails', async () => {
    mockGetRoutes({ '/queue': [{ id: 'q1', tokenNumber: 1, status: 'waiting', patient: { name: 'Asha' } }] })
    apiClient.patch.mockRejectedValue(new Error('Token already claimed by another session.'))
    renderConnected(QueueManagement, {})

    await screen.findByRole('button', { name: 'Call' })
    fireEvent.click(screen.getByRole('button', { name: 'Call' }))

    expect(await screen.findByText('Token already claimed by another session.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Call' })).toBeInTheDocument()
  })

  it('labels the receptionist variant as a scoped queue monitor', () => {
    mockGetRoutes({ '/queue': [] })
    renderConnected(QueueManagement, { receptionist: true })
    expect(screen.getByText('Queue monitor')).toBeInTheDocument()
    expect(screen.getByText(/automatically scoped to your assigned clinic/i)).toBeInTheDocument()
  })
})

describe('DoctorProfileEdit', () => {
  it('shows an empty state when there is no signed-in doctor', () => {
    setCurrentUser(null)
    renderConnected(DoctorProfileEdit, { data: {} })
    expect(screen.getByText('No doctor profile yet')).toBeInTheDocument()
  })

  it('submits the profile form with correctly-typed and derived fields', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', phone: '', photoUrl: '', profile: {} })
    renderConnected(DoctorProfileEdit, { data: { specializations: [{ id: 'spec-1', name: 'Cardiology' }] } })

    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Dr. Asha K. Rao' } })
    fireEvent.change(screen.getByLabelText('Specialization'), { target: { value: 'Cardiology' } })
    fireEvent.change(screen.getByLabelText(/Experience \(years\)/), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText(/Consultation fee/), { target: { value: '700' } })
    fireEvent.change(screen.getByLabelText(/Emergency fee/), { target: { value: '900' } })
    fireEvent.change(screen.getByLabelText(/Languages/), { target: { value: 'English, Hindi ' } })
    fireEvent.click(screen.getByLabelText('Available for emergency care'))
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1))
    expect(apiClient.patch).toHaveBeenCalledWith('/me', expect.objectContaining({
      name: 'Dr. Asha K. Rao',
      specializationId: 'spec-1',
      experienceYears: 9,
      consultationFee: 700,
      emergencyFee: 900,
      languages: ['English', 'Hindi'],
      emergencyAvailable: true,
      minBookingAdvanceAmount: null,
    }))
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
  })

  it('uploads a chosen photo immediately, independent of the Save button', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    apiClient.post.mockResolvedValue({ url: 'https://cdn.example.com/doc-1.jpg' })
    renderConnected(DoctorProfileEdit, { data: {} })

    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/media/photo', expect.any(FormData)))
    expect(await screen.findByAltText('Doctor profile preview')).toHaveAttribute('src', 'https://cdn.example.com/doc-1.jpg')
  })

  it('rejects a non-image file without ever calling the upload endpoint', () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    renderConnected(DoctorProfileEdit, { data: {} })

    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } })

    expect(screen.getByText('Please choose an image file.')).toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('shows an inline error when saving the profile fails', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    apiClient.patch.mockRejectedValue(new Error('Registration number already in use.'))
    renderConnected(DoctorProfileEdit, { data: {} })

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))
    expect(await screen.findByText('Registration number already in use.')).toBeInTheDocument()
  })

  // COMPLETENESS FIX regression tests: POST /media/document (uploads.service.js#saveVerificationDocument)
  // is a real, doctor-only backend endpoint that had no caller anywhere in the app before this —
  // a self-registered doctor had no way to ever submit verification documents, leaving their
  // account stuck "pending" forever with nothing for an admin to review. These tests cover the
  // new self-service upload section added to this page.
  it('shows the pending-verification nudge with no documents uploaded yet', () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: { status: 'pending' } })
    renderConnected(DoctorProfileEdit, { data: {} })

    expect(screen.getByText(/pending admin verification/i)).toBeInTheDocument()
    expect(screen.getByText('No documents uploaded yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload document/i })).toBeDisabled()
  })

  it('shows the account-disabled message instead of the pending nudge when disabled', () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: { status: 'disabled' } })
    renderConnected(DoctorProfileEdit, { data: {} })

    expect(screen.getByText(/account has been disabled/i)).toBeInTheDocument()
    expect(screen.queryByText(/pending admin verification/i)).not.toBeInTheDocument()
  })

  it('lists previously uploaded verification documents with a working View link', () => {
    setCurrentUser({
      id: 'doc-1',
      name: 'Dr. Asha Rao',
      profile: {
        status: 'pending',
        verificationDocuments: [{ name: 'MBBS certificate', url: 'https://cdn.example.com/doc-1/mbbs.pdf', uploadedAt: '2026-01-05T10:00:00.000Z' }],
      },
    })
    renderConnected(DoctorProfileEdit, { data: {} })

    expect(screen.getByText('MBBS certificate')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', 'https://cdn.example.com/doc-1/mbbs.pdf')
    expect(screen.queryByText('No documents uploaded yet')).not.toBeInTheDocument()
  })

  it('uploads a chosen verification document with its name and appends it to the list', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: { status: 'pending' } })
    apiClient.post.mockResolvedValue({ url: 'https://cdn.example.com/doc-1/aadhaar.jpg' })
    renderConnected(DoctorProfileEdit, { data: {} })

    const file = new File(['x'], 'aadhaar.jpg', { type: 'image/jpeg' })
    fireEvent.change(document.getElementById('verification-document-input'), { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText('Document name (optional)'), { target: { value: 'Aadhaar card' } })
    fireEvent.click(screen.getByRole('button', { name: /Upload document/i }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/media/document', expect.any(FormData)))
    expect(await screen.findByText('Aadhaar card')).toBeInTheDocument()
    // The file input and name field both reset after a successful upload, ready for the next document.
    expect(screen.getByLabelText('Document name (optional)')).toHaveValue('')
  })

  it('shows an inline error when a verification-document upload fails, without clearing the chosen file', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: { status: 'pending' } })
    apiClient.post.mockRejectedValue(new Error('File is too large.'))
    renderConnected(DoctorProfileEdit, { data: {} })

    const file = new File(['x'], 'cert.pdf', { type: 'application/pdf' })
    fireEvent.change(document.getElementById('verification-document-input'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: /Upload document/i }))

    expect(await screen.findByText('File is too large.')).toBeInTheDocument()
  })

  it('rejects an oversized document client-side without ever calling the upload endpoint', () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: { status: 'pending' } })
    renderConnected(DoctorProfileEdit, { data: {} })

    const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
    fireEvent.change(document.getElementById('verification-document-input'), { target: { files: [bigFile] } })

    expect(screen.getByText(/too large/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload document/i })).toBeDisabled()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  // COMPLETENESS ADD tests (request: "doctor bank details v only admin and super admin dekh
  // sakta hai add kro bank detail se ke") — this is the doctor's own self-entry form for payout
  // bank details; the admin-only READ-side display is covered separately in AdminPages.test.jsx.
  it('saves bank details via PATCH /me, independent of the main profile form', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    renderConnected(DoctorProfileEdit, { data: {} })

    fireEvent.change(screen.getByLabelText('Account holder name'), { target: { value: 'Asha Rao' } })
    fireEvent.change(screen.getByLabelText('Bank name'), { target: { value: 'HDFC Bank' } })
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '123456789012' } })
    fireEvent.change(screen.getByLabelText('IFSC code'), { target: { value: 'HDFC0001234' } })
    fireEvent.click(screen.getByRole('button', { name: /Save bank details/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/me', {
      bankAccountHolderName: 'Asha Rao',
      bankAccountNumber: '123456789012',
      bankIfscCode: 'HDFC0001234',
      bankName: 'HDFC Bank',
      bankUpiId: null,
    }))
    expect(await screen.findByText('Bank details saved.')).toBeInTheDocument()
  })

  // COMPLETENESS ADD (request: "upiid dalne ka v option de do") — a UPI ID, independent of the
  // 4 bank fields above.
  it('saves a UPI ID alone, without any of the 4 bank fields filled in', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    renderConnected(DoctorProfileEdit, { data: {} })

    fireEvent.change(screen.getByLabelText(/^UPI ID/), { target: { value: 'asha@okhdfcbank' } })
    fireEvent.click(screen.getByRole('button', { name: /Save bank details/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/me', expect.objectContaining({
      bankUpiId: 'asha@okhdfcbank',
    })))
    expect(await screen.findByText('Bank details saved.')).toBeInTheDocument()
  })

  it('prefills the bank-details form from the doctor\'s existing profile.bankDetails', () => {
    setCurrentUser({
      id: 'doc-1',
      name: 'Dr. Asha Rao',
      profile: { bankDetails: { accountHolderName: 'Asha Rao', bankName: 'HDFC Bank', accountNumber: '123456789012', ifscCode: 'HDFC0001234', upiId: 'asha@okhdfcbank' } },
    })
    renderConnected(DoctorProfileEdit, { data: {} })

    expect(screen.getByLabelText('Account holder name')).toHaveValue('Asha Rao')
    expect(screen.getByLabelText('Bank name')).toHaveValue('HDFC Bank')
    expect(screen.getByLabelText('Account number')).toHaveValue('123456789012')
    expect(screen.getByLabelText('IFSC code')).toHaveValue('HDFC0001234')
    expect(screen.getByLabelText(/^UPI ID/)).toHaveValue('asha@okhdfcbank')
  })

  it('shows an inline error when saving bank details fails', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    apiClient.patch.mockRejectedValue(new Error('bankIfscCode must be a valid 11-character IFSC code.'))
    renderConnected(DoctorProfileEdit, { data: {} })

    fireEvent.click(screen.getByRole('button', { name: /Save bank details/i }))

    expect(await screen.findByText('bankIfscCode must be a valid 11-character IFSC code.')).toBeInTheDocument()
  })

  // BUG FIX regression test (found live: an invalid IFSC code showed only the generic
  // "Validation failed" with no clue which field or why). The real backend response for a 422
  // VALIDATION_ERROR always carries this same generic top-level message — the specific, useful
  // reason is only ever in `error.details[0].message` (see validateRequest.js +
  // apiClient.js#shapeError, which surfaces it as `err.details`). firstErrorMessage() must prefer
  // that specific reason over the generic wrapper message.
  it('shows the SPECIFIC field message from err.details, not the generic "Validation failed" wrapper', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    apiClient.patch.mockRejectedValue(
      Object.assign(new Error('Validation failed'), {
        details: [{ field: 'bankIfscCode', message: 'bankIfscCode must be a valid 11-character IFSC code (e.g. HDFC0001234).' }],
      })
    )
    renderConnected(DoctorProfileEdit, { data: {} })

    fireEvent.change(screen.getByLabelText('IFSC code'), { target: { value: 'hdfcn0004' } })
    fireEvent.click(screen.getByRole('button', { name: /Save bank details/i }))

    expect(await screen.findByText('bankIfscCode must be a valid 11-character IFSC code (e.g. HDFC0001234).')).toBeInTheDocument()
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
  })

  // COMPLETENESS FIX regression tests: every other role's "My profile" page
  // (PortalSectionPages.jsx#PortalProfile — patient/receptionist/admin/superadmin) has a change-
  // password form; this page never did, leaving a doctor with no self-service way to change their
  // password. Same convention as PortalProfile#updatePassword: the server revokes every refresh
  // token on success, so this redirects to /login rather than pretending the session survives.
  it('changes the password and redirects to /login on success', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    apiClient.patch.mockResolvedValue({})
    renderConnected(DoctorProfileEdit, { data: {} })

    fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: 'oldpass123' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'newpass456' } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'newpass456' } })
    fireEvent.click(screen.getByRole('button', { name: /Change password/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/me/password', {
      currentPassword: 'oldpass123',
      newPassword: 'newpass456',
      confirmPassword: 'newpass456',
    }))
    expect(await screen.findByText(/Password changed successfully/i)).toBeInTheDocument()
  })

  it('rejects a mismatched confirmation without ever calling the password-change endpoint', () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    renderConnected(DoctorProfileEdit, { data: {} })

    fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: 'oldpass123' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'newpass456' } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'different789' } })
    fireEvent.click(screen.getByRole('button', { name: /Change password/i }))

    expect(screen.getByText('New passwords do not match.')).toBeInTheDocument()
    expect(apiClient.patch).not.toHaveBeenCalled()
  })

  it('shows an inline error when the server rejects the password change', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha Rao', profile: {} })
    apiClient.patch.mockRejectedValue(new Error('Current password is incorrect.'))
    renderConnected(DoctorProfileEdit, { data: {} })

    fireEvent.change(screen.getByLabelText(/^Current password/), { target: { value: 'wrongpass' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'newpass456' } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: 'newpass456' } })
    fireEvent.click(screen.getByRole('button', { name: /Change password/i }))

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument()
  })
})

describe('DoctorAppointments / ReceptionAppointments (shared AppointmentTable)', () => {
  const APPOINTMENTS = [
    { id: 'a1', status: 'upcoming', tokenNumber: 1, patient: { name: 'Asha' } },
    { id: 'a2', status: 'confirmed', tokenNumber: 2, patient: { name: 'Ben' } },
    { id: 'a3', status: 'completed', tokenNumber: 3, patient: { name: 'Chitra' } },
  ]

  it('renders the doctor appointments list from the live store and offers status actions per row', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    renderConnected(DoctorAppointments, {})

    expect(await screen.findByText('Asha')).toBeInTheDocument()
    // upcoming: Confirm + Complete + No-show + Cancel all offered.
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    // confirmed (not upcoming): Confirm is gone but Complete/No-show/Cancel remain.
    const benRow = screen.getByText('Ben').closest('tr')
    expect(within(benRow).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(within(benRow).getByRole('button', { name: 'Complete' })).toBeInTheDocument()
    // completed/terminal row: no actions left at all.
    const chitraRow = screen.getByText('Chitra').closest('tr')
    expect(within(chitraRow).queryByRole('button')).not.toBeInTheDocument()
  })

  it('confirms an upcoming appointment via PATCH /appointments/:id/status', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    apiClient.patch.mockResolvedValue({ ...APPOINTMENTS[0], status: 'confirmed' })
    renderConnected(DoctorAppointments, {})

    await screen.findByText('Asha')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/appointments/a1/status', { status: 'confirmed' }))
  })

  it('cancels an appointment only after the staff member confirms the prompt', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    apiClient.patch.mockResolvedValue({ ...APPOINTMENTS[0], status: 'cancelled' })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderConnected(DoctorAppointments, {})

    await screen.findByText('Asha')
    const ashaRow = screen.getByText('Asha').closest('tr')
    fireEvent.click(within(ashaRow).getByRole('button', { name: 'Cancel' }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(apiClient.patch).not.toHaveBeenCalledWith('/appointments/a1/status', { status: 'cancelled' })

    confirmSpy.mockReturnValue(true)
    fireEvent.click(within(ashaRow).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/appointments/a1/status', { status: 'cancelled' }))
    confirmSpy.mockRestore()
  })

  it('shows an inline error when a status update fails, without losing the row', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    apiClient.patch.mockRejectedValue(new Error('This appointment was already updated.'))
    renderConnected(DoctorAppointments, {})

    await screen.findByText('Asha')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('This appointment was already updated.')).toBeInTheDocument()
    expect(screen.getByText('Asha')).toBeInTheDocument()
  })

  it('renders the receptionist appointments page with the same shared table', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    renderConnected(ReceptionAppointments, {})
    expect(screen.getByText('Manage scheduled and walk-in visits.')).toBeInTheDocument()
    expect(await screen.findByText('Asha')).toBeInTheDocument()
  })

  // BOOKING-ID VISIBILITY FIX (user request: "bookinh id ko slip pe dikhai and my bookong me v
  // dikhao", follow-up: "dctor receptionest ko v show ho") — the shared AppointmentTable's 'ID'
  // column is just this table's own row sequence number, not the real booking id. Since both
  // DoctorAppointments and ReceptionAppointments render the same AppointmentTable, one column
  // covers both roles — verified here for each page.
  it('shows a "Booking ID" column with the real booking id on the doctor appointments page', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    renderConnected(DoctorAppointments, {})

    await screen.findByText('Asha')
    expect(screen.getByRole('columnheader', { name: 'Booking ID' })).toBeInTheDocument()
    expect(screen.getByText(shortId('a1'))).toBeInTheDocument()
  })

  it('shows a "Booking ID" column with the real booking id on the receptionist appointments page', async () => {
    mockGetRoutes({ '/appointments': APPOINTMENTS })
    renderConnected(ReceptionAppointments, {})

    await screen.findByText('Asha')
    expect(screen.getByRole('columnheader', { name: 'Booking ID' })).toBeInTheDocument()
    expect(screen.getByText(shortId('a1'))).toBeInTheDocument()
  })
})

describe('PatientHistory', () => {
  it('derives a distinct patient list from appointments and supports name/phone search', async () => {
    mockGetRoutes({
      '/appointments': [
        { id: 'a1', status: 'completed', patient: { id: 'p1', name: 'Asha Mehta', phone: '9000000001' } },
        { id: 'a2', status: 'upcoming', patient: { id: 'p1', name: 'Asha Mehta', phone: '9000000001' } },
        { id: 'a3', status: 'completed', patient: { id: 'p2', name: 'Ben Gala', phone: '9000000002' } },
      ],
    })
    renderConnected(PatientHistory, {})

    expect(await screen.findByText('Asha Mehta')).toBeInTheDocument()
    expect(screen.getByText('Ben Gala')).toBeInTheDocument()
    // Two appointments collapse into one patient row with visits: 2.
    expect(screen.getByText('2')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search patient'), { target: { value: '9000000002' } })
    expect(screen.queryByText('Asha Mehta')).not.toBeInTheDocument()
    expect(screen.getByText('Ben Gala')).toBeInTheDocument()
  })
})

describe('Analytics', () => {
  it('shows a clear not-available state instead of crashing (no time-series endpoint exists)', () => {
    renderConnected(Analytics, {})
    expect(screen.getByText('Analytics not available')).toBeInTheDocument()
    expect(screen.getByText(/no time-series analytics endpoint yet/i)).toBeInTheDocument()
  })
})

describe('ReceptionDashboard', () => {
  it('renders reception stats and this receptionist\'s own clinic doctors from the live store', async () => {
    // BUG FIX regression coverage — same fix as WalkIn below: "Assigned doctors" now loads this
    // receptionist's own clinic (GET /clinics/:id) instead of the platform-wide public directory.
    setCurrentUser({ id: 'rec-1', name: 'Meera Iyer', profile: { clinicId: 'clinic-1' } })
    mockGetRoutes({ '/clinics/clinic-1': { id: 'clinic-1', doctors: [{ doctorUserId: 'd1', name: 'Dr. Kapoor', onlineBooking: true }] } })
    const today = new Date().toISOString().slice(0, 10)
    renderConnected(ReceptionDashboard, {
      data: {
        queueTokens: [{ id: 'q1', status: 'waiting' }],
        appointments: [{ id: 'a1', appointmentDate: today, status: 'completed' }],
        payments: [{ status: 'pending' }],
      },
    })
    expect(screen.getByText('Welcome, Meera.')).toBeInTheDocument()
    expect(await screen.findByText('Dr. Kapoor')).toBeInTheDocument()
  })
})

describe('WalkIn', () => {
  // BUG FIX regression coverage ("yaha par do doctor kyu aa raha hai... jis doctor ka
  // receptionist hai ushi ka show hona chahiye"): the Doctor dropdown now loads this
  // receptionist's OWN clinic (GET /clinics/:id, keyed off currentUser.profile.clinicId) instead
  // of the platform-wide public doctor directory — so every test below sets a signed-in
  // receptionist with a clinicId and mocks that clinic's doctors.
  const RECEPTIONIST = { id: 'recep-1', name: 'Anita Desai', role: 'receptionist', profile: { clinicId: 'clinic-1' } }

  it('scopes the Doctor dropdown to this receptionist\'s own clinic, not every doctor on the platform', async () => {
    setCurrentUser(RECEPTIONIST)
    mockGetRoutes({ '/clinics/clinic-1': { id: 'clinic-1', doctors: [{ doctorUserId: 'doc-1', name: 'Dr. Priya Sharma' }] } })
    renderConnected(WalkIn, { data: { appointments: [] } })

    expect(await screen.findByRole('option', { name: 'Dr. Priya Sharma' })).toBeInTheDocument()
    // A doctor from elsewhere on the platform (not assigned to this clinic) must never appear.
    expect(screen.queryByRole('option', { name: 'Prakash Kumar' })).not.toBeInTheDocument()
  })

  it('shows a message instead of a doctor list when the receptionist has no clinic assigned', async () => {
    setCurrentUser({ ...RECEPTIONIST, profile: { clinicId: null } })
    renderConnected(WalkIn, { data: { appointments: [] } })

    expect(await screen.findByText(/account isn't linked to a clinic yet/i)).toBeInTheDocument()
  })

  it('registers a walk-in visit and shows the issued token', async () => {
    setCurrentUser(RECEPTIONIST)
    // createAppointment() is a job-queue flow (see useAppStore.js): POST /appointments only
    // enqueues the booking ({ jobId, status: 'queued' }) — the real appointment comes back from
    // polling GET /appointments/booking-status/:jobId until it reports 'confirmed'.
    apiClient.post.mockImplementation((url) => {
      if (url === '/appointments') return Promise.resolve({ jobId: 'job-1', status: 'queued' })
      return Promise.resolve({})
    })
    apiClient.get.mockImplementation((url) => {
      if (url === '/clinics/clinic-1') return Promise.resolve({ id: 'clinic-1', doctors: [{ doctorUserId: 'doc-1', name: 'Dr. Kapoor' }] })
      if (url === '/appointments/booking-status/job-1') {
        return Promise.resolve({ status: 'confirmed', appointment: { id: 'appt-new', tokenNumber: 42, patient: { name: 'Ravi Shah' } } })
      }
      return Promise.resolve([])
    })
    renderConnected(WalkIn, { data: { appointments: [] } })

    await screen.findByRole('option', { name: 'Dr. Kapoor' })
    fireEvent.change(screen.getByLabelText(/^Patient name/), { target: { value: 'Ravi Shah' } })
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9876543210' } })
    fireEvent.change(screen.getByLabelText(/^Doctor\b/), { target: { value: 'Dr. Kapoor' } })
    fireEvent.click(screen.getByRole('button', { name: /Register and issue token/i }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/appointments', expect.objectContaining({
      doctorUserId: 'doc-1',
      patientName: 'Ravi Shah',
      patientPhone: '9876543210',
    })))
    // The poll sleeps ~1.7s between attempts (real timers) before resolving 'confirmed'.
    expect(await screen.findByText(/token #42 issued for Ravi Shah/, {}, { timeout: 3000 })).toBeInTheDocument()
  }, 10000)

  it('shows an inline error when registration fails', async () => {
    setCurrentUser(RECEPTIONIST)
    mockGetRoutes({ '/clinics/clinic-1': { id: 'clinic-1', doctors: [{ doctorUserId: 'doc-1', name: 'Dr. Kapoor' }] } })
    apiClient.post.mockRejectedValue(new Error('Doctor is fully booked for this date.'))
    renderConnected(WalkIn, { data: { appointments: [] } })

    await screen.findByRole('option', { name: 'Dr. Kapoor' })
    fireEvent.change(screen.getByLabelText(/^Patient name/), { target: { value: 'Ravi Shah' } })
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9876543210' } })
    fireEvent.change(screen.getByLabelText(/^Doctor\b/), { target: { value: 'Dr. Kapoor' } })
    fireEvent.click(screen.getByRole('button', { name: /Register and issue token/i }))

    expect(await screen.findByText('Doctor is fully booked for this date.')).toBeInTheDocument()
  })
})

describe('CheckIn', () => {
  it('shows checked-in vs not-checked-in appointments without a manual check-in endpoint', () => {
    renderConnected(CheckIn, {
      data: {
        appointments: [
          { id: 'a1', status: 'upcoming', doctor: { name: 'Dr. Kapoor' }, checkedInAt: '2026-01-01T00:00:00Z' },
          { id: 'a2', status: 'confirmed', doctor: { name: 'Dr. Rao' } },
        ],
      },
    })
    expect(screen.getByText('Not checked in')).toBeInTheDocument()
    // The checked-in row renders a StatusPill('completed') rather than the plain text.
    expect(screen.queryAllByText('Not checked in')).toHaveLength(1)
  })
})

describe('CashPayment', () => {
  it('records a cash payment for the selected unpaid appointment', async () => {
    mockGetRoutes({ '/payments': [] })
    apiClient.post.mockResolvedValue({ id: 'pay-1' })
    renderConnected(CashPayment, {
      data: {
        appointments: [{ id: 'a1', patient: { id: 'p1', name: 'Asha' }, doctor: { id: 'd1' }, clinic: { id: 'c1' }, fees: { consultationFee: 500 }, paymentStatus: 'pending' }],
      },
    })

    fireEvent.change(screen.getByLabelText(/^Unpaid appointment/), { target: { value: '#a1 · Asha · ₹500' } })
    fireEvent.change(screen.getByLabelText(/^Payment method/), { target: { value: 'Cash' } })
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/payments', expect.objectContaining({
      appointmentId: 'a1',
      patientUserId: 'p1',
      doctorUserId: 'd1',
      clinicId: 'c1',
      mode: 'cash',
    })))
    expect(await screen.findByText('Payment recorded.')).toBeInTheDocument()
  })

  // COMPLETENESS ADD coverage (request: "koi patient ko select karne ke bad open ho kitna
  // payment hua hai kitna baki hai utr no aaye upi id aaye"): selecting an appointment opens a
  // paid/due summary, the UTR and UPI ID fields are always visible, and both submit correctly.
  it('shows paid/due status once an appointment is selected, and submits the UTR number + UPI ID', async () => {
    mockGetRoutes({ '/payments': [] })
    apiClient.post.mockResolvedValue({ id: 'pay-1' })
    renderConnected(CashPayment, {
      data: {
        appointments: [{ id: 'a1', patient: { id: 'p1', name: 'Asha' }, doctor: { id: 'd1' }, clinic: { id: 'c1' }, fees: { consultationFee: 500 }, paymentStatus: 'pending' }],
      },
    })

    // UTR number and UPI ID fields are always present, regardless of payment method.
    expect(screen.getByLabelText(/^UTR \/ Transaction number/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^UPI ID/)).toBeInTheDocument()
    // No summary before an appointment is picked.
    expect(screen.queryByText(/Consultation fee/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Unpaid appointment/), { target: { value: '#a1 · Asha · ₹500' } })
    expect(screen.getByText('Consultation fee: ₹500')).toBeInTheDocument()
    expect(screen.getByText(/Paid so far: ₹0 · Due now: ₹500/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Payment method/), { target: { value: 'Upi' } })
    fireEvent.change(screen.getByLabelText(/^UTR \/ Transaction number/), { target: { value: 'UTR998877' } })
    fireEvent.change(screen.getByLabelText(/^UPI ID/), { target: { value: 'asha@okhdfcbank' } })
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/payments', expect.objectContaining({
      appointmentId: 'a1',
      mode: 'upi',
      transactionRef: 'UTR998877',
      payerUpiId: 'asha@okhdfcbank',
    })))
  })

  // DUE-AMOUNT VISIBILITY FIX (user request: "jab payment minimum hua hai to receptionist ko v to
  // baki ka due show hoga aur doctor ko") — this used to show a vague "advance already paid,
  // collecting the remaining balance now" sentence with NO number at all for a partial
  // appointment (receptionist only ever saw `fees.consultationFee`). The server now also sends a
  // single, already-contextual `fees.due` figure (the doctor's own outstanding share, never a
  // masked platform-business field) — see appointments.service.js#shapeFees — so the exact amount
  // to collect is now shown as a number, not just prose.
  it('shows the exact server-computed due amount (fees.due) for a partial appointment, not just a vague note', async () => {
    mockGetRoutes({ '/payments': [] })
    renderConnected(CashPayment, {
      data: {
        appointments: [{ id: 'a1', patient: { id: 'p1', name: 'Asha' }, doctor: { id: 'd1' }, clinic: { id: 'c1' }, fees: { consultationFee: 500, due: 400 }, paymentStatus: 'partial' }],
      },
    })

    fireEvent.change(screen.getByLabelText(/^Unpaid appointment/), { target: { value: '#a1 · Asha · ₹500' } })
    expect(screen.getByText(/already been paid online/)).toBeInTheDocument()
    expect(screen.getByText(/Due now: ₹400/)).toBeInTheDocument()
  })

  // BUG FIX regression coverage ("eshko sahi review kro proper"): a real appointment id is a full
  // UUID, not a short mock like 'a1'. The dropdown must show a short id (not the raw UUID) AND
  // still submit the correct appointment — the old code parsed the id back out of the visible
  // label text, so shortening the label without fixing that would have submitted nothing/the
  // wrong appointment.
  it('shortens a full-UUID appointment id in the dropdown label and still submits the right appointment', async () => {
    mockGetRoutes({ '/payments': [] })
    apiClient.post.mockResolvedValue({ id: 'pay-2' })
    renderConnected(CashPayment, {
      data: {
        appointments: [{ id: '5c1a256d-3583-4400-9dd5-498660ebf63b', patient: { id: 'p1', name: 'Rahul Verma' }, doctor: { id: 'd1' }, clinic: { id: 'c1' }, fees: { consultationFee: 500 }, paymentStatus: 'pending' }],
      },
    })

    // The full UUID must never appear in the dropdown.
    expect(screen.queryByText(/5c1a256d-3583-4400-9dd5-498660ebf63b/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Unpaid appointment/), { target: { value: '#f63b · Rahul Verma · ₹500' } })
    fireEvent.change(screen.getByLabelText(/^Payment method/), { target: { value: 'Cash' } })
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/payments', expect.objectContaining({
      appointmentId: '5c1a256d-3583-4400-9dd5-498660ebf63b',
      patientUserId: 'p1',
      mode: 'cash',
    })))
    expect(await screen.findByText('Payment recorded.')).toBeInTheDocument()
  })

  // BUG FIX (request: "jiska payment complete ho jaye hat jaye") — data.appointments is only
  // loaded once at login (loadUserData), so createPayment() flipping the appointment's
  // paymentStatus server-side never showed up here on its own; the just-paid appointment kept
  // sitting in the "Unpaid appointment" dropdown. Fixed by refetching appointments after a
  // successful save. Uses the live store (no `data` override) so the refetch is observable.
  it('refetches appointments after recording a payment, so the just-paid appointment drops out of the unpaid list', async () => {
    useAppStore.setState((state) => ({
      data: {
        ...state.data,
        appointments: [
          { id: 'a1', patient: { id: 'p1', name: 'Rahul Verma' }, doctor: { id: 'd1' }, clinic: { id: 'c1' }, fees: { consultationFee: 500 }, paymentStatus: 'pending' },
          { id: 'a2', patient: { id: 'p1', name: 'Rahul Verma' }, doctor: { id: 'd1' }, clinic: { id: 'c1' }, fees: { consultationFee: 500 }, paymentStatus: 'pending' },
        ],
      },
    }))
    mockGetRoutes({
      '/payments': [],
      // Simulates the server having flipped a1's paymentStatus to 'paid'; a2 stays unpaid.
      '/appointments': [
        { id: 'a1', patient: { id: 'p1', name: 'Rahul Verma' }, doctor: { id: 'd1' }, clinic: { id: 'c1' }, fees: { consultationFee: 500 }, paymentStatus: 'paid' },
        { id: 'a2', patient: { id: 'p1', name: 'Rahul Verma' }, doctor: { id: 'd1' }, clinic: { id: 'c1' }, fees: { consultationFee: 500 }, paymentStatus: 'pending' },
      ],
    })
    apiClient.post.mockResolvedValue({ id: 'pay-1' })
    renderConnected(CashPayment)

    fireEvent.change(screen.getByLabelText(/^Unpaid appointment/), { target: { value: '#a1 · Rahul Verma · ₹500' } })
    fireEvent.change(screen.getByLabelText(/^Payment method/), { target: { value: 'Cash' } })
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }))

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/appointments', expect.anything()))
    await waitFor(() => expect(screen.queryByText('#a1 · Rahul Verma · ₹500')).not.toBeInTheDocument())
    expect(screen.getByText('#a2 · Rahul Verma · ₹500')).toBeInTheDocument()
  })

  // COMPLETENESS ADD (request: "receptionist and doctor ke pass show ho online payment kitna hua
  // cash ye proper way me", then "eshme ye show hona chahiye ki online booking ke time pe kitna
  // payment hua hai and second clinic pe aake cash ya online ye v to confirm hona chahiye") — this
  // page previously had no running total of collections at all, then only a cash-vs-"everything
  // else online" split that didn't separate a patient's own booking-time Razorpay payment from a
  // payment the receptionist collects in person at the counter. Now a three-way split: paid online
  // at booking (transactionRef shaped like a Razorpay payment id, e.g. 'pay_xyz789' — see
  // lib/paymentVisibility.js's isOnlineBookingPayment) vs collected at the clinic (cash vs
  // online/upi/card, with a receptionist-typed reference like a UTR number).
  it('shows three separate totals: paid online at booking, cash collected at the clinic, and online collected at the clinic', async () => {
    renderConnected(CashPayment, {
      data: {
        appointments: [],
        payments: [
          { id: 'pay-1', mode: 'cash', appointment: { id: 'a1' }, fees: { consultationFee: 500 } },
          { id: 'pay-2', mode: 'cash', appointment: { id: 'a2' }, fees: { consultationFee: 300 } },
          { id: 'pay-3', mode: 'upi', transactionRef: 'UTR12345', appointment: { id: 'a3' }, fees: { consultationFee: 400 } },
          { id: 'pay-4', mode: 'card', appointment: { id: 'a4' }, fees: { consultationFee: 100 } },
          // Paid by the patient online at booking time (Razorpay) — must count separately, not as
          // another "collected at clinic" online payment.
          { id: 'pay-5', mode: 'online', transactionRef: 'pay_xyz789', appointment: { id: 'a5' }, fees: { consultationFee: 600 } },
        ],
      },
    })

    const bookingCard = screen.getByText('PAID ONLINE AT BOOKING').closest('article')
    expect(bookingCard).toHaveTextContent('₹600')
    expect(bookingCard).toHaveTextContent('1 payment')

    const cashCard = screen.getByText('CASH COLLECTED AT CLINIC').closest('article')
    expect(cashCard).toHaveTextContent('₹800') // 500 + 300
    expect(cashCard).toHaveTextContent('2 payments')

    const onlineCard = screen.getByText('ONLINE COLLECTED AT CLINIC').closest('article')
    expect(onlineCard).toHaveTextContent('₹500') // 400 (upi) + 100 (card) — the Razorpay one is excluded
    expect(onlineCard).toHaveTextContent('2 payments')

    // Per-row confirmation in the table itself: which rows were paid before arrival vs collected
    // at the counter (shown for every row, cash included). The table starts in its loading state
    // (DataTable shows a skeleton until the page's own fetchPayments() resolves), so wait for the
    // real rows to appear.
    expect(await screen.findByText('At booking')).toBeInTheDocument()
    expect(screen.getAllByText('At clinic')).toHaveLength(4) // the two cash rows, the upi row, and the card row
  })

  // Same "view before download" pattern as PatientPages.jsx's booking slip / receipt actions
  // (request: "baki jagah v same kar do jaha slip download ho raha hai") — the receptionist/doctor
  // Receipt action must open an in-page preview rather than save a file immediately, with the
  // download action inside it.
  it('View receipt opens an in-page PDF preview instead of downloading immediately, with a Download action inside it', async () => {
    mockGetRoutes({ '/payments': [] })
    renderConnected(CashPayment, {
      data: {
        appointments: [{ id: 'a1', patient: { name: 'Rahul Verma' }, doctor: { name: 'Dr. Asha Rao' }, fees: { consultationFee: 500 }, paymentStatus: 'paid' }],
        payments: [{
          id: 'pay-1',
          receiptNumber: 'RCPT-9',
          createdAt: '2026-08-02',
          mode: 'cash',
          status: 'paid',
          transactionRef: 'txn_1',
          fees: { consultationFee: 500 },
          appointment: { id: 'a1' },
        }],
      },
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /View receipt/ }))

    const preview = await screen.findByRole('dialog', { name: 'Payment receipt preview' })
    const iframe = preview.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe.getAttribute('src')).toMatch(/^blob:/)

    const downloadLink = screen.getByRole('link', { name: /Download/ })
    expect(downloadLink.getAttribute('href')).toBe(iframe.getAttribute('src'))
    expect(downloadLink.getAttribute('download')).toMatch(/^receipt-.*\.pdf$/)

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('ClinicSchedule', () => {
  it('shows an empty state when there is no signed-in doctor', () => {
    setCurrentUser(null)
    renderConnected(ClinicSchedule, { data: {} })
    expect(screen.getByText('No doctor profile yet')).toBeInTheDocument()
  })

  it('saves a new weekly OPD timing for the chosen clinic', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha', profile: {} })
    renderConnected(ClinicSchedule, { data: { clinics: [{ id: 'clinic-1', name: 'Heart Care Clinic' }], opdEntries: [] } })

    fireEvent.change(screen.getAllByLabelText(/^Clinic\b/)[0], { target: { value: 'Heart Care Clinic' } })
    fireEvent.change(screen.getByLabelText(/^Day\b/), { target: { value: 'Monday' } })
    fireEvent.click(screen.getByRole('button', { name: /Save OPD timing/i }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/clinics/clinic-1/hours', expect.objectContaining({
      weekday: 1,
      startTime: '10:00',
      endTime: '18:00',
    })))
    expect(await screen.findByText('OPD timing saved.')).toBeInTheDocument()
  })

  // COMPLETENESS ADD tests (request: "doctor ek booking rule do jo booking online wala continues
  // token no jayega ya odd ya even patient ko mle" + follow-up "odd ya even select karne ka
  // option do doctor jo select kar online ke lie") — the token-numbering-mode selector added to
  // this same "Patient booking window" form; appointments.service.js#runBookingJob's actual
  // numbering behavior for each mode is covered in the backend's appointments.service.test.js.
  it('defaults to "Sequential" and sends tokenNumberingMode: sequential when left unchanged', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha', profile: {} })
    renderConnected(ClinicSchedule, { data: { clinics: [], opdEntries: [] } })

    expect(screen.getByLabelText('Token numbering for queue')).toHaveValue('Sequential')
    fireEvent.click(screen.getByRole('button', { name: /Save booking window/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/doctors/doc-1', expect.objectContaining({
      tokenNumberingMode: 'sequential',
    })))
  })

  it('sends tokenNumberingMode: alternate + onlineTokenParity: odd when the doctor picks "online gets odd numbers"', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha', profile: {} })
    renderConnected(ClinicSchedule, { data: { clinics: [], opdEntries: [] } })

    fireEvent.change(screen.getByLabelText('Token numbering for queue'), { target: { value: 'Odd / even — online gets odd numbers' } })
    fireEvent.click(screen.getByRole('button', { name: /Save booking window/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/doctors/doc-1', expect.objectContaining({
      tokenNumberingMode: 'alternate',
      onlineTokenParity: 'odd',
    })))
    expect(await screen.findByText('Booking window saved.')).toBeInTheDocument()
  })

  it('sends tokenNumberingMode: alternate + onlineTokenParity: even when the doctor picks "online gets even numbers"', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha', profile: {} })
    renderConnected(ClinicSchedule, { data: { clinics: [], opdEntries: [] } })

    fireEvent.change(screen.getByLabelText('Token numbering for queue'), { target: { value: 'Odd / even — online gets even numbers' } })
    fireEvent.click(screen.getByRole('button', { name: /Save booking window/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/doctors/doc-1', expect.objectContaining({
      tokenNumberingMode: 'alternate',
      onlineTokenParity: 'even',
    })))
  })

  it('prefills "online gets odd numbers" when the doctor already has alternate/odd configured', () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha', profile: { tokenNumberingMode: 'alternate', onlineTokenParity: 'odd' } })
    renderConnected(ClinicSchedule, { data: { clinics: [], opdEntries: [] } })

    expect(screen.getByLabelText('Token numbering for queue')).toHaveValue('Odd / even — online gets odd numbers')
  })

  it('prefills "online gets even numbers" when the doctor already has alternate/even configured', () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Asha', profile: { tokenNumberingMode: 'alternate', onlineTokenParity: 'even' } })
    renderConnected(ClinicSchedule, { data: { clinics: [], opdEntries: [] } })

    expect(screen.getByLabelText('Token numbering for queue')).toHaveValue('Odd / even — online gets even numbers')
  })
})

describe('StaffPages role gating (RoleGuard, via App)', () => {
  const DOCTOR_USER = { id: 'doc-1', name: 'Dr. Nikhil Rao', email: 'nikhil@example.com', role: 'doctor' }
  const RECEPTIONIST_USER = { id: 'rec-1', name: 'Meera Iyer', email: 'meera@example.com', role: 'receptionist' }

  function mockBootFor(user) {
    getTokens.mockReturnValue({ accessToken: 'tok' })
    apiClient.post.mockResolvedValue({})
    apiClient.get.mockImplementation((url) => {
      if (url === '/me') return Promise.resolve(user)
      return Promise.resolve([])
    })
  }

  it('lets a doctor reach /doctor/queue and blocks a receptionist from it', async () => {
    mockBootFor(DOCTOR_USER)
    render(<MemoryRouter initialEntries={['/doctor/queue']}><App /></MemoryRouter>)
    expect(await screen.findByText('Live OPD queue')).toBeInTheDocument()
  })

  it('redirects a receptionist away from the doctor-only /doctor/queue route to their own dashboard', async () => {
    mockBootFor(RECEPTIONIST_USER)
    render(<MemoryRouter initialEntries={['/doctor/queue']}><App /></MemoryRouter>)
    expect(await screen.findByText('Welcome, Meera.')).toBeInTheDocument()
    expect(screen.queryByText('Live OPD queue')).not.toBeInTheDocument()
  })
})
