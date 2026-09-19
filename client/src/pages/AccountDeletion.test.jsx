// Tests for the public account/data deletion request page (src/pages/AccountDeletion.jsx).
//
// Same convention as the other page test suites: render the real component against the real
// Zustand store, mocking only src/lib/apiClient.js at the network boundary. This page is public
// (reachable without logging in — see the file's own header comment), so no auth state is seeded.
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
import { AccountDeletion } from './AccountDeletion'

const initialStoreState = useAppStore.getState()

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(initialStoreState, true)
  vi.clearAllMocks()
  getTokens.mockReturnValue(null)
  apiClient.get.mockResolvedValue([])
  apiClient.post.mockResolvedValue({})
})

afterEach(() => {
  localStorage.clear()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/delete-account']}>
      <AccountDeletion />
    </MemoryRouter>
  )
}

function fillRequiredFields({ name = 'Asha Mehta', email = 'asha@example.com' } = {}) {
  // Required FormFields render a trailing " *" inside the same <label>, so their accessible name
  // is "Full name *" / "Account email *" — match with a prefix regex, as the rest of this app's
  // tests do for other required fields (see AdminPages.test.jsx/StaffPages.test.jsx).
  fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: name } })
  fireEvent.change(screen.getByLabelText(/^Account email/), { target: { value: email } })
}

describe('AccountDeletion', () => {
  it('renders the public page (no login required) with the retained-records notice', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Request account & data deletion' })).toBeInTheDocument()
    expect(screen.getByText(/Financial and payment records/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit deletion request' })).toBeInTheDocument()
  })

  it('refuses to submit — and never calls the delete endpoint — until the confirmation checkbox is checked', () => {
    renderPage()
    fillRequiredFields()

    // Checkbox intentionally left unchecked.
    fireEvent.click(screen.getByRole('button', { name: 'Submit deletion request' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/confirm the checkbox/i)
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('submits the deletion request to the contact endpoint only after the checkbox is confirmed', async () => {
    renderPage()
    fillRequiredFields({ name: 'Asha Mehta', email: 'asha@example.com' })
    fireEvent.change(screen.getByLabelText('Account type (optional)'), { target: { value: 'Patient' } })
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Switching providers' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit deletion request' }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1))
    expect(apiClient.post).toHaveBeenCalledWith('/contact', {
      name: 'Asha Mehta',
      email: 'asha@example.com',
      subject: 'Account & data deletion request',
      message: [
        'Account email to delete: asha@example.com',
        'Account type: Patient',
        'Reason (optional): Switching providers',
        'Confirmation: user has confirmed they understand this request is permanent, subject to the retained-records exceptions described on the deletion request page.',
      ].join('\n'),
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/Request received/i)
    // The destructive action is genuinely irreversible from here on in the UI: the form is gone.
    expect(screen.queryByRole('button', { name: 'Submit deletion request' })).not.toBeInTheDocument()
  })

  it('omits the optional account type / reason lines when left blank', async () => {
    renderPage()
    fillRequiredFields()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit deletion request' }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1))
    const [, payload] = apiClient.post.mock.calls[0]
    expect(payload.message).not.toMatch(/Account type:/)
    expect(payload.message).not.toMatch(/Reason \(optional\):/)
  })

  it('shows an inline error and keeps the form usable when the submission fails', async () => {
    apiClient.post.mockRejectedValue(new Error('Network error'))
    renderPage()
    fillRequiredFields()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit deletion request' }))

    expect(await screen.findByText('Network error')).toBeInTheDocument()
    // Not marked as sent — the destructive request did not actually go through.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit deletion request' })).toBeInTheDocument()
  })

  it('falls back to a generic error message when the rejection carries none', async () => {
    apiClient.post.mockRejectedValue(new Error())
    renderPage()
    fillRequiredFields()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit deletion request' }))

    expect(await screen.findByText(/Could not submit this request/i)).toBeInTheDocument()
  })
})
