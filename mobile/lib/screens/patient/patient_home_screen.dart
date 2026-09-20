import 'package:flutter/material.dart';

import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../../widgets/role_scaffold.dart';
import 'appointments_screen.dart';
import 'book_appointment_screen.dart';
import 'complaints_screen.dart';
import 'emergency_booking_screen.dart';
import 'family_members_screen.dart';
import 'medical_records_screen.dart';
import 'patient_dashboard_screen.dart';
import 'patient_search_screen.dart';
import 'payments_screen.dart';
import 'queue_tracker_screen.dart';
import 'quick_clinic_booking_screen.dart';
import 'reviews_screen.dart';

/// Patient portal shell — comprehensive feature set providing 100% parity
/// with the web application and all patient capabilities:
/// 1. Dashboard (/patient/dashboard)
/// 2. Find doctors (/search)
/// 3. Book appointment (/patient/book)
/// 4. My appointments (/patient/appointments)
/// 5. Queue tracker (/patient/queue)
/// 6. Booking history (/patient/records)
/// 7. Medical records (/medical-records)
/// 8. Quick clinic booking (/patient/quick-book)
/// 9. Emergency care (/patient/emergency)
/// 10. Payments (/patient/payments)
/// 11. Family members (/patient/family)
/// 12. My reviews (/patient/reviews)
/// 13. Help & complaints (/complaints)
/// 14. Notifications (/patient/notifications)
/// 15. My profile (/patient/profile)
class PatientHomeScreen extends StatelessWidget {
  const PatientHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const RoleScaffold(
      portalTitle: 'Patient portal',
      items: [
        RoleNavItem(icon: Icons.dashboard_outlined, label: 'Dashboard', builder: _buildDashboard),
        RoleNavItem(icon: Icons.search_rounded, label: 'Find doctors', builder: _buildSearch),
        RoleNavItem(icon: Icons.calendar_month_outlined, label: 'Book appointment', builder: _buildBook),
        RoleNavItem(icon: Icons.event_note_outlined, label: 'My appointments', builder: _buildAppointments),
        RoleNavItem(icon: Icons.confirmation_number_outlined, label: 'Queue tracker', builder: _buildQueue),
        RoleNavItem(icon: Icons.folder_shared_outlined, label: 'Booking history', builder: _buildHistory),
        RoleNavItem(icon: Icons.description_outlined, label: 'Medical records', builder: _buildRecords),
        RoleNavItem(icon: Icons.qr_code_scanner_outlined, label: 'Quick clinic booking', builder: _buildQuickClinic),
        RoleNavItem(icon: Icons.emergency_outlined, label: 'Emergency care', builder: _buildEmergency),
        RoleNavItem(icon: Icons.receipt_long_outlined, label: 'Payments', builder: _buildPayments),
        RoleNavItem(icon: Icons.people_outline, label: 'Family members', builder: _buildFamily),
        RoleNavItem(icon: Icons.star_outline_rounded, label: 'My reviews', builder: _buildReviews),
        RoleNavItem(icon: Icons.support_agent_outlined, label: 'Help & complaints', builder: _buildComplaints),
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildNotifications),
        RoleNavItem(icon: Icons.person_outline, label: 'My profile', builder: _buildProfile),
      ],
    );
  }
}

Widget _buildDashboard(BuildContext context) => const PatientDashboardScreen();
Widget _buildSearch(BuildContext context) => const PatientSearchScreen();
Widget _buildBook(BuildContext context) => const BookAppointmentScreen();
Widget _buildAppointments(BuildContext context) => const PatientAppointmentsScreen();
Widget _buildQueue(BuildContext context) => const QueueTrackerScreen(embedded: true);
Widget _buildHistory(BuildContext context) => const PatientAppointmentsScreen(isHistory: true);
Widget _buildRecords(BuildContext context) => const PatientMedicalRecordsScreen();
Widget _buildQuickClinic(BuildContext context) => const QuickClinicBookingScreen();
Widget _buildEmergency(BuildContext context) => const EmergencyBookingScreen();
Widget _buildPayments(BuildContext context) => const PatientPaymentsScreen();
Widget _buildFamily(BuildContext context) => const FamilyMembersScreen();
Widget _buildReviews(BuildContext context) => const PatientReviewsScreen();
Widget _buildComplaints(BuildContext context) => const ComplaintsScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();


