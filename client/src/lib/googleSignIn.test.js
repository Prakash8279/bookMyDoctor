// Unit tests for the configuration helpers. The actual Google button is rendered by Google's
// Identity Services script and must be clicked by a person, so it is intentionally covered by
// browser-level testing rather than faking a synthetic popup in jsdom.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGoogleClientId, isGoogleSignInConfigured } from './googleSignIn'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isGoogleSignInConfigured', () => {
  it('is false when VITE_GOOGLE_CLIENT_ID is unset', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    expect(isGoogleSignInConfigured()).toBe(false)
    expect(getGoogleClientId()).toBe('')
  })

  it('is true once a Client ID is configured', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '123-abc.apps.googleusercontent.com')
    expect(isGoogleSignInConfigured()).toBe(true)
    expect(getGoogleClientId()).toBe('123-abc.apps.googleusercontent.com')
  })
})
