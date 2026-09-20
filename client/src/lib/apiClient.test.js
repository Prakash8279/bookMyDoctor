// Unit tests for lib/apiClient.js — specifically the WEB REFRESH-COOKIE FIX (risky-item #2,
// docs/risky-fixes-plan-2026-09-20.md): the refresh token no longer lives in localStorage at
// all (only the httpOnly cookie the backend sets), and the silent-refresh-on-401 interceptor no
// longer sends a body refreshToken — it relies on the browser attaching that cookie automatically
// (withCredentials: true) instead.
//
// axios itself is mocked: `axios.create()` returns a fake instance that is both callable (an
// axios instance can be invoked as a function to retry a request — see the interceptor's
// `return apiClient(original)`) and carries `.post`/`.get`/`.interceptors`, mirroring the real
// shape closely enough to capture and directly invoke the request/response interceptor callbacks
// apiClient.js registers at module load, without a real HTTP layer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function createMockAxiosInstance() {
  const fn = vi.fn()
  fn.post = vi.fn()
  fn.get = vi.fn()
  fn.interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  }
  return fn
}

let mockInstance
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockInstance),
  },
}))

describe('apiClient — axios instance configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    mockInstance = createMockAxiosInstance()
    localStorage.clear()
  })

  it('is created with withCredentials:true and the X-Client-Platform: web header (so the backend can tell it apart from the mobile app)', async () => {
    const axios = (await import('axios')).default
    await import('./apiClient')

    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        withCredentials: true,
        headers: { 'X-Client-Platform': 'web' },
      })
    )
  })
})

describe('apiClient — token storage (refreshToken never persisted)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockInstance = createMockAxiosInstance()
    localStorage.clear()
  })

  it('setTokens persists only accessToken to localStorage, never refreshToken', async () => {
    const { setTokens, getTokens } = await import('./apiClient')

    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })

    expect(getTokens()).toEqual({ accessToken: 'access-1' })
    const raw = JSON.parse(localStorage.getItem('connect_auth_tokens'))
    expect(raw).toEqual({ accessToken: 'access-1' })
    expect(raw.refreshToken).toBeUndefined();
  })

  it('clearTokens removes the stored value entirely', async () => {
    const { setTokens, clearTokens, getTokens } = await import('./apiClient')
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })

    clearTokens()

    expect(getTokens()).toBeNull()
    expect(localStorage.getItem('connect_auth_tokens')).toBeNull()
  })

  it('loading a pre-existing OLD-shape blob (from before this fix) silently drops refreshToken', async () => {
    localStorage.setItem('connect_auth_tokens', JSON.stringify({ accessToken: 'old-access', refreshToken: 'old-refresh' }))

    const { getTokens } = await import('./apiClient')

    expect(getTokens()).toEqual({ accessToken: 'old-access' })
  })

  it('a blob with no accessToken loads as null', async () => {
    localStorage.setItem('connect_auth_tokens', JSON.stringify({ refreshToken: 'orphaned' }))

    const { getTokens } = await import('./apiClient')

    expect(getTokens()).toBeNull()
  })
})

describe('apiClient — request interceptor', () => {
  let requestInterceptor

  beforeEach(async () => {
    vi.resetModules()
    mockInstance = createMockAxiosInstance()
    localStorage.clear()
    await import('./apiClient')
    requestInterceptor = mockInstance.interceptors.request.use.mock.calls[0][0]
  })

  it('attaches Authorization: Bearer <accessToken> when a token is set', async () => {
    const { setTokens } = await import('./apiClient')
    setTokens({ accessToken: 'abc123' })

    const config = requestInterceptor({ headers: {} })

    expect(config.headers.Authorization).toBe('Bearer abc123')
  })

  it('does not attach an Authorization header when there is no token', () => {
    const config = requestInterceptor({ headers: {} })
    expect(config.headers.Authorization).toBeUndefined()
  })
})

describe('apiClient — response success interceptor', () => {
  let successHandler

  beforeEach(async () => {
    vi.resetModules()
    mockInstance = createMockAxiosInstance()
    localStorage.clear()
    await import('./apiClient')
    successHandler = mockInstance.interceptors.response.use.mock.calls[0][0]
  })

  it('unwraps the {success, data} envelope, returning data directly', () => {
    const result = successHandler({ data: { success: true, data: { id: 'x1' } } })
    expect(result).toEqual({ id: 'x1' })
  })

  it('throws when the server responds 2xx but success:false (defensive — should not normally happen)', () => {
    expect(() =>
      successHandler({ data: { success: false, error: { code: 'WEIRD', message: 'huh' } }, status: 200 })
    ).toThrow('huh')
  })

  it('attaches pagination as a non-enumerable __pagination property when present', () => {
    const pagination = { page: 1, total: 10 }
    const result = successHandler({ data: { success: true, data: [{ id: 1 }], pagination } })
    expect(result.__pagination).toBe(pagination)
    expect(Object.keys(result)).not.toContain('__pagination') // non-enumerable
  })
})

describe('apiClient — response error interceptor: silent refresh via httpOnly cookie', () => {
  let errorHandler
  let apiClientModule

  beforeEach(async () => {
    vi.resetModules()
    mockInstance = createMockAxiosInstance()
    localStorage.clear()
    apiClientModule = await import('./apiClient')
    errorHandler = mockInstance.interceptors.response.use.mock.calls[0][1]
  })

  it('on a 401 from a non-refresh URL, calls POST /auth/refresh with NO body (the cookie carries it, not a stored refreshToken)', async () => {
    mockInstance.post.mockResolvedValueOnce({ accessToken: 'fresh-access' }) // already-unwrapped, as the success interceptor would leave it
    mockInstance.mockResolvedValueOnce({ ok: true }) // the retried original request

    const original = { url: '/appointments', headers: {} }
    await errorHandler({ config: original, response: { status: 401, data: {} } })

    expect(mockInstance.post).toHaveBeenCalledWith('/auth/refresh')
    expect(mockInstance.post).not.toHaveBeenCalledWith('/auth/refresh', expect.anything())
  })

  it('on a successful refresh, stores the new access token and retries the original request with the new Authorization header', async () => {
    mockInstance.post.mockResolvedValueOnce({ accessToken: 'fresh-access' })
    mockInstance.mockResolvedValueOnce({ ok: true })

    const original = { url: '/appointments', headers: {} }
    const result = await errorHandler({ config: original, response: { status: 401, data: {} } })

    expect(apiClientModule.getTokens()).toEqual({ accessToken: 'fresh-access' })
    expect(original.headers.Authorization).toBe('Bearer fresh-access')
    expect(mockInstance).toHaveBeenCalledWith(original)
    expect(result).toEqual({ ok: true })
  })

  it('marks the retried request so a SECOND 401 on it does not loop back into another refresh attempt', async () => {
    mockInstance.post.mockResolvedValueOnce({ accessToken: 'fresh-access' })
    mockInstance.mockResolvedValueOnce({ ok: true })

    const original = { url: '/appointments', headers: {} }
    await errorHandler({ config: original, response: { status: 401, data: {} } })

    expect(original._retry).toBe(true)
  })

  it('when the refresh call itself fails, clears tokens and fires the unauthorized handler', async () => {
    const onUnauthorized = vi.fn()
    apiClientModule.registerUnauthorizedHandler(onUnauthorized)
    apiClientModule.setTokens({ accessToken: 'stale' })
    mockInstance.post.mockRejectedValueOnce({ response: { data: { error: { code: 'INVALID_REFRESH_TOKEN', message: 'nope' } } } })

    const original = { url: '/appointments', headers: {} }
    await expect(errorHandler({ config: original, response: { status: 401, data: {} } })).rejects.toThrow('nope')

    expect(apiClientModule.getTokens()).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('a 401 on /auth/refresh itself never triggers another refresh attempt (would loop forever)', async () => {
    const onUnauthorized = vi.fn()
    apiClientModule.registerUnauthorizedHandler(onUnauthorized)

    const original = { url: '/auth/refresh', headers: {} }
    await expect(errorHandler({ config: original, response: { status: 401, data: {} } })).rejects.toThrow()

    expect(mockInstance.post).not.toHaveBeenCalledWith('/auth/refresh')
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('concurrent 401s from different requests de-dupe into a single /auth/refresh call', async () => {
    let resolveRefresh
    mockInstance.post.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve
      })
    )
    mockInstance.mockResolvedValue({ ok: true })

    const originalA = { url: '/appointments', headers: {} }
    const originalB = { url: '/payments', headers: {} }

    const pA = errorHandler({ config: originalA, response: { status: 401, data: {} } })
    const pB = errorHandler({ config: originalB, response: { status: 401, data: {} } })

    resolveRefresh({ accessToken: 'fresh-access' })
    await Promise.all([pA, pB])

    expect(mockInstance.post).toHaveBeenCalledTimes(1)
  })
})
