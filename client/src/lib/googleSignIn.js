// GOOGLE SIGN-IN FEATURE (user request: "google work nahi kar rah hai fix kro") — the
// "Continue with Google" button on Login/Register used to be a stub that only showed an error
// message (see PublicPages.jsx). This is the real implementation.
//
// Loads Google Identity Services (GIS) on demand, same "don't block every page load with a
// third-party script" pattern as loadRazorpayScript.js, and turns our own custom-styled button
// click into a real Google account picker.
//
// GIS's raw JS API only ever opens ITS OWN rendered button UI — there's no bare
// `google.accounts.id.signIn()` you can call from an arbitrary click handler. The standard,
// widely-used workaround (this is not a hack specific to this app) is to render one real —
// but invisible — Google button once, and forward a click on our own styled button to it.
let gisScriptPromise = null

function loadGisScript() {
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google)
  }
  if (gisScriptPromise) {
    return gisScriptPromise
  }
  gisScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google?.accounts?.id) {
        resolve(window.google)
      } else {
        reject(new Error('Google Sign-In script loaded but window.google.accounts.id is missing.'))
      }
    }
    script.onerror = () => reject(new Error('Failed to load the Google Sign-In script.'))
    document.head.appendChild(script)
  }).catch((err) => {
    // Don't permanently cache a failure — let the next click retry instead of being stuck
    // forever because of one transient network blip, same reasoning as loadRazorpayScript.js.
    gisScriptPromise = null
    throw err
  })
  return gisScriptPromise
}

let hiddenButtonEl = null
let pendingCredentialCallbacks = []

export function isGoogleSignInConfigured() {
  return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
}

// Resolves with the Google ID token (a signed JWT our backend verifies — see POST /auth/google)
// once the user finishes picking a Google account, or rejects if the script fails to load, GIS
// isn't configured, or the picker sits unused long enough that we give up waiting (the user
// closed the popup — GIS has no direct "the user cancelled" event for this button-click flow, so
// a timeout is the only way to stop waiting forever).
export async function signInWithGoogle() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('Google sign-in is not configured for this deployment yet.')
  }

  const google = await loadGisScript()

  if (!hiddenButtonEl) {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        const callbacks = pendingCredentialCallbacks
        pendingCredentialCallbacks = []
        callbacks.forEach(({ resolve }) => resolve(response.credential))
      },
    })
    hiddenButtonEl = document.createElement('div')
    hiddenButtonEl.style.position = 'fixed'
    hiddenButtonEl.style.top = '-9999px'
    hiddenButtonEl.style.left = '-9999px'
    document.body.appendChild(hiddenButtonEl)
    google.accounts.id.renderButton(hiddenButtonEl, { type: 'standard' })
  }

  const realButton = hiddenButtonEl.querySelector('div[role="button"]')
  if (!realButton) {
    throw new Error('Google Sign-In button failed to render.')
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      pendingCredentialCallbacks = pendingCredentialCallbacks.filter((entry) => entry.resolve !== wrappedResolve)
      reject(new Error('Google sign-in was cancelled or timed out.'))
    }, 90_000)
    const wrappedResolve = (credential) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve(credential)
    }
    pendingCredentialCallbacks.push({ resolve: wrappedResolve })
    realButton.click()
  })
}
