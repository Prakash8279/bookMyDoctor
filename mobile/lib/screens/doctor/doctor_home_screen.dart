import 'package:flutter/material.dart';

import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/role_scaffold.dart';
import 'doctor_appointments_screen.dart';
import 'doctor_clinic_hours_screen.dart';
import 'doctor_clinics_screen.dart';
import 'doctor_dashboard_screen.dart';
import 'doctor_queue_screen.dart';
import 'doctor_receptionists_screen.dart';
import 'doctor_revenue_reports_screen.dart';
import 'doctor_reviews_screen.dart';

/// Doctor portal shell — 100% parity with the web app's reachable Doctor sidebar
/// (client/src/components/Sidebar.jsx's `doctor` menu array — the only 11 pages a real
/// website user can ever click into):
/// 1. Dashboard (/doctor/dashboard)
/// 2. Queue management (/doctor/queue)
/// 3. Appointments (/doctor/appointments)
/// 4. Analytics (/doctor/analytics)
/// 5. Patient reviews (/doctor/reviews)
/// 6. Notifications (/doctor/notifications)
/// 7. Clinic settings (/doctor/clinic)
/// 8. OPD schedule (/doctor/schedule)
/// 9. Receptionists (/doctor/receptionists)
/// 10. Reports (/doctor/reports)
/// 11. My profile (/doctor/profile)
///
/// PARITY FIX (mobile parity audit — Doctor panel, user request: "doctor panel ko app me
/// complete same to same website jaisa"): this used to also carry "Consultation & EMR",
/// "Patients", "Fee management", "Payment setup", and "Payment collections" — each backed by
/// a web component (DoctorEmr/PatientHistory/DoctorFees/DoctorPaymentSetup at
/// client/src/pages/FeaturePages.jsx and StaffPages.jsx) that DOES have a route in App.jsx but
/// is absent from Sidebar.jsx's doctor menu and linked from nowhere else in client/src — a real
/// website user can never open any of them. Mobile had turned these unreachable web routes into
/// fully live, nav-visible screens, which is extra surface the website doesn't actually expose.
/// Fee editing already lives on the reachable "My profile" page (consultation/emergency fee
/// fields — StaffPages.jsx's DoctorProfileEdit, already ported to shared/profile_screen.dart);
/// payment records already show on the reachable "Reports" page; a doctor can never write a
/// payment anyway (POST /payments is receptionist/admin/superadmin only). The backing .dart
/// files (doctor_medical_records_screen.dart, doctor_patients_screen.dart,
/// doctor_fees_screen.dart, doctor_payment_setup_screen.dart, doctor_payments_screen.dart) are
/// left in place but now unreferenced — same treatment as the receptionist/patient audits' own
/// orphaned screens — rather than deleted, in case they're wanted back later.
class DoctorHomeScreen extends StatelessWidget {
  const DoctorHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const RoleScaffold(
      portalTitle: 'Doctor portal',
      items: [
        RoleNavItem(icon: Icons.dashboard_outlined, label: 'Dashboard', builder: _buildDashboard),
        RoleNavItem(icon: Icons.people_alt_outlined, label: 'Queue management', builder: _buildQueue),
        RoleNavItem(icon: Icons.event_note_outlined, label: 'Appointments', builder: _buildAppointments),
        RoleNavItem(icon: Icons.bar_chart_outlined, label: 'Analytics', builder: _buildAnalytics),
        RoleNavItem(icon: Icons.star_outline, label: 'Patient reviews', builder: _buildReviews),
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildNotifications),
        RoleNavItem(icon: Icons.local_hospital_outlined, label: 'Clinic settings', builder: _buildClinics),
        RoleNavItem(icon: Icons.schedule_outlined, label: 'OPD schedule', builder: _buildHours),
        RoleNavItem(icon: Icons.support_agent_outlined, label: 'Receptionists', builder: _buildReceptionists),
        RoleNavItem(icon: Icons.file_copy_outlined, label: 'Reports', builder: _buildReports),
        RoleNavItem(icon: Icons.person_outline, label: 'My profile', builder: _buildProfile),
      ],
    );
  }
}

Widget _buildDashboard(BuildContext context) => const DoctorDashboardScreen();
Widget _buildQueue(BuildContext context) => const DoctorQueueScreen();
Widget _buildAppointments(BuildContext context) => const DoctorAppointmentsScreen();
// PARITY FIX: this used to point at the same DoctorRevenueReportsScreen as "Reports" below —
// silently identical to that tab. Web's Analytics (StaffPages.jsx's `Analytics` component) is a
// genuinely different, distinct page: `data.analytics` is permanently null (§6.3 — no
// time-series endpoint exists in the API at all), so it always renders a dedicated
// "Analytics not available" empty state rather than any revenue/report data. Mirrored exactly.
Widget _buildAnalytics(BuildContext context) => const Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
          child: PageHeader(
            title: 'Analytics',
            subtitle: 'See appointment trends, completion rate, and workload.',
          ),
        ),
        Expanded(
          child: EmptyStateView(
            icon: Icons.bar_chart_outlined,
            title: 'Analytics not available',
            subtitle: 'The current API has no time-series analytics endpoint yet.',
          ),
        ),
      ],
    );
Widget _buildReviews(BuildContext context) => const DoctorReviewsScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildClinics(BuildContext context) => const DoctorClinicsScreen();
Widget _buildHours(BuildContext context) => const DoctorClinicHoursScreen();
Widget _buildReceptionists(BuildContext context) => const DoctorReceptionistsScreen();
Widget _buildReports(BuildContext context) => const DoctorRevenueReportsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();

