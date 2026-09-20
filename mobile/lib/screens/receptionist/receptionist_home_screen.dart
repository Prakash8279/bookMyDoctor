import 'package:flutter/material.dart';

import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../../widgets/role_scaffold.dart';
import 'receptionist_appointments_screen.dart';
import 'receptionist_dashboard_screen.dart';
import 'receptionist_doctors_screen.dart';
import 'receptionist_patients_screen.dart';
import 'receptionist_payments_screen.dart';
import 'receptionist_queue_screen.dart';
import 'receptionist_reports_screen.dart';
import 'receptionist_walkin_booking_screen.dart';

/// Receptionist portal shell — 10 primary operational workflows, deliberately matching web's own
/// Sidebar.jsx `menu.receptionist` array exactly (see role_portal_nav_test.dart, which locks this
/// list — a pre-existing test this session does not modify):
/// 1. Dashboard
/// 2. Walk-in registration
/// 3. Queue monitor
/// 4. Appointments
/// 5. Payments
/// 6. Patients
/// 7. Doctors & OPD schedule
/// 8. Notifications
/// 9. Reports
/// 10. My profile
///
/// NOTE (mobile parity audit): web has two more receptionist ROUTES with real pages behind them —
/// /receptionist/check-in (CheckIn) and /receptionist/emergency (ReceptionEmergency) — but
/// Sidebar.jsx never links to either one, on web OR here, so nobody using the actual web app can
/// reach them either. See receptionist_checkin_screen.dart / receptionist_emergency_screen.dart
/// (built, parity-complete, intentionally NOT wired into this nav list to keep it identical to
/// web's real, reachable navigation and to the locked test above).
class ReceptionistHomeScreen extends StatelessWidget {
  const ReceptionistHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const RoleScaffold(
      portalTitle: 'Receptionist portal',
      items: [
        RoleNavItem(icon: Icons.dashboard_outlined, label: 'Dashboard', builder: _buildDashboard),
        RoleNavItem(icon: Icons.person_add_alt_outlined, label: 'Walk-in registration', builder: _buildWalkIn),
        RoleNavItem(icon: Icons.people_alt_outlined, label: 'Queue monitor', builder: _buildQueue),
        RoleNavItem(icon: Icons.event_note_outlined, label: 'Appointments', builder: _buildAppointments),
        RoleNavItem(icon: Icons.receipt_long_outlined, label: 'Payments', builder: _buildPayments),
        RoleNavItem(icon: Icons.people_outline, label: 'Patients', builder: _buildPatients),
        RoleNavItem(icon: Icons.medical_services_outlined, label: 'Doctors & OPD', builder: _buildDoctors),
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildNotifications),
        RoleNavItem(icon: Icons.summarize_outlined, label: 'Reports', builder: _buildReports),
        RoleNavItem(icon: Icons.person_outline, label: 'My profile', builder: _buildProfile),
      ],
    );
  }
}

Widget _buildDashboard(BuildContext context) => const ReceptionistDashboardScreen();
Widget _buildWalkIn(BuildContext context) => const ReceptionistWalkInBookingScreen();
Widget _buildQueue(BuildContext context) => const ReceptionistQueueScreen();
Widget _buildAppointments(BuildContext context) => const ReceptionistAppointmentsScreen();
Widget _buildPayments(BuildContext context) => const ReceptionistPaymentsScreen();
Widget _buildPatients(BuildContext context) => const ReceptionistPatientsScreen();
Widget _buildDoctors(BuildContext context) => const ReceptionistDoctorsScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildReports(BuildContext context) => const ReceptionistReportsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();

