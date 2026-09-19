import { useEffect, lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/RoleGuard'
import { SiteFooter } from './components/SiteFooter'
import { LoadingSkeleton } from './components/LoadingSkeleton'
import { PortalLayout } from './layouts/PortalLayout'
import { getTokens } from './lib/apiClient'
import { PlatformCharges } from './pages/PlatformCharges'
import { useAppStore } from './store/useAppStore'

// -----------------------------------------------------------------------
// Route-based code splitting (perf pass): every page-group module below
// (PublicPages, PublicLanding, PatientPages, StaffPages, AdminPages,
// FeaturePages, PortalSectionPages) exports many NAMED components rather
// than one default — `React.lazy(() => import(...))` needs a default
// export, so it can't be pointed at the module directly. `lazyNamed`
// re-shapes one named export into the `{ default }` shape `lazy()`
// expects. Every name below still resolves to its own lazy binding, but
// React/webpack de-duplicate the underlying dynamic `import()` calls per
// source file, so requesting 7 names out of StaffPages.jsx still only
// fetches that one chunk once. `<Route element={<X ... />}>` call sites
// below are unchanged — only where `X` is bound changes, from a static
// top-level import to this lazy binding, resolved inside the <Suspense>
// wrapped around <Routes> further down.
const lazyNamed = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })))

const DoctorProfile = lazyNamed(() => import('./pages/PublicPages'), 'DoctorProfile')
const EmergencyPage = lazyNamed(() => import('./pages/PublicPages'), 'EmergencyPage')
const ForgotPassword = lazyNamed(() => import('./pages/PublicPages'), 'ForgotPassword')
const Login = lazyNamed(() => import('./pages/PublicPages'), 'Login')
const Register = lazyNamed(() => import('./pages/PublicPages'), 'Register')
const ResetPassword = lazyNamed(() => import('./pages/PublicPages'), 'ResetPassword')
const SearchResults = lazyNamed(() => import('./pages/PublicPages'), 'SearchResults')

// TermsOfService/PrivacyPolicy each live in their own single-export file
// (unlike the grouped page files above) since they're standalone legal
// documents, not part of any existing page-file's topic — see
// TermsOfService.jsx/PrivacyPolicy.jsx's header comments for why. Still
// named exports (matching this codebase's convention), so still routed
// through `lazyNamed` rather than plain `lazy()`.
const TermsOfService = lazyNamed(() => import('./pages/TermsOfService'), 'TermsOfService')
const PrivacyPolicy = lazyNamed(() => import('./pages/PrivacyPolicy'), 'PrivacyPolicy')
const AccountDeletion = lazyNamed(() => import('./pages/AccountDeletion'), 'AccountDeletion')

const PatientLanding = lazyNamed(() => import('./pages/PublicLanding'), 'PatientLanding')
const ProviderLanding = lazyNamed(() => import('./pages/PublicLanding'), 'ProviderLanding')

const Booking = lazyNamed(() => import('./pages/PatientPages'), 'Booking')
const BookingHistory = lazyNamed(() => import('./pages/PatientPages'), 'BookingHistory')
const Family = lazyNamed(() => import('./pages/PatientPages'), 'Family')
const Notifications = lazyNamed(() => import('./pages/PatientPages'), 'Notifications')
const PatientAppointments = lazyNamed(() => import('./pages/PatientPages'), 'PatientAppointments')
const PatientDashboard = lazyNamed(() => import('./pages/PatientPages'), 'PatientDashboard')
const PatientSettings = lazyNamed(() => import('./pages/PatientPages'), 'PatientSettings')
const Payments = lazyNamed(() => import('./pages/PatientPages'), 'Payments')

const Analytics = lazyNamed(() => import('./pages/StaffPages'), 'Analytics')
const CashPayment = lazyNamed(() => import('./pages/StaffPages'), 'CashPayment')
const CheckIn = lazyNamed(() => import('./pages/StaffPages'), 'CheckIn')
const ClinicSchedule = lazyNamed(() => import('./pages/StaffPages'), 'ClinicSchedule')
const DoctorAppointments = lazyNamed(() => import('./pages/StaffPages'), 'DoctorAppointments')
const DoctorDashboard = lazyNamed(() => import('./pages/StaffPages'), 'DoctorDashboard')
const DoctorProfileEdit = lazyNamed(() => import('./pages/StaffPages'), 'DoctorProfileEdit')
const PatientHistory = lazyNamed(() => import('./pages/StaffPages'), 'PatientHistory')
const QueueManagement = lazyNamed(() => import('./pages/StaffPages'), 'QueueManagement')
const ReceptionAppointments = lazyNamed(() => import('./pages/StaffPages'), 'ReceptionAppointments')
const ReceptionDashboard = lazyNamed(() => import('./pages/StaffPages'), 'ReceptionDashboard')
const WalkIn = lazyNamed(() => import('./pages/StaffPages'), 'WalkIn')

const AdminDashboard = lazyNamed(() => import('./pages/AdminPages'), 'AdminDashboard')
const AuditLog = lazyNamed(() => import('./pages/AdminPages'), 'AuditLog')
const Broadcast = lazyNamed(() => import('./pages/AdminPages'), 'Broadcast')
const CitiesAreas = lazyNamed(() => import('./pages/AdminPages'), 'CitiesAreas')
const ClinicVerification = lazyNamed(() => import('./pages/AdminPages'), 'ClinicVerification')
const Complaints = lazyNamed(() => import('./pages/AdminPages'), 'Complaints')
const DoctorVerification = lazyNamed(() => import('./pages/AdminPages'), 'DoctorVerification')
const ManageClinics = lazyNamed(() => import('./pages/AdminPages'), 'ManageClinics')
const ManagePatients = lazyNamed(() => import('./pages/AdminPages'), 'ManagePatients')
const ManageReceptionists = lazyNamed(() => import('./pages/AdminPages'), 'ManageReceptionists')
const PlatformSettings = lazyNamed(() => import('./pages/AdminPages'), 'PlatformSettings')
const RevenueReports = lazyNamed(() => import('./pages/AdminPages'), 'RevenueReports')

const ClinicSearch = lazyNamed(() => import('./pages/FeaturePages'), 'ClinicSearch')
const DoctorClinics = lazyNamed(() => import('./pages/FeaturePages'), 'DoctorClinics')
const DoctorEmr = lazyNamed(() => import('./pages/FeaturePages'), 'DoctorEmr')
const DoctorFees = lazyNamed(() => import('./pages/FeaturePages'), 'DoctorFees')
const DoctorPaymentSetup = lazyNamed(() => import('./pages/FeaturePages'), 'DoctorPaymentSetup')
const DoctorReviews = lazyNamed(() => import('./pages/FeaturePages'), 'DoctorReviews')
const DoctorStaff = lazyNamed(() => import('./pages/FeaturePages'), 'DoctorStaff')
const PatientEmergencyBooking = lazyNamed(() => import('./pages/FeaturePages'), 'PatientEmergencyBooking')
const PatientReviews = lazyNamed(() => import('./pages/FeaturePages'), 'PatientReviews')
const PublicContent = lazyNamed(() => import('./pages/FeaturePages'), 'PublicContent')
const QuickClinicBooking = lazyNamed(() => import('./pages/FeaturePages'), 'QuickClinicBooking')
const ReceptionAvailability = lazyNamed(() => import('./pages/FeaturePages'), 'ReceptionAvailability')
const ReceptionEmergency = lazyNamed(() => import('./pages/FeaturePages'), 'ReceptionEmergency')
const ReceptionReports = lazyNamed(() => import('./pages/FeaturePages'), 'ReceptionReports')
const SimpleInbox = lazyNamed(() => import('./pages/FeaturePages'), 'SimpleInbox')
const SuperAdminDashboard = lazyNamed(() => import('./pages/FeaturePages'), 'SuperAdminDashboard')
const SuperAdminEntities = lazyNamed(() => import('./pages/FeaturePages'), 'SuperAdminEntities')

const ContactInbox = lazyNamed(() => import('./pages/PortalSectionPages'), 'ContactInbox')
const PortalAppointments = lazyNamed(() => import('./pages/PortalSectionPages'), 'PortalAppointments')
const PortalPatients = lazyNamed(() => import('./pages/PortalSectionPages'), 'PortalPatients')
const PortalProfile = lazyNamed(() => import('./pages/PortalSectionPages'), 'PortalProfile')
const QueueTracker = lazyNamed(() => import('./pages/PortalSectionPages'), 'QueueTracker')
const ReviewModeration = lazyNamed(() => import('./pages/PortalSectionPages'), 'ReviewModeration')
const Specializations = lazyNamed(() => import('./pages/PortalSectionPages'), 'Specializations')

function ProtectedLayout({ role, currentRole, onLogout }) { return <ProtectedRoute role={role} currentRole={currentRole}><PortalLayout role={role} onLogout={onLogout} /></ProtectedRoute> }
export default function App() {
  const data = useAppStore((state) => state.data)
  // `currentUser` (not `auth`) is the store's real field, populated by GET /me on
  // login/register/boot-time session restore. There is no localStorage role
  // fallback: nothing in this codebase ever writes a `dc-role` key, so reading
  // it here would only let a visitor spoof `localStorage.setItem('dc-role', 'admin')`
  // in devtools to make ProtectedRoute render a protected portal shell without a
  // real session (SECURITY: fixed during review — see RoleGuard.jsx/PortalLayout.jsx).
  const role = useAppStore((state) => state.currentUser?.role || '')
  const logout = useAppStore((state) => state.logout)
  const dataLoading = useAppStore((state) => state.dataLoading)
  const dataLoaded = useAppStore((state) => state.dataLoaded)
  const loadPublicDirectory = useAppStore((state) => state.loadPublicDirectory)
  const restoreSession = useAppStore((state) => state.restoreSession)

  // Boot sequence (plan §4, §7 G7): a genuinely anonymous (token-less)
  // visitor gets the public directory loaded unconditionally, exactly as
  // before, so they can browse without waiting on auth. An already
  // token-holding visitor (a returning, previously-logged-in session) skips
  // straight to restoreSession() instead of also calling loadPublicDirectory()
  // here — but restoreSession()'s own success path now runs BOTH
  // loadPublicDirectory() and loadUserData() together (see useAppStore.js —
  // fixed in a later audit: several portal routes for every role DO read
  // data.doctors/data.clinics/etc, so skipping the public bulk load on a
  // boot-time restore was a real bug, not a safe skip). Runs once at the
  // top level, not per-page.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (getTokens()?.accessToken) {
        await restoreSession().catch((err) => console.error('[App] restoreSession failed', err))
        return
      }
      if (cancelled) return
      await loadPublicDirectory().catch((err) => console.error('[App] loadPublicDirectory failed', err))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const requires = (targetRole, element) => <ProtectedRoute role={targetRole} currentRole={role}>{element}</ProtectedRoute>
  const portal = (targetRole) => <ProtectedLayout role={targetRole} currentRole={role} onLogout={logout} />
  const publicPage = (element) => <>{element}<SiteFooter /></>

  // First-load splash (plan §4.3): only on the very first bulk load, never on
  // subsequent refetches (dataLoaded stays true once the initial public
  // directory load completes).
  if (dataLoading && !dataLoaded) {
    return <div className="grid min-h-screen place-items-center bg-surface p-6"><div className="w-full max-w-md"><LoadingSkeleton rows={5} /></div></div>
  }

  // Route-level chunks (see the `lazyNamed` bindings above) resolve async on
  // first navigation to each — <Suspense> here shows the same splash used
  // for the initial bulk load above while that chunk downloads, instead of
  // the route panel flashing blank.
  return <Suspense fallback={<div className="grid min-h-screen place-items-center bg-surface p-6"><div className="w-full max-w-md"><LoadingSkeleton rows={5} /></div></div>}>
  <Routes>
    <Route path="/" element={publicPage(<PatientLanding />)} />
    <Route path="/for-doctors" element={publicPage(<ProviderLanding />)} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Register />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/search" element={publicPage(<SearchResults data={data} />)} />
    <Route path="/clinics" element={publicPage(<ClinicSearch data={data} />)} />
    <Route path="/about" element={publicPage(<PublicContent kind="about" />)} />
    <Route path="/blog" element={publicPage(<PublicContent kind="blog" />)} />
    <Route path="/contact" element={publicPage(<PublicContent kind="contact" />)} />
    <Route path="/terms" element={publicPage(<TermsOfService />)} />
    <Route path="/privacy" element={publicPage(<PrivacyPolicy />)} />
    <Route path="/delete-account" element={publicPage(<AccountDeletion />)} />
    <Route path="/doctors/:doctorId" element={publicPage(<DoctorProfile data={data} />)} />
    <Route path="/doctor/:doctorId" element={publicPage(<DoctorProfile data={data} />)} />
    <Route path="/emergency" element={publicPage(<EmergencyPage data={data} />)} />

    <Route path="/patient" element={portal('patient')}>
      <Route index element={requires('patient', <PatientDashboard data={data} />)} />
      <Route path="dashboard" element={requires('patient', <PatientDashboard data={data} />)} />
      <Route path="book" element={requires('patient', <Booking data={data} />)} />
      <Route path="appointments" element={requires('patient', <PatientAppointments data={data} />)} />
      <Route path="booking-history" element={requires('patient', <BookingHistory data={data} />)} />
      <Route path="records" element={requires('patient', <BookingHistory data={data} />)} />
      <Route path="queue" element={requires('patient', <QueueTracker data={data} />)} />
      <Route path="quick-book" element={requires('patient', <QuickClinicBooking data={data} />)} />
      <Route path="family" element={requires('patient', <Family data={data} />)} />
      <Route path="payments" element={requires('patient', <Payments data={data} />)} />
      <Route path="reviews" element={requires('patient', <PatientReviews data={data} />)} />
      <Route path="emergency" element={requires('patient', <PatientEmergencyBooking data={data} />)} />
      <Route path="notifications" element={requires('patient', <Notifications data={data} />)} />
      <Route path="profile" element={requires('patient', <PortalProfile data={data} />)} />
      <Route path="settings" element={requires('patient', <PatientSettings data={data} />)} />
    </Route>
    <Route path="/doctor" element={portal('doctor')}>
      <Route index element={requires('doctor', <DoctorDashboard data={data} />)} />
      <Route path="dashboard" element={requires('doctor', <DoctorDashboard data={data} />)} />
      <Route path="clinics" element={requires('doctor', <DoctorClinics data={data} />)} />
      <Route path="fees" element={requires('doctor', <DoctorFees data={data} />)} />
      <Route path="payments" element={requires('doctor', <DoctorPaymentSetup />)} />
      <Route path="queue" element={requires('doctor', <QueueManagement data={data} />)} />
      <Route path="appointments" element={requires('doctor', <DoctorAppointments data={data} />)} />
      <Route path="emr" element={requires('doctor', <DoctorEmr data={data} />)} />
      {/* COMPLETENESS FIX (audit Priority 1 #5): "Schedule" here silently local-drafted a
          follow-up with zero server effect and zero user feedback — not linked from any sidebar,
          but reachable by direct URL. Redirecting to the real Appointments list rather than
          leaving a feedback-less fake action live. */}
      <Route path="follow-ups" element={requires('doctor', <Navigate to="/doctor/appointments" replace />)} />
      <Route path="patients" element={requires('doctor', <PatientHistory data={data} />)} />
      <Route path="schedule" element={requires('doctor', <ClinicSchedule data={data} />)} />
      <Route path="analytics" element={requires('doctor', <Analytics data={data} />)} />
      <Route path="revenue" element={requires('doctor', <RevenueReports data={data} doctorOnly />)} />
      <Route path="profile" element={requires('doctor', <DoctorProfileEdit data={data} />)} />
      <Route path="staff" element={requires('doctor', <DoctorStaff data={data} />)} />
      <Route path="clinic" element={requires('doctor', <DoctorClinics data={data} />)} />
      <Route path="receptionists" element={requires('doctor', <DoctorStaff data={data} />)} />
      <Route path="reports" element={requires('doctor', <RevenueReports data={data} doctorOnly />)} />
      <Route path="reviews" element={requires('doctor', <DoctorReviews data={data} />)} />
      <Route path="notifications" element={requires('doctor', <SimpleInbox data={data} />)} />
    </Route>
    <Route path="/receptionist" element={portal('receptionist')}>
      <Route index element={requires('receptionist', <ReceptionDashboard data={data} />)} />
      <Route path="dashboard" element={requires('receptionist', <ReceptionDashboard data={data} />)} />
      <Route path="walk-in" element={requires('receptionist', <WalkIn data={data} />)} />
      <Route path="queue" element={requires('receptionist', <QueueManagement data={data} receptionist />)} />
      <Route path="check-in" element={requires('receptionist', <CheckIn data={data} />)} />
      <Route path="payments" element={requires('receptionist', <CashPayment data={data} />)} />
      <Route path="appointments" element={requires('receptionist', <ReceptionAppointments data={data} />)} />
      <Route path="availability" element={requires('receptionist', <ReceptionAvailability data={data} />)} />
      <Route path="emergency" element={requires('receptionist', <ReceptionEmergency data={data} />)} />
      <Route path="reports" element={requires('receptionist', <ReceptionReports data={data} />)} />
      <Route path="patients" element={requires('receptionist', <PortalPatients data={data} />)} />
      <Route path="notifications" element={requires('receptionist', <SimpleInbox data={data} />)} />
      <Route path="profile" element={requires('receptionist', <PortalProfile data={data} role="receptionist" />)} />
    </Route>
    <Route path="/admin" element={portal('admin')}>
      <Route index element={requires('admin', <AdminDashboard data={data} />)} />
      <Route path="dashboard" element={requires('admin', <AdminDashboard data={data} />)} />
      <Route path="doctors" element={requires('admin', <DoctorVerification data={data} />)} />
      <Route path="clinic-verification" element={requires('admin', <ClinicVerification data={data} />)} />
      {/* COMPLETENESS FIX (audit Priority 1 #4): this used to render a stub AdminForm with a
          local-only saveDraft() table showing blank City/Status columns for every user, on a
          stale comment claiming "no /patients endpoint" — that endpoint exists now and has its
          own correct, fully-working page at /admin/patients (ManagePatients), which also covers
          doctors via /admin/doctors and staff via /admin/receptionists. Redirecting rather than
          deleting the route so any old bookmark/link to /admin/users still lands somewhere real. */}
      <Route path="users" element={requires('admin', <Navigate to="/admin/patients" replace />)} />
      <Route path="clinics" element={requires('admin', <ManageClinics data={data} />)} />
      <Route path="cities" element={requires('admin', <CitiesAreas data={data} />)} />
      {/* COMPLETENESS FIX (audit Priority 1 #1): this used to render a stub AdminForm wired to a
          local-only saveDraft() — the green "Changes saved" message never reached the server, so
          a superadmin could believe they'd changed the platform-wide cancellation policy and be
          wrong. The real, working booking-rules form (backed by GET/PUT /admin/booking-rules)
          already lives inside PlatformSettings (also reachable via the "Settings" nav item) — now
          this route renders that same real component instead of the fake one. */}
      <Route path="booking-rules" element={requires('admin', <PlatformSettings />)} />
      <Route path="platform-fee" element={requires('admin', <PlatformCharges audience="admin" />)} />
      {/* COMPLETENESS FIX (audit Priority 1 #4): this was just the receptionist list relabeled,
          with no way to actually change anyone's role — a misleading duplicate of the real
          Receptionists page. Redirecting rather than deleting so any old bookmark/link still
          lands somewhere real. */}
      <Route path="roles" element={requires('admin', <Navigate to="/admin/receptionists" replace />)} />
      <Route path="patients" element={requires('admin', <ManagePatients data={data} />)} />
      <Route path="receptionists" element={requires('admin', <ManageReceptionists data={data} />)} />
      <Route path="revenue" element={requires('admin', <RevenueReports data={data} />)} />
      <Route path="appointments" element={requires('admin', <PortalAppointments data={data} role="admin" />)} />
      <Route path="specializations" element={requires('admin', <Specializations data={data} />)} />
      <Route path="reviews" element={requires('admin', <ReviewModeration data={data} />)} />
      <Route path="contacts" element={requires('admin', <ContactInbox data={data} />)} />
      <Route path="complaints" element={requires('admin', <Complaints data={data} />)} />
      <Route path="notifications" element={requires('admin', <Broadcast />)} />
      <Route path="broadcast" element={requires('admin', <Broadcast />)} />
      <Route path="audit" element={requires('admin', <AuditLog data={data} />)} />
      <Route path="activity" element={requires('admin', <AuditLog data={data} />)} />
      <Route path="activity-logs" element={requires('admin', <AuditLog data={data} />)} />
      <Route path="settings" element={requires('admin', <PlatformSettings />)} />
      <Route path="profile" element={requires('admin', <PortalProfile data={data} role="admin" />)} />
    </Route>
    <Route path="/super-admin" element={portal('superadmin')}>
      <Route index element={requires('superadmin', <SuperAdminDashboard data={data} />)} />
      <Route path="dashboard" element={requires('superadmin', <SuperAdminDashboard data={data} />)} />
      <Route path="entities" element={requires('superadmin', <SuperAdminEntities data={data} />)} />
      <Route path="doctors" element={requires('superadmin', <DoctorVerification data={data} />)} />
      <Route path="patients" element={requires('superadmin', <ManagePatients data={data} />)} />
      <Route path="clinics" element={requires('superadmin', <ManageClinics data={data} />)} />
      <Route path="receptionists" element={requires('superadmin', <ManageReceptionists data={data} />)} />
      <Route path="revenue" element={requires('superadmin', <RevenueReports data={data} />)} />
      <Route path="charges" element={requires('superadmin', <PlatformCharges audience="superadmin" />)} />
      <Route path="cities" element={requires('superadmin', <CitiesAreas data={data} />)} />
      <Route path="tenants" element={requires('superadmin', <ManageClinics data={data} />)} />
      <Route path="security" element={requires('superadmin', <AuditLog data={data} />)} />
      <Route path="cms" element={requires('superadmin', <Broadcast />)} />
      <Route path="settings" element={requires('superadmin', <PlatformSettings />)} />
      <Route path="profile" element={requires('superadmin', <PortalProfile data={data} role="superadmin" />)} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
  </Suspense>
}


