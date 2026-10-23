import { afterEach, expect, it, vi } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import { GoogleSignInButton } from './GoogleSignInButton'
import { loadGoogleIdentityServices } from './googleSignIn'

vi.mock('./googleSignIn', () => ({
  getGoogleClientId: () => 'test-client',
  isGoogleSignInConfigured: () => true,
  loadGoogleIdentityServices: vi.fn(),
}))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('uses the official generic rounded Google button and preserves credential handling', async () => {
  const initialize = vi.fn()
  const renderButton = vi.fn()
  loadGoogleIdentityServices.mockResolvedValue({ accounts: { id: { initialize, renderButton } } })
  const onCredential = vi.fn()
  render(<GoogleSignInButton onCredential={onCredential} />)
  await waitFor(() => expect(renderButton).toHaveBeenCalled())
  expect(renderButton.mock.calls[0][1]).toEqual(expect.objectContaining({
    type: 'standard', size: 'medium', shape: 'pill', theme: 'outline', text: 'continue_with',
  }))
  initialize.mock.calls[0][0].callback({ credential: 'valid-token' })
  expect(onCredential).toHaveBeenCalledWith('valid-token')
})

it('resizes on narrow screens without reinitializing Google and disconnects on unmount', async () => {
  let width = 600
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width }))
  let onResize
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { onResize = callback } observe() {} disconnect = disconnect })
  const initialize = vi.fn()
  const renderButton = vi.fn()
  loadGoogleIdentityServices.mockResolvedValue({ accounts: { id: { initialize, renderButton } } })
  const { unmount } = render(<GoogleSignInButton />)
  await waitFor(() => expect(renderButton).toHaveBeenCalled())
  expect(renderButton.mock.calls[0][1].width).toBe(400)
  width = 280
  onResize()
  expect(renderButton.mock.lastCall[1].width).toBe(280)
  onResize()
  expect(renderButton).toHaveBeenCalledTimes(2)
  expect(initialize).toHaveBeenCalledTimes(1)
  unmount()
  expect(disconnect).toHaveBeenCalled()
})

it('prevents repeat interaction while signing in', async () => {
  loadGoogleIdentityServices.mockResolvedValue({ accounts: { id: { initialize: vi.fn(), renderButton: vi.fn() } } })
  const { container } = render(<GoogleSignInButton disabled />)
  expect(container.querySelector('.google-sign-in__button')).toHaveAttribute('inert')
  expect(screen.getByRole('status')).toHaveTextContent('Signing in…')
})
