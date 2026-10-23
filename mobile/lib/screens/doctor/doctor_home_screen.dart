import 'package:flutter/material.dart';

import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../shared/legal_policies_screen.dart';
import '../../widgets/role_scaffold.dart';
import 'doctor_appointments_screen.dart';
import 'doctor_analytics_screen.dart';
import 'doctor_clinic_hours_screen.dart';
import 'doctor_clinics_screen.dart';
import 'doctor_dashboard_screen.dart';
import 'doctor_queue_screen.dart';
import 'doctor_receptionists_screen.dart';
import 'doctor_revenue_reports_screen.dart';
import 'doctor_reviews_screen.dart';

/// Doctor portal shell — parity with the web app's reachable Doctor sidebar:
/// 1. Dashboard (/doctor/dashboard)
/// 2. Queue management (/doctor/queue)
/// 3. Appointments (/doctor/appointments)
/// 4. Consultation & EMR (/doctor/emr)
/// 5. Analytics (/doctor/analytics)
/// Analytics is derived from the doctor's scoped appointment/payment APIs; EMR remains the
/// write-enabled clinical workflow already enforced by the backend's doctor-only route.
class DoctorHomeScreen extends StatelessWidget {
  const DoctorHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const RoleScaffold(
      portalTitle: 'Doctor portal',
      items: [
        RoleNavItem(
            icon: Icons.dashboard_outlined,
            label: 'Dashboard',
            builder: _buildDashboard),
        RoleNavItem(
            icon: Icons.people_alt_outlined,
            label: 'Queue management',
            builder: _buildQueue),
        RoleNavItem(
            icon: Icons.event_note_outlined,
            label: 'Appointments',
            builder: _buildAppointments),
        RoleNavItem(
            icon: Icons.bar_chart_outlined,
            label: 'Analytics',
            builder: _buildAnalytics),
        RoleNavItem(
            icon: Icons.star_outline,
            label: 'Patient reviews',
            builder: _buildReviews),
        RoleNavItem(
            icon: Icons.notifications_none,
            label: 'Notifications',
            builder: _buildNotifications),
        RoleNavItem(
            icon: Icons.local_hospital_outlined,
            label: 'Clinic settings',
            builder: _buildClinics),
        RoleNavItem(
            icon: Icons.schedule_outlined,
            label: 'OPD schedule',
            builder: _buildHours),
        RoleNavItem(
            icon: Icons.support_agent_outlined,
            label: 'Receptionists',
            builder: _buildReceptionists),
        RoleNavItem(
            icon: Icons.file_copy_outlined,
            label: 'Reports',
            builder: _buildReports),
        RoleNavItem(
            icon: Icons.description_outlined,
            label: 'Help & Policies',
            builder: _buildPolicies),
        RoleNavItem(
            icon: Icons.person_outline,
            label: 'My profile',
            builder: _buildProfile),
      ],
    );
  }
}

Widget _buildDashboard(BuildContext context) => const DoctorDashboardScreen();
Widget _buildQueue(BuildContext context) => const DoctorQueueScreen();
Widget _buildAppointments(BuildContext context) =>
    const DoctorAppointmentsScreen();
// PARITY FIX: this used to point at the same DoctorRevenueReportsScreen as "Reports" below —
// silently identical to that tab. Web's Analytics (StaffPages.jsx's `Analytics` component) is a
// genuinely different, distinct page: `data.analytics` is permanently null (§6.3 — no
// time-series endpoint exists in the API at all), so it always renders a dedicated
// "Analytics not available" empty state rather than any revenue/report data. Mirrored exactly.
Widget _buildAnalytics(BuildContext context) => const DoctorAnalyticsScreen();
Widget _buildReviews(BuildContext context) => const DoctorReviewsScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildClinics(BuildContext context) => const DoctorClinicsScreen();
Widget _buildHours(BuildContext context) => const DoctorClinicHoursScreen();
Widget _buildReceptionists(BuildContext context) =>
    const DoctorReceptionistsScreen();
Widget _buildReports(BuildContext context) =>
    const DoctorRevenueReportsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();
Widget _buildPolicies(BuildContext context) => const LegalPoliciesScreen();
