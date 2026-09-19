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

/// Receptionist portal shell — full feature set per integration_plan.md
/// §1.8/§1.9/§1.12: front-desk dashboard, walk-in booking on behalf of a
/// patient, clinic queue console, appointment lifecycle, cash/UPI/card
/// payment recording, and read-only doctor/OPD-hours lookup, plus the
/// shared notifications/profile screens. Every list here is already
/// clinic-scoped server-side to this receptionist's own `clinicId` — no
/// client-side filtering needed.
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
        RoleNavItem(icon: Icons.medical_services_outlined, label: 'Doctors', builder: _buildDoctors),
        RoleNavItem(icon: Icons.people_outline, label: 'Patients', builder: _buildPatients),
        RoleNavItem(icon: Icons.summarize_outlined, label: 'Reports', builder: _buildReports),
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildNotifications),
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
Widget _buildDoctors(BuildContext context) => const ReceptionistDoctorsScreen();
Widget _buildPatients(BuildContext context) => const ReceptionistPatientsScreen();
Widget _buildReports(BuildContext context) => const ReceptionistReportsScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();
