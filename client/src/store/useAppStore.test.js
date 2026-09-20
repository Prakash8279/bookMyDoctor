// Unit tests for the Zustand store itself. Per src/integration/login-flow.test.jsx, the only
// network boundary is src/lib/apiClient.js's default-exported client (get/post/patch/put/delete)
// plus its named token helpers — every store action goes through that one module, so mocking it
// here lets the real store logic (branching, merging, guard conditions, session resets) run
// unmocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  getTokens: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  registerUnauthorizedHandler: vi.fn(),
}))

import apiClient, { getTokens, setTokens, clearTokens, registerUnauthorizedHandler } from '../lib/apiClient'
import { useAppStore, getLocalData } from './useAppStore'

// Snapshot of the store's state exactly as it is right after module load (before any test has
// touched it) — used to fully reset the real, singleton store between tests without mocking it.
const initialStoreState = useAppStore.getState()

// The store registers its unauthorized handler once, at module-load time — capture the actual
// callback reference now (before any vi.clearAllMocks() wipes registerUnauthorizedHandler's call
// log) so later tests can invoke it directly.
const unauthorizedHandler = registerUnauthorizedHandler.mock.calls[0][0]

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState(initialStoreState, true)
  vi.clearAllMocks()
  getTokens.mockReturnValue(null)
})

afterEach(() => {
  localStorage.clear()
})

describe('initial state', () => {
  it('starts signed out with an unverified session and the default data shape', () => {
    const state = useAppStore.getState()
    expect(state.currentUser).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.sessionVerified).toBe(false)
    expect(state.authLoading).toBe(false)
    expect(state.dataLoading).toBe(false)
    expect(state.dataLoaded).toBe(false)
    expect(state.bookingQueueInfo).toBeNull()
    expect(state.drafts).toEqual({})
    // Every collection key defaults to an empty array (never undefined) so unconditional
    // `data.xxx.map()` call sites never crash before the first fetch resolves.
    expect(state.data.cities).toEqual([])
    expect(state.data.doctors).toEqual([])
    expect(state.data.appointments).toEqual([])
    expect(state.data.dashboardStats).toBeNull()
  })

  it('exposes data via the legacy getLocalData() export', () => {
    expect(getLocalData()).toBe(useAppStore.getState().data)
  })
})

describe('login / register / registerDoctor', () => {
  const PATIENT = { id: 'u1', name: 'Asha Mehta', email: 'asha@example.com', role: 'patient' }

  it('login(): sets tokens, currentUser, and marks the session verified', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/auth/login') return Promise.resolve({ accessToken: 'at1', refreshToken: 'rt1' })
      return Promise.resolve({})
    })
    apiClient.get.mockImplementation((url) => (url === '/me' ? Promise.resolve(PATIENT) : Promise.resolve([])))

    const me = await useAppStore.getState().login('asha@example.com', 'secret')

    expect(me).toEqual(PATIENT)
    expect(apiClient.post).toHaveBeenCalledWith('/auth/login', { email: 'asha@example.com', password: 'secret' })
    expect(setTokens).toHaveBeenCalledWith({ accessToken: 'at1', refreshToken: 'rt1' })
    const state = useAppStore.getState()
    expect(state.currentUser).toEqual(PATIENT)
    expect(state.isAuthenticated).toBe(true)
    expect(state.sessionVerified).toBe(true)
    expect(state.authLoading).toBe(false)
    // Post-login bulk load ran for a patient — a role-specific endpoint was hit.
    expect(apiClient.get).toHaveBeenCalledWith('/family-members', expect.anything())
  })

  it('login(): resets authLoading and rethrows on failure, without touching session state', async () => {
    const boom = new Error('Invalid credentials')
    apiClient.post.mockRejectedValue(boom)

    await expect(useAppStore.getState().login('asha@example.com', 'wrong')).rejects.toThrow('Invalid credentials')

    const state = useAppStore.getState()
    expect(state.authLoading).toBe(false)
    expect(state.currentUser).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(setTokens).not.toHaveBeenCalled()
  })

  it('register(): forces role to "patient" regardless of what was passed', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/auth/register') return Promise.resolve({ accessToken: 'at', refreshToken: 'rt' })
      return Promise.resolve({})
    })
    apiClient.get.mockImplementation((url) => (url === '/me' ? Promise.resolve(PATIENT) : Promise.resolve([])))

    await useAppStore.getState().register({ email: 'asha@example.com', password: 'secret', role: 'admin' })

    expect(apiClient.post).toHaveBeenCalledWith('/auth/register', {
      email: 'asha@example.com',
      password: 'secret',
      role: 'patient',
    })
  })

  it('registerDoctor(): posts to /doctors/register and signs the new doctor in', async () => {
    const DOCTOR = { id: 'd1', name: 'Dr. Rao', role: 'doctor' }
    apiClient.post.mockImplementation((url) => {
      if (url === '/doctors/register') return Promise.resolve({ accessToken: 'at', refreshToken: 'rt' })
      return Promise.resolve({})
    })
    apiClient.get.mockImplementation((url) => (url === '/me' ? Promise.resolve(DOCTOR) : Promise.resolve([])))

    const me = await useAppStore.getState().registerDoctor({ email: 'rao@example.com' })

    expect(me).toEqual(DOCTOR)
    expect(useAppStore.getState().isAuthenticated).toBe(true)
  })
})

describe('forgotPassword / resetPassword', () => {
  it('forgotPassword(): posts the email and always resolves true', async () => {
    apiClient.post.mockResolvedValue({})
    await expect(useAppStore.getState().forgotPassword('a@b.com')).resolves.toBe(true)
    expect(apiClient.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'a@b.com' })
  })

  it('resetPassword(): posts the token + new password and resolves true', async () => {
    apiClient.post.mockResolvedValue({})
    await expect(useAppStore.getState().resetPassword('tok123', 'newpass')).resolves.toBe(true)
    expect(apiClient.post).toHaveBeenCalledWith('/auth/reset-password', { token: 'tok123', newPassword: 'newpass' })
  })
})

describe('logout', () => {
  it('clears tokens and role-scoped data but keeps public directory data and dataLoaded', async () => {
    getTokens.mockReturnValue({ accessToken: 'at', refreshToken: 'rt' })
    apiClient.post.mockResolvedValue({})
    useAppStore.setState({
      currentUser: { id: 'u1', role: 'patient' },
      isAuthenticated: true,
      dataLoaded: true,
      data: {
        ...useAppStore.getState().data,
        cities: [{ id: 'c1' }], // public — must survive
        doctors: [{ id: 'd1' }], // public — must survive
        appointments: [{ id: 'a1' }], // private — must be wiped
        dashboardStats: { total: 5 }, // private — must be wiped
      },
    })

    await useAppStore.getState().logout()

    expect(apiClient.post).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'rt' })
    expect(clearTokens).toHaveBeenCalled()
    const state = useAppStore.getState()
    expect(state.currentUser).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.dataLoaded).toBe(true)
    expect(state.data.cities).toEqual([{ id: 'c1' }])
    expect(state.data.doctors).toEqual([{ id: 'd1' }])
    expect(state.data.appointments).toEqual([])
    expect(state.data.dashboardStats).toBeNull()
  })

  it('does not call /auth/logout when there is no refresh token, but still clears local session', async () => {
    getTokens.mockReturnValue(null)
    useAppStore.setState({ currentUser: { id: 'u1' }, isAuthenticated: true })

    await useAppStore.getState().logout()

    expect(apiClient.post).not.toHaveBeenCalled()
    expect(clearTokens).toHaveBeenCalled()
    expect(useAppStore.getState().isAuthenticated).toBe(false)
  })

  it('clears the local session even when the best-effort server logout call fails', async () => {
    getTokens.mockReturnValue({ accessToken: 'at', refreshToken: 'rt' })
    apiClient.post.mockRejectedValue(new Error('network down'))
    useAppStore.setState({ currentUser: { id: 'u1' }, isAuthenticated: true })

    await useAppStore.getState().logout()

    expect(clearTokens).toHaveBeenCalled()
    expect(useAppStore.getState().isAuthenticated).toBe(false)
  })
})

describe('restoreSession', () => {
  it('marks the session verified without calling the API when there is no stored token', async () => {
    getTokens.mockReturnValue(null)

    await useAppStore.getState().restoreSession()

    expect(apiClient.get).not.toHaveBeenCalled()
    expect(useAppStore.getState().sessionVerified).toBe(true)
  })

  it('restores the session and runs both bulk loads on a valid token', async () => {
    getTokens.mockReturnValue({ accessToken: 'at', refreshToken: 'rt' })
    const ADMIN = { id: 'a1', role: 'admin' }
    apiClient.get.mockImplementation((url) => (url === '/me' ? Promise.resolve(ADMIN) : Promise.resolve([])))

    await useAppStore.getState().restoreSession()

    const state = useAppStore.getState()
    expect(state.currentUser).toEqual(ADMIN)
    expect(state.isAuthenticated).toBe(true)
    expect(state.sessionVerified).toBe(true)
    // loadPublicDirectory() ran (public endpoint hit)...
    expect(apiClient.get).toHaveBeenCalledWith('/geography/cities', expect.anything())
    // ...and loadUserData() ran too (admin-only endpoint hit) — a boot-time restore must run
    // both, not just one (see the FIX comment above restoreSession in the source).
    expect(apiClient.get).toHaveBeenCalledWith('/admin/dashboard-stats')
  })

  it('clears the session when the stored token is no longer valid', async () => {
    getTokens.mockReturnValue({ accessToken: 'bad', refreshToken: 'bad' })
    apiClient.get.mockRejectedValue(new Error('401'))

    await useAppStore.getState().restoreSession()

    expect(clearTokens).toHaveBeenCalled()
    const state = useAppStore.getState()
    expect(state.currentUser).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.sessionVerified).toBe(true)
    expect(state.authLoading).toBe(false)
  })
})

describe('loadUserData', () => {
  it('is a no-op when nobody is signed in', async () => {
    await useAppStore.getState().loadUserData()
    expect(apiClient.get).not.toHaveBeenCalled()
    expect(useAppStore.getState().dataLoading).toBe(false)
  })

  it('fetches the receptionist-specific set of resources for a receptionist', async () => {
    apiClient.get.mockResolvedValue([])
    useAppStore.setState({ currentUser: { id: 'r1', role: 'receptionist' } })

    await useAppStore.getState().loadUserData()

    expect(apiClient.get).toHaveBeenCalledWith('/appointments', expect.anything())
    expect(apiClient.get).toHaveBeenCalledWith('/queue', expect.anything())
    expect(apiClient.get).toHaveBeenCalledWith('/payments', expect.anything())
    expect(apiClient.get).toHaveBeenCalledWith('/notifications', expect.anything())
    // Receptionists don't get medical records (clinical data is excluded for that role).
    expect(apiClient.get).not.toHaveBeenCalledWith('/medical-records', expect.anything())
    expect(useAppStore.getState().dataLoaded).toBe(true)
    expect(useAppStore.getState().dataLoading).toBe(false)
  })

  it('fetches /platform-charges for a patient too — the Booking page price preview reads data.platformCharges', async () => {
    // Regression test: this endpoint used to be fetched here only for doctor/admin/superadmin,
    // so a patient's data.platformCharges stayed null for their whole session and
    // PatientPages.jsx#Booking's Consultation/Convenience fee/Transaction charge preview (and the
    // emergency-booking surcharge) always showed 0, no matter the real configured values. GET
    // /platform-charges is authenticate + any role, so a patient was always allowed to call it —
    // it just needed to be added to this list.
    apiClient.get.mockResolvedValue([])
    useAppStore.setState({ currentUser: { id: 'p1', role: 'patient' } })

    await useAppStore.getState().loadUserData()

    expect(apiClient.get).toHaveBeenCalledWith('/platform-charges')
  })

  it('logs but does not throw when some requests fail', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    apiClient.get.mockImplementation((url) => (url === '/payments' ? Promise.reject(new Error('boom')) : Promise.resolve([])))
    useAppStore.setState({ currentUser: { id: 'p1', role: 'patient' } })

    await expect(useAppStore.getState().loadUserData()).resolves.toBeUndefined()

    expect(useAppStore.getState().dataLoading).toBe(false)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('unauthorized handler (registered with apiClient at module load)', () => {
  it('is a no-op when nobody is currently signed in', () => {
    useAppStore.setState({ currentUser: null, isAuthenticated: false })
    const before = useAppStore.getState()

    unauthorizedHandler()

    expect(useAppStore.getState()).toBe(before)
  })

  it('force-clears the session (like logout, minus the server call) when a session was active', () => {
    useAppStore.setState({
      currentUser: { id: 'u1' },
      isAuthenticated: true,
      data: { ...useAppStore.getState().data, cities: [{ id: 'c1' }], appointments: [{ id: 'a1' }] },
    })

    unauthorizedHandler()

    const state = useAppStore.getState()
    expect(state.currentUser).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.sessionVerified).toBe(true)
    expect(state.data.cities).toEqual([{ id: 'c1' }])
    expect(state.data.appointments).toEqual([])
  })
})

describe('/me profile actions', () => {
  it('updateProfile(): patches /me and replaces currentUser', async () => {
    const updated = { id: 'u1', name: 'New Name' }
    apiClient.patch.mockResolvedValue(updated)

    const result = await useAppStore.getState().updateProfile({ name: 'New Name' })

    expect(apiClient.patch).toHaveBeenCalledWith('/me', { name: 'New Name' })
    expect(result).toEqual(updated)
    expect(useAppStore.getState().currentUser).toEqual(updated)
  })

  it('uploadPhoto(): merges the returned URL into currentUser without a fresh /me fetch', async () => {
    useAppStore.setState({ currentUser: { id: 'u1', name: 'Asha', photoUrl: null } })
    apiClient.post.mockResolvedValue({ url: 'https://cdn.example.com/photo.png' })

    const url = await useAppStore.getState().uploadPhoto(new Blob())

    expect(url).toBe('https://cdn.example.com/photo.png')
    expect(apiClient.post).toHaveBeenCalledWith('/media/photo', expect.any(FormData))
    expect(useAppStore.getState().currentUser).toEqual({
      id: 'u1',
      name: 'Asha',
      photoUrl: 'https://cdn.example.com/photo.png',
    })
  })

  it('uploadPhoto(): no-ops the currentUser merge when nobody is signed in', async () => {
    useAppStore.setState({ currentUser: null })
    apiClient.post.mockResolvedValue({ url: 'https://cdn.example.com/photo.png' })

    await useAppStore.getState().uploadPhoto(new Blob())

    expect(useAppStore.getState().currentUser).toBeNull()
  })

  it('uploadClinicQr(): merges the returned URL into the cached clinic list', async () => {
    useAppStore.setState({ data: { ...useAppStore.getState().data, clinics: [{ id: 'clinic-1', name: 'Downtown' }] } })
    apiClient.post.mockResolvedValue({ url: 'https://cdn.example.com/qr.png' })

    await useAppStore.getState().uploadClinicQr('clinic-1', new Blob())

    expect(useAppStore.getState().data.clinics).toEqual([
      { id: 'clinic-1', name: 'Downtown', paymentQrUrl: 'https://cdn.example.com/qr.png' },
    ])
  })

  // COMPLETENESS FIX (doctor panel profile section audit): POST /media/document was a real,
  // working, doctor-only backend endpoint (uploads.service.js#saveVerificationDocument) with no
  // caller anywhere in the app — added here alongside the new StaffPages.jsx upload UI. The
  // server only echoes back {url} (it appends server-side, never the full updated array), so
  // this action reconstructs the same {name, url, uploadedAt} shape the server itself stores.
  it('uploadVerificationDocument(): appends a {name, url, uploadedAt} entry to the current profile', async () => {
    useAppStore.setState({ currentUser: { id: 'doc-1', profile: { verificationDocuments: [{ name: 'Old doc', url: 'https://cdn.example.com/old.pdf' }] } } })
    apiClient.post.mockResolvedValue({ url: 'https://cdn.example.com/new.pdf' })

    await useAppStore.getState().uploadVerificationDocument(new Blob(), 'MBBS certificate')

    expect(apiClient.post).toHaveBeenCalledWith('/media/document', expect.any(FormData))
    const docs = useAppStore.getState().currentUser.profile.verificationDocuments
    expect(docs).toHaveLength(2)
    expect(docs[1]).toMatchObject({ name: 'MBBS certificate', url: 'https://cdn.example.com/new.pdf' })
    expect(typeof docs[1].uploadedAt).toBe('string')
  })

  it('uploadVerificationDocument(): falls back to an auto-numbered label when no name is given', async () => {
    useAppStore.setState({ currentUser: { id: 'doc-1', profile: { verificationDocuments: [] } } })
    apiClient.post.mockResolvedValue({ url: 'https://cdn.example.com/new.pdf' })

    await useAppStore.getState().uploadVerificationDocument(new Blob(), '')

    expect(useAppStore.getState().currentUser.profile.verificationDocuments[0].name).toBe('Document 1')
  })

  it('uploadVerificationDocument(): no-ops the profile merge when there is no signed-in doctor profile', async () => {
    useAppStore.setState({ currentUser: null })
    apiClient.post.mockResolvedValue({ url: 'https://cdn.example.com/new.pdf' })

    await useAppStore.getState().uploadVerificationDocument(new Blob(), 'X')

    expect(useAppStore.getState().currentUser).toBeNull()
  })

  it('changePassword(): forces a local logout since the server revokes all refresh tokens', async () => {
    apiClient.patch.mockResolvedValue({});
    useAppStore.setState({
      currentUser: { id: 'u1' },
      isAuthenticated: true,
      data: { ...useAppStore.getState().data, appointments: [{ id: 'a1' }] },
    })

    const result = await useAppStore.getState().changePassword('old', 'new', 'new')

    expect(apiClient.patch).toHaveBeenCalledWith('/me/password', {
      currentPassword: 'old',
      newPassword: 'new',
      confirmPassword: 'new',
    })
    expect(clearTokens).toHaveBeenCalled()
    expect(result).toBe(true)
    const state = useAppStore.getState()
    expect(state.currentUser).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.data.appointments).toEqual([])
  })
})

describe('geography', () => {
  it('fetchCities(): strips undefined/null/empty-string filter values before calling the API', async () => {
    apiClient.get.mockResolvedValue([{ id: 'c1' }])

    await useAppStore.getState().fetchCities({ state: 'MH', search: '', country: null, page: undefined })

    expect(apiClient.get).toHaveBeenCalledWith('/geography/cities', { params: { state: 'MH' } })
    expect(useAppStore.getState().data.cities).toEqual([{ id: 'c1' }])
  })

  it('addCity()/deleteCity(): append then remove by id', async () => {
    apiClient.post.mockResolvedValue({ id: 'c1', name: 'Pune' })
    await useAppStore.getState().addCity({ name: 'Pune' })
    expect(useAppStore.getState().data.cities).toEqual([{ id: 'c1', name: 'Pune' }])

    apiClient.delete.mockResolvedValue(undefined)
    await useAppStore.getState().deleteCity('c1')
    expect(useAppStore.getState().data.cities).toEqual([])
  })

  it('addArea(): posts under the given cityId (areas are never nested in state)', async () => {
    apiClient.post.mockResolvedValue({ id: 'ar1', name: 'Kothrud' })

    await useAppStore.getState().addArea('city-9', { name: 'Kothrud' })

    expect(apiClient.post).toHaveBeenCalledWith('/geography/cities/city-9/areas', { name: 'Kothrud' })
    expect(useAppStore.getState().data.areas).toEqual([{ id: 'ar1', name: 'Kothrud' }])
  })

  it('deleteSpecialization(): removes by id from the cached list', async () => {
    useAppStore.setState({
      data: { ...useAppStore.getState().data, specializations: [{ id: 's1' }, { id: 's2' }] },
    })
    apiClient.delete.mockResolvedValue(undefined)

    await useAppStore.getState().deleteSpecialization('s1')

    expect(useAppStore.getState().data.specializations).toEqual([{ id: 's2' }])
  })
})

describe('doctors', () => {
  it('getDoctor(): upserts — appends when new, merges when already cached', async () => {
    apiClient.get.mockResolvedValue({ id: 'd1', name: 'Dr. Rao' })
    await useAppStore.getState().getDoctor('d1')
    expect(useAppStore.getState().data.doctors).toEqual([{ id: 'd1', name: 'Dr. Rao' }])

    apiClient.get.mockResolvedValue({ id: 'd1', consultationFee: 500 })
    await useAppStore.getState().getDoctor('d1')
    expect(useAppStore.getState().data.doctors).toEqual([{ id: 'd1', name: 'Dr. Rao', consultationFee: 500 }])
  })
})

describe('clinics', () => {
  const clinicState = (clinic) => ({
    data: { ...useAppStore.getState().data, clinics: [clinic] },
  })

  it('toggleClinicEmergency(): throws when the clinic is not in the local cache', async () => {
    await expect(useAppStore.getState().toggleClinicEmergency('missing')).rejects.toThrow(
      'Clinic not found in local cache — fetch it first.'
    )
    expect(apiClient.patch).not.toHaveBeenCalled()
  })

  it('toggleClinicEmergency(): flips the cached emergencyAvailable flag via updateClinic', async () => {
    useAppStore.setState(clinicState({ id: 'cl1', emergencyAvailable: false }))
    apiClient.patch.mockResolvedValue({ id: 'cl1', emergencyAvailable: true })

    await useAppStore.getState().toggleClinicEmergency('cl1')

    expect(apiClient.patch).toHaveBeenCalledWith('/clinics/cl1', { emergencyAvailable: true })
  })

  it('toggleClinicStatus(): re-enables via approveClinic when currently disabled', async () => {
    useAppStore.setState(clinicState({ id: 'cl1', approvalStatus: 'disabled' }))
    apiClient.patch.mockResolvedValue({ id: 'cl1', approvalStatus: 'approved' })

    await useAppStore.getState().toggleClinicStatus('cl1')

    expect(apiClient.patch).toHaveBeenCalledWith('/clinics/cl1/approve')
  })

  it('toggleClinicStatus(): disables via rejectClinic when currently approved', async () => {
    useAppStore.setState(clinicState({ id: 'cl1', approvalStatus: 'approved' }))
    apiClient.patch.mockResolvedValue({ id: 'cl1', approvalStatus: 'disabled' })

    await useAppStore.getState().toggleClinicStatus('cl1')

    expect(apiClient.patch).toHaveBeenCalledWith('/clinics/cl1/reject', { rejectionReason: 'Disabled by admin.' })
  })

  it('assignDoctorToClinic(): still resolves even when the follow-up refetch fails', async () => {
    apiClient.post.mockResolvedValue({ ok: true })
    apiClient.get.mockRejectedValue(new Error('refetch failed'))

    await expect(useAppStore.getState().assignDoctorToClinic('cl1', { doctorUserId: 'd1' })).resolves.toEqual({
      ok: true,
    })
  })

  describe('clinic hours + closures (merged into data.opdEntries by kind)', () => {
    it('keeps hours and closures separate even when they share the same id', async () => {
      apiClient.get.mockImplementation((url) => {
        if (url === '/clinics/cl1/hours') return Promise.resolve([{ id: 'row-1', weekday: 1 }])
        if (url === '/clinics/cl1/closures') return Promise.resolve([{ id: 'row-1', date: '2026-01-01' }])
        return Promise.resolve([])
      })

      await useAppStore.getState().fetchClinicHours('cl1')
      await useAppStore.getState().fetchClinicClosures('cl1')

      const entries = useAppStore.getState().data.opdEntries
      expect(entries).toHaveLength(2)
      expect(entries).toContainEqual({ id: 'row-1', weekday: 1, kind: 'hours' })
      expect(entries).toContainEqual({ id: 'row-1', date: '2026-01-01', kind: 'closure' })
    })

    it('re-fetching hours replaces only "hours" rows, leaving closures untouched', async () => {
      useAppStore.setState({
        data: {
          ...useAppStore.getState().data,
          opdEntries: [
            { id: 'h1', kind: 'hours', weekday: 1 },
            { id: 'c1', kind: 'closure', date: '2026-01-01' },
          ],
        },
      })
      apiClient.get.mockResolvedValue([{ id: 'h2', weekday: 2 }])

      await useAppStore.getState().fetchClinicHours('cl1')

      const entries = useAppStore.getState().data.opdEntries
      expect(entries).toContainEqual({ id: 'c1', kind: 'closure', date: '2026-01-01' })
      expect(entries).toContainEqual({ id: 'h2', kind: 'hours', weekday: 2 })
      expect(entries.find((e) => e.id === 'h1')).toBeUndefined()
    })

    it('deleteClinicHours() only removes the "hours" row, not a closure with the same id', async () => {
      useAppStore.setState({
        data: {
          ...useAppStore.getState().data,
          opdEntries: [
            { id: 'shared-id', kind: 'hours' },
            { id: 'shared-id', kind: 'closure' },
          ],
        },
      })
      apiClient.delete.mockResolvedValue(undefined)

      await useAppStore.getState().deleteClinicHours('cl1', 'shared-id')

      expect(useAppStore.getState().data.opdEntries).toEqual([{ id: 'shared-id', kind: 'closure' }])
    })

    it('upsertClinicHours(): updates the existing row in place instead of duplicating it', async () => {
      useAppStore.setState({
        data: { ...useAppStore.getState().data, opdEntries: [{ id: 'h1', kind: 'hours', weekday: 1, start: '09:00' }] },
      })
      apiClient.put.mockResolvedValue({ id: 'h1', weekday: 1, start: '10:00' })

      await useAppStore.getState().upsertClinicHours('cl1', { weekday: 1, start: '10:00' })

      expect(useAppStore.getState().data.opdEntries).toEqual([{ id: 'h1', kind: 'hours', weekday: 1, start: '10:00' }])
    })
  })
})

describe('appointments — createAppointment async booking poll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the confirmed appointment and clears bookingQueueInfo', async () => {
    apiClient.post.mockResolvedValue({ jobId: 'job-1', status: 'queued' })
    apiClient.get.mockResolvedValue({ status: 'confirmed', appointment: { id: 'appt-1' } })

    const promise = useAppStore.getState().createAppointment({ doctorId: 'd1' })
    await vi.advanceTimersByTimeAsync(1700)
    const appointment = await promise

    expect(appointment).toEqual({ id: 'appt-1' })
    expect(apiClient.get).toHaveBeenCalledWith('/appointments/booking-status/job-1')
    const state = useAppStore.getState()
    expect(state.bookingQueueInfo).toBeNull()
    expect(state.data.appointments).toEqual([{ id: 'appt-1' }])
  })

  it('rejects with the server-provided message and code on a failed booking', async () => {
    apiClient.post.mockResolvedValue({ jobId: 'job-2', status: 'queued' })
    apiClient.get.mockResolvedValue({ status: 'failed', error: { message: 'Slot taken', code: 'SLOT_TAKEN' } })

    const promise = useAppStore.getState().createAppointment({ doctorId: 'd1' })
    // Attach the rejection assertion before advancing timers so vitest's fake-timer microtask
    // flush never sees this rejection as briefly unhandled.
    const assertion = expect(promise).rejects.toMatchObject({ message: 'Slot taken', code: 'SLOT_TAKEN' })
    await vi.advanceTimersByTimeAsync(1700)
    await assertion
    expect(useAppStore.getState().bookingQueueInfo).toBeNull()
  })

  it('surfaces live queue position while queued, then times out after 40s of no resolution', async () => {
    apiClient.post.mockResolvedValue({ jobId: 'job-3', status: 'queued' })
    apiClient.get.mockResolvedValue({ status: 'queued', aheadOfYou: 3, etaSeconds: 90 })

    const promise = useAppStore.getState().createAppointment({ doctorId: 'd1' })
    await vi.advanceTimersByTimeAsync(1700)

    expect(useAppStore.getState().bookingQueueInfo).toEqual({ aheadOfYou: 3, etaSeconds: 90, queuePosition: 1 })

    // Same reasoning as the failed-booking test above: attach before advancing.
    const assertion = expect(promise).rejects.toMatchObject({ code: 'BOOKING_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(45000)
    await assertion
    expect(useAppStore.getState().bookingQueueInfo).toBeNull()
  })

  // LOAD-REVIEW FIX (audit finding: "booking-status polling has no backoff") — see
  // useAppStore.js#createAppointment's comment for the rationale (1.5s → 2.25s → 3.375s → ...,
  // capped at 5s, instead of a fixed 1.7s cadence for the whole 40s budget).
  it('backs off the poll interval (capped at 5s) instead of polling at a fixed fast rate the whole time', async () => {
    apiClient.post.mockResolvedValue({ jobId: 'job-4', status: 'queued' })
    apiClient.get.mockResolvedValue({ status: 'queued' })

    const promise = useAppStore.getState().createAppointment({ doctorId: 'd1' })

    await vi.advanceTimersByTimeAsync(1500)
    expect(apiClient.get).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2250)
    expect(apiClient.get).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(3375)
    expect(apiClient.get).toHaveBeenCalledTimes(3)

    // The 4th-and-onward interval is capped at 5s, not still growing (3.375 * 1.5 = 5.0625,
    // which would exceed the cap).
    await vi.advanceTimersByTimeAsync(5000)
    expect(apiClient.get).toHaveBeenCalledTimes(4)

    // Attach the rejection assertion before advancing past the 40s budget, same reasoning as the
    // other tests in this suite — avoids vitest ever seeing a briefly-unhandled rejection.
    const assertion = expect(promise).rejects.toMatchObject({ code: 'BOOKING_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(40000)
    await assertion
  })

  it('cancelAppointment(): delegates to updateAppointmentStatus with "cancelled"', async () => {
    apiClient.patch.mockResolvedValue({ id: 'appt-1', status: 'cancelled' })

    await useAppStore.getState().cancelAppointment('appt-1')

    expect(apiClient.patch).toHaveBeenCalledWith('/appointments/appt-1/status', { status: 'cancelled' })
  })
})

describe('queue', () => {
  it('fetchMyQueueStatus(): returns the single-token status without merging it into queueTokens', async () => {
    apiClient.get.mockResolvedValue({ queuePosition: 2 })

    const result = await useAppStore.getState().fetchMyQueueStatus('appt-1')

    expect(apiClient.get).toHaveBeenCalledWith('/queue/mine/appt-1')
    expect(result).toEqual({ queuePosition: 2 })
    expect(useAppStore.getState().data.queueTokens).toEqual([])
  })
})

describe('notifications', () => {
  it('markNotificationRead(): matches by the recipient row id, not notificationId', async () => {
    useAppStore.setState({
      data: {
        ...useAppStore.getState().data,
        notifications: [
          { id: 'recipient-1', notificationId: 'notif-1', readAt: null },
          { id: 'recipient-2', notificationId: 'notif-1', readAt: null },
        ],
      },
    })
    apiClient.patch.mockResolvedValue({ readAt: '2026-09-12T00:00:00Z' })

    await useAppStore.getState().markNotificationRead('recipient-1')

    const notifications = useAppStore.getState().data.notifications
    expect(notifications.find((n) => n.id === 'recipient-1').readAt).toBe('2026-09-12T00:00:00Z')
    expect(notifications.find((n) => n.id === 'recipient-2').readAt).toBeNull()
  })

  it('markAllNotificationsRead(): marks unread rows read and leaves already-read timestamps alone', async () => {
    useAppStore.setState({
      data: {
        ...useAppStore.getState().data,
        notifications: [
          { id: 'n1', readAt: null },
          { id: 'n2', readAt: '2026-01-01T00:00:00Z' },
        ],
      },
    })
    apiClient.patch.mockResolvedValue({})

    await useAppStore.getState().markAllNotificationsRead()

    const notifications = useAppStore.getState().data.notifications
    expect(notifications.find((n) => n.id === 'n1').readAt).toBeTruthy()
    expect(notifications.find((n) => n.id === 'n2').readAt).toBe('2026-01-01T00:00:00Z')
  })
})

describe('payments', () => {
  it('verifyRazorpayPayment(): prepends the payment and replaces the matching appointment with the authoritative one', async () => {
    useAppStore.setState({
      data: {
        ...useAppStore.getState().data,
        appointments: [{ id: 'appt-1', status: 'pending_payment' }, { id: 'appt-2', status: 'upcoming' }],
      },
    })
    apiClient.post.mockResolvedValue({
      payment: { id: 'pay-1', amount: 500 },
      appointment: { id: 'appt-1', status: 'upcoming', tokenNumber: 12 },
    })

    const result = await useAppStore.getState().verifyRazorpayPayment({ orderId: 'order-1' })

    expect(result.payment).toEqual({ id: 'pay-1', amount: 500 })
    const state = useAppStore.getState()
    expect(state.data.payments).toEqual([{ id: 'pay-1', amount: 500 }])
    expect(state.data.appointments).toEqual([
      { id: 'appt-1', status: 'upcoming', tokenNumber: 12 },
      { id: 'appt-2', status: 'upcoming' },
    ])
  })
})

describe('local-only drafts', () => {
  it('saveDraft(): stores values under the given key without touching other drafts', () => {
    useAppStore.getState().saveDraft('booking-form', { doctorId: 'd1' })
    useAppStore.getState().saveDraft('review-form', { rating: 5 })

    expect(useAppStore.getState().drafts).toEqual({
      'booking-form': { doctorId: 'd1' },
      'review-form': { rating: 5 },
    })
  })
})

describe('admin', () => {
  it('updatePatientStatus(): patches the account-status endpoint and merges the new status locally', async () => {
    useAppStore.setState({
      data: { ...useAppStore.getState().data, patients: [{ id: 'p1', status: 'active' }] },
    })
    apiClient.patch.mockResolvedValue({})

    const result = await useAppStore.getState().updatePatientStatus('p1', 'disabled')

    expect(apiClient.patch).toHaveBeenCalledWith('/admin/patients/p1/status', { status: 'disabled' })
    expect(result).toEqual({ id: 'p1', status: 'disabled' })
    expect(useAppStore.getState().data.patients).toEqual([{ id: 'p1', status: 'disabled' }])
  })
})
