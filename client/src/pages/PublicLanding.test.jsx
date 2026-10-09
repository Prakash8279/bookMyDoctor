// Unit tests for the marketing landing pages in PublicLanding.jsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

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
import { PatientLanding, ProviderLanding } from './PublicLanding'

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

describe('PatientLanding', () => {
  it('reads doctors/specializations/clinics/cities straight from the real store', () => {
    useAppStore.setState({
      data: {
        ...useAppStore.getState().data,
        cities: [{ id: 'c1', name: 'Mumbai' }],
        specializations: [{ id: 'spec-1', name: 'Cardiology' }],
        clinics: [{ id: 'clinic-1', name: 'Heart Care Clinic' }],
        doctors: [{
          id: 'doc-1',
          name: 'Dr. Asha Rao',
          specialization: { name: 'Cardiology' },
          experienceYears: 8,
          rating: 4.7,
          consultationFee: 700,
          clinics: [{ id: 'clinic-1', name: 'Heart Care Clinic', city: 'Mumbai' }],
        }],
      },
    })
    renderWithLocation(<PatientLanding />)
    expect(screen.getByRole('heading', { name: /Book Doctor Appointments Online/i })).toBeInTheDocument()
    // Stats strip counts (1 doctor, 1 clinic).
    expect(screen.getAllByText('1', { selector: 'strong' })).toHaveLength(2)
    // The specialization card shows the real doctor count for that specialization (1 doctor).
    expect(screen.getByText('Cardiology', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('1 doctor')).toBeInTheDocument()
    expect(screen.getByText('Dr. Asha Rao')).toBeInTheDocument()
  })

  it('submits the hero search filters as query params on /search', () => {
    useAppStore.setState({
      data: {
        ...useAppStore.getState().data,
        cities: [{ id: 'c1', name: 'Mumbai' }],
        specializations: [{ id: 'spec-1', name: 'Cardiology' }],
      },
    })
    renderWithLocation(<PatientLanding />)
    fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Mumbai' } })
    fireEvent.change(screen.getByLabelText(/Specialization/i), { target: { value: 'Cardiology' } })
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. fever, Dr\. Sharma/i), { target: { value: 'fever' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const probe = screen.getByTestId('location-probe')
    expect(probe.dataset.pathname).toBe('/search')
    const params = new URLSearchParams(probe.dataset.search)
    expect(params.get('city')).toBe('Mumbai')
    expect(params.get('specialty')).toBe('Cardiology')
    expect(params.get('q')).toBe('fever')
    expect(params.get('today')).toBe('true') // default "Booking" selection is "Today booking".
  })

  it('omits the "today" flag when "Any available date" is chosen', () => {
    renderWithLocation(<PatientLanding />)
    fireEvent.change(screen.getByLabelText(/Booking/i), { target: { value: 'any' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const probe = screen.getByTestId('location-probe')
    expect(new URLSearchParams(probe.dataset.search).get('today')).toBeNull()
  })

  it('shows an empty state with a link to add a doctor when there are no doctors yet', () => {
    renderWithLocation(<PatientLanding />)
    expect(screen.getByText('No doctor profiles added yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a doctor' })).toHaveAttribute('href', '/register?role=doctor')
  })

  it('links the doctor CTA to doctor registration', () => {
    renderWithLocation(<PatientLanding />)
    expect(screen.getByRole('link', { name: /Join as a doctor/ })).toHaveAttribute('href', '/register?role=doctor')
  })
})

describe('ProviderLanding', () => {
  it('renders the provider hero and links to clinic registration', () => {
    renderWithLocation(<ProviderLanding />)
    expect(screen.getByRole('heading', { name: /A calmer clinic, from arrival to consultation\./i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Register your clinic' })).toHaveAttribute('href', '/register')
  })

  it('submits the clinic demo request through the real store and shows a success message', async () => {
    renderWithLocation(<ProviderLanding />)
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Dr. Priya Nair' } })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'priya@example.com' } })
    fireEvent.change(screen.getByLabelText('Clinic name'), { target: { value: 'Nair Clinic' } })
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '9990001111' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Pune' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request a demo' }))

    expect(await screen.findByText(/demo request has been received/i)).toBeInTheDocument()
    expect(apiClient.post).toHaveBeenCalledWith('/contact', expect.objectContaining({
      name: 'Dr. Priya Nair',
      email: 'priya@example.com',
      subject: 'Clinic demo request',
      message: expect.stringContaining('Nair Clinic'),
    }))
  })

  it('shows the real error message when the demo request submission fails', async () => {
    apiClient.post.mockImplementation((url) => (url === '/contact' ? Promise.reject(new Error('Could not reach the server.')) : Promise.resolve({})))
    renderWithLocation(<ProviderLanding />)
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Dr. Priya Nair' } })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'priya@example.com' } })
    fireEvent.change(screen.getByLabelText('Clinic name'), { target: { value: 'Nair Clinic' } })
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '9990001111' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Pune' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request a demo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
  })
})
