import 'package:flutter/material.dart';

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
import 'super_admin_dashboard_screen.dart';
import 'super_admin_entities_screen.dart';

/// Admin/Superadmin portal shell — 100% exact parity with the web application
/// (client/src/components/Sidebar.jsx lines 42 & 56).
///
/// For Admin (16 items):
/// 1. Dashboard (/admin/dashboard)
/// 2. Doctors (/admin/doctors)
/// 3. Patients (/admin/patients)
/// 4. Receptionists (/admin/receptionists)
/// 5. Clinics (/admin/clinics)
/// 6. Cities & areas (/admin/cities)
/// 7. Specializations (/admin/specializations)
/// 8. Appointments (/admin/appointments)
/// 9. Revenue (/admin/revenue)
/// 10. Review moderation (/admin/reviews)
/// 11. Complaints (/admin/complaints)
/// 12. Contact inbox (/admin/contacts)
/// 13. Notifications (/admin/notifications)
/// 14. Activity logs (/admin/activity-logs)
/// 15. Settings (/admin/settings)
/// 16. My profile (/admin/profile)
///
/// For Super Admin (21 items):
/// [Super Admin workspace - 10 items]
/// 1. Control center (/super-admin/dashboard)
/// 2. People & clinics (/super-admin/entities)
/// 3. Payments & revenue (/super-admin/revenue)
/// 4. Platform charges (/super-admin/charges)
/// 5. Cities & service areas (/super-admin/cities)
/// 6. Clinic tenants (/super-admin/tenants)
/// 7. Security & activity (/super-admin/security)
/// 8. Content & broadcasts (/super-admin/cms)
/// 9. System settings (/super-admin/settings)
/// 10. My profile (/super-admin/profile)
/// [Admin workspace - 11 items]
/// 11. Dashboard (/admin/dashboard)
/// 12. Doctors (/admin/doctors)
/// 13. Clinic verification (/admin/clinic-verification)
/// 14. Patients (/admin/patients)
/// 15. Specializations (/admin/specializations)
/// 16. Appointments (/admin/appointments)
/// 17. Booking rules (/admin/booking-rules)
/// 18. Receptionists (/admin/receptionists)
/// 19. Reviews (/admin/reviews)
/// 20. Complaints (/admin/complaints)
/// 21. Contact inbox (/admin/contacts)
class AdminHomeScreen extends StatelessWidget {
  final bool isSuperAdmin;
  const AdminHomeScreen({super.key, required this.isSuperAdmin});

  @override
  Widget build(BuildContext context) {
    if (isSuperAdmin) {
      return const RoleScaffold(
        portalTitle: 'Super Admin control panel',
        items: [
          // Super Admin workspace (first 10 items)
          RoleNavItem(icon: Icons.speed, label: 'Control center', builder: _buildControlCenter),
          RoleNavItem(icon: Icons.groups_outlined, label: 'People & clinics', builder: _buildEntities),
          RoleNavItem(icon: Icons.currency_rupee, label: 'Payments & revenue', builder: _buildRevenue),
          RoleNavItem(icon: Icons.percent_outlined, label: 'Platform charges', builder: _buildCharges),
          RoleNavItem(icon: Icons.map_outlined, label: 'Cities & service areas', builder: _buildCities),
          RoleNavItem(icon: Icons.apartment_outlined, label: 'Clinic tenants', builder: _buildClinicTenants),
          RoleNavItem(icon: Icons.shield_outlined, label: 'Security & activity', builder: _buildActivityLog),
          RoleNavItem(icon: Icons.campaign_outlined, label: 'Content & broadcasts', builder: _buildBroadcast),
          RoleNavItem(icon: Icons.settings_outlined, label: 'System settings', builder: _buildSystemSettings),
          RoleNavItem(icon: Icons.person_outline, label: 'My profile', builder: _buildProfile),

          // Admin workspace divider (items 11-21)
          RoleNavItem(
            icon: Icons.dashboard_outlined,
            label: 'Dashboard',
            builder: _buildDashboard,
            headerAbove: 'Admin workspace',
          ),
          RoleNavItem(icon: Icons.medical_services_outlined, label: 'Doctors', builder: _buildDoctors),
          RoleNavItem(icon: Icons.verified_outlined, label: 'Clinic verification', builder: _buildClinicVerification),
          RoleNavItem(icon: Icons.people_outline, label: 'Patients', builder: _buildPatients),
          RoleNavItem(icon: Icons.category_outlined, label: 'Specializations', builder: _buildSpecializations),
          RoleNavItem(icon: Icons.event_note_outlined, label: 'Appointments', builder: _buildAppointments),
          RoleNavItem(icon: Icons.rule_folder_outlined, label: 'Booking rules', builder: _buildBookingRules),
          RoleNavItem(icon: Icons.support_agent_outlined, label: 'Receptionists', builder: _buildReceptionists),
          RoleNavItem(icon: Icons.star_outline, label: 'Reviews', builder: _buildReviews),
          RoleNavItem(icon: Icons.report_problem_outlined, label: 'Complaints', builder: _buildComplaints),
          RoleNavItem(icon: Icons.mail_outline, label: 'Contact inbox', builder: _buildContact),
        ],
      );
    }

    return const RoleScaffold(
      portalTitle: 'Admin control panel',
      items: [
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
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildBroadcast),
        RoleNavItem(icon: Icons.history, label: 'Activity logs', builder: _buildActivityLog),
        RoleNavItem(icon: Icons.settings_outlined, label: 'Settings', builder: _buildSettings),
        RoleNavItem(icon: Icons.person_outline, label: 'My profile', builder: _buildProfile),
      ],
    );
  }
}

// Superadmin specific builders
Widget _buildControlCenter(BuildContext context) => const SuperAdminDashboardScreen();
Widget _buildEntities(BuildContext context) => const SuperAdminEntitiesScreen();
Widget _buildCharges(BuildContext context) => const AdminPlatformSettingsScreen(focusSection: AdminSettingsSection.charges);
Widget _buildClinicTenants(BuildContext context) => const AdminClinicsScreen(initialTabIndex: 1);
Widget _buildSystemSettings(BuildContext context) => const AdminPlatformSettingsScreen(focusSection: AdminSettingsSection.settings);
Widget _buildClinicVerification(BuildContext context) => const AdminClinicsScreen(initialTabIndex: 0, verificationOnly: true);
Widget _buildBookingRules(BuildContext context) => const AdminPlatformSettingsScreen(focusSection: AdminSettingsSection.bookingRules);

// Shared Admin & Superadmin builders
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
Widget _buildActivityLog(BuildContext context) => const AdminActivityLogScreen();
Widget _buildSettings(BuildContext context) => const AdminPlatformSettingsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();
