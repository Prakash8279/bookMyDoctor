import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/role_scaffold.dart';
import 'doctor_appointments_screen.dart';
import 'doctor_clinic_hours_screen.dart';
import 'doctor_medical_records_screen.dart';
import 'doctor_patients_screen.dart';
import 'doctor_payment_setup_screen.dart';
import 'doctor_queue_screen.dart';
import 'doctor_revenue_reports_screen.dart';
import 'doctor_reviews_screen.dart';

/// Doctor dashboard — 100% parity with web's DoctorDashboard (StaffPages.jsx):
/// Header with "Open OPD console", on-duty toggle banner, verification warning,
/// 4 StatCards (Today's bookings, Waiting patients, Today's revenue, Patient rating),
/// "Recent live records" with Connected badge, and "Quick actions".
class DoctorDashboardScreen extends StatefulWidget {
  const DoctorDashboardScreen({super.key});

  @override
  State<DoctorDashboardScreen> createState() => _DoctorDashboardScreenState();
}

class _DoctorDashboardScreenState extends State<DoctorDashboardScreen> {
  Future<_DashboardData>? _future;
  bool _dutyBusy = false;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<_DashboardData> _fetch() async {
    final futures = await Future.wait([
      ApiClient.instance
          .get('/appointments', query: {'pageSize': 50})
          .catchError((_) => ApiResponse(data: [])),
      ApiClient.instance
          .get('/queue', query: {'pageSize': 50})
          .catchError((_) => ApiResponse(data: [])),
      ApiClient.instance
          .get('/payments', query: {'pageSize': 50})
          .catchError((_) => ApiResponse(data: [])),
    ]);

    final appointments = <Appointment>[];
    for (final item in futures[0].list) {
      try {
        appointments.add(Appointment.fromJson(item));
      } catch (_) {}
    }

    final queue = <QueueTokenItem>[];
    for (final item in futures[1].list) {
      try {
        queue.add(QueueTokenItem.fromJson(item));
      } catch (_) {}
    }

    final payments = <PaymentItem>[];
    for (final item in futures[2].list) {
      try {
        payments.add(PaymentItem.fromJson(item));
      } catch (_) {}
    }

    return _DashboardData(
      appointments: appointments,
      queue: queue,
      payments: payments,
    );
  }

  Future<void> _toggleDuty(bool current) async {
    if (_dutyBusy) return;
    setState(() => _dutyBusy = true);
    final next = !current;
    try {
      // BUG FIX (mobile parity audit): there is no '/doctors/profile' route on the backend at all
      // (doctors.routes.js only has PATCH '/:id') — this call was silently failing (404) every
      // time, so "Go on/off duty" never actually worked on mobile. The real route is a full-
      // replace of 3 REQUIRED fields (doctors.validation.js#patchDoctor: onlineBooking,
      // allowRebooking, maxDaysAdvance all `exists({checkNull:true})`), so the other 2 must be
      // carried through from the current profile — same pattern as web's toggleDuty
      // (StaffPages.jsx) via updateDoctorBookingPolicy(currentUser.id, {...}).
      final auth = context.read<AuthProvider>();
      final doctorId = auth.user?.id;
      if (doctorId == null) throw Exception('Could not determine your doctor id.');
      await ApiClient.instance.patch('/doctors/$doctorId', body: {
        'onlineBooking': next,
        'allowRebooking': auth.profile?.allowRebooking ?? true,
        'maxDaysAdvance': auth.profile?.maxDaysAdvance ?? 7,
      });
      if (mounted) {
        await context.read<AuthProvider>().refreshProfile();
        if (mounted) {
          showSuccessSnack(context, next ? 'You are now marked on duty' : 'You are now marked off duty');
        }
      }
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _dutyBusy = false);
    }
  }

  void _goToQueue(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Queue')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Queue')), body: const DoctorQueueScreen()),
    ));
  }

  void _goToAppointments(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Appointments')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Appointments')), body: const DoctorAppointmentsScreen()),
    ));
  }

  void _goToEmr(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && (role.navigateToLabel('EMR') || role.navigateToLabel('Consultation'))) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Consultation & EMR')), body: const DoctorMedicalRecordsScreen()),
    ));
  }

  void _goToPatients(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Patients')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Patients')), body: const DoctorPatientsScreen()),
    ));
  }

  void _goToRevenue(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && (role.navigateToLabel('Analytics') || role.navigateToLabel('Reports') || role.navigateToLabel('Revenue'))) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Revenue')), body: const DoctorRevenueReportsScreen()),
    ));
  }

  void _goToReviews(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Reviews')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Reviews')), body: const DoctorReviewsScreen()),
    ));
  }

  void _goToPaymentSetup(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Payment setup')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Payment setup')), body: const DoctorPaymentSetupScreen()),
    ));
  }

  void _goToHours(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && (role.navigateToLabel('OPD schedule') || role.navigateToLabel('Schedule'))) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('OPD schedule')), body: const DoctorClinicHoursScreen()),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    final profile = auth.profile;
    final rawName = user?.name ?? 'Doctor';
    final firstName = rawName.replaceAll(RegExp(r'^dr\.?\s+', caseSensitive: false), '').split(' ').first;
    final onDuty = profile?.onlineBooking ?? true;

    return RefreshIndicator(
      onRefresh: () async => _load(),
      child: FutureBuilder<_DashboardData>(
        future: _future,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final data = snapshot.data;

          final appointments = data?.appointments ?? [];
          final queue = data?.queue ?? [];
          final payments = data?.payments ?? [];

          final todayStr = DateFormat('yyyy-MM-dd').format(DateTime.now());
          final todayBookings = appointments.where((a) => a.appointmentDate == todayStr && a.status != 'completed').length;
          final waitingPatients = queue.where((q) => q.status == 'waiting').length;
          final todayRevenue = payments.fold<double>(0, (sum, p) => sum + (p.fees.consultationFee ?? 0));
          final rating = profile?.rating ?? 5.0;

          final recentRecords = appointments.reversed.take(6).toList();

          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              // Mirrors web PageHeader with "Open OPD console" action
              PageHeader(
                kicker: 'Production database',
                title: 'Welcome, $firstName.',
                subtitle: 'Your authenticated workspace is connected to live records.',
                action: ElevatedButton(
                  onPressed: () => _goToQueue(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primaryDark,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: const Text('Open OPD console', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                ),
              ),

              // Duty status toggle banner (mirrors web's toggleDuty bar)
              Container(
                margin: const EdgeInsets.only(bottom: AppSpacing.md),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: onDuty ? AppColors.success : AppColors.textSecondary,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        onDuty ? 'Patients can currently find and book you.' : 'You are hidden from new patient bookings.',
                        style: const TextStyle(fontSize: 13, color: AppColors.textPrimary),
                      ),
                    ),
                    OutlinedButton(
                      onPressed: _dutyBusy ? null : () => _toggleDuty(onDuty),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: Text(
                        _dutyBusy ? 'Saving…' : (onDuty ? 'Go off duty' : 'Go on duty'),
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),

              // Verification warning if account is pending
              if (profile?.doctorStatus != null && profile?.doctorStatus != 'verified') ...[
                Container(
                  margin: const EdgeInsets.only(bottom: AppSpacing.md),
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF3C7),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFF59E0B)),
                  ),
                  child: Text(
                    profile?.doctorStatus == 'disabled'
                        ? 'Your account has been disabled by an admin. Contact support if you believe this is a mistake.'
                        : 'Your account is pending admin verification — patients cannot find or book you until verification is complete.',
                    style: const TextStyle(color: Color(0xFF92400E), fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ),
              ],

              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),

              if (data != null) ...[
                // Stat Cards (2x2 Grid)
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: "TODAY'S BOOKINGS",
                        value: '$todayBookings',
                        icon: Icons.event_note_outlined,
                        onTap: () => _goToAppointments(context),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'WAITING PATIENTS',
                        value: '$waitingPatients',
                        icon: Icons.people_alt_outlined,
                        onTap: () => _goToQueue(context),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: "TODAY'S REVENUE",
                        value: '₹${todayRevenue.toStringAsFixed(0)}',
                        icon: Icons.currency_rupee,
                        onTap: () => _goToRevenue(context),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'PATIENT RATING',
                        value: rating.toStringAsFixed(1),
                        icon: Icons.star,
                        onTap: () => _goToReviews(context),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),

                // Recent live records with Connected badge
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Recent live records', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppColors.success.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: const Text('Connected', style: TextStyle(color: AppColors.success, fontWeight: FontWeight.w700, fontSize: 11)),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        if (recentRecords.isEmpty)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
                            child: Text('No live records yet. Consultations will appear here as they happen.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                          )
                        else
                          ...recentRecords.map((item) {
                            final timeStr = '${item.appointmentDate} ${item.appointmentTime}'.trim();
                            return Container(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              decoration: const BoxDecoration(
                                border: Border(bottom: BorderSide(color: Color(0xFFF3F0EC))),
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(item.patient?.name ?? 'Patient', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                                        Text(
                                          timeStr.isNotEmpty ? timeStr : 'Today',
                                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                        ),
                                      ],
                                    ),
                                  ),
                                  StatusBadge(status: item.status),
                                ],
                              ),
                            );
                          }),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                // Quick actions
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Quick actions', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        const SizedBox(height: AppSpacing.sm),
                        _buildActionRow(
                          context,
                          icon: Icons.people_alt_outlined,
                          label: 'Queue management',
                          onTap: () => _goToQueue(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.event_note_outlined,
                          label: 'Appointments',
                          onTap: () => _goToAppointments(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.assignment_outlined,
                          label: 'Consultation & EMR',
                          onTap: () => _goToEmr(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.folder_shared_outlined,
                          label: 'Patient history',
                          onTap: () => _goToPatients(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.schedule_outlined,
                          label: 'OPD schedule & hours',
                          onTap: () => _goToHours(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.qr_code_2_outlined,
                          label: 'Clinic payment setup',
                          onTap: () => _goToPaymentSetup(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.bar_chart_outlined,
                          label: 'Analytics & revenue',
                          onTap: () => _goToRevenue(context),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _buildActionRow(BuildContext context, {required IconData icon, required String label, required VoidCallback onTap}) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border.withValues(alpha: 0.6)),
      ),
      child: ListTile(
        leading: Icon(icon, color: AppColors.primaryDark),
        title: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
        subtitle: const Text('Open live workspace', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        trailing: const Icon(Icons.chevron_right, color: AppColors.textSecondary),
        onTap: onTap,
      ),
    );
  }
}

class _DashboardData {
  final List<Appointment> appointments;
  final List<QueueTokenItem> queue;
  final List<PaymentItem> payments;
  _DashboardData({required this.appointments, required this.queue, required this.payments});
}
