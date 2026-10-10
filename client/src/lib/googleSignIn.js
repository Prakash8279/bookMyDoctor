// Google Identity Services loader shared by the visible, Google-rendered sign-in button.
//
// Do not replace the rendered Google button with a hidden button plus element.click(). Google
// explicitly does not support programmatically initiating the button flow; browsers can treat
// such synthetic clicks as popup abuse and silently block the account picker.
let gisScriptPromise = null

export function isGoogleSignInConfigured() {
  return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
}

export function getGoogleClientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
}

export function loadGoogleIdentityServices() {
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
        reject(new Error('Google Sign-In loaded incorrectly. Please refresh and try again.'))
      }
    }
    script.onerror = () => reject(new Error('Could not load Google Sign-In. Check your internet connection and try again.'))
    document.head.appendChild(script)
  }).catch((error) => {
    // A temporary network problem must not leave the entire login page permanently broken.
    gisScriptPromise = null
    throw error
  })

  return gisScriptPromise
}
