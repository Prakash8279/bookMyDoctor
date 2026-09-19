// Unit tests for the guest-facing pieces of FeaturePages.jsx: ClinicSearch (public clinic
// directory + its inline ClinicProfile view) and PublicContent (about/blog/contact marketing
// pages, including the real contact form), plus ReceptionReports (the one authenticated
// receptionist page covered here, for its cash/online collection totals).
//
// The rest of FeaturePages.jsx (DoctorClinics, DoctorFees, DoctorStaff, SuperAdminDashboard, …)
// is authenticated staff/admin tooling reached only from behind ProtectedRoute, not a
// guest-facing/marketing page, so it is out of scope here.
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
import { ClinicSearch, PublicContent, ReceptionReports } from './FeaturePages'

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

const clinicData = {
  cities: [{ id: 'city-1', name: 'Mumbai' }, { id: 'city-2', name: 'Pune' }],
  areas: [{ id: 'area-1', name: 'Andheri', cityId: 'city-1' }],
  clinics: [
    { id: 'clinic-1', name: 'Heart Care Clinic', city: { name: 'Mumbai' }, area: { name: 'Andheri' }, address: '12 MG Road', approvalStatus: 'active', emergencyAvailable: true, phone: '+91 22 4000 1111' },
    { id: 'clinic-2', name: 'Skin & Glow Clinic', city: { name: 'Pune' }, area: { name: 'Kothrud' }, address: '5 FC Road', approvalStatus: 'active', emergencyAvailable: false, phone: '' },
  ],
  doctors: [
    { id: 'doc-1', name: 'Dr. Asha Rao', specialization: { name: 'Cardiology' }, experienceYears: 8, rating: 4.7, consultationFee: 700, onlineBooking: true, clinics: [{ id: 'clinic-1', name: 'Heart Care Clinic' }] },
  ],
}

describe('ClinicSearch', () => {
  it('lists every clinic by default with status and emergency info', () => {
    render(<MemoryRouter initialEntries={['/clinics']}><ClinicSearch data={clinicData} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Heart Care Clinic' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Skin & Glow Clinic' })).toBeInTheDocument()
    expect(screen.getByText('2 clinics found')).toBeInTheDocument()
    expect(screen.getByText('Emergency services available')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call clinic' })).toHaveAttribute('href', 'tel:+912240001111')
  })

  it('narrows results by city filter', () => {
    render(<MemoryRouter initialEntries={['/clinics']}><ClinicSearch data={clinicData} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Pune' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(screen.getByText('1 clinics found')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Skin & Glow Clinic' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Heart Care Clinic' })).not.toBeInTheDocument()
  })

  it('reads the clinic filter from the URL and shows the single-clinic profile view directly', () => {
    render(<MemoryRouter initialEntries={['/clinics?clinic=Heart%20Care%20Clinic']}><ClinicSearch data={clinicData} /></MemoryRouter>)
    // ClinicProfile view: clinic header + its doctor team, not the search list.
    expect(screen.getByRole('heading', { name: 'Heart Care Clinic', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Doctors at Heart Care Clinic')).toBeInTheDocument()
    expect(screen.getByText('Dr. Asha Rao')).toBeInTheDocument()
    expect(screen.queryByText('clinics found')).not.toBeInTheDocument()
  })

  it('shows an empty state on the clinic profile when no doctor is linked to the clinic', () => {
    render(<MemoryRouter initialEntries={['/clinics?clinic=Skin%20%26%20Glow%20Clinic']}><ClinicSearch data={clinicData} /></MemoryRouter>)
    expect(screen.getByText('No doctors listed')).toBeInTheDocument()
  })
})

describe('PublicContent', () => {
  it('renders the About page content', () => {
    render(<MemoryRouter><PublicContent kind="about" /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'About BookMyDoctor24' })).toBeInTheDocument()
  })

  it('renders the Blog page with its list of guide articles', () => {
    render(<MemoryRouter><PublicContent kind="blog" /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'BookMyDoctor24 Blog' })).toBeInTheDocument()
    expect(screen.getByText('How to prepare for a specialist visit')).toBeInTheDocument()
  })

  it('renders the Contact page with support details and submits the contact form for real', async () => {
    render(<MemoryRouter><PublicContent kind="contact" /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Contact BookMyDoctor24' })).toBeInTheDocument()
    expect(screen.getByText('bookmydoctor24@gmail.com')).toBeInTheDocument()

    // Every field here is `required`, so FormField appends a " *" to the visible label text.
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Rahul V' } })
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'rahul@example.com' } })
    fireEvent.change(screen.getByLabelText(/^Subject/), { target: { value: 'Payment or billing' } })
    fireEvent.change(screen.getByLabelText(/How can we help\?/), { target: { value: 'My payment failed but was deducted.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByText('Message sent.')).toBeInTheDocument()
    expect(apiClient.post).toHaveBeenCalledWith('/contact', {
      name: 'Rahul V',
      email: 'rahul@example.com',
      subject: 'Payment or billing',
      message: 'My payment failed but was deducted.',
    })
  })

  it('shows the real error message when the contact form submission fails', async () => {
    apiClient.post.mockImplementation((url) => (url === '/contact' ? Promise.reject(new Error('Could not send this message. Please try again.')) : Promise.resolve({})))
    render(<MemoryRouter><PublicContent kind="contact" /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Rahul V' } })
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'rahul@example.com' } })
    fireEvent.change(screen.getByLabelText(/How can we help\?/), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send this message. Please try again.')
  })
})

// COMPLETENESS ADD (request: "receptionist and doctor ke pass show ho online payment kitna hua
// cash ye proper way me", then "eshme ye show hona chahiye ki online booking ke time pe kitna
// payment hua hai and second clinic pe aake cash ya online ye v to confirm hona chahiye") — this
// stat row used to show only "Cash collected", then a cash-vs-"everything else online" split that
// didn't separate a patient's own booking-time Razorpay payment from one collected at the clinic.
describe('ReceptionReports', () => {
  it('shows paid-online-at-booking, cash collected, and online collected at the clinic as three separate totals', () => {
    const data = {
      payments: [
        { id: 'pay-1', mode: 'cash', appointment: { id: 'a1' }, fees: { consultationFee: 500 } },
        { id: 'pay-2', mode: 'upi', transactionRef: 'UTR555', appointment: { id: 'a2' }, fees: { consultationFee: 300 } },
        { id: 'pay-3', mode: 'online', transactionRef: 'UTR777', appointment: { id: 'a3' }, fees: { consultationFee: 200 } },
        // Paid by the patient online at booking time (Razorpay) — must not count as "collected".
        { id: 'pay-4', mode: 'online', transactionRef: 'pay_abc123', appointment: { id: 'a4' }, fees: { consultationFee: 900 } },
      ],
      appointments: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }],
      queueTokens: [],
    }
    render(<MemoryRouter><ReceptionReports data={data} /></MemoryRouter>)

    expect(screen.getByText('Paid online at booking').closest('article')).toHaveTextContent('₹900')
    expect(screen.getByText('Cash collected').closest('article')).toHaveTextContent('₹500')
    expect(screen.getByText('Online collected at clinic').closest('article')).toHaveTextContent('₹500') // 300 (upi) + 200 (online), excluding the Razorpay one
  })
})
