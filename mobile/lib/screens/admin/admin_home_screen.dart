import 'package:flutter/material.dart';

import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../../widgets/role_scaffold.dart';
import 'admin_activity_log_screen.dart';
import 'admin_appointments_screen.dart';
import 'admin_broadcast_screen.dart';
import 'admin_clinics_screen.dart';
import 'admin_complaints_screen.dart';
import 'admin_contact_screen.dart';
import 'admin_dashboard_screen.dart';
import 'admin_doctors_screen.dart';
import 'admin_geography_screen.dart';
import 'admin_patients_screen.dart';
import 'admin_platform_settings_screen.dart';
import 'admin_receptionists_screen.dart';
import 'admin_reviews_screen.dart';
import 'admin_revenue_reports_screen.dart';

/// Admin/Superadmin portal shell — superadmin gets the same sections in
/// this build (the backend, not the client, decides what a superadmin can
/// do beyond admin; every /admin/* route and every admin-gated action
/// elsewhere authorizes 'admin','superadmin' identically —
/// integration_plan.md §1.18 and throughout). Full feature set: dashboard
/// stats, doctor onboarding, clinic approval queue, receptionist
/// management, reviews/complaints/contact moderation, geography, platform
/// charges/system settings/booking rules, broadcast notifications, and the
/// activity log, plus the shared notifications/profile screens.
class AdminHomeScreen extends StatelessWidget {
  final bool isSuperAdmin;
  const AdminHomeScreen({super.key, required this.isSuperAdmin});

  @override
  Widget build(BuildContext context) {
    return RoleScaffold(
      portalTitle: isSuperAdmin ? 'Superadmin portal' : 'Admin portal',
      items: [
        RoleNavItem(icon: Icons.dashboard_outlined, label: 'Dashboard', builder: _buildDashboard),
        RoleNavItem(icon: Icons.medical_services_outlined, label: 'Doctors', builder: _buildDoctors),
        // COMPLETENESS FIX (audit Priority 3 #5 — mobile parity): see admin_patients_screen.dart.
        RoleNavItem(icon: Icons.people_outline, label: 'Patients', builder: _buildPatients),
        RoleNavItem(icon: Icons.event_note_outlined, label: 'Appointments', builder: _buildAppointments),
        RoleNavItem(icon: Icons.local_hospital_outlined, label: 'Clinics', builder: _buildClinics),
        RoleNavItem(icon: Icons.support_agent_outlined, label: 'Receptionists', builder: _buildReceptionists),
        RoleNavItem(icon: Icons.star_outline, label: 'Reviews', builder: _buildReviews),
        RoleNavItem(icon: Icons.report_problem_outlined, label: 'Complaints', builder: _buildComplaints),
        RoleNavItem(icon: Icons.mail_outline, label: 'Contact Requests', builder: _buildContact),
        // COMPLETENESS FIX (mobile parity — client/src/pages/AdminPages.jsx's
        // RevenueReports(doctorOnly=false), mounted at web's /admin/revenue, had no mobile
        // equivalent; only the doctor-scoped DoctorRevenueReportsScreen existed).
        RoleNavItem(icon: Icons.bar_chart_outlined, label: 'Revenue reports', builder: _buildRevenue),
        RoleNavItem(icon: Icons.map_outlined, label: 'Geography', builder: _buildGeography),
        RoleNavItem(icon: Icons.settings_outlined, label: 'Platform Settings', builder: _buildSettings),
        RoleNavItem(icon: Icons.campaign_outlined, label: 'Broadcast', builder: _buildBroadcast),
        RoleNavItem(icon: Icons.history, label: 'Activity Log', builder: _buildActivityLog),
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildNotifications),
        RoleNavItem(icon: Icons.person_outline, label: 'Profile', builder: _buildProfile),
      ],
    );
  }
}

Widget _buildDashboard(BuildContext context) => const AdminDashboardScreen();
Widget _buildDoctors(BuildContext context) => const AdminDoctorsScreen();
Widget _buildPatients(BuildContext context) => const AdminPatientsScreen();
Widget _buildAppointments(BuildContext context) => const AdminAppointmentsScreen();
Widget _buildClinics(BuildContext context) => const AdminClinicsScreen();
Widget _buildReceptionists(BuildContext context) => const AdminReceptionistsScreen();
Widget _buildReviews(BuildContext context) => const AdminReviewsScreen();
Widget _buildComplaints(BuildContext context) => const AdminComplaintsScreen();
Widget _buildContact(BuildContext context) => const AdminContactScreen();
Widget _buildRevenue(BuildContext context) => const AdminRevenueReportsScreen();
Widget _buildGeography(BuildContext context) => const AdminGeographyScreen();
Widget _buildSettings(BuildContext context) => const AdminPlatformSettingsScreen();
Widget _buildBroadcast(BuildContext context) => const AdminBroadcastScreen();
Widget _buildActivityLog(BuildContext context) => const AdminActivityLogScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();
