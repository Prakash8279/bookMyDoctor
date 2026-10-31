import 'package:flutter/material.dart';

import '../shared/profile_screen.dart';
import '../../widgets/role_scaffold.dart';
import 'appointments_screen.dart';
import 'book_appointment_screen.dart';
import 'family_members_screen.dart';
import 'patient_dashboard_screen.dart';
import 'payments_screen.dart';
import 'queue_tracker_screen.dart';

/// Patient portal shell. The visible navigation mirrors the website sidebar exactly.
class PatientHomeScreen extends StatelessWidget {
  const PatientHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const RoleScaffold(
      portalTitle: 'Patient portal',
      items: [
        RoleNavItem(
            icon: Icons.dashboard_outlined,
            label: 'Dashboard',
            builder: _buildDashboard),
        RoleNavItem(
            icon: Icons.calendar_month_outlined,
            label: 'Book appointment',
            builder: _buildBook),
        RoleNavItem(
            icon: Icons.event_note_outlined,
            label: 'My appointments',
            builder: _buildAppointments),
        RoleNavItem(
            icon: Icons.confirmation_number_outlined,
            label: 'Queue tracker',
            builder: _buildQueue),
        RoleNavItem(
            icon: Icons.receipt_long_outlined,
            label: 'Payments',
            builder: _buildPayments),
        RoleNavItem(
            icon: Icons.people_outline,
            label: 'Family members',
            builder: _buildFamily),
        RoleNavItem(
            icon: Icons.person_outline,
            label: 'My profile',
            builder: _buildProfile),
      ],
    );
  }
}

Widget _buildDashboard(BuildContext context) => const PatientDashboardScreen();
Widget _buildBook(BuildContext context) => const BookAppointmentScreen();
Widget _buildAppointments(BuildContext context) =>
    const PatientAppointmentsScreen();
Widget _buildQueue(BuildContext context) =>
    const QueueTrackerScreen(embedded: true);
Widget _buildPayments(BuildContext context) => const PatientPaymentsScreen();
Widget _buildFamily(BuildContext context) => const FamilyMembersScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();
