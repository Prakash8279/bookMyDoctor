// Integration test: doctor search/filter flow.
//
// Exercises together, for real: the boot-time public-directory load in App.jsx (which calls the
// real store's loadPublicDirectory()/searchDoctors()/fetchSpecializations() etc.), the real
// SearchResults page component (src/pages/PublicPages.jsx) reading `data` straight from the
// store, and its own client-side filtering/derivation logic (the `doctors` useMemo). Only the
// network boundary (src/lib/apiClient.js) is mocked — the doctor list narrowing on "Apply
// filters" is entirely real component + store-shaped-data logic, nothing about the filtering
// itself is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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

const CITIES = [
  { id: 'city-mumbai', name: 'Mumbai' },
  { id: 'city-pune', name: 'Pune' },
]
const SPECIALIZATIONS = [
  { id: 'spec-cardio', name: 'Cardiology' },
  { id: 'spec-derma', name: 'Dermatology' },
]
const DOCTORS = [
  {
    id: 'doc-1',
    name: 'Dr. Asha Rao',
    specialization: { id: 'spec-cardio', name: 'Cardiology' },
    consultationFee: 800,
    experienceYears: 10,
    rating: 4.8,
    city: 'Mumbai',
    emergencyAvailable: false,
    onlineBooking: true,
    clinics: [{ id: 'clinic-1', name: 'Heart Care Clinic', city: 'Mumbai', area: 'Andheri' }],
  },
  {
    id: 'doc-2',
    name: 'Dr. Vikram Shah',
    specialization: { id: 'spec-derma', name: 'Dermatology' },
    consultationFee: 500,
    experienceYears: 5,
    rating: 4.2,
    city: 'Pune',
    emergencyAvailable: false,
    onlineBooking: true,
    clinics: [{ id: 'clinic-2', name: 'Skin & Glow Clinic', city: 'Pune', area: 'Kothrud' }],
  },
]
const CLINICS = [
  { id: 'clinic-1', name: 'Heart Care Clinic', city: 'Mumbai' },
  { id: 'clinic-2', name: 'Skin & Glow Clinic', city: 'Pune' },
]

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(initialStoreState, true)
  vi.clearAllMocks()
  getTokens.mockReturnValue(null)
  apiClient.post.mockImplementation(() => Promise.resolve({}))
  apiClient.get.mockImplementation((url) => {
    if (url === '/geography/cities') return Promise.resolve(CITIES)
    if (url === '/geography/specializations') return Promise.resolve(SPECIALIZATIONS)
    if (url === '/doctors') return Promise.resolve(DOCTORS)
    if (url === '/clinics') return Promise.resolve(CLINICS)
    return Promise.resolve([])
  })
})

afterEach(() => {
  localStorage.clear()
})

describe('doctor search/filter flow', () => {
  it('loads the real public directory and narrows results by specialization', async () => {
    render(
      <MemoryRouter initialEntries={['/search']}>
        <App />
      </MemoryRouter>
    )

    // Both doctors render once the boot-time bulk load (real store action, mocked network)
    // resolves and the lazy SearchResults chunk mounts.
    expect(await screen.findByText('Dr. Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('Dr. Vikram Shah')).toBeInTheDocument()
    expect(screen.getByText('2 doctors found')).toBeInTheDocument()

    // Real <select> from FormField, labelled "Specialization" — pick Cardiology and apply.
    fireEvent.change(screen.getByLabelText('Specialization'), { target: { value: 'Cardiology' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    // The store's raw `doctors` data never changed (still both) — only SearchResults' own
    // useMemo-derived, filtered view narrows. This is the real filtering logic under test.
    expect(await screen.findByText('1 doctors found', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText('Dr. Asha Rao')).toBeInTheDocument()
    expect(screen.queryByText('Dr. Vikram Shah')).not.toBeInTheDocument()
    expect(useAppStore.getState().data.doctors).toHaveLength(2)

    // Clearing filters restores the full list.
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(await screen.findByText('2 doctors found')).toBeInTheDocument()
    expect(screen.getByText('Dr. Vikram Shah')).toBeInTheDocument()
  })

  it('narrows by a text search term matched against name/specialty', async () => {
    render(
      <MemoryRouter initialEntries={['/search']}>
        <App />
      </MemoryRouter>
    )

    await screen.findByText('Dr. Asha Rao')
    const searchBox = screen.getByLabelText('Doctor or symptom')
    fireEvent.change(searchBox, { target: { value: 'vikram' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    const list = await screen.findByText('1 doctors found')
    expect(list).toBeInTheDocument()
    expect(screen.getByText('Dr. Vikram Shah')).toBeInTheDocument()
    expect(screen.queryByText('Dr. Asha Rao')).not.toBeInTheDocument()
  })
})
