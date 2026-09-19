// Unit tests for src/lib/googleSignIn.js — GOOGLE SIGN-IN FEATURE (user request: "google work
// nahi kar rah hai fix kro"). Only the parts that don't require an actual Google Identity
// Services script (which needs real network access and a real Google account picker — neither
// available in a unit test) are exercised directly here: whether the feature reports itself as
// configured, and that signInWithGoogle() fails fast — without touching the DOM at all — when no
// Client ID is configured, rather than injecting a script that could never succeed anyway.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isGoogleSignInConfigured, signInWithGoogle } from './googleSignIn'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isGoogleSignInConfigured', () => {
  it('is false when VITE_GOOGLE_CLIENT_ID is unset', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    expect(isGoogleSignInConfigured()).toBe(false)
  })

  it('is true once a Client ID is configured', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '123-abc.apps.googleusercontent.com')
    expect(isGoogleSignInConfigured()).toBe(true)
  })
})

describe('signInWithGoogle', () => {
  it('rejects immediately when not configured, without injecting the Google script', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    const createElementSpy = vi.spyOn(document, 'createElement')

    await expect(signInWithGoogle()).rejects.toThrow('Google sign-in is not configured for this deployment yet.')
    expect(createElementSpy).not.toHaveBeenCalledWith('script')
  })
})
