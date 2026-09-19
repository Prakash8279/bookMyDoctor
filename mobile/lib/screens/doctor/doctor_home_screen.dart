import 'package:flutter/material.dart';

import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../../widgets/role_scaffold.dart';
import 'doctor_appointments_screen.dart';
import 'doctor_clinic_hours_screen.dart';
import 'doctor_clinics_screen.dart';
import 'doctor_dashboard_screen.dart';
import 'doctor_medical_records_screen.dart';
import 'doctor_patients_screen.dart';
import 'doctor_payment_setup_screen.dart';
import 'doctor_payments_screen.dart';
import 'doctor_queue_screen.dart';
import 'doctor_receptionists_screen.dart';
import 'doctor_revenue_reports_screen.dart';
import 'doctor_reviews_screen.dart';

/// Doctor portal shell — full feature set per integration_plan.md §1.4-§1.12:
/// dashboard snapshot, live queue console, appointment lifecycle, writing
/// medical records, OPD hours+closures, clinic management,
/// clinic receptionist staff, read-only payments, plus the shared
/// notifications/profile screens.
class DoctorHomeScreen extends StatelessWidget {
  const DoctorHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const RoleScaffold(
      portalTitle: 'Doctor portal',
      items: [
        RoleNavItem(icon: Icons.dashboard_outlined, label: 'Dashboard', builder: _buildDashboard),
        // COMPLETENESS FIX (mobile parity — content/copy): labels below match the web sidebar's
        // own wording (components/Sidebar.jsx#menu.doctor) and/or each destination screen's own
        // PageHeader title, so the drawer entry and the page it opens read as the same feature.
        RoleNavItem(icon: Icons.people_alt_outlined, label: 'Queue management', builder: _buildQueue),
        RoleNavItem(icon: Icons.event_note_outlined, label: 'Appointments', builder: _buildAppointments),
        RoleNavItem(icon: Icons.folder_shared_outlined, label: 'Consultation & EMR', builder: _buildRecords),
        RoleNavItem(icon: Icons.schedule_outlined, label: 'OPD schedule', builder: _buildHours),
        RoleNavItem(icon: Icons.local_hospital_outlined, label: 'Clinic settings', builder: _buildClinics),
        RoleNavItem(icon: Icons.people_outline, label: 'Patients', builder: _buildPatients),
        RoleNavItem(icon: Icons.support_agent_outlined, label: 'Receptionists', builder: _buildReceptionists),
        RoleNavItem(icon: Icons.receipt_long_outlined, label: 'Payments', builder: _buildPayments),
        RoleNavItem(icon: Icons.bar_chart_outlined, label: 'My revenue reports', builder: _buildRevenue),
        RoleNavItem(icon: Icons.qr_code_2_outlined, label: 'Payment Setup', builder: _buildPaymentSetup),
        // COMPLETENESS FIX (audit Priority 3 #4 — mobile parity): see doctor_reviews_screen.dart.
        RoleNavItem(icon: Icons.star_outline, label: 'Patient reviews', builder: _buildReviews),
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildNotifications),
        RoleNavItem(icon: Icons.person_outline, label: 'My profile', builder: _buildProfile),
      ],
    );
  }
}

Widget _buildDashboard(BuildContext context) => const DoctorDashboardScreen();
Widget _buildQueue(BuildContext context) => const DoctorQueueScreen();
Widget _buildAppointments(BuildContext context) => const DoctorAppointmentsScreen();
Widget _buildRecords(BuildContext context) => const DoctorMedicalRecordsScreen();
Widget _buildHours(BuildContext context) => const DoctorClinicHoursScreen();
Widget _buildClinics(BuildContext context) => const DoctorClinicsScreen();
Widget _buildPatients(BuildContext context) => const DoctorPatientsScreen();
Widget _buildReceptionists(BuildContext context) => const DoctorReceptionistsScreen();
Widget _buildPayments(BuildContext context) => const DoctorPaymentsScreen();
Widget _buildRevenue(BuildContext context) => const DoctorRevenueReportsScreen();
Widget _buildPaymentSetup(BuildContext context) => const DoctorPaymentSetupScreen();
Widget _buildReviews(BuildContext context) => const DoctorReviewsScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();
