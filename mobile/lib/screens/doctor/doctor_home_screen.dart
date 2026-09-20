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
import 'doctor_fees_screen.dart';
import 'doctor_payment_setup_screen.dart';
import 'doctor_payments_screen.dart';
import 'doctor_queue_screen.dart';
import 'doctor_receptionists_screen.dart';
import 'doctor_revenue_reports_screen.dart';
import 'doctor_reviews_screen.dart';

/// Doctor portal shell — full feature set providing 100% parity
/// with the web application and all doctor capabilities:
/// 1. Dashboard (/doctor/dashboard)
/// 2. Queue management (/doctor/queue)
/// 3. Appointments (/doctor/appointments)
/// 4. Consultation & EMR (/doctor/emr)
/// 5. Patients directory (/doctor/patients)
/// 6. Analytics (/doctor/analytics)
/// 7. Patient reviews (/doctor/reviews)
/// 8. Notifications (/doctor/notifications)
/// 9. Clinic settings (/doctor/clinic)
/// 10. OPD schedule (/doctor/schedule)
/// 11. Fee management (/doctor/fees)
/// 12. Payment setup (/doctor/payments - UPI/QR)
/// 13. Payment collections (read-only collections)
/// 14. Receptionists (/doctor/receptionists)
/// 15. Reports (/doctor/reports)
/// 16. My profile (/doctor/profile)
class DoctorHomeScreen extends StatelessWidget {
  const DoctorHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const RoleScaffold(
      portalTitle: 'Doctor portal',
      items: [
        RoleNavItem(icon: Icons.dashboard_outlined, label: 'Dashboard', builder: _buildDashboard),
        RoleNavItem(icon: Icons.people_alt_outlined, label: 'Queue management', builder: _buildQueue),
        RoleNavItem(icon: Icons.event_note_outlined, label: 'Appointments', builder: _buildAppointments),
        RoleNavItem(icon: Icons.assignment_outlined, label: 'Consultation & EMR', builder: _buildEmr),
        RoleNavItem(icon: Icons.folder_shared_outlined, label: 'Patients', builder: _buildPatients),
        RoleNavItem(icon: Icons.bar_chart_outlined, label: 'Analytics', builder: _buildRevenue),
        RoleNavItem(icon: Icons.star_outline, label: 'Patient reviews', builder: _buildReviews),
        RoleNavItem(icon: Icons.notifications_none, label: 'Notifications', builder: _buildNotifications),
        RoleNavItem(icon: Icons.local_hospital_outlined, label: 'Clinic settings', builder: _buildClinics),
        RoleNavItem(icon: Icons.schedule_outlined, label: 'OPD schedule', builder: _buildHours),
        RoleNavItem(icon: Icons.attach_money_outlined, label: 'Fee management', builder: _buildFees),
        RoleNavItem(icon: Icons.qr_code_2_outlined, label: 'Payment setup', builder: _buildPaymentSetup),
        RoleNavItem(icon: Icons.receipt_long_outlined, label: 'Payment collections', builder: _buildPayments),
        RoleNavItem(icon: Icons.support_agent_outlined, label: 'Receptionists', builder: _buildReceptionists),
        RoleNavItem(icon: Icons.file_copy_outlined, label: 'Reports', builder: _buildReports),
        RoleNavItem(icon: Icons.person_outline, label: 'My profile', builder: _buildProfile),
      ],
    );
  }
}

Widget _buildDashboard(BuildContext context) => const DoctorDashboardScreen();
Widget _buildQueue(BuildContext context) => const DoctorQueueScreen();
Widget _buildAppointments(BuildContext context) => const DoctorAppointmentsScreen();
Widget _buildEmr(BuildContext context) => const DoctorMedicalRecordsScreen();
Widget _buildPatients(BuildContext context) => const DoctorPatientsScreen();
Widget _buildRevenue(BuildContext context) => const DoctorRevenueReportsScreen();
Widget _buildReviews(BuildContext context) => const DoctorReviewsScreen();
Widget _buildNotifications(BuildContext context) => const NotificationsScreen();
Widget _buildClinics(BuildContext context) => const DoctorClinicsScreen();
Widget _buildHours(BuildContext context) => const DoctorClinicHoursScreen();
Widget _buildFees(BuildContext context) => const DoctorFeesScreen();
Widget _buildPaymentSetup(BuildContext context) => const DoctorPaymentSetupScreen();
Widget _buildPayments(BuildContext context) => const DoctorPaymentsScreen();
Widget _buildReceptionists(BuildContext context) => const DoctorReceptionistsScreen();
Widget _buildReports(BuildContext context) => const DoctorRevenueReportsScreen();
Widget _buildProfile(BuildContext context) => const ProfileScreen();

