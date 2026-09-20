// Real backend API client. Replaces the dead `lib/api.js` stub (see that file's deprecation
// comment) — every store action in `store/useAppStore.js` goes through this client, never
// through `lib/api.js`. Built per the integration plan (`/tmp/connect/integration_plan.md`,
// §2 `apiClient.js` design).
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

// Keep the raw access token in module-scope + localStorage (persisted across reloads). Tokens are
// deliberately kept OUT of the Zustand `data` object / its persisted blob — auth-token storage
// stays separate from app data so a `persist` partialize/migrate change never accidentally drops
// or exposes tokens differently than intended.
//
// WEB REFRESH-COOKIE FIX (risky-item #2, docs/risky-fixes-plan-2026-09-20.md — "the refresh
// token sits in localStorage, so any XSS on the web app can steal a long-lived (30-day) session,
// not just the short-lived access token"): the refresh token is no longer stored here AT ALL.
// The backend now sets it as an httpOnly cookie instead (see server's utils/webClientAuth.js) —
// invisible to JS, so an XSS payload running in this page can no longer read or exfiltrate it.
// `withCredentials: true` below is what makes the browser actually send/receive that cookie.
// Only the short-lived (15m) access token still lives here, same as before this fix — it MUST be
// readable by this code to attach it as an Authorization header, so moving it out of JS reach
// isn't possible without switching every authenticated call to cookie auth too (a bigger change,
// out of scope here — see the plan doc). `loadTokens`/`saveTokens` keep the object shape (rather
// than a bare string) for forward/backward compatibility with an already-persisted blob from
// before this fix — an old `{accessToken, refreshToken}` value loads fine, just with
// refreshToken silently dropped and never written back.
const TOKEN_STORAGE_KEY = 'connect_auth_tokens' // { accessToken }

function loadTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && parsed.accessToken ? { accessToken: parsed.accessToken } : null
  } catch {
    return null
  }
}

function saveTokens(next) {
  try {
    if (next && next.accessToken) localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ accessToken: next.accessToken }))
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    /* ignore quota/private-mode errors */
  }
}

let tokens = loadTokens() // { accessToken } | null

// Exported so the store can read/clear auth state without importing axios directly.
export function getTokens() {
  return tokens
}
export function setTokens(next) {
  // Strip refreshToken here too, not just in saveTokens' localStorage write below — otherwise a
  // refreshToken passed in by a call site (login()/register()/etc. still pass the full
  // `{accessToken, refreshToken}} shape through unchanged, since a mobile/non-web response still
  // legitimately has one) would sit in this module's in-memory `tokens` variable for the rest of
  // the page's lifetime, undermining the whole point of this fix even though it was never
  // persisted to disk.
  tokens = next && next.accessToken ? { accessToken: next.accessToken } : null
  saveTokens(tokens)
}
export function clearTokens() {
  tokens = null
  saveTokens(null)
}

// REQUEST-TIMEOUT FIX (senior-dev payment audit, "payment sahi nahi hua hai"): this client had NO
// timeout at all, so a hung response (a slow/overloaded server, or a proxy that silently
// black-holes the response instead of dropping the connection) left a caller's promise pending
// forever. The worst case was the Razorpay payment-verification call — Razorpay had ALREADY
// charged the patient by the time that call fires, so an indefinite hang left the "Opening
// payment…" button frozen with no error and no way to tell whether the payment succeeded. 30s is
// generous for a normal request/response but still bounds every call to a real outcome (success or
// a catchable error) instead of an infinite wait.
// WEB REFRESH-COOKIE FIX — `withCredentials: true` lets the browser send/receive the httpOnly
// refresh cookie the backend now sets (safe: the backend pins CORS to this exact origin with
// credentials:true, never a wildcard — see server's app.js). `X-Client-Platform: web` is how the
// backend tells this app apart from the Flutter mobile client, which never sends it and keeps
// its existing JSON-body refresh-token flow (flutter_secure_storage-backed) completely
// unchanged — see server's utils/webClientAuth.js for the full flow this pairs with.
const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: { 'X-Client-Platform': 'web' },
})

apiClient.interceptors.request.use((config) => {
  if (tokens && tokens.accessToken) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${tokens.accessToken}`
  }
  return config
})

function shapeError(body, originalError) {
  // A timed-out request never reaches a server response, so `body` is always empty here — axios's
  // own default message ("timeout of 30000ms exceeded") is accurate but not patient-facing.
  const isTimeout = originalError?.code === 'ECONNABORTED' && /timeout/i.test(originalError?.message || '')
  const message = body?.error?.message
    || (isTimeout ? 'The request took too long to respond. Please check your connection and try again.' : null)
    || originalError?.message
    || 'Request failed'
  const err = new Error(message)
  err.code = body?.error?.code || (isTimeout ? 'REQUEST_TIMEOUT' : null)
  err.details = body?.error?.details || null
  err.status = originalError?.response?.status || null
  return err
}

// One-shot silent refresh-then-retry on 401. `_retry` flag prevents infinite loops. A second
// 401 in a row (including one from the refresh call itself) clears tokens and lets the error
// propagate — the store's onUnauthorized callback (registered below) is called so App-level
// state can redirect to /login.
let onUnauthorized = () => {}
export function registerUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

let refreshPromise = null // de-dupe concurrent 401s into a single refresh call

apiClient.interceptors.response.use(
  (response) => {
    const body = response.data
    if (body && body.success === false) {
      // Shouldn't normally happen (non-2xx should already reject) but defensive: treat a
      // success:false 2xx the same as a thrown error.
      const err = new Error(body.error?.message || 'Request failed')
      err.code = body.error?.code || null
      err.details = body.error?.details || null
      err.status = response.status
      throw err
    }
    // Unwrap the envelope: callers get `data` directly. Pagination, when present, is attached
    // as a non-enumerable convenience property on the returned value so call sites that need it
    // can read `result.__pagination` without it polluting `...spread` usage or `Object.keys` on
    // array results.
    const data = body?.data
    if (body && body.pagination !== undefined) {
      try {
        Object.defineProperty(data, '__pagination', { value: body.pagination, enumerable: false, configurable: true })
      } catch {
        /* primitive data (rare) — skip attaching */
      }
    }
    return data
  },
  async (error) => {
    const original = error.config
    const status = error.response?.status
    const body = error.response?.data

    if (status === 401 && original && !original._retry && original.url !== '/auth/refresh') {
      original._retry = true
      // WEB REFRESH-COOKIE FIX — there is no longer a `tokens.refreshToken` to check for
      // presence before bothering (it isn't stored in JS-reachable memory/localStorage at all
      // anymore — see the TOKEN_STORAGE_KEY comment above). The httpOnly cookie is invisible to
      // this code either way, so the ONLY way to know whether a session can be silently restored
      // is to just attempt the call and let the backend decide from the cookie it can see.
      try {
        if (!refreshPromise) {
          refreshPromise = apiClient
            .post('/auth/refresh')
            .finally(() => {
              refreshPromise = null
            })
        }
        const refreshed = await refreshPromise // already-unwrapped {accessToken} — no refreshToken in the body for web
        setTokens(refreshed)
        original.headers = original.headers || {}
        original.headers.Authorization = `Bearer ${refreshed.accessToken}`
        return apiClient(original)
      } catch (refreshErr) {
        clearTokens()
        onUnauthorized()
        return Promise.reject(shapeError(refreshErr.response?.data, refreshErr))
      }
    }

    if (status === 401) {
      // Second 401 in a row, or the refresh call itself failed with 401 (reuse-detected /
      // fully invalid) — unrecoverable, clear and bail.
      clearTokens()
      onUnauthorized()
    }

    return Promise.reject(shapeError(body, error))
  }
)

export default apiClient
