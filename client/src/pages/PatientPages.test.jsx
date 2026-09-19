// Tests for the patient-portal pages (src/pages/PatientPages.jsx).
//
// Same convention as AdminPages.test.jsx/StaffPages.test.jsx/login-flow.test.jsx: render the real
// page components against the real Zustand store, mocking only src/lib/apiClient.js at the
// network boundary. `renderConnected` mirrors how App.jsx feeds every one of these components
// their `data` prop (`const data = useAppStore((state) => state.data)`), so an action's
// PATCH/POST/PUT/DELETE that updates the store is actually visible on screen, exactly as in the
// real app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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
import { formatDate } from '../lib/format'
import { visiblePaymentAmount } from '../lib/paymentVisibility'
import {
  Booking,
  BookingHistory,
  Family,
  Notifications,
  PatientAppointments,
  PatientDashboard,
  PatientSettings,
  Payments,
} from './PatientPages'

const initialStoreState = useAppStore.getState()

const PATIENT_USER = {
  id: 'user-1',
  name: 'Asha Mehta',
  email: 'asha@example.com',
  phone: '9876500000',
  city: 'Mumbai',
  role: 'patient',
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(initialStoreState, true)
  vi.clearAllMocks()
  getTokens.mockReturnValue(null)
  apiClient.get.mockResolvedValue([])
  apiClient.post.mockResolvedValue({})
  apiClient.patch.mockResolvedValue({})
  apiClient.put.mockResolvedValue({})
  apiClient.delete.mockResolvedValue({})
  useAppStore.setState({ currentUser: PATIENT_USER, isAuthenticated: true, sessionVerified: true })
})

afterEach(() => {
  localStorage.clear()
})

function renderConnected(Component, extraProps = {}, { route = '/patient' } = {}) {
  function Connected() {
    const data = useAppStore((state) => state.data)
    return <Component data={data} {...extraProps} />
  }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Connected />
    </MemoryRouter>
  )
}

function seedData(overrides) {
  useAppStore.setState((state) => ({ data: { ...state.data, ...overrides } }))
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

// =====================================================================
// PatientDashboard
// =====================================================================
describe('PatientDashboard', () => {
  const UPCOMING = {
    id: 'appt-1',
    status: 'upcoming',
    doctor: { name: 'Dr. Asha Rao' },
    clinic: { name: 'Heart Care Clinic' },
    appointmentDate: '2026-09-20',
    appointmentTime: '10:00 AM',
    tokenNumber: 12,
    paymentStatus: 'pending',
  }
  const NOTIFICATION = {
    id: 'notif-1',
    title: 'Booking confirmed',
    body: 'Your appointment is confirmed.',
    createdAt: '2026-09-10T00:00:00.000Z',
    readAt: null,
  }

  it('renders live records and the resolved live-queue status for the upcoming appointment', async () => {
    seedData({ appointments: [UPCOMING], notifications: [NOTIFICATION] })
    mockGetRoutes({
      '/queue/mine/appt-1': { patientsAhead: 3, token: 12, nowServing: 9, estimatedWaitMinutes: 15, status: 'waiting' },
    })

    renderConnected(PatientDashboard)

    expect(screen.getByText('Welcome, Asha.')).toBeInTheDocument()
    expect(screen.getAllByText('Dr. Asha Rao').length).toBeGreaterThan(0)
    expect(screen.getByText('#12')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/queue/mine/appt-1')
    // Patient-scoped live queue status resolved and rendered (the fixed bug this effect exists
    // for — see the header comment above PatientDashboard's useEffect).
    expect(await screen.findByText('3 patients')).toBeInTheDocument()
    // LiveQueueWidget mirrors `initialQueue` into its own state via a follow-up effect — allow
    // one more tick for that second, widget-local render to settle.
    expect(await screen.findByLabelText('Live queue status')).toBeInTheDocument()
    expect(screen.getByText('Booking confirmed')).toBeInTheDocument()
  })

  it('degrades gracefully when the live-queue fetch fails, without breaking the rest of the dashboard', async () => {
    seedData({ appointments: [UPCOMING], notifications: [] })
    apiClient.get.mockImplementation((url) =>
      url === '/queue/mine/appt-1' ? Promise.reject(new Error('Queue service unavailable.')) : Promise.resolve([])
    )

    renderConnected(PatientDashboard)

    expect(await screen.findByText('Live queue is temporarily unavailable')).toBeInTheDocument()
    // The rest of the dashboard (doctor name, token number) is untouched by the queue error.
    expect(screen.getAllByText('Dr. Asha Rao').length).toBeGreaterThan(0)
    expect(screen.getByText('#12')).toBeInTheDocument()
    expect(screen.getByText('— patients')).toBeInTheDocument()
  })

  it('shows the empty state and never calls the queue endpoint when there is no upcoming appointment', () => {
    seedData({ appointments: [], notifications: [] })

    renderConnected(PatientDashboard)

    expect(screen.getByText('No upcoming appointments scheduled')).toBeInTheDocument()
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/queue/mine'))
  })
})

// =====================================================================
// Booking
// =====================================================================
describe('Booking', () => {
  const DOCTOR = {
    id: 'doc-1',
    name: 'Dr. Asha Rao',
    consultationFee: 500,
    minBookingAdvanceAmount: 100,
    clinics: [{ id: 'clinic-1', name: 'Heart Care Clinic' }],
  }
  const FAMILY_MEMBER = { id: 'fam-1', name: 'Rohan Mehta', relation: 'Son' }
  const PLATFORM_CHARGES = { applyConvenienceFee: true, patientConvenienceFee: 20, applyEmergencyFee: true, emergencyFee: 50, gstPercent: 5 }

  it("shows the doctor's primary clinic and fee preview once a doctor is chosen", () => {
    seedData({ doctors: [DOCTOR], familyMembers: [], platformCharges: PLATFORM_CHARGES })
    const { container } = renderConnected(Booking, {}, { route: '/patient/book' })

    expect(screen.getByText('Select a doctor first')).toBeInTheDocument()

    // Selected by its `name` attribute, not label text — the new doctor-finder Filters panel
    // above the form (added so a patient can narrow the Doctor dropdown by city/specialization/
    // etc., mirroring the public search page) has its own unnamed "Doctor or symptom" field,
    // whose accessible label text also starts with "Doctor" and would collide with any
    // getByLabelText('Doctor'-ish) query here.
    fireEvent.change(container.querySelector('select[name="doctorLabel"]'), { target: { value: 'Dr. Asha Rao' } })

    expect(screen.getByText('Heart Care Clinic')).toBeInTheDocument()
    expect(screen.getByText('₹500')).toBeInTheDocument() // consultation
    expect(screen.getByText('₹20')).toBeInTheDocument() // platform charge
    expect(screen.getByText('5%')).toBeInTheDocument() // Transaction charge

    // MUTUAL-EXCLUSIVITY FIX (superadmin request): platform charge and emergency fee never stack
    // — checking "Emergency booking" drops the platform-charge preview to ₹0. Selected by `name`
    // rather than label text, same reason as the Doctor field above (the "+₹50" surcharge text
    // sits inside the same <label>, so its accessible name isn't the exact string "Emergency
    // booking").
    fireEvent.click(container.querySelector('input[name="isEmergency"]'))
    expect(screen.queryByText('₹20')).not.toBeInTheDocument()
    expect(screen.getByText('₹0')).toBeInTheDocument()
  })

  it('confirms a booking with the selected doctor, clinic, date, and family member', async () => {
    vi.useFakeTimers()
    try {
      seedData({ doctors: [DOCTOR], familyMembers: [FAMILY_MEMBER], platformCharges: PLATFORM_CHARGES })
      apiClient.post.mockImplementation((url) =>
        url === '/appointments' ? Promise.resolve({ jobId: 'job-1', status: 'queued' }) : Promise.resolve({})
      )
      apiClient.get.mockImplementation((url) =>
        url === '/appointments/booking-status/job-1'
          ? Promise.resolve({
              status: 'confirmed',
              appointment: {
                id: 'appt-9',
                status: 'upcoming',
                doctor: { name: 'Dr. Asha Rao' },
                appointmentDate: '2026-09-25',
                tokenNumber: 7,
                fees: { totalAmount: 0 },
                paymentStatus: 'not_required',
              },
            })
          : Promise.resolve([])
      )

      renderConnected(Booking, {}, { route: '/patient/book?doctorId=doc-1' })

      fireEvent.change(screen.getByLabelText(/^Patient/), { target: { value: 'Rohan Mehta · Son' } })
      fireEvent.change(screen.getByLabelText(/^Appointment date/), { target: { value: '2026-09-25' } })
      fireEvent.change(screen.getByLabelText('Reason for visit'), { target: { value: 'Follow up' } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))

      expect(screen.getByText(/Confirming your booking/i)).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1700)
      })
      // Switch back to real timers before any further `findBy*`/`waitFor` — those poll using
      // `setTimeout` internally, which would otherwise be the still-faked one and never fire.
      vi.useRealTimers()

      expect(apiClient.post).toHaveBeenCalledWith('/appointments', {
        doctorUserId: 'doc-1',
        clinicId: 'clinic-1',
        appointmentDate: '2026-09-25',
        reason: 'Follow up',
        isEmergency: false,
        familyMemberId: 'fam-1',
      })
      expect(screen.getByText('Booking confirmed')).toBeInTheDocument()
      expect(screen.getByText('Token #7')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the server-provided error message when booking fails, without losing the form', async () => {
    vi.useFakeTimers()
    try {
      seedData({ doctors: [DOCTOR], familyMembers: [], platformCharges: PLATFORM_CHARGES })
      apiClient.post.mockImplementation((url) =>
        url === '/appointments' ? Promise.resolve({ jobId: 'job-2', status: 'queued' }) : Promise.resolve({})
      )
      apiClient.get.mockImplementation((url) =>
        url === '/appointments/booking-status/job-2'
          ? Promise.resolve({ status: 'failed', error: { message: 'Slot taken' } })
          : Promise.resolve([])
      )

      renderConnected(Booking, {}, { route: '/patient/book?doctorId=doc-1' })
      fireEvent.change(screen.getByLabelText(/^Patient/), { target: { value: 'Myself' } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1700)
      })
      vi.useRealTimers()

      expect(screen.getByText('Slot taken')).toBeInTheDocument()
      // Still on the booking form, not a "booked" screen.
      expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pays online for a pending_payment booking and shows the confirmed, paid booking once Razorpay verifies', async () => {
    vi.useFakeTimers()
    let capturedOptions = null
    // A real `function` (not an arrow function) — Booking calls `new window.Razorpay(...)`, and an
    // arrow-function mock implementation can't be used as a constructor.
    window.Razorpay = vi.fn(function RazorpayMock(options) {
      capturedOptions = options
      return { open: vi.fn(), on: vi.fn() }
    })
    try {
      seedData({ doctors: [DOCTOR], familyMembers: [], platformCharges: PLATFORM_CHARGES })
      apiClient.post.mockImplementation((url, payload) => {
        if (url === '/appointments') return Promise.resolve({ jobId: 'job-3', status: 'queued' })
        if (url === '/payments/razorpay/order') return Promise.resolve({ keyId: 'key_1', amount: 60000, currency: 'INR', orderId: 'order_1' })
        if (url === '/payments/razorpay/verify') {
          return Promise.resolve({
            payment: { id: 'pay-1', amount: 600 },
            appointment: { id: 'appt-9', status: 'upcoming', doctor: { name: 'Dr. Asha Rao' }, appointmentDate: '2026-09-25', tokenNumber: 9, fees: { totalAmount: 600 }, paymentStatus: 'paid' },
          })
        }
        return Promise.resolve({})
      })
      apiClient.get.mockImplementation((url) =>
        url === '/appointments/booking-status/job-3'
          ? Promise.resolve({
              status: 'confirmed',
              appointment: { id: 'appt-9', status: 'pending_payment', doctor: { name: 'Dr. Asha Rao' }, appointmentDate: '2026-09-25', fees: { totalAmount: 600 } },
            })
          : Promise.resolve([])
      )

      renderConnected(Booking, {}, { route: '/patient/book?doctorId=doc-1' })
      fireEvent.change(screen.getByLabelText(/^Patient/), { target: { value: 'Myself' } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1700)
      })
      vi.useRealTimers()

      expect(screen.getByText('Payment required to confirm')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Pay ₹600 now' }))

      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith('/payments/razorpay/order', { appointmentId: 'appt-9', paymentOption: 'full' })
      )
      expect(window.Razorpay).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'key_1', amount: 60000, currency: 'INR', order_id: 'order_1' })
      )

      await act(async () => {
        await capturedOptions.handler({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig_1' })
      })

      expect(apiClient.post).toHaveBeenCalledWith('/payments/razorpay/verify', {
        appointmentId: 'appt-9',
        razorpayOrderId: 'order_1',
        razorpayPaymentId: 'pay_1',
        razorpaySignature: 'sig_1',
      })
      expect(screen.getByText('Booking confirmed')).toBeInTheDocument()
      expect(screen.getByText('Token #9')).toBeInTheDocument()
      expect(screen.getByText('✓ Paid online')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
      delete window.Razorpay
    }
  })

  // MIN-BOOKING-AMOUNT FIX (superadmin request) regression test: the "Minimum booking amount"
  // card must read from the appointment's own server-computed `fees.minBookingAmount` — which
  // already bakes in the platform's cut — not the doctor's raw `minBookingAdvanceAmount` (that
  // old behaviour left the platform's cut out of this payment option entirely).
  it('shows the server-computed minBookingAmount (not the doctor\'s raw minBookingAdvanceAmount) as the minimum booking option, and pays that exact amount', async () => {
    vi.useFakeTimers()
    let capturedOptions = null
    window.Razorpay = vi.fn(function RazorpayMock(options) {
      capturedOptions = options
      return { open: vi.fn(), on: vi.fn() }
    })
    try {
      seedData({ doctors: [DOCTOR], familyMembers: [], platformCharges: PLATFORM_CHARGES })
      apiClient.post.mockImplementation((url) => {
        if (url === '/appointments') return Promise.resolve({ jobId: 'job-4', status: 'queued' })
        // Server order amount reflects fees.minBookingAmount (¥33.60 below), NOT the doctor's raw
        // minBookingAdvanceAmount of ₹100 from the DOCTOR fixture.
        if (url === '/payments/razorpay/order') return Promise.resolve({ keyId: 'key_1', amount: 3360, currency: 'INR', orderId: 'order_2' })
        return Promise.resolve({})
      })
      apiClient.get.mockImplementation((url) =>
        url === '/appointments/booking-status/job-4'
          ? Promise.resolve({
              status: 'confirmed',
              appointment: {
                id: 'appt-10',
                status: 'pending_payment',
                doctor: { name: 'Dr. Asha Rao' },
                appointmentDate: '2026-09-25',
                // Server-computed: platform charge (₹20 convenience + ₹0.60 GST-ish) + doctor's
                // minBookingAdvanceAmount x admin commission% — deliberately NOT ₹100 (the raw
                // doctor-set value), to prove the UI reads the computed field, not the raw one.
                fees: { totalAmount: 546, minBookingAmount: 33.6 },
              },
            })
          : Promise.resolve([])
      )

      renderConnected(Booking, {}, { route: '/patient/book?doctorId=doc-1' })
      fireEvent.change(screen.getByLabelText(/^Patient/), { target: { value: 'Myself' } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1700)
      })
      vi.useRealTimers()

      expect(screen.getByText('Payment required to confirm')).toBeInTheDocument()
      expect(screen.getByText('Minimum booking amount')).toBeInTheDocument()
      expect(screen.getByText('₹33.6')).toBeInTheDocument()
      expect(screen.queryByText('₹100')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Pay ₹33.6 now' }))
      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith('/payments/razorpay/order', { appointmentId: 'appt-10', paymentOption: 'minimum' })
      )
      expect(window.Razorpay).toHaveBeenCalledWith(expect.objectContaining({ amount: 3360, order_id: 'order_2' }))
    } finally {
      vi.useRealTimers()
      delete window.Razorpay
    }
  })
})

// =====================================================================
// PatientAppointments / BookingHistory
// =====================================================================
describe('PatientAppointments', () => {
  const APPT_COMPLETED = {
    id: 'a1',
    status: 'completed',
    doctor: { name: 'Dr. Asha Rao' },
    clinic: { name: 'Heart Care Clinic' },
    appointmentDate: '2026-08-01',
    appointmentTime: '09:00',
    tokenNumber: 3,
    fees: { totalAmount: 500 },
    paymentStatus: 'paid',
    paymentMethod: 'online',
  }
  const PAYMENT1 = { id: 'pay-1', appointment: { id: 'a1' }, status: 'paid', mode: 'online', transactionRef: 'txn_1', fees: { amount: 500 } }

  it('renders live appointment rows with computed fee/paid/due from the matching payment', () => {
    seedData({ appointments: [APPT_COMPLETED], payments: [PAYMENT1] })
    renderConnected(PatientAppointments)

    expect(screen.getByText('1 record(s)')).toBeInTheDocument()
    // Fee and Paid are both ₹500 for a fully-paid appointment (two separate cells).
    expect(screen.getAllByText('₹500')).toHaveLength(2)
    expect(screen.getByText('₹0')).toBeInTheDocument() // Due
    expect(screen.getByText(formatDate('2026-08-01'))).toBeInTheDocument()
  })

  // PAID/DUE FIX regression test (multi-agent payment audit — high severity): a Payment row is
  // always status:'paid' the instant it exists (it records one transaction that succeeded, not
  // "is the appointment fully settled" — see payments.service.js's header comment), so a patient
  // who only paid the doctor's minimum advance online used to see "Paid in full, Due ₹0" here the
  // moment that one payment row existed. `appointment.paymentStatus` ('partial') is now checked
  // first, and `paid` sums the actual payment row(s) recorded instead of an all-or-nothing toggle.
  it('shows the real paid/due split for a partially-paid appointment instead of a false "fully paid"', () => {
    const APPT_PARTIAL = {
      ...APPT_COMPLETED,
      id: 'a3',
      status: 'upcoming',
      fees: { totalAmount: 500 },
      paymentStatus: 'partial',
    }
    // This Payment row is itself status:'paid' (a successful ₹100 advance transaction) even
    // though the appointment as a whole is only 'partial' — exactly the mismatch the fix targets.
    const ADVANCE_PAYMENT = { id: 'pay-3', appointment: { id: 'a3' }, status: 'paid', mode: 'online', transactionRef: 'rzp_1', fees: { amount: 100 } }
    seedData({ appointments: [APPT_PARTIAL], payments: [ADVANCE_PAYMENT] })

    renderConnected(PatientAppointments)

    expect(screen.getByText('₹500')).toBeInTheDocument() // Fee
    expect(screen.getByText('₹100')).toBeInTheDocument() // Paid — the real advance, not the full fee
    expect(screen.getByText('₹400')).toBeInTheDocument() // Due — the real remaining balance, not ₹0
    expect(screen.queryByText('₹0')).not.toBeInTheDocument()
  })

  it('refresh re-fetches appointments and payments from the server and re-renders with the new rows', async () => {
    seedData({ appointments: [APPT_COMPLETED], payments: [PAYMENT1] })
    const APPT_NEW = { ...APPT_COMPLETED, id: 'a2', tokenNumber: 4 }
    mockGetRoutes({ '/appointments': [APPT_COMPLETED, APPT_NEW], '/payments': [PAYMENT1] })

    renderConnected(PatientAppointments)
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/appointments', { params: {} }))
    expect(apiClient.get).toHaveBeenCalledWith('/payments', { params: {} })
    expect(await screen.findByText('2 record(s)')).toBeInTheDocument()
  })

  it('shows an inline error and keeps the existing records visible when refresh fails', async () => {
    seedData({ appointments: [APPT_COMPLETED], payments: [PAYMENT1] })
    apiClient.get.mockRejectedValue(new Error('Network unreachable'))

    renderConnected(PatientAppointments)
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))

    expect(await screen.findByText('Network unreachable')).toBeInTheDocument()
    expect(screen.getByText('1 record(s)')).toBeInTheDocument()
  })

  // "View slip" flow (request: "booking slip ke jagah view ka option do view open hone ke bad
  // download ka option ho") — clicking the row action must open an in-page preview rather than
  // save a file immediately, and the download action must live inside that preview.
  it('View slip opens an in-page PDF preview instead of downloading immediately, with a Download action inside it', async () => {
    seedData({ appointments: [APPT_COMPLETED], payments: [PAYMENT1] })
    renderConnected(PatientAppointments)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /View slip/ }))

    const preview = await screen.findByRole('dialog', { name: 'Booking slip preview' })
    const iframe = preview.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe.getAttribute('src')).toMatch(/^blob:/) // the generated PDF, not a network URL

    const downloadLink = screen.getByRole('link', { name: /Download/ })
    expect(downloadLink.getAttribute('href')).toBe(iframe.getAttribute('src')) // same object URL — no second PDF build to download what's already shown
    expect(downloadLink.getAttribute('download')).toMatch(/^booking-slip-.*\.pdf$/)

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('submits a review with the appointment id, numeric rating, and trimmed text', async () => {
    seedData({ appointments: [APPT_COMPLETED], payments: [PAYMENT1] })
    apiClient.post.mockResolvedValue({ id: 'rev-1' })

    renderConnected(PatientAppointments)
    fireEvent.change(screen.getByLabelText(/^Rating/), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText(/^Review/), { target: { value: '  Great doctor  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }))

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/reviews', { appointmentId: 'a1', rating: 5, text: 'Great doctor' })
    )
    expect(await screen.findByText(/Review submitted/i)).toBeInTheDocument()
  })
})

describe('BookingHistory', () => {
  it('renders the same records under the "Booking history" title, without the review form', () => {
    const APPT_COMPLETED = {
      id: 'a1',
      status: 'completed',
      doctor: { name: 'Dr. Asha Rao' },
      clinic: { name: 'Heart Care Clinic' },
      appointmentDate: '2026-08-01',
      tokenNumber: 3,
      fees: { totalAmount: 500 },
      paymentStatus: 'paid',
    }
    seedData({ appointments: [APPT_COMPLETED], payments: [] })
    renderConnected(BookingHistory)

    expect(screen.getAllByText('Booking history').length).toBeGreaterThan(0)
    expect(screen.queryByText('Review a completed consultation')).not.toBeInTheDocument()
  })
})

// =====================================================================
// Family
// =====================================================================
describe('Family', () => {
  const FAMILY_MEMBER = { id: 'fam-1', name: 'Rohan Mehta', relation: 'Son', dateOfBirth: '2010-05-01', gender: 'Male', bloodGroup: 'B+' }

  it('adds a new family member with the entered details', async () => {
    seedData({ familyMembers: [] })
    apiClient.post.mockResolvedValue({ id: 'fam-2', name: 'Meera Mehta', relation: 'Daughter' })

    renderConnected(Family)
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Meera Mehta' } })
    fireEvent.change(screen.getByLabelText(/^Relationship/), { target: { value: 'Daughter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/family-members', {
        name: 'Meera Mehta',
        relation: 'Daughter',
        dateOfBirth: undefined,
        gender: undefined,
        bloodGroup: undefined,
      })
    )
    expect(await screen.findByText('Meera Mehta')).toBeInTheDocument()
  })

  it('edits an existing family member', async () => {
    seedData({ familyMembers: [FAMILY_MEMBER] })
    apiClient.patch.mockResolvedValue({ ...FAMILY_MEMBER, relation: 'Elder son' })

    renderConnected(Family)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('heading', { name: 'Edit family member' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Relationship/), { target: { value: 'Elder son' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update member' }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/family-members/fam-1', expect.objectContaining({ relation: 'Elder son' })))
    expect(await screen.findByText('Elder son')).toBeInTheDocument()
  })

  it('asks for confirmation, disables Remove while in flight, and deletes on confirm', async () => {
    seedData({ familyMembers: [FAMILY_MEMBER] })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolveDelete
    apiClient.delete.mockImplementation(() => new Promise((resolve) => { resolveDelete = resolve }))

    renderConnected(Family)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(confirmSpy).toHaveBeenCalledWith("Delete Rohan Mehta's family profile?")
    // Regression coverage for the fix noted in useDeleteWithConfirm.js's header comment: Family's
    // remove used to have NO busy state at all, so a fast double-click could fire
    // removeFamilyMember twice before the first request resolved.
    expect(screen.getByRole('button', { name: 'Removing…' })).toBeDisabled()

    await act(async () => {
      resolveDelete()
      await Promise.resolve()
    })

    expect(apiClient.delete).toHaveBeenCalledWith('/family-members/fam-1')
    expect(await screen.findByText('No family members added yet.')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('does not delete when the confirmation dialog is cancelled', () => {
    seedData({ familyMembers: [FAMILY_MEMBER] })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderConnected(Family)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(apiClient.delete).not.toHaveBeenCalled()
    expect(screen.getByText('Rohan Mehta')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})

// =====================================================================
// Payments
// =====================================================================
describe('Payments', () => {
  const APPT_FOR_PAYMENT = {
    id: 'a1',
    doctor: { name: 'Dr. Asha Rao' },
    clinic: { name: 'Heart Care Clinic' },
    tokenNumber: 4,
    appointmentTime: '11:00',
    status: 'completed',
    isEmergency: false,
    paymentStatus: 'paid',
  }
  const PAYMENT_ROW = {
    id: 'pay-1',
    receiptNumber: 'RCPT-1',
    createdAt: '2026-08-02',
    mode: 'online',
    status: 'paid',
    transactionRef: 'txn_9',
    appointment: { id: 'a1' },
    fees: { amount: 750 }, // what Payments itself reads (`payment.fees?.amount`)
    amount: 750, // top-level field `visiblePaymentAmount()` reads for a non-staff role — kept in
    // sync with `fees.amount` above so the cross-check below is meaningful.
  }

  it("renders the patient's full paid amount (never the doctor's masked cut)", () => {
    seedData({ payments: [PAYMENT_ROW], appointments: [APPT_FOR_PAYMENT] })
    renderConnected(Payments)

    expect(screen.getByText('₹750')).toBeInTheDocument()
    // Same shared masking rule the rest of the app enforces (src/lib/paymentVisibility.js):
    // a non-staff viewer (patient/admin) sees the full recorded amount, never doctorCharge()'s
    // doctor-only consultation cut. PatientPages.jsx renders `payment.fees.amount` directly, which
    // must always agree with what visiblePaymentAmount() would show a patient.
    expect(visiblePaymentAmount(PAYMENT_ROW, APPT_FOR_PAYMENT, 'patient')).toBe(750)
  })

  it('shows the count of clinic payments still pending', () => {
    seedData({ payments: [], appointments: [{ ...APPT_FOR_PAYMENT, id: 'a2', paymentStatus: 'pending' }] })
    renderConnected(Payments)

    expect(screen.getByText('1 visit awaiting payment')).toBeInTheDocument()
  })

  it('refresh re-fetches payments from the server', async () => {
    seedData({ payments: [PAYMENT_ROW], appointments: [APPT_FOR_PAYMENT] })
    renderConnected(Payments)
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/payments', { params: {} }))
  })

  // Same "view before download" pattern as PatientAppointments' "View slip" above (request:
  // "baki jagah v same kar do jaha slip download ho raha hai") — the Receipt action must open an
  // in-page preview rather than save a file immediately, with the download action inside it.
  it('View receipt opens an in-page PDF preview instead of downloading immediately, with a Download action inside it', async () => {
    seedData({ payments: [PAYMENT_ROW], appointments: [APPT_FOR_PAYMENT] })
    renderConnected(Payments)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /View receipt/ }))

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

  // COMPLETENESS ADD (request: "eshme v add kro ye sab ye sab patient setion me v add kro") —
  // the same "At booking" / "At clinic" confirmation tag added to the receptionist/doctor Payments
  // table (StaffPages.jsx) now also shows here, so a patient can see whether a payment was their
  // own online prepayment at booking time or one collected in person at the clinic.
  it('shows "At booking" for a Razorpay online prepayment and "At clinic" for a payment collected at the clinic', () => {
    const BOOKING_PAYMENT = { ...PAYMENT_ROW, id: 'pay-2', mode: 'online', transactionRef: 'pay_xyz789' }
    seedData({ payments: [PAYMENT_ROW, BOOKING_PAYMENT], appointments: [APPT_FOR_PAYMENT] })
    renderConnected(Payments)

    expect(screen.getByText('At booking')).toBeInTheDocument()
    expect(screen.getByText('At clinic')).toBeInTheDocument() // PAYMENT_ROW's transactionRef ('txn_9') isn't a Razorpay id
  })
})

// =====================================================================
// Notifications
// =====================================================================
describe('Notifications', () => {
  const NOTIFICATION = {
    id: 'notif-1',
    title: 'Booking confirmed',
    body: 'Your appointment is confirmed.',
    createdAt: '2026-09-10T00:00:00.000Z',
    readAt: null,
  }

  it('fetches notifications on mount and renders them', async () => {
    mockGetRoutes({ '/notifications': [NOTIFICATION] })
    renderConnected(Notifications)

    expect(await screen.findByText('Booking confirmed')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/notifications', { params: {} })
  })

  it('marks a single notification as read', async () => {
    mockGetRoutes({ '/notifications': [NOTIFICATION] })
    apiClient.patch.mockResolvedValue({ readAt: '2026-09-10T01:00:00.000Z' })

    renderConnected(Notifications)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark read' }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/notifications/notif-1/read'))
    expect(screen.queryByRole('button', { name: 'Mark read' })).not.toBeInTheDocument()
  })

  it('marks all notifications as read', async () => {
    mockGetRoutes({ '/notifications': [NOTIFICATION] })
    apiClient.patch.mockResolvedValue({})

    renderConnected(Notifications)
    await screen.findByText('Booking confirmed')
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/notifications/read-all'))
  })

  it('shows an inline error on the initial fetch failure without crashing the page', async () => {
    apiClient.get.mockImplementation((url) =>
      url === '/notifications' ? Promise.reject(new Error('Could not load notifications.')) : Promise.resolve([])
    )
    renderConnected(Notifications)

    expect(await screen.findByText('Could not load notifications.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
  })
})

// =====================================================================
// PatientSettings
// =====================================================================
describe('PatientSettings', () => {
  it("prefills the form from the current user's profile and saves changes", async () => {
    apiClient.patch.mockResolvedValue({ ...PATIENT_USER, name: 'Asha K Mehta' })
    renderConnected(PatientSettings)

    expect(screen.getByLabelText(/^Full name/)).toHaveValue('Asha Mehta')
    expect(screen.getByLabelText('Mobile number')).toHaveValue('9876500000')

    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Asha K Mehta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith('/me', {
        name: 'Asha K Mehta',
        phone: '9876500000',
        email: 'asha@example.com',
        city: 'Mumbai',
      })
    )
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument()
  })

  it('shows an inline error when saving fails', async () => {
    apiClient.patch.mockRejectedValue(new Error('Update failed.'))
    renderConnected(PatientSettings)

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Update failed.')).toBeInTheDocument()
    expect(screen.queryByText('Profile updated.')).not.toBeInTheDocument()
  })
})
