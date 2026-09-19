import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import apiClient, { getTokens, setTokens, clearTokens, registerUnauthorizedHandler } from '../lib/apiClient'

// ---------------------------------------------------------------------------
// Real-backend store. Rewritten per /tmp/connect/integration_plan.md (§3).
// Every action below is a plain async function that calls `apiClient`, updates
// `data`/`currentUser` via `set`, and re-throws on failure so call sites can
// try/catch and surface an inline error — nothing here swallows errors.
// ---------------------------------------------------------------------------

// Strip undefined/null/'' entries from a filter object before handing it to
// axios as `params` — keeps query strings clean (`?status=` never sent).
const cleanParams = (params = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))

// Merge-or-append a fetched item into a cached list, keyed by `id`.
const upsertById = (list = [], item) => {
  if (!item || item.id == null) return list
  const idx = list.findIndex((row) => row.id === item.id)
  if (idx === -1) return [...list, item]
  const next = [...list]
  next[idx] = { ...next[idx], ...item }
  return next
}

// `opdEntries` is a client-side merged view of clinic hours (weekly recurring)
// and clinic closures (one-off dates) — each real row gets a `kind` tag so
// save/delete route to the correct endpoint pair (integration plan §1.5).
const replaceOpdEntriesOfKind = (existing = [], freshRows, kind) => [
  ...existing.filter((row) => row.kind !== kind),
  ...freshRows.map((row) => ({ ...row, kind })),
]
const upsertOpdEntry = (list = [], entry) => {
  const idx = list.findIndex((row) => row.id === entry.id && row.kind === entry.kind)
  if (idx === -1) return [...list, entry]
  const next = [...list]
  next[idx] = entry
  return next
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Default `data` shape — integration plan §5. Every key is always present
// (never undefined) so page code doing unconditional `data.xxx.map()` never
// crashes before the first fetch resolves.
// ---------------------------------------------------------------------------
const DEFAULT_DATA_SHAPE = {
  // Reference/geography
  cities: [],
  areas: [], // flat top-level resource — NOT nested under a city (plan §1.3)
  specializations: [],

  // Directory
  doctors: [],
  clinics: [],

  // Patient-owned
  familyMembers: [],
  appointments: [],
  records: [], // medical records (kept as `records` to match the mock's key)
  payments: [],
  patients: [], // admin's GET /admin/patients — added late (fetchPatients pre-dates this shape entry)

  // Staff/clinic operations
  queueTokens: [], // sourced from GET /queue — see plan §1.9 for row shape
  receptionists: [],
  opdEntries: [], // merged clinic hours + closures, each row carries `kind`

  // Reviews / notifications / support
  reviews: [],
  notifications: [],
  broadcasts: [], // admin broadcast history (GET /notifications/broadcast)
  complaints: [],
  contactRequests: [],

  // Admin
  activity: [], // GET /admin/activity-log
  dashboardStats: null, // GET /admin/dashboard-stats
  systemSettings: null, // GET /admin/system-settings
  bookingRules: null, // GET /admin/booking-rules
  platformCharges: null, // GET /platform-charges (masked or not, per role)

  // GENUINE GAPS — no real backend equivalent exists (plan §6). Keys are kept
  // so existing page code referencing them doesn't crash; they stay
  // permanently empty/null.
  pendingDoctors: [], // §6.1 — no admin list endpoint for pending/disabled doctors
  pendingClinics: [], // derive from data.clinics.filter(c => c.approvalStatus === 'pending') instead
  analytics: null, // §6.3 — no time-series endpoint exists anywhere
  checkedIns: [], // derive from data.appointments.filter(a => a.checkedInAt) instead
}

// Keys that are scoped to the signed-in user (or role) and must be cleared on
// logout / forced-logout. Public/reference data (cities, areas,
// specializations, doctors, clinics, reviews) survives a logout so a visitor
// can keep browsing the public site without a refetch.
const PRIVATE_DATA_KEYS = [
  'familyMembers',
  'appointments',
  'records',
  'payments',
  // FIX (scalability/correctness audit): fetchPatients() writes here, but this key was missing
  // from both DEFAULT_DATA_SHAPE and this list — the one collection in the store that didn't
  // follow the "role-scoped data is wiped on logout" rule every other entry here follows. Low
  // real-world exposure today (ManagePatients refetches on every mount before rendering), but a
  // stale admin's patient list surviving a logout/login-as-someone-else in the same tab is
  // exactly the class of bug this list exists to prevent.
  'patients',
  'queueTokens',
  'receptionists',
  'opdEntries',
  'notifications',
  'broadcasts',
  'complaints',
  'contactRequests',
  'activity',
  'dashboardStats',
  'systemSettings',
  'bookingRules',
  'platformCharges',
  'pendingDoctors',
  'pendingClinics',
  'analytics',
  'checkedIns',
]

const resetSessionData = (data) => {
  const next = { ...data }
  PRIVATE_DATA_KEYS.forEach((key) => {
    next[key] = Array.isArray(DEFAULT_DATA_SHAPE[key]) ? [] : DEFAULT_DATA_SHAPE[key] ?? null
  })
  return next
}

const initialState = {
  // ---- auth/session ----
  currentUser: null, // full GET /me response shape once loaded
  isAuthenticated: false,
  authLoading: false, // true during login/register/boot-time session restore
  // In-memory ONLY (never persisted — see partialize below). Starts false on
  // every fresh page load, even when currentUser/isAuthenticated rehydrate
  // from localStorage instantly. Flips true once this app load has confirmed
  // the session for real — either restoreSession()'s boot-time GET /me has
  // settled (success or failure), or a fresh login()/register() has
  // succeeded. Route guards must gate protected rendering on this, not on
  // the persisted isAuthenticated alone, so a stale/revoked session never
  // flashes protected UI before it's actually been verified.
  sessionVerified: false,

  // ---- bulk app data ----
  data: { ...DEFAULT_DATA_SHAPE },
  dataLoading: false, // true while a bulk load (public or post-login) is in flight
  dataLoaded: false, // true once the initial (public) bulk load has completed once
  // Live queue-position info for an in-flight createAppointment() poll —
  // { aheadOfYou, etaSeconds, queuePosition } while status is 'queued'/'processing',
  // null otherwise (before booking starts, and once confirmed/failed/timed out).
  bookingQueueInfo: null,

  // ---- local-only, no backend concept ----
  drafts: {},
}

export const useAppStore = create(
  persist(
    (set, get) => ({
      ...initialState,

      // =====================================================================
      // Auth / session
      // =====================================================================
      login: async (email, password) => {
        set({ authLoading: true })
        try {
          const result = await apiClient.post('/auth/login', { email, password })
          setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken })
          const me = await apiClient.get('/me')
          // A fresh login is itself a server-confirmed session — mark it verified
          // immediately so route guards don't wait on a boot-time restore that
          // already ran (and won't run again) earlier this app load.
          set({ currentUser: me, isAuthenticated: true, authLoading: false, sessionVerified: true })
          await get().loadUserData().catch((err) => console.error('[useAppStore] post-login bulk load failed', err))
          return me
        } catch (err) {
          set({ authLoading: false })
          throw err
        }
      },

      register: async (fields) => {
        set({ authLoading: true })
        try {
          // §6.6 — POST /auth/register always creates role:'patient' server-side
          // regardless of what's sent; force it here so there's no illusion of
          // a client-selectable role.
          const body = { ...fields, role: 'patient' }
          const result = await apiClient.post('/auth/register', body)
          setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken })
          const me = await apiClient.get('/me')
          // Same reasoning as login() — a fresh register is a confirmed session.
          set({ currentUser: me, isAuthenticated: true, authLoading: false, sessionVerified: true })
          await get().loadUserData().catch((err) => console.error('[useAppStore] post-login bulk load failed', err))
          return me
        } catch (err) {
          set({ authLoading: false })
          throw err
        }
      },

      // Public self-registration as a doctor — mirrors register() above, but hits
      // POST /doctors/register. That endpoint always creates the account with
      // doctorProfile.status:'pending' (it never reads/accepts a verifyImmediately flag from a
      // public caller) — the new doctor can sign in immediately (this logs them straight in) but
      // stays invisible to patient search/booking until an admin verifies them from the Doctors
      // panel (same "Create doctor account" verification queue an admin-created doctor lands in).
      registerDoctor: async (fields) => {
        set({ authLoading: true })
        try {
          const result = await apiClient.post('/doctors/register', fields)
          setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken })
          const me = await apiClient.get('/me')
          set({ currentUser: me, isAuthenticated: true, authLoading: false, sessionVerified: true })
          await get().loadUserData().catch((err) => console.error('[useAppStore] post-login bulk load failed', err))
          return me
        } catch (err) {
          set({ authLoading: false })
          throw err
        }
      },

      // POST /auth/forgot-password ALWAYS responds 200 with the same generic message whether or
      // not `email` matches a real account (server-side enumeration avoidance — see
      // auth.service.js#forgotPassword) — so there's nothing account-specific to return here;
      // the call site shows its own generic "if an account exists…" copy regardless of outcome.
      forgotPassword: async (email) => {
        await apiClient.post('/auth/forgot-password', { email })
        return true
      },

      // POST /auth/reset-password verifies the short-lived token from the emailed/logged reset
      // link and sets the new password server-side; throws (like changePassword) on an
      // invalid/expired token so the call site can show an inline error.
      resetPassword: async (token, newPassword) => {
        await apiClient.post('/auth/reset-password', { token, newPassword })
        return true
      },

      logout: async () => {
        const tokens = getTokens()
        try {
          if (tokens?.refreshToken) await apiClient.post('/auth/logout', { refreshToken: tokens.refreshToken })
        } catch (err) {
          // Best-effort — logout is idempotent server-side and we're clearing
          // the local session regardless.
          console.warn('[useAppStore] logout: server call failed, clearing local session anyway', err?.message)
        }
        clearTokens()
        set((state) => ({
          currentUser: null,
          isAuthenticated: false,
          dataLoaded: state.dataLoaded, // keep the public directory loaded
          data: resetSessionData(state.data),
        }))
      },

      // Boot-time session restore: if apiClient already holds tokens (from a
      // previous browser session), re-validate them against GET /me before
      // any protected route renders. Call once from G7 (App shell) on mount,
      // ideally after loadPublicDirectory() has been kicked off.
      restoreSession: async () => {
        const tokens = getTokens()
        if (!tokens?.accessToken) {
          // Nothing to validate this app load — persisted isAuthenticated (if
          // any) is already stale/inconsistent with the absence of a token,
          // so there's no pending verification to block route guards on.
          set({ sessionVerified: true })
          return
        }
        set({ authLoading: true })
        try {
          const me = await apiClient.get('/me')
          set({ currentUser: me, isAuthenticated: true, authLoading: false, sessionVerified: true })
          // FIX (found in a scalability/correctness audit): this used to call ONLY
          // loadUserData() — the comment above loadPublicDirectory() claimed portal routes
          // "don't read data.doctors / data.clinics / etc", but several do: the patient
          // booking page's doctor dropdown, the doctor's OPD-schedule clinic picker, the
          // admin's receptionist-creation clinic picker, and doctor-mode revenue reports (which
          // looks itself up in data.doctors) all read from data that only loadPublicDirectory()
          // populates. A fresh anonymous-then-login session had it (the boot effect's anonymous
          // branch ran loadPublicDirectory() before login), but a BOOT-TIME restore — any
          // refresh, reopened tab, or deep link while already logged in — skipped it entirely,
          // silently breaking booking/OPD-schedule/receptionist-creation until the user visited
          // a page that happened to self-fetch its own clinics. Run both bulk loads together so
          // a restored session ends up with the same reference data a fresh login gets.
          await Promise.allSettled([get().loadPublicDirectory(), get().loadUserData()]).then((results) => {
            results.forEach((r) => {
              if (r.status === 'rejected') console.error('[useAppStore] post-restore bulk load failed', r.reason)
            })
          })
        } catch {
          // Refresh (handled transparently by apiClient's interceptor) also
          // failed — session is unrecoverable.
          clearTokens()
          set((state) => ({
            currentUser: null,
            isAuthenticated: false,
            authLoading: false,
            sessionVerified: true,
            data: resetSessionData(state.data),
          }))
        }
      },

      // =====================================================================
      // Bulk-load strategy (integration plan §4)
      // =====================================================================

      // Pre-login / public phase — safe to call unauthenticated, runs once at
      // app boot regardless of session state (§4.1).
      loadPublicDirectory: async () => {
        set({ dataLoading: true })
        try {
          await Promise.allSettled([
            get().fetchCities(),
            get().fetchAreas(),
            get().fetchSpecializations(),
            get().searchDoctors({ pageSize: 100 }),
            get().fetchClinics({}),
            get().fetchReviews({}),
          ])
        } finally {
          set({ dataLoading: false, dataLoaded: true })
        }
      },

      // Post-login phase — call once right after login()/register() succeed,
      // and again on a successful boot-time restoreSession() (§4.2). Branches
      // on currentUser.role; safe no-op if not authenticated.
      loadUserData: async () => {
        const user = get().currentUser
        if (!user) return
        set({ dataLoading: true })
        const tasks = []
        if (user.role === 'patient') {
          tasks.push(
            get().fetchFamilyMembers(),
            get().fetchAppointments(),
            get().fetchRecords(),
            get().fetchPayments(),
            get().fetchNotifications(),
            // BUG FIX: a patient's boot-time data load never fetched this, so data.platformCharges
            // stayed null for their entire session (only doctor/admin/superadmin loaded it here —
            // GET /platform-charges is authenticate + any role, so a patient was always allowed to
            // call it, this was just missing from the list). PatientPages.jsx#Booking reads
            // data.platformCharges directly for its Consultation/Convenience fee/Transaction
            // charge price preview and the emergency-booking surcharge — with it null, every
            // `Number(platformCharges?.x) || 0` fell back to 0, showing "Convenience fee ₹0",
            // "Transaction charge 0%", and "+₹0" on Emergency booking regardless of the real
            // configured values.
            get().fetchPlatformCharges()
          )
        } else if (user.role === 'doctor') {
          tasks.push(
            get().fetchAppointments(),
            get().fetchQueue({}),
            get().fetchRecords(),
            get().fetchPayments(),
            get().fetchNotifications(),
            get().fetchPlatformCharges()
          )
        } else if (user.role === 'receptionist') {
          tasks.push(get().fetchAppointments(), get().fetchQueue({}), get().fetchPayments(), get().fetchNotifications())
        } else if (user.role === 'admin' || user.role === 'superadmin') {
          tasks.push(
            get().fetchDashboardStats(),
            get().fetchNotifications(),
            get().fetchPlatformCharges(),
            get().fetchSystemSettings(),
            get().fetchBookingRules()
          )
        }
        const results = await Promise.allSettled(tasks)
        const failed = results.filter((r) => r.status === 'rejected')
        if (failed.length) {
          console.error(
            '[useAppStore] loadUserData: some requests failed',
            failed.map((f) => f.reason?.message)
          )
        }
        set({ dataLoading: false, dataLoaded: true })
      },

      // =====================================================================
      // /me
      // =====================================================================
      updateProfile: async (fields) => {
        const me = await apiClient.patch('/me', fields)
        set({ currentUser: me })
        return me
      },
      // Split from the old mock's single `updateDoctor(...)` — this half
      // covers everything OTHER than the 3 booking-policy fields, which go
      // through `updateDoctorBookingPolicy` (PATCH /doctors/:id) instead.
      updateDoctorProfile: async (fields) => {
        const me = await apiClient.patch('/me', fields)
        set({ currentUser: me })
        return me
      },
      // Real photo upload (POST /media/photo, multipart) — replaces the old data:-URI-preview-
      // only / paste-a-hosted-URL workarounds in StaffPages.jsx / PortalSectionPages.jsx now that
      // a real upload endpoint exists. Unlike updateProfile/updateDoctorProfile above this does
      // NOT PATCH /me — the server persists users.photo_url directly as part of the upload
      // itself, so this only needs to merge the returned URL into the already-loaded
      // `currentUser` rather than replacing it with a fresh GET /me response.
      uploadPhoto: async (file) => {
        const formData = new FormData()
        formData.append('file', file)
        const result = await apiClient.post('/media/photo', formData)
        set((state) => (state.currentUser ? { currentUser: { ...state.currentUser, photoUrl: result.url } } : state))
        return result.url
      },
      // COMPLETENESS FIX (audit Priority 4 — stale clinic-QR-upload placeholder, discovered
      // while building mobile parity item #8/file uploads): POST /media/qr is a real, working
      // endpoint (uploads.service.js#saveClinicQr) that this app already used from the mobile
      // client's clinic screen; the web payment-setup screen's own comment claiming "no
      // file-upload endpoint exists anywhere in the API" was simply false by the time it was
      // read. The upload itself persists clinics.payment_qr_url server-side (see that function),
      // so this only needs to merge the returned URL into the already-loaded clinics list.
      uploadClinicQr: async (clinicId, file) => {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('clinicId', clinicId)
        const result = await apiClient.post('/media/qr', formData)
        set((state) => ({ data: { ...state.data, clinics: upsertById(state.data.clinics, { id: clinicId, paymentQrUrl: result.url }) } }))
        return result.url
      },
      // COMPLETENESS FIX (doctor panel profile section audit): POST /media/document is a real,
      // working, doctor-only endpoint (uploads.service.js#saveVerificationDocument) that had NO
      // caller anywhere in this app — a self-registered doctor had no way to ever submit
      // verification documents themselves, leaving their account stuck "pending" forever unless
      // an admin verified them with nothing to review. The server only returns {url} (it appends
      // to doctor_profiles.verification_documents server-side and doesn't echo the full updated
      // array back — see saveVerificationDocument), so this mirrors the server's own
      // name/url/uploadedAt shape locally rather than refetching all of GET /me for one field.
      uploadVerificationDocument: async (file, name) => {
        const formData = new FormData()
        formData.append('file', file)
        if (name) formData.append('name', name)
        const result = await apiClient.post('/media/document', formData)
        const label = (name || '').trim() || null
        set((state) => {
          if (!state.currentUser?.profile) return state
          const currentDocs = Array.isArray(state.currentUser.profile.verificationDocuments)
            ? state.currentUser.profile.verificationDocuments
            : []
          const entry = { name: label || `Document ${currentDocs.length + 1}`, url: result.url, uploadedAt: new Date().toISOString() }
          return {
            currentUser: {
              ...state.currentUser,
              profile: { ...state.currentUser.profile, verificationDocuments: [...currentDocs, entry] },
            },
          }
        })
        return result.url
      },
      changePassword: async (currentPassword, newPassword, confirmPassword) => {
        await apiClient.patch('/me/password', { currentPassword, newPassword, confirmPassword })
        // Server revokes ALL of this user's refresh tokens on success — the
        // current session's own refresh token is now invalid too, so force a
        // local logout rather than pretending the session survives.
        clearTokens()
        set((state) => ({
          currentUser: null,
          isAuthenticated: false,
          data: resetSessionData(state.data),
        }))
        return true
      },
      // COMPLETENESS FIX (audit Priority 4 — "updatePhoto no-op" dead code): this stub predates
      // uploadPhoto above (POST /media/photo, a real working endpoint) and had no remaining call
      // sites anywhere in the app — every photo-picker screen already calls uploadPhoto instead.
      // Removed rather than left in place as stale, misleading dead code.

      // =====================================================================
      // Geography
      // =====================================================================
      fetchCities: async (filters = {}) => {
        const rows = await apiClient.get('/geography/cities', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, cities: rows } }))
        return rows
      },
      fetchAreas: async (filters = {}) => {
        const rows = await apiClient.get('/geography/areas', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, areas: rows } }))
        return rows
      },
      fetchSpecializations: async (filters = {}) => {
        const rows = await apiClient.get('/geography/specializations', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, specializations: rows } }))
        return rows
      },
      // admin/superadmin only (server-enforced) — not in the plan's §3.2
      // table by name, but the endpoints are real (§1.3) and existing admin
      // geography UI has nothing else to call.
      addCity: async (fields) => {
        const city = await apiClient.post('/geography/cities', fields)
        set((state) => ({ data: { ...state.data, cities: [...(state.data.cities || []), city] } }))
        return city
      },
      // NOTE signature change from the mock: takes a real `cityId` (UUID),
      // not a city name — areas are never nested under a city (plan §1.3).
      addArea: async (cityId, fields) => {
        const area = await apiClient.post(`/geography/cities/${cityId}/areas`, fields)
        set((state) => ({ data: { ...state.data, areas: [...(state.data.areas || []), area] } }))
        return area
      },
      // Backend refuses (409) when the city still has areas or is assigned to a clinic —
      // callers should surface err.message to the admin rather than assuming success.
      deleteCity: async (cityId) => {
        await apiClient.delete(`/geography/cities/${cityId}`)
        set((state) => ({ data: { ...state.data, cities: (state.data.cities || []).filter((c) => c.id !== cityId) } }))
      },
      // Backend refuses (409) when the area is still assigned to a clinic.
      deleteArea: async (cityId, areaId) => {
        await apiClient.delete(`/geography/cities/${cityId}/areas/${areaId}`)
        set((state) => ({ data: { ...state.data, areas: (state.data.areas || []).filter((a) => a.id !== areaId) } }))
      },
      addSpecialization: async (fields) => {
        const specialization = await apiClient.post('/geography/specializations', fields)
        set((state) => ({ data: { ...state.data, specializations: [...(state.data.specializations || []), specialization] } }))
        return specialization
      },
      // Backend refuses (409) when the specialization is still assigned to a doctor.
      deleteSpecialization: async (specializationId) => {
        await apiClient.delete(`/geography/specializations/${specializationId}`)
        set((state) => ({
          data: { ...state.data, specializations: (state.data.specializations || []).filter((s) => s.id !== specializationId) },
        }))
      },

      // =====================================================================
      // Doctors
      // =====================================================================
      searchDoctors: async (filters = {}) => {
        const rows = await apiClient.get('/doctors', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, doctors: rows } }))
        return rows
      },
      getDoctor: async (id) => {
        const doctor = await apiClient.get(`/doctors/${id}`)
        set((state) => ({ data: { ...state.data, doctors: upsertById(state.data.doctors, doctor) } }))
        return doctor
      },
      // Renamed/split from the old mock's `updateDoctor` — ONLY these 3
      // booking-policy fields, full-replace, all 3 required by the server.
      updateDoctorBookingPolicy: async (id, fields) => {
        const doctor = await apiClient.patch(`/doctors/${id}`, fields)
        set((state) => ({ data: { ...state.data, doctors: upsertById(state.data.doctors, doctor) } }))
        return doctor
      },
      createDoctor: async (fields) => {
        const doctor = await apiClient.post('/doctors', fields)
        set((state) => ({ data: { ...state.data, doctors: [...(state.data.doctors || []), doctor] } }))
        return doctor
      },
      updateDoctorStatus: async (id, status) => {
        const result = await apiClient.patch(`/doctors/${id}/status`, { status })
        set((state) => ({ data: { ...state.data, doctors: upsertById(state.data.doctors, { id, ...result }) } }))
        return result
      },
      // COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
      // account-level login enable/disable (users.status via PATCH /doctors/:id/account-status),
      // distinct from updateDoctorStatus above (doctor_profiles.status, verification lifecycle).
      updateDoctorAccountStatus: async (id, status) => {
        const result = await apiClient.patch(`/doctors/${id}/account-status`, { status })
        set((state) => ({ data: { ...state.data, doctors: upsertById(state.data.doctors, { id, ...result }) } }))
        return result
      },

      // =====================================================================
      // Clinics
      // =====================================================================
      fetchClinics: async (filters = {}) => {
        const rows = await apiClient.get('/clinics', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, clinics: rows } }))
        return rows
      },
      getClinic: async (id) => {
        const clinic = await apiClient.get(`/clinics/${id}`)
        set((state) => ({ data: { ...state.data, clinics: upsertById(state.data.clinics, clinic) } }))
        return clinic
      },
      createClinic: async (fields) => {
        const clinic = await apiClient.post('/clinics', fields)
        set((state) => ({ data: { ...state.data, clinics: [...(state.data.clinics || []), clinic] } }))
        return clinic
      },
      updateClinic: async (id, fields) => {
        const clinic = await apiClient.patch(`/clinics/${id}`, fields)
        set((state) => ({ data: { ...state.data, clinics: upsertById(state.data.clinics, clinic) } }))
        return clinic
      },
      approveClinic: async (id) => {
        const clinic = await apiClient.patch(`/clinics/${id}/approve`)
        set((state) => ({ data: { ...state.data, clinics: upsertById(state.data.clinics, clinic) } }))
        return clinic
      },
      rejectClinic: async (id, rejectionReason) => {
        const clinic = await apiClient.patch(`/clinics/${id}/reject`, { rejectionReason })
        set((state) => ({ data: { ...state.data, clinics: upsertById(state.data.clinics, clinic) } }))
        return clinic
      },
      // Convenience wrappers — there's no dedicated single-field toggle
      // endpoint; both go through the general clinic endpoints.
      toggleClinicEmergency: async (id) => {
        const clinic = (get().data.clinics || []).find((item) => item.id === id)
        if (!clinic) throw new Error('Clinic not found in local cache — fetch it first.')
        return get().updateClinic(id, { emergencyAvailable: !clinic.emergencyAvailable })
      },
      toggleClinicStatus: async (id) => {
        const clinic = (get().data.clinics || []).find((item) => item.id === id)
        if (!clinic) throw new Error('Clinic not found in local cache — fetch it first.')
        if (clinic.approvalStatus === 'disabled') return get().approveClinic(id)
        return get().rejectClinic(id, 'Disabled by admin.')
      },
      assignDoctorToClinic: async (clinicId, fields) => {
        const result = await apiClient.post(`/clinics/${clinicId}/doctors`, fields)
        await get().getClinic(clinicId).catch(() => {})
        return result
      },
      updateDoctorClinicAssignment: async (clinicId, doctorUserId, fields) => {
        const result = await apiClient.patch(`/clinics/${clinicId}/doctors/${doctorUserId}`, fields)
        await get().getClinic(clinicId).catch(() => {})
        return result
      },
      removeDoctorFromClinic: async (clinicId, doctorUserId) => {
        await apiClient.delete(`/clinics/${clinicId}/doctors/${doctorUserId}`)
        await get().getClinic(clinicId).catch(() => {})
      },

      // Clinic hours (weekly recurring) + closures (one-off dates) — merged
      // client-side into `data.opdEntries`, each row tagged `kind`.
      fetchClinicHours: async (clinicId, filters = {}) => {
        const rows = await apiClient.get(`/clinics/${clinicId}/hours`, { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, opdEntries: replaceOpdEntriesOfKind(state.data.opdEntries, rows, 'hours') } }))
        return rows
      },
      fetchClinicClosures: async (clinicId, filters = {}) => {
        const rows = await apiClient.get(`/clinics/${clinicId}/closures`, { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, opdEntries: replaceOpdEntriesOfKind(state.data.opdEntries, rows, 'closure') } }))
        return rows
      },
      // Upsert by (doctorUserId, clinicId, weekday) server-side — calling
      // again with the same trio overwrites rather than duplicating.
      upsertClinicHours: async (clinicId, fields) => {
        const row = await apiClient.put(`/clinics/${clinicId}/hours`, fields)
        const shaped = { ...row, kind: 'hours' }
        set((state) => ({ data: { ...state.data, opdEntries: upsertOpdEntry(state.data.opdEntries, shaped) } }))
        return row
      },
      createClinicClosure: async (clinicId, fields) => {
        const row = await apiClient.post(`/clinics/${clinicId}/closures`, fields)
        const shaped = { ...row, kind: 'closure' }
        set((state) => ({ data: { ...state.data, opdEntries: upsertOpdEntry(state.data.opdEntries, shaped) } }))
        return row
      },
      deleteClinicHours: async (clinicId, hoursId) => {
        await apiClient.delete(`/clinics/${clinicId}/hours/${hoursId}`)
        set((state) => ({
          data: { ...state.data, opdEntries: (state.data.opdEntries || []).filter((row) => !(row.id === hoursId && row.kind === 'hours')) },
        }))
      },
      deleteClinicClosure: async (clinicId, closureId) => {
        await apiClient.delete(`/clinics/${clinicId}/closures/${closureId}`)
        set((state) => ({
          data: {
            ...state.data,
            opdEntries: (state.data.opdEntries || []).filter((row) => !(row.id === closureId && row.kind === 'closure')),
          },
        }))
      },

      // =====================================================================
      // Family members (patient-only, server-scoped to req.user.id)
      // =====================================================================
      fetchFamilyMembers: async (filters = {}) => {
        const rows = await apiClient.get('/family-members', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, familyMembers: rows } }))
        return rows
      },
      addFamilyMember: async (fields) => {
        const member = await apiClient.post('/family-members', fields)
        set((state) => ({ data: { ...state.data, familyMembers: [...(state.data.familyMembers || []), member] } }))
        return member
      },
      updateFamilyMember: async (id, fields) => {
        const member = await apiClient.patch(`/family-members/${id}`, fields)
        set((state) => ({ data: { ...state.data, familyMembers: upsertById(state.data.familyMembers, member) } }))
        return member
      },
      removeFamilyMember: async (id) => {
        await apiClient.delete(`/family-members/${id}`)
        set((state) => ({ data: { ...state.data, familyMembers: (state.data.familyMembers || []).filter((m) => m.id !== id) } }))
      },

      // =====================================================================
      // Receptionists
      // =====================================================================
      fetchReceptionists: async (filters = {}) => {
        const rows = await apiClient.get('/receptionists', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, receptionists: rows } }))
        return rows
      },
      // Convergence note (plan §1.7): the mock had two inconsistent creation
      // call sites — both now hit this single real endpoint, which requires
      // `clinicId` + `email` + `password`. `createReceptionistAccount` is
      // kept as an alias so either existing call-site name keeps working.
      addReceptionist: async (fields) => {
        const receptionist = await apiClient.post('/receptionists', fields)
        set((state) => ({ data: { ...state.data, receptionists: [...(state.data.receptionists || []), receptionist] } }))
        return receptionist
      },
      createReceptionistAccount: async (fields) => get().addReceptionist(fields),
      updateReceptionist: async (id, fields) => {
        const receptionist = await apiClient.patch(`/receptionists/${id}`, fields)
        set((state) => ({ data: { ...state.data, receptionists: upsertById(state.data.receptionists, receptionist) } }))
        return receptionist
      },
      updateReceptionistStatus: async (id, status) => {
        const receptionist = await apiClient.patch(`/receptionists/${id}/status`, { status })
        set((state) => ({ data: { ...state.data, receptionists: upsertById(state.data.receptionists, receptionist) } }))
        return receptionist
      },

      // =====================================================================
      // Appointments — booking is fully asynchronous (plan §1.8)
      // =====================================================================
      // POST /appointments returns HTTP 202 {jobId, status:'queued'} — this
      // is NOT "booking succeeded". Poll GET /appointments/booking-status/:id
      // until confirmed/failed/timeout and resolve/reject accordingly. Call
      // sites MUST `await` this and show a "confirming your booking…" state.
      createAppointment: async (fields) => {
        const enqueued = await apiClient.post('/appointments', fields) // { jobId, status: 'queued' }
        const jobId = enqueued.jobId
        const pollIntervalMs = 1700
        const timeoutMs = 40000
        const startedAt = Date.now()
        while (Date.now() - startedAt < timeoutMs) {
          await sleep(pollIntervalMs)
          const statusResult = await apiClient.get(`/appointments/booking-status/${jobId}`)
          if (statusResult.status === 'confirmed') {
            const appointment = statusResult.appointment
            set({ bookingQueueInfo: null })
            set((state) => ({ data: { ...state.data, appointments: upsertById(state.data.appointments, appointment) } }))
            return appointment
          }
          if (statusResult.status === 'failed') {
            set({ bookingQueueInfo: null })
            const err = new Error(statusResult.error?.message || 'Booking failed — the slot may no longer be available.')
            err.code = statusResult.error?.code || null
            err.details = statusResult.error || null
            throw err
          }
          // 'queued' or 'processing' — keep polling, surfacing live queue
          // position/ETA (if the backend included them) to the UI.
          set({
            bookingQueueInfo: {
              aheadOfYou: statusResult.aheadOfYou ?? 0,
              etaSeconds: statusResult.etaSeconds ?? 0,
              queuePosition: statusResult.queuePosition ?? 1,
            },
          })
        }
        set({ bookingQueueInfo: null })
        const timeoutErr = new Error('Still processing — check My Appointments shortly.')
        timeoutErr.code = 'BOOKING_TIMEOUT'
        throw timeoutErr
      },
      fetchAppointments: async (filters = {}) => {
        const rows = await apiClient.get('/appointments', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, appointments: rows } }))
        return rows
      },
      getAppointment: async (id) => {
        const appointment = await apiClient.get(`/appointments/${id}`)
        set((state) => ({ data: { ...state.data, appointments: upsertById(state.data.appointments, appointment) } }))
        return appointment
      },
      updateAppointmentStatus: async (id, status) => {
        const appointment = await apiClient.patch(`/appointments/${id}/status`, { status })
        set((state) => ({ data: { ...state.data, appointments: upsertById(state.data.appointments, appointment) } }))
        return appointment
      },
      cancelAppointment: async (id) => get().updateAppointmentStatus(id, 'cancelled'),

      // =====================================================================
      // Queue
      // =====================================================================
      fetchQueue: async (filters = {}) => {
        const rows = await apiClient.get('/queue', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, queueTokens: rows } }))
        return rows
      },
      // Patient-only (GET /queue/mine/:appointmentId — see queue.service.js#getMyQueueStatus).
      // The literal fix for the "Live queue tracker" page always showing "no active queue": the
      // main GET /queue above is doctor/receptionist-only, and a patient's post-login bulk load
      // never called it (would 403) — so `data.queueTokens` was always empty for a patient, no
      // matter their real position in line. Deliberately NOT merged into `data.queueTokens` (that
      // array's row shape/scoping is staff-only "everyone in the queue today"; this is one
      // patient's own single-token status) — callers hold the returned object in local state.
      fetchMyQueueStatus: async (appointmentId) => {
        return apiClient.get(`/queue/mine/${appointmentId}`)
      },
      // NOTE: the real enum is `in_consultation` (underscore) — call sites
      // must pass that exact string, not the mock's `'in consultation'`.
      setQueueTokenStatus: async (id, status) => {
        const token = await apiClient.patch(`/queue/${id}/status`, { status })
        set((state) => ({ data: { ...state.data, queueTokens: upsertById(state.data.queueTokens, token) } }))
        // Completing a token cascades server-side to the linked appointment's
        // status — refetch is left to the page (fetchAppointments on demand)
        // rather than guessed here.
        return token
      },

      // =====================================================================
      // Medical records (receptionist excluded — clinical data)
      // =====================================================================
      fetchRecords: async (filters = {}) => {
        const rows = await apiClient.get('/medical-records', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, records: rows } }))
        return rows
      },
      addRecord: async (fields) => {
        const record = await apiClient.post('/medical-records', fields)
        set((state) => ({ data: { ...state.data, records: [record, ...(state.data.records || [])] } }))
        return record
      },

      // =====================================================================
      // Payments
      // =====================================================================
      fetchPayments: async (filters = {}) => {
        const rows = await apiClient.get('/payments', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, payments: rows } }))
        return rows
      },
      // §6.2 — receptionist/admin/superadmin ONLY. A patient can never create
      // their own payment record; the Patient Payments page must stay
      // read-only.
      createPayment: async (fields) => {
        const payment = await apiClient.post('/payments', fields)
        set((state) => ({ data: { ...state.data, payments: [payment, ...(state.data.payments || [])] } }))
        return payment
      },
      // Razorpay self-pay — payment is now MANDATORY before an online booking gets a token
      // (PatientPages.jsx#Booking shows a `pending_payment` screen with two buttons: pay the
      // full consultation amount, or pay just the doctor's configured minimum booking amount).
      // Two-step flow: create an order for whichever `paymentOption` the patient picked, open
      // Razorpay Checkout with it, then verify the signature Checkout hands back before this is
      // ever treated as paid.
      createRazorpayOrder: async (appointmentId, paymentOption = 'full') =>
        apiClient.post('/payments/razorpay/order', { appointmentId, paymentOption }),
      verifyRazorpayPayment: async (fields) => {
        // Backend now returns { payment, appointment } — the appointment is re-fetched
        // server-side AFTER payment is recorded, so its status/tokenNumber/paymentStatus are
        // authoritative (a pending_payment booking may have just flipped to upcoming with a
        // freshly-minted token). Trust that returned appointment instead of guessing the new
        // shape from the fields we sent.
        const { payment, appointment } = await apiClient.post('/payments/razorpay/verify', fields)
        set((state) => ({
          data: {
            ...state.data,
            payments: [payment, ...(state.data.payments || [])],
            appointments: (state.data.appointments || []).map((existing) =>
              existing.id === appointment.id ? appointment : existing
            ),
          },
        }))
        return { payment, appointment }
      },

      // =====================================================================
      // Platform charges (singleton config row)
      // =====================================================================
      fetchPlatformCharges: async () => {
        const charges = await apiClient.get('/platform-charges')
        set((state) => ({ data: { ...state.data, platformCharges: charges } }))
        return charges
      },
      // Full-replace, all 6 fields required every call — apply the field
      // rename/retype table (plan §1.13) at the form-handler call site.
      updatePlatformCharges: async (fields) => {
        const charges = await apiClient.put('/platform-charges', fields)
        set((state) => ({ data: { ...state.data, platformCharges: charges } }))
        return charges
      },

      // =====================================================================
      // Reviews
      // =====================================================================
      fetchReviews: async (filters = {}) => {
        const rows = await apiClient.get('/reviews', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, reviews: rows } }))
        return rows
      },
      addReview: async (fields) => {
        const review = await apiClient.post('/reviews', fields)
        set((state) => ({ data: { ...state.data, reviews: [review, ...(state.data.reviews || [])] } }))
        return review
      },
      updateReviewStatus: async (id, status) => {
        const review = await apiClient.patch(`/reviews/${id}/status`, { status })
        set((state) => ({ data: { ...state.data, reviews: upsertById(state.data.reviews, review) } }))
        return review
      },

      // =====================================================================
      // Notifications
      // =====================================================================
      fetchNotifications: async (filters = {}) => {
        const rows = await apiClient.get('/notifications', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, notifications: rows } }))
        return rows
      },
      // `id` MUST be the NotificationRecipient row's own `id` (already
      // present on rows from fetchNotifications), NOT `notificationId`.
      markNotificationRead: async (id) => {
        const result = await apiClient.patch(`/notifications/${id}/read`)
        set((state) => ({
          data: {
            ...state.data,
            notifications: (state.data.notifications || []).map((n) => (n.id === id ? { ...n, readAt: result.readAt } : n)),
          },
        }))
        return result
      },
      markAllNotificationsRead: async () => {
        const result = await apiClient.patch('/notifications/read-all')
        const now = new Date().toISOString()
        set((state) => ({
          data: {
            ...state.data,
            notifications: (state.data.notifications || []).map((n) => ({ ...n, readAt: n.readAt || now })),
          },
        }))
        return result
      },
      broadcastNotification: async (fields) => {
        const result = await apiClient.post('/notifications/broadcast', fields)
        set((state) => ({ data: { ...state.data, broadcasts: [result, ...(state.data.broadcasts || [])] } }))
        return result
      },
      fetchBroadcastHistory: async (filters = {}) => {
        const rows = await apiClient.get('/notifications/broadcast', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, broadcasts: rows } }))
        return rows
      },

      // =====================================================================
      // Complaints
      // =====================================================================
      fetchComplaints: async (filters = {}) => {
        const rows = await apiClient.get('/complaints', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, complaints: rows } }))
        return rows
      },
      addComplaint: async (fields) => {
        const complaint = await apiClient.post('/complaints', fields)
        set((state) => ({ data: { ...state.data, complaints: [complaint, ...(state.data.complaints || [])] } }))
        return complaint
      },
      // Body field is `adminResponse`, not `response` (rename vs the mock).
      updateComplaint: async (id, fields) => {
        const complaint = await apiClient.patch(`/complaints/${id}`, fields)
        set((state) => ({ data: { ...state.data, complaints: upsertById(state.data.complaints, complaint) } }))
        return complaint
      },

      // =====================================================================
      // Contact requests
      // =====================================================================
      fetchContactRequests: async (filters = {}) => {
        const rows = await apiClient.get('/contact', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, contactRequests: rows } }))
        return rows
      },
      // Fully public, no auth required.
      submitContactRequest: async (fields) => {
        const request = await apiClient.post('/contact', fields)
        set((state) => ({ data: { ...state.data, contactRequests: [request, ...(state.data.contactRequests || [])] } }))
        return request
      },
      updateContactRequest: async (id, fields) => {
        const request = await apiClient.patch(`/contact/${id}`, fields)
        set((state) => ({ data: { ...state.data, contactRequests: upsertById(state.data.contactRequests, request) } }))
        return request
      },

      // =====================================================================
      // Admin
      // =====================================================================
      fetchActivityLog: async (filters = {}) => {
        const rows = await apiClient.get('/admin/activity-log', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, activity: rows } }))
        return rows
      },
      fetchSystemSettings: async () => {
        const settings = await apiClient.get('/admin/system-settings')
        set((state) => ({ data: { ...state.data, systemSettings: settings } }))
        return settings
      },
      // Full-replace, all fields required — rename `maintenance` -> `maintenanceMode` at the call site.
      updateSystemSettings: async (fields) => {
        const settings = await apiClient.put('/admin/system-settings', fields)
        set((state) => ({ data: { ...state.data, systemSettings: settings } }))
        return settings
      },
      fetchBookingRules: async () => {
        const rules = await apiClient.get('/admin/booking-rules')
        set((state) => ({ data: { ...state.data, bookingRules: rules } }))
        return rules
      },
      updateBookingRules: async (fields) => {
        const rules = await apiClient.put('/admin/booking-rules', fields)
        set((state) => ({ data: { ...state.data, bookingRules: rules } }))
        return rules
      },
      fetchDashboardStats: async () => {
        const stats = await apiClient.get('/admin/dashboard-stats')
        set((state) => ({ data: { ...state.data, dashboardStats: stats } }))
        return stats
      },
      // Real registered-patient directory (id/email/phone/registered-date) — distinct from the
      // best-effort list ManagePatients used to derive from appointments/payments alone, which
      // silently missed any patient who registered but never booked/paid.
      fetchPatients: async (filters = {}) => {
        const rows = await apiClient.get('/admin/patients', { params: cleanParams(filters) })
        set((state) => ({ data: { ...state.data, patients: rows } }))
        return rows
      },
      // COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
      // account-level login enable/disable for a patient (PATCH /admin/patients/:id/status).
      updatePatientStatus: async (id, status) => {
        await apiClient.patch(`/admin/patients/${id}/status`, { status })
        set((state) => ({
          data: {
            ...state.data,
            patients: (state.data.patients || []).map((p) => (p.id === id ? { ...p, status } : p)),
          },
        }))
        return { id, status }
      },

      // =====================================================================
      // Local-only (no backend concept)
      // =====================================================================
      saveDraft: (key, values) => set((state) => ({ drafts: { ...state.drafts, [key]: values } })),
    }),
    {
      name: 'connect-app-session', // new key — deliberately distinct from the old mock's
      // 'connect-doctor-local-workspace' so no legacy mock-shaped blob is ever rehydrated.
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Do NOT persist `data` wholesale — it's a cache, always refetched on
      // boot via loadPublicDirectory()/restoreSession(), never trusted stale.
      // Tokens live entirely in apiClient.js's own localStorage key, kept
      // deliberately separate from this persisted blob.
      // `sessionVerified` is likewise deliberately excluded — it's an
      // in-memory-only flag that must start false on every fresh load (see
      // its definition in initialState above), never carried over from a
      // previous app load via localStorage.
      partialize: (state) => ({
        currentUser: state.currentUser,
        isAuthenticated: state.isAuthenticated,
        drafts: state.drafts,
      }),
    }
  )
)

// If a request ever hits an unrecoverable 401 (refresh failed / reuse
// detected), clear local session state the same way logout() does, minus the
// best-effort server call (the token is already known-invalid).
registerUnauthorizedHandler(() => {
  const state = useAppStore.getState()
  if (!state.currentUser && !state.isAuthenticated) return
  useAppStore.setState({
    currentUser: null,
    isAuthenticated: false,
    sessionVerified: true,
    data: resetSessionData(state.data),
  })
})

// Legacy compatibility export — `lib/api.js` (deprecated, unused) imports
// this. Kept so that dead file doesn't fail to resolve if anything still
// references it.
export const getLocalData = () => useAppStore.getState().data
