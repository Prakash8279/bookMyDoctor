// Real backend API client. Replaces the dead `lib/api.js` stub (see that file's deprecation
// comment) — every store action in `store/useAppStore.js` goes through this client, never
// through `lib/api.js`. Built per the integration plan (`/tmp/connect/integration_plan.md`,
// §2 `apiClient.js` design).
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

// Keep the raw tokens in module-scope + localStorage (persisted across reloads). Tokens are
// deliberately kept OUT of the Zustand `data` object / its persisted blob — auth-token storage
// stays separate from app data so a `persist` partialize/migrate change never accidentally drops
// or exposes tokens differently than intended.
const TOKEN_STORAGE_KEY = 'connect_auth_tokens' // { accessToken, refreshToken }

function loadTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveTokens(next) {
  try {
    if (next) localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    /* ignore quota/private-mode errors */
  }
}

let tokens = loadTokens() // { accessToken, refreshToken } | null

// Exported so the store can read/clear auth state without importing axios directly.
export function getTokens() {
  return tokens
}
export function setTokens(next) {
  tokens = next
  saveTokens(next)
}
export function clearTokens() {
  tokens = null
  saveTokens(null)
}

const apiClient = axios.create({ baseURL: BASE_URL })

apiClient.interceptors.request.use((config) => {
  if (tokens && tokens.accessToken) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${tokens.accessToken}`
  }
  return config
})

function shapeError(body, originalError) {
  const message = body?.error?.message || originalError?.message || 'Request failed'
  const err = new Error(message)
  err.code = body?.error?.code || null
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
      if (!tokens || !tokens.refreshToken) {
        clearTokens()
        onUnauthorized()
        return Promise.reject(shapeError(body, error))
      }
      try {
        if (!refreshPromise) {
          refreshPromise = apiClient
            .post('/auth/refresh', { refreshToken: tokens.refreshToken })
            .finally(() => {
              refreshPromise = null
            })
        }
        const refreshed = await refreshPromise // already-unwrapped {accessToken, refreshToken}
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
