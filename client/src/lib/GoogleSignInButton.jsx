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
    let resizeObserver

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

        let previousWidth = 0
        const render = () => {
          if (disposed) return
          const width = Math.min(400, Math.max(200, Math.round(mountElement.getBoundingClientRect().width) || 320))
          if (width === previousWidth) return
          previousWidth = width
          mountElement.replaceChildren()
          google.accounts.id.renderButton(mountElement, {
          type: 'standard',
          theme: 'outline',
          // Google's medium button uses the generic label rather than exposing
          // a remembered account name/email in a two-line personalized card.
          size: 'medium',
          text,
          shape: 'pill',
          logo_alignment: 'left',
          width,
          })
        }
        render()
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(render)
          resizeObserver.observe(mountElement)
        }
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
      resizeObserver?.disconnect()
      mountElement?.replaceChildren()
    }
  }, [text])

  return (
    <div className="google-sign-in" aria-busy={disabled}>
      <div className="google-sign-in__button" ref={mountRef} inert={disabled ? true : undefined} style={disabled ? { pointerEvents: 'none' } : undefined} />
      {disabled && <div className="google-sign-in__busy" role="status">Signing in…</div>}
      {setupError && <p className="google-sign-in__error" role="alert">{setupError}</p>}
    </div>
  )
}
