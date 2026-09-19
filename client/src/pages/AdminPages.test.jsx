// Tests for the admin/superadmin portal pages (src/pages/AdminPages.jsx).
//
// Same convention as StaffPages.test.jsx / login-flow.test.jsx: render the real page components
// against the real Zustand store, mocking only src/lib/apiClient.js. `renderConnected` mirrors how
// App.jsx feeds every one of these components their `data` prop
// (`const data = useAppStore((state) => state.data)`), so an action's PATCH/POST/PUT that updates
// the store is actually visible on screen, exactly as in the real app.
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
  AdminDashboard,
  AuditLog,
  Broadcast,
  CitiesAreas,
  ClinicVerification,
  Complaints,
  DoctorVerification,
  ManageClinics,
  ManagePatients,
  ManageReceptionists,
  PlatformSettings,
  RevenueReports,
} from './AdminPages'

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

describe('AdminDashboard', () => {
  it('renders live stat cards and recent records once both fetches resolve', async () => {
    setCurrentUser({ id: 'admin-1', name: 'Priya Admin' })
    mockGetRoutes({
      '/admin/dashboard-stats': { verifiedDoctorsCount: 12, registeredPatientsCount: 340, todaysBookingsCount: 8, monthlyRevenue: 125000 },
      '/appointments': [{ id: 'a1', patient: { name: 'Asha' }, appointmentDate: '2026-01-05', status: 'upcoming' }],
    })
    renderConnected(AdminDashboard, {})

    expect(screen.getByText('Welcome, Priya.')).toBeInTheDocument()
    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('340')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('₹1,25,000')).toBeInTheDocument()
    expect(await screen.findByText('Asha')).toBeInTheDocument()
  })

  it('shows an inline error when the dashboard-stats fetch fails, without crashing the rest of the page', async () => {
    setCurrentUser({ id: 'admin-1', name: 'Priya Admin' })
    apiClient.get.mockImplementation((url) => {
      if (url === '/admin/dashboard-stats') return Promise.reject(new Error('Stats service unavailable.'))
      return Promise.resolve([])
    })
    renderConnected(AdminDashboard, {})
    expect(await screen.findByText('Stats service unavailable.')).toBeInTheDocument()
    expect(screen.getByText('Welcome, Priya.')).toBeInTheDocument()
  })

  // BOOKING-ID VISIBILITY FIX (user request: "booking id appointment me do admin supar admin ke")
  // — the "Recent live records" widget's 'Time / ID' column is just this row's position (#1,
  // #2...), never the real booking id. Same shortId() format already used everywhere else.
  it('shows a "Booking ID" column with the real booking id in "Recent live records"', async () => {
    setCurrentUser({ id: 'admin-1', name: 'Priya Admin' })
    mockGetRoutes({
      '/admin/dashboard-stats': { verifiedDoctorsCount: 12, registeredPatientsCount: 340, todaysBookingsCount: 8, monthlyRevenue: 125000 },
      '/appointments': [{ id: 'a1', patient: { name: 'Asha' }, appointmentDate: '2026-01-05', status: 'upcoming' }],
    })
    renderConnected(AdminDashboard, {})

    expect(await screen.findByRole('columnheader', { name: 'Booking ID' })).toBeInTheDocument()
    expect(screen.getByText(shortId('a1'))).toBeInTheDocument()
  })
})

describe('DoctorVerification', () => {
  const DOCTORS = [
    { id: 'doc-1', name: 'Dr. Kapoor', status: 'verified', accountStatus: 'active', experienceYears: 5, consultationFee: 500 },
    { id: 'doc-2', name: 'Dr. New', status: 'pending', accountStatus: 'active', experienceYears: 2, consultationFee: 300 },
  ]

  it('lists every doctor plus a distinct pending-verification queue', async () => {
    mockGetRoutes({ '/doctors': DOCTORS })
    renderConnected(DoctorVerification, {})

    expect(await screen.findByText('Dr. Kapoor')).toBeInTheDocument()
    expect(screen.getByText('Pending verification')).toBeInTheDocument()
    const pendingSection = screen.getByText('Pending verification').closest('div').parentElement
    expect(within(pendingSection).getByText('Dr. New')).toBeInTheDocument()
  })

  // Regression test for the stable-id feature (prisma/migrations/
  // 20260919130000_add_patient_doctor_clinic_numbers): the ID column must render the real stored
  // doctorNumber via stableId(), not a row-position-derived sequenceId(), so the same doctor
  // always shows the same "DCD<N>" regardless of where they land in the list.
  it('renders each doctor\'s ID from their stored doctorNumber, not their row position', async () => {
    mockGetRoutes({
      '/doctors': [
        { id: 'doc-1', name: 'Dr. Kapoor', status: 'verified', accountStatus: 'active', experienceYears: 5, consultationFee: 500, doctorNumber: 12 },
        { id: 'doc-2', name: 'Dr. New', status: 'pending', accountStatus: 'active', experienceYears: 2, consultationFee: 300, doctorNumber: 3 },
      ],
    })
    renderConnected(DoctorVerification, {})

    await screen.findByText('Dr. Kapoor')
    expect((await screen.findByText('Dr. Kapoor')).closest('tr')).toHaveTextContent('DCD12')
    // Dr. New is index 1 in "Live records" but appears FIRST (index 0) in "Pending verification"
    // below — a position-based DC02 would collide with a different index-based label in each
    // section; the stored doctorNumber must show DCD3 in both regardless.
    const pendingSection = screen.getByText('Pending verification').closest('div').parentElement
    expect(within(pendingSection).getByText('Dr. New').closest('tr')).toHaveTextContent('DCD3')
  })

  it('creates a doctor account with correctly-typed fields', async () => {
    mockGetRoutes({ '/doctors': [] })
    apiClient.post.mockResolvedValue({ id: 'doc-3', name: 'Dr. Fresh', status: 'pending' })
    renderConnected(DoctorVerification, { data: { specializations: [{ id: 'spec-1', name: 'Cardiology' }] } })

    fireEvent.change(screen.getByLabelText(/^Doctor name/), { target: { value: 'Dr. Fresh' } })
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'fresh@example.com' } })
    fireEvent.change(screen.getByLabelText(/^Temporary password/), { target: { value: 'temp12345' } })
    fireEvent.change(screen.getByLabelText(/^Specialization/), { target: { value: 'spec-1' } })
    fireEvent.change(screen.getByLabelText(/^Experience/), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText(/^Consultation fee/), { target: { value: '650' } })
    fireEvent.click(screen.getByRole('button', { name: /^Create doctor$/ }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/doctors', expect.objectContaining({
      name: 'Dr. Fresh',
      email: 'fresh@example.com',
      specializationId: 'spec-1',
      experienceYears: 4,
      consultationFee: 650,
      verifyImmediately: false,
    })))
    expect(await screen.findByText('Doctor account created.')).toBeInTheDocument()
  })

  it('verifies a pending doctor, moving them out of the pending queue', async () => {
    mockGetRoutes({ '/doctors': DOCTORS })
    apiClient.patch.mockResolvedValue({ status: 'verified' })
    renderConnected(DoctorVerification, {})

    await screen.findByText('Dr. New')
    const pendingSection = screen.getByText('Pending verification').closest('div').parentElement
    fireEvent.click(within(pendingSection).getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/doctors/doc-2/status', { status: 'verified' }))
    await waitFor(() => expect(screen.getByText('No doctors awaiting verification')).toBeInTheDocument())
  })

  it('disables a doctor login independently of their verification status', async () => {
    mockGetRoutes({ '/doctors': DOCTORS })
    apiClient.patch.mockResolvedValue({ accountStatus: 'disabled' })
    renderConnected(DoctorVerification, {})

    const row = (await screen.findByText('Dr. Kapoor')).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'Disable login' }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/doctors/doc-1/account-status', { status: 'disabled' }))
  })

  it('opens booking settings and clears the per-doctor window override when following platform hours', async () => {
    mockGetRoutes({ '/doctors': DOCTORS })
    apiClient.get.mockImplementation((url) => {
      if (url === '/doctors') return Promise.resolve(DOCTORS)
      if (url === '/doctors/doc-1') return Promise.resolve({ ...DOCTORS[0], onlineBooking: true, allowRebooking: true, maxDaysAdvance: 14, onlineBookingWindowStart: '08:00', onlineBookingWindowEnd: '20:00' })
      return Promise.resolve([])
    })
    apiClient.patch.mockResolvedValue({})
    renderConnected(DoctorVerification, {})

    const row = (await screen.findByText('Dr. Kapoor')).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'Booking settings' }))

    // The fetched doctor already has a per-doctor window, so "Follow platform-wide hours" starts
    // unchecked — check it to clear the override.
    await screen.findByLabelText('Follow platform-wide hours')
    // The checkbox starts `true` (its state's own initial value) and only flips to reflect the
    // fetched doctor's real window in a follow-up effect once `editingDoctor` is set — wait for
    // that settle instead of asserting on the very first paint.
    await waitFor(() => expect(screen.getByLabelText('Follow platform-wide hours')).not.toBeChecked())
    fireEvent.click(screen.getByLabelText('Follow platform-wide hours'))
    fireEvent.click(screen.getByRole('button', { name: /Save booking settings/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/doctors/doc-1', expect.objectContaining({
      onlineBookingWindowStart: null,
      onlineBookingWindowEnd: null,
    })))
  })

  // COMPLETENESS FIX (doctor panel profile-section audit): verificationDocuments was written by
  // a doctor's self-service upload (StaffPages.jsx#DoctorProfileEdit) but never displayed
  // anywhere an admin could review it before deciding to verify the account. This is the
  // review surface — the "View details" modal, admin/superadmin-only per App.jsx's routing.
  it('shows a pending doctor\'s uploaded verification documents in the "View details" modal', async () => {
    mockGetRoutes({ '/doctors': DOCTORS })
    apiClient.get.mockImplementation((url) => {
      if (url === '/doctors') return Promise.resolve(DOCTORS)
      if (url === '/doctors/doc-2') return Promise.resolve({
        ...DOCTORS[1],
        verificationDocuments: [{ name: 'MBBS certificate', url: 'https://cdn.example.com/doc-2/mbbs.pdf', uploadedAt: '2026-01-05T10:00:00.000Z' }],
      })
      return Promise.resolve([])
    })
    renderConnected(DoctorVerification, {})

    await screen.findByText('Pending verification')
    const pendingSection = screen.getByText('Pending verification').closest('div').parentElement
    const row = within(pendingSection).getByText('Dr. New').closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'View details' }))

    expect(await screen.findByText('MBBS certificate')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', 'https://cdn.example.com/doc-2/mbbs.pdf')
  })

  it('shows a plain empty message when a doctor has not uploaded any verification documents', async () => {
    mockGetRoutes({ '/doctors': DOCTORS })
    apiClient.get.mockImplementation((url) => {
      if (url === '/doctors') return Promise.resolve(DOCTORS)
      if (url === '/doctors/doc-1') return Promise.resolve({ ...DOCTORS[0], verificationDocuments: [] })
      return Promise.resolve([])
    })
    renderConnected(DoctorVerification, {})

    const row = (await screen.findByText('Dr. Kapoor')).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'View details' }))

    expect(await screen.findByText('No documents uploaded by this doctor yet.')).toBeInTheDocument()
  })

  // COMPLETENESS ADD (request: "doctor bank details v only admin and super admin dekh sakta hai
  // add kro") — bankDetails is the same admin/superadmin-only field (doctors.service.js#shapeDoctor's
  // includeContact gate) as verificationDocuments above; this is the one place it's ever shown.
  it('shows a doctor\'s bank details in the "View details" modal', async () => {
    mockGetRoutes({ '/doctors': DOCTORS })
    apiClient.get.mockImplementation((url) => {
      if (url === '/doctors') return Promise.resolve(DOCTORS)
      if (url === '/doctors/doc-1') return Promise.resolve({
        ...DOCTORS[0],
        bankDetails: { accountHolderName: 'Dr. Kapoor', bankName: 'HDFC Bank', accountNumber: '123456789012', ifscCode: 'HDFC0001234', upiId: 'kapoor@okhdfcbank' },
      })
      return Promise.resolve([])
    })
    renderConnected(DoctorVerification, {})

    const row = (await screen.findByText('Dr. Kapoor')).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'View details' }))

    expect(await screen.findByText('HDFC Bank')).toBeInTheDocument()
    expect(screen.getByText('123456789012')).toBeInTheDocument()
    // COMPLETENESS ADD (request: "upiid dalne ka v option de do")
    expect(screen.getByText('kapoor@okhdfcbank')).toBeInTheDocument()
    expect(screen.getByText('HDFC0001234')).toBeInTheDocument()
  })

  it('shows a plain empty message when a doctor has not added bank details yet', async () => {
    mockGetRoutes({ '/doctors': DOCTORS })
    apiClient.get.mockImplementation((url) => {
      if (url === '/doctors') return Promise.resolve(DOCTORS)
      if (url === '/doctors/doc-1') return Promise.resolve({ ...DOCTORS[0], bankDetails: null })
      return Promise.resolve([])
    })
    renderConnected(DoctorVerification, {})

    const row = (await screen.findByText('Dr. Kapoor')).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'View details' }))

    expect(await screen.findByText('This doctor has not added bank details yet.')).toBeInTheDocument()
  })
})

describe('ClinicVerification', () => {
  const PENDING_CLINIC = { id: 'clinic-1', name: 'Heart Care Clinic', approvalStatus: 'pending', city: { name: 'Mumbai' } }

  it('approves a pending clinic', async () => {
    mockGetRoutes({ '/clinics': [PENDING_CLINIC] })
    apiClient.patch.mockResolvedValue({ ...PENDING_CLINIC, approvalStatus: 'active' })
    renderConnected(ClinicVerification, {})

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: /Approve & activate/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/clinics/clinic-1/approve'))
  })

  it('requires a rejection reason of at least 5 characters before rejecting', async () => {
    mockGetRoutes({ '/clinics': [PENDING_CLINIC] })
    renderConnected(ClinicVerification, {})

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(await screen.findByText(/at least 5 characters/i)).toBeInTheDocument()
    expect(apiClient.patch).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Rejection reason/i), { target: { value: 'Missing documents' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/clinics/clinic-1/reject', { rejectionReason: 'Missing documents' }))
  })
})

describe('ManageClinics', () => {
  it('toggles a clinic\'s status and emergency availability', async () => {
    const CLINIC = { id: 'clinic-1', name: 'Heart Care Clinic', approvalStatus: 'active', emergencyAvailable: false }
    mockGetRoutes({ '/clinics': [CLINIC] })
    // There is no dedicated status-toggle endpoint (see useAppStore.js#toggleClinicStatus) —
    // "Disable" on an active clinic goes through the same reject flow clinic verification uses.
    apiClient.patch.mockImplementation((url, body) => Promise.resolve({ ...CLINIC, ...body, approvalStatus: url.endsWith('/reject') ? 'disabled' : CLINIC.approvalStatus }))
    renderConnected(ManageClinics, {})

    await screen.findByText('Heart Care Clinic')
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/clinics/clinic-1/reject', { rejectionReason: 'Disabled by admin.' }))
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/clinics/clinic-1', { emergencyAvailable: true }))
  })

  it('renders the clinic\'s ID from its stored clinicNumber ("DCC<N>")', async () => {
    mockGetRoutes({ '/clinics': [{ id: 'clinic-1', name: 'Heart Care Clinic', approvalStatus: 'active', emergencyAvailable: false, clinicNumber: 9 }] })
    renderConnected(ManageClinics, {})

    const row = (await screen.findByText('Heart Care Clinic')).closest('tr')
    expect(row).toHaveTextContent('DCC9')
  })
})

describe('CitiesAreas', () => {
  it('adds a city and then deletes it after confirmation', async () => {
    mockGetRoutes({})
    apiClient.post.mockResolvedValue({ id: 'city-1', name: 'Pune', state: 'Maharashtra' })
    apiClient.delete.mockResolvedValue({})
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderConnected(CitiesAreas, {})

    fireEvent.click(screen.getByRole('button', { name: 'Add city' }))
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: 'Pune' } })
    fireEvent.change(screen.getByLabelText(/^State/), { target: { value: 'Maharashtra' } })
    fireEvent.click(screen.getByRole('button', { name: /Save city/i }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/geography/cities', { name: 'Pune', state: 'Maharashtra' }))
    expect(await screen.findByText('Pune')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/geography/cities/city-1'))
    confirmSpy.mockRestore()
  })
})

describe('ManagePatients', () => {
  it('shows every registered patient (not just ones with a booking) and toggles login status', async () => {
    mockGetRoutes({
      '/admin/patients': [{ id: 'p1', name: 'Asha Mehta', email: 'asha@example.com', status: 'active' }],
      '/appointments': [],
      '/payments': [],
    })
    apiClient.patch.mockResolvedValue({})
    renderConnected(ManagePatients, {})

    expect(await screen.findByText('Asha Mehta')).toBeInTheDocument()
    expect(screen.getByText('1 registered patient')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disable login' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/admin/patients/p1/status', { status: 'disabled' }))
  })

  it('renders the patient\'s ID from their stored patientNumber ("DCP<N>")', async () => {
    mockGetRoutes({
      '/admin/patients': [{ id: 'p1', name: 'Asha Mehta', email: 'asha@example.com', status: 'active', patientNumber: 1 }],
      '/appointments': [],
      '/payments': [],
    })
    renderConnected(ManagePatients, {})

    const row = (await screen.findByText('Asha Mehta')).closest('tr')
    expect(row).toHaveTextContent('DCP1')
  })

  // Legacy-row fallback: prisma/migrations/20260919130000_add_patient_doctor_clinic_numbers
  // backfills every existing row, but stableId() must still degrade gracefully (never crash the
  // table render) if a patientNumber is ever missing.
  it('falls back to "DCP—" for a patient with no stored patientNumber yet', async () => {
    mockGetRoutes({
      '/admin/patients': [{ id: 'p1', name: 'Asha Mehta', email: 'asha@example.com', status: 'active', patientNumber: null }],
      '/appointments': [],
      '/payments': [],
    })
    renderConnected(ManagePatients, {})

    const row = (await screen.findByText('Asha Mehta')).closest('tr')
    expect(row).toHaveTextContent('DCP—')
  })
})

describe('ManageReceptionists', () => {
  it('creates a receptionist account tied to a clinic', async () => {
    mockGetRoutes({ '/receptionists': [] })
    apiClient.post.mockResolvedValue({ id: 'rec-1', name: 'Meera Iyer', status: 'active' })
    renderConnected(ManageReceptionists, { data: { clinics: [{ id: 'clinic-1', name: 'Heart Care Clinic' }] } })

    fireEvent.click(screen.getByRole('button', { name: 'Create receptionist' }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Meera Iyer' } })
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'meera@example.com' } })
    fireEvent.change(screen.getByLabelText(/^Temporary password/), { target: { value: 'temp12345' } })
    fireEvent.change(screen.getByLabelText(/^Assigned clinic/), { target: { value: 'clinic-1' } })
    fireEvent.click(screen.getByRole('button', { name: /Save receptionist/i }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/receptionists', expect.objectContaining({
      name: 'Meera Iyer',
      email: 'meera@example.com',
      clinicId: 'clinic-1',
    })))
  })

  it('requires name, email, password, and clinic before submitting', () => {
    renderConnected(ManageReceptionists, { data: { clinics: [] } })
    fireEvent.click(screen.getByRole('button', { name: 'Create receptionist' }))
    // Every field involved is also HTML5 `required`, which blocks a real click-triggered submit
    // outright — dispatch the submit event directly to reach this component's own JS validation.
    fireEvent.submit(document.querySelector('form'))
    expect(screen.getByText('Name, email, password, and clinic are required.')).toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})

describe('RevenueReports', () => {
  const today = new Date()
  const isoToday = today.toISOString().slice(0, 10)

  it('totals revenue/commission/payout for the selected range across all doctors', async () => {
    mockGetRoutes({
      '/payments': [
        { id: 'pay-1', createdAt: isoToday, doctor: { id: 'doc-1', name: 'Dr. Kapoor' }, mode: 'Cash', status: 'paid', fees: { amount: 1000, commission: 100, clinicPayout: 900 } },
        { id: 'pay-2', createdAt: isoToday, doctor: { id: 'doc-2', name: 'Dr. Rao' }, mode: 'Upi', status: 'paid', fees: { amount: 500, commission: 50, clinicPayout: 450 } },
      ],
    })
    renderConnected(RevenueReports, {})

    expect(await screen.findByText('₹1,500')).toBeInTheDocument()
    expect(screen.getByText('₹150')).toBeInTheDocument()
    expect(screen.getByText('₹1,350')).toBeInTheDocument()
  })

  it('scopes a doctor-only report to just that doctor\'s own consultation fees, hiding commission', async () => {
    setCurrentUser({ id: 'doc-1', name: 'Dr. Kapoor' })
    useAppStore.setState((state) => ({ data: { ...state.data, doctors: [{ id: 'doc-1', name: 'Dr. Kapoor' }] } }))
    mockGetRoutes({
      '/payments': [
        { id: 'pay-1', createdAt: isoToday, doctor: { id: 'doc-1', name: 'Dr. Kapoor' }, mode: 'Cash', status: 'paid', fees: { consultationFee: 500 } },
        { id: 'pay-2', createdAt: isoToday, doctor: { id: 'doc-2', name: 'Dr. Rao' }, mode: 'Cash', status: 'paid', fees: { consultationFee: 700 } },
      ],
    })
    renderConnected(RevenueReports, { doctorOnly: true })

    const revenueCard = (await screen.findByText('Selected range revenue')).closest('article')
    expect(within(revenueCard).getByText('₹500')).toBeInTheDocument()
    const commissionCard = screen.getByText('Platform commission').closest('article')
    expect(within(commissionCard).getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('Dr. Rao')).not.toBeInTheDocument()
  })

  // COMPLETENESS ADD (request: "receptionist and doctor ke pass show ho online payment kitna hua
  // cash ye proper way me", then "eshme ye show hona chahiye ki online booking ke time pe kitna
  // payment hua hai and second clinic pe aake cash ya online ye v to confirm hona chahiye") — the
  // "Payment modes" panel used to show only a bare count per mode ("Cash: 1"), then a cash-vs-
  // online rollup that didn't separate a patient's own booking-time Razorpay payment from one
  // collected in person at the clinic (both share mode:'online').
  it('breaks the "Payment modes" panel down into paid-at-booking vs cash/online-at-clinic totals, with an amount per mode', async () => {
    mockGetRoutes({
      '/payments': [
        { id: 'pay-1', createdAt: isoToday, doctor: { id: 'doc-1', name: 'Dr. Kapoor' }, mode: 'Cash', status: 'paid', fees: { amount: 1000, commission: 100, clinicPayout: 900 } },
        { id: 'pay-2', createdAt: isoToday, doctor: { id: 'doc-2', name: 'Dr. Rao' }, mode: 'Upi', status: 'paid', fees: { amount: 500, commission: 50, clinicPayout: 450 } },
        // Paid by the patient online at booking time (Razorpay) — must land in its own tile, not
        // "Online (clinic)".
        { id: 'pay-3', createdAt: isoToday, doctor: { id: 'doc-1', name: 'Dr. Kapoor' }, mode: 'online', transactionRef: 'pay_booking1', status: 'paid', fees: { amount: 700, commission: 70, clinicPayout: 630 } },
      ],
    })
    renderConnected(RevenueReports, {})

    const modesPanel = (await screen.findByText('Payment modes')).closest('section')
    expect(within(modesPanel).getByText('Paid at booking')).toBeInTheDocument()
    expect(within(modesPanel).getByText('₹700')).toBeInTheDocument() // paid-at-booking tile
    expect(within(modesPanel).getByText('₹1,000')).toBeInTheDocument() // cash-at-clinic tile
    expect(within(modesPanel).getByText('₹500')).toBeInTheDocument() // online-at-clinic tile (Upi only — the booking payment is excluded)
    expect(within(modesPanel).getByText('Upi')).toBeInTheDocument() // per-mode breakdown row
    expect(within(modesPanel).getByText('₹500 · 1')).toBeInTheDocument() // Upi mode row: amount · count
  })

  // COMPLETENESS ADD (request: "eshme v add kro ye sab ye sab patient setion me v add kro ...
  // admin section me v") — the "Payments in selected period" table's Mode column now carries the
  // same "At booking" / "At clinic" tag as the receptionist/doctor and patient Payments tables.
  it('tags each row in "Payments in selected period" as paid at booking or collected at the clinic', async () => {
    mockGetRoutes({
      '/payments': [
        { id: 'pay-1', createdAt: isoToday, doctor: { id: 'doc-1', name: 'Dr. Kapoor' }, mode: 'Cash', status: 'paid', fees: { amount: 1000, commission: 100, clinicPayout: 900 } },
        { id: 'pay-2', createdAt: isoToday, doctor: { id: 'doc-1', name: 'Dr. Kapoor' }, mode: 'online', transactionRef: 'pay_booking1', status: 'paid', fees: { amount: 700, commission: 70, clinicPayout: 630 } },
      ],
    })
    renderConnected(RevenueReports, {})

    const paymentsSection = (await screen.findByText('Payments in selected period')).closest('div')
    expect(within(paymentsSection).getByText('At booking')).toBeInTheDocument()
    expect(within(paymentsSection).getByText('At clinic')).toBeInTheDocument()
  })

  // BOOKING-ID VISIBILITY FIX (user request: "payment me v booking id do", follow-up to "bookinh
  // id ko slip pe dikhai and my bookong me v dikhao") — this table (shared by admin's "Revenue
  // reports" and, via doctorOnly, the doctor's own "My revenue reports") never showed which
  // appointment/booking each payment belonged to. Every payment row already carries
  // `appointment: {id}` straight from the API, unmasked for every role.
  it('shows a "Booking ID" column with the real booking id in "Payments in selected period"', async () => {
    mockGetRoutes({
      '/payments': [
        { id: 'pay-1', createdAt: isoToday, doctor: { id: 'doc-1', name: 'Dr. Kapoor' }, mode: 'Cash', status: 'paid', appointment: { id: 'a1' }, fees: { amount: 1000, commission: 100, clinicPayout: 900 } },
      ],
    })
    renderConnected(RevenueReports, {})

    expect(await screen.findByRole('columnheader', { name: 'Booking ID' })).toBeInTheDocument()
    expect(screen.getByText(shortId('a1'))).toBeInTheDocument()
  })
})

describe('Complaints', () => {
  it('saves an admin response with the real adminResponse field name', async () => {
    mockGetRoutes({ '/complaints': [{ id: 'c1', subject: 'Refund delay', status: 'open' }] })
    apiClient.patch.mockResolvedValue({})
    renderConnected(Complaints, {})

    await screen.findByText('Refund delay')
    fireEvent.change(screen.getByLabelText(/^Complaint ID/), { target: { value: 'c1' } })
    fireEvent.change(screen.getByLabelText(/^Admin response/), { target: { value: 'Refund processed.' } })
    fireEvent.click(screen.getByRole('button', { name: /Save response/i }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/complaints/c1', { status: 'open', adminResponse: 'Refund processed.' }))
  })
})

describe('Broadcast', () => {
  it('sends a broadcast to all users', async () => {
    mockGetRoutes({ '/notifications/broadcast': [] })
    apiClient.post.mockResolvedValue({ id: 'b1', title: 'Maintenance', body: 'Down at 2am', audience: 'all' })
    renderConnected(Broadcast, {})

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Maintenance' } })
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: 'Down at 2am' } })
    fireEvent.click(screen.getByRole('button', { name: /Send broadcast/i }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/notifications/broadcast', { audience: 'all', title: 'Maintenance', body: 'Down at 2am' }))
    expect(await screen.findByText('Broadcast sent.')).toBeInTheDocument()
  })

  it('requires a target user id for a single-user broadcast', async () => {
    mockGetRoutes({ '/notifications/broadcast': [] })
    renderConnected(Broadcast, {})

    fireEvent.change(screen.getByLabelText(/^Audience/), { target: { value: 'Single user (by id)' } })
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Heads up' } })
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: 'Just you' } })
    // The target-id field is also HTML5 `required` once shown, which blocks a real click-triggered
    // submit outright — dispatch the submit event directly to reach this component's own JS check.
    fireEvent.submit(document.querySelector('form'))

    expect(await screen.findByText(/Target user id is required/)).toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})

describe('AuditLog', () => {
  it('renders activity rows from the live store', async () => {
    mockGetRoutes({
      '/admin/activity-log': [{ id: 'log-1', description: 'Approved clinic', actor: { name: 'Priya Admin', email: 'priya@example.com' }, actorRole: 'admin' }],
    })
    renderConnected(AuditLog, {})
    expect(await screen.findByText('Approved clinic')).toBeInTheDocument()
    expect(screen.getByText('Priya Admin')).toBeInTheDocument()
  })
})

describe('PlatformSettings', () => {
  it('saves platform identity/maintenance settings with the real maintenanceMode field name', async () => {
    mockGetRoutes({
      '/admin/system-settings': { platformName: 'BookMyDoctor24', maintenanceMode: false },
      '/admin/booking-rules': { cancellationWindowHours: 2, maxBookingsPerPatient: 5, defaultSlotMinutes: 15 },
    })
    apiClient.put.mockResolvedValue({})
    renderConnected(PlatformSettings, {})

    await screen.findByLabelText(/^Platform name/)
    fireEvent.click(screen.getByLabelText('Maintenance mode'))
    fireEvent.click(screen.getByRole('button', { name: /^Save settings$/ }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/system-settings', {
      platformName: 'BookMyDoctor24',
      supportEmail: undefined,
      supportPhone: undefined,
      maintenanceMode: true,
    }))
  })

  it('clears the online-booking window entirely when "always open" is checked', async () => {
    mockGetRoutes({
      '/admin/system-settings': { platformName: 'BookMyDoctor24' },
      '/admin/booking-rules': { cancellationWindowHours: 2, maxBookingsPerPatient: 5, defaultSlotMinutes: 15, onlineBookingWindowStart: '09:00', onlineBookingWindowEnd: '21:00' },
    })
    apiClient.put.mockResolvedValue({})
    renderConnected(PlatformSettings, {})

    // A fetched window means "always open" starts unchecked.
    const alwaysOpen = await screen.findByLabelText(/Accept online bookings around the clock/i)
    expect(alwaysOpen).not.toBeChecked()
    fireEvent.click(alwaysOpen)
    fireEvent.click(screen.getByRole('button', { name: /Save booking rules/i }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/booking-rules', expect.objectContaining({
      onlineBookingWindowStart: null,
      onlineBookingWindowEnd: null,
    })))
  })
})

describe('AdminPages role gating (RoleGuard, via App)', () => {
  const ADMIN_USER = { id: 'admin-1', name: 'Priya Admin', email: 'priya@example.com', role: 'admin' }
  const PATIENT_USER = { id: 'pat-1', name: 'Asha Mehta', email: 'asha@example.com', role: 'patient' }

  function mockBootFor(user) {
    getTokens.mockReturnValue({ accessToken: 'tok' })
    apiClient.post.mockResolvedValue({})
    apiClient.get.mockImplementation((url) => {
      if (url === '/me') return Promise.resolve(user)
      return Promise.resolve([])
    })
  }

  it('lets an admin reach /admin/dashboard', async () => {
    mockBootFor(ADMIN_USER)
    render(<MemoryRouter initialEntries={['/admin/dashboard']}><App /></MemoryRouter>)
    expect(await screen.findByText('Welcome, Priya.')).toBeInTheDocument()
  })

  it('redirects a patient away from the admin-only /admin/doctors route to their own dashboard', async () => {
    mockBootFor(PATIENT_USER)
    render(<MemoryRouter initialEntries={['/admin/doctors']}><App /></MemoryRouter>)
    expect(await screen.findByText(/Welcome, Asha\./i)).toBeInTheDocument()
    expect(screen.queryByText('Doctor management')).not.toBeInTheDocument()
  })
})
