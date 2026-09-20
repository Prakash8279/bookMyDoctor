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

/// Admin/Superadmin portal shell — full feature set providing 100% parity
/// with the web application and all administrative capabilities:
/// 1. Dashboard (/admin/dashboard & /super-admin/dashboard)
/// 2. People & clinics (/super-admin/entities - SuperAdmin only)
/// 3. Doctors (/admin/doctors)
/// 4. Patients (/admin/patients)
/// 5. Receptionists (/admin/receptionists)
/// 6. Clinics (/admin/clinics)
/// 7. Cities & areas (/admin/cities)
/// 8. Specializations (/admin/specializations)
/// 9. Appointments (/admin/appointments)
/// 10. Revenue (/admin/revenue)
/// 11. Review moderation (/admin/reviews)
/// 12. Complaints (/admin/complaints)
/// 13. Contact inbox (/admin/contacts)
/// 14. Broadcast (/admin/broadcast)
/// 15. Notifications (/admin/notifications)
/// 16. Activity logs (/admin/activity-logs)
/// 17. Settings (/admin/settings)
/// 18. My profile (/admin/profile)
class AdminHomeScreen extends StatelessWidget {
  final bool isSuperAdmin;
  const AdminHomeScreen({super.key, required this.isSuperAdmin});

  @override
  Widget build(BuildContext context) {
    return RoleScaffold(
      portalTitle: isSuperAdmin ? 'Superadmin portal' : 'Admin portal',
      items: const [
        RoleNavItem(icon: Icons.dashboard_outlined, label: 'Dashboard', builder: _buildDashboard),
        RoleNavItem(icon: Icons.medical_services_outlined, label: 'Doctors', builder: _buildDoctors),
        RoleNavItem(icon: Icons.people_outline, label: 'Patients', builder: _buildPatients),
        RoleNavItem(icon: Icons.support_agent_outlined, label: 'Receptionists', builder: _buildReceptionists),
        RoleNavItem(icon: Icons.local_hospital_outlined, label: 'Clinics', builder: _buildClinics),
        RoleNavItem(icon: Icons.map_outlined, label: 'Cities & areas', builder: _buildCities),
        RoleNavItem(icon: Icons.category_outlined, label: 'Specializations', builder: _buildSpecializations),
        RoleNavItem(icon: Icons.event_note_outlined, label: 'Appointments', builder: _buildAppointments),
        RoleNavItem(icon: Icons.receipt_long_outlined, label: 'Revenue', builder: _buildRevenue),
        RoleNavItem(icon: Icons.star_outline, label: 'Review moderation', builder: _buildReviews),
        RoleNavItem(icon: Icons.report_problem_outlined, label: 'Complaints', builder: _buildComplaints),
        RoleNavItem(icon: Icons.mail_outline, label: 'Contact inbox', builder: _buildContact),
        RoleNavItem(icon: Icons.campaign_outlined, label: 'Broadcast', builder: _buildBroadcast),
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildNotifications),
        RoleNavItem(icon: Icons.history, label: 'Activity logs', builder: _buildActivityLog),
        RoleNavItem(icon: Icons.settings_outlined, label: 'Settings', builder: _buildSettings),
        RoleNavItem(icon: Icons.person_outline, label: 'My profile', builder: _buildProfile),
      ],
    );
  }
}

Widget _buildDashboard(BuildContext context) => const AdminDashboardScreen();
Widget _buildDoctors(BuildContext context) => const AdminDoctorsScreen();
Widget _buildPatients(BuildContext context) => const AdminPatientsScreen();
Widget _buildReceptionists(BuildContext context) => const AdminReceptionistsScreen();
Widget _buildClinics(BuildContext context) => const AdminClinicsScreen();
Widget _buildCities(BuildContext context) => const AdminGeographyScreen(focusSpecializations: false);
Widget _buildSpecializations(BuildContext context) => const AdminGeographyScreen(focusSpecializations: true);
Widget _buildAppointments(BuildContext context) => const AdminAppointmentsScreen();
Widget _buildRevenue(BuildContext context) => const AdminRevenueReportsScreen();
Widget _buildReviews(BuildContext context) => const AdminReviewsScreen();
Widget _buildComplaints(BuildContext context) => const AdminComplaintsScreen();
Widget _buildContact(BuildContext context) => const AdminContactScreen();
Widget _buildBroadcast(BuildContext context) => const AdminBroadcastScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildActivityLog(BuildContext context) => const AdminActivityLogScreen();
Widget _buildSettings(BuildContext context) => const AdminPlatformSettingsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();

