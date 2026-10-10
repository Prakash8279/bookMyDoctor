import { useEffect, useRef, useState } from 'react'
import { getGoogleClientId, isGoogleSignInConfigured, loadGoogleIdentityServices } from './googleSignIn'

/**
 * Renders Google's own sign-in button instead of imitating it with an app button.
 * Google Identity Services requires the person to click the button it renders; synthetic clicks
 * are unsupported and may be blocked by browsers as popup abuse.
 */
export function GoogleSignInButton({ onCredential, onError, disabled = false, text = 'continue_with' }) {
  const mountRef = useRef(null)
  const callbacksRef = useRef({ onCredential, onError })
  const [setupError, setSetupError] = useState('')

  useEffect(() => {
    callbacksRef.current = { onCredential, onError }
  }, [onCredential, onError])

  useEffect(() => {
    let disposed = false
    const mountElement = mountRef.current

    async function renderGoogleButton() {
      if (!isGoogleSignInConfigured()) {
        const error = new Error('Google sign-in is not configured for this deployment yet.')
        setSetupError(error.message)
        callbacksRef.current.onError?.(error)
        return
      }

      try {
        const google = await loadGoogleIdentityServices()
        if (disposed || !mountElement) return

        google.accounts.id.initialize({
          client_id: getGoogleClientId(),
          callback: (response) => {
            if (!response?.credential) {
              callbacksRef.current.onError?.(new Error('Google did not return a sign-in token. Please try again.'))
              return
            }
            callbacksRef.current.onCredential?.(response.credential)
          },
        })

        mountElement.replaceChildren()
        const width = Math.min(400, Math.max(200, Math.round(mountElement.getBoundingClientRect().width) || 320))
        google.accounts.id.renderButton(mountElement, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
        })
      } catch (error) {
        if (disposed) return
        const friendlyError = error instanceof Error ? error : new Error('Google sign-in could not be started. Please try again.')
        setSetupError(friendlyError.message)
        callbacksRef.current.onError?.(friendlyError)
      }
    }

    renderGoogleButton()
    return () => {
      disposed = true
      mountElement?.replaceChildren()
    }
  }, [text])

  return (
    <div className="google-sign-in" aria-busy={disabled}>
      <div className="google-sign-in__button" ref={mountRef} style={disabled ? { pointerEvents: 'none' } : undefined} />
      {disabled && <div className="google-sign-in__busy">Signing in…</div>}
      {setupError && <p className="google-sign-in__error" role="alert">{setupError}</p>}
    </div>
  )
}
