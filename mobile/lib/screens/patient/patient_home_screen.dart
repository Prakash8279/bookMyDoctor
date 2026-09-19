import 'package:flutter/material.dart';

import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../../widgets/role_scaffold.dart';
import 'appointments_screen.dart';
import 'complaints_screen.dart';
import 'emergency_booking_screen.dart';
import 'family_members_screen.dart';
import 'medical_records_screen.dart';
import 'patient_search_screen.dart';
import 'payments_screen.dart';
import 'quick_clinic_booking_screen.dart';
import 'reviews_screen.dart';

/// Patient portal shell — full feature set per integration_plan.md's
/// PatientPages scope: search/book doctors, appointments (which also
/// carries token/queue-status info — see appointments_screen.dart's doc
/// comment for why there's no separate /queue-backed screen here),
/// medical records, family members, payments (read-only),
/// complaints, notifications, profile.
class PatientHomeScreen extends StatelessWidget {
  const PatientHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const RoleScaffold(
      portalTitle: 'Patient portal',
      items: [
        RoleNavItem(icon: Icons.search, label: 'Find Doctors', builder: _buildSearch),
        RoleNavItem(icon: Icons.event_note_outlined, label: 'My Appointments', builder: _buildAppointments),
        RoleNavItem(icon: Icons.folder_shared_outlined, label: 'Medical Records', builder: _buildRecords),
        RoleNavItem(icon: Icons.family_restroom, label: 'Family Members', builder: _buildFamily),
        RoleNavItem(icon: Icons.receipt_long_outlined, label: 'Payments', builder: _buildPayments),
        RoleNavItem(icon: Icons.rate_review_outlined, label: 'Reviews', builder: _buildReviews),
        RoleNavItem(icon: Icons.emergency, label: 'Emergency Booking', builder: _buildEmergency),
        RoleNavItem(icon: Icons.qr_code_2_outlined, label: 'Quick Clinic Booking', builder: _buildQuickClinic),
        RoleNavItem(icon: Icons.support_agent_outlined, label: 'Help & Complaints', builder: _buildComplaints),
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildNotifications),
        RoleNavItem(icon: Icons.person_outline, label: 'Profile', builder: _buildProfile),
      ],
    );
  }
}

Widget _buildSearch(BuildContext context) => const PatientSearchScreen();
Widget _buildAppointments(BuildContext context) => const PatientAppointmentsScreen();
Widget _buildRecords(BuildContext context) => const PatientMedicalRecordsScreen();
Widget _buildFamily(BuildContext context) => const FamilyMembersScreen();
Widget _buildPayments(BuildContext context) => const PatientPaymentsScreen();
Widget _buildReviews(BuildContext context) => const PatientReviewsScreen();
Widget _buildEmergency(BuildContext context) => const EmergencyBookingScreen();
Widget _buildQuickClinic(BuildContext context) => const QuickClinicBookingScreen();
Widget _buildComplaints(BuildContext context) => const ComplaintsScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();
