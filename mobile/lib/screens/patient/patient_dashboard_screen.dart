import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../models/clinical_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../shared/notifications_screen.dart';
import '../../widgets/role_scaffold.dart';
import 'appointments_screen.dart';
import 'book_appointment_screen.dart';
import 'complaints_screen.dart';
import 'emergency_booking_screen.dart';
import 'family_members_screen.dart';
import 'medical_records_screen.dart';
import 'patient_search_screen.dart';
import 'payments_screen.dart';
import 'payment_required_screen.dart';
import 'queue_tracker_screen.dart';
import 'quick_clinic_booking_screen.dart';

/// Patient Dashboard — mirrors the web app's PatientDashboard (src/pages/PatientPages.jsx) exactly:
/// - Kicker: "Production database"
/// - Title: "Welcome, {firstName}."
/// - Subtitle: "Your authenticated workspace is connected to live records."
/// - Quick action button: "Book appointment"
/// - Metric cards: TOTAL APPOINTMENTS, UPCOMING, PENDING PAYMENTS
/// - Live Next Visit & Queue Status card (when an upcoming appointment exists)
/// - Recent live records list with doctor, clinic, date/time, and status pills
class PatientDashboardScreen extends StatefulWidget {
  final VoidCallback? onNavigateToBook;
  final VoidCallback? onNavigateToAppointments;
  final VoidCallback? onNavigateToPayments;

  const PatientDashboardScreen({
    super.key,
    this.onNavigateToBook,
    this.onNavigateToAppointments,
    this.onNavigateToPayments,
  });

  @override
  State<PatientDashboardScreen> createState() => _PatientDashboardScreenState();
}

class _PatientDashboardData {
  final List<Appointment> appointments;
  final List<AppNotification> notifications;
  final Map<String, dynamic>? queueStatus;
  _PatientDashboardData({
    required this.appointments,
    this.notifications = const [],
    this.queueStatus,
  });
}

class _PatientDashboardScreenState extends State<PatientDashboardScreen> {
  Future<_PatientDashboardData>? _future;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  @override
  void dispose() {
    super.dispose();
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  Future<_PatientDashboardData> _fetch() async {
    final futures = await Future.wait([
      ApiClient.instance
          .get('/appointments', query: {'pageSize': 50})
          .catchError((_) => ApiResponse(data: [])),
      ApiClient.instance
          .get('/notifications', query: {'pageSize': 10})
          .catchError((_) => ApiResponse(data: [])),
    ]);

    final appointments = <Appointment>[];
    for (final item in futures[0].list) {
      try {
        appointments.add(Appointment.fromJson(item));
      } catch (_) {}
    }

    final notifications = <AppNotification>[];
    for (final item in futures[1].list) {
      try {
        notifications.add(AppNotification.fromJson(item));
      } catch (_) {}
    }
    
    final upcomingList = appointments
        .where((a) => a.status == 'upcoming' || a.status == 'confirmed' || a.status == 'pending_payment')
        .toList();
    Map<String, dynamic>? queueStatus;

    if (upcomingList.isNotEmpty) {
      final nextAppt = upcomingList.first;
      if (nextAppt.status != 'pending_payment') {
        try {
          final qRes = await ApiClient.instance.get('/queue/mine/${nextAppt.id}');
          queueStatus = qRes.map;
        } catch (_) {
          queueStatus = null;
        }
      }
    }

    return _PatientDashboardData(
      appointments: appointments,
      notifications: notifications,
      queueStatus: queueStatus,
    );
  }

  void _goToBook(BuildContext context) {
    if (widget.onNavigateToBook != null) {
      widget.onNavigateToBook!();
      return;
    }
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Book appointment')) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BookAppointmentScreen()));
  }

  void _goToAppointments(BuildContext context, {bool isHistory = false}) {
    if (widget.onNavigateToAppointments != null) {
      widget.onNavigateToAppointments!();
      return;
    }
    final role = RoleScaffold.of(context);
    if (isHistory) {
      if (role != null && role.navigateToLabel('Booking history')) return;
    } else {
      if (role != null && role.navigateToLabel('My appointments')) return;
    }
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => PatientAppointmentsScreen(isHistory: isHistory)));
  }

  void _goToPayments(BuildContext context) {
    if (widget.onNavigateToPayments != null) {
      widget.onNavigateToPayments!();
      return;
    }
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Payments')) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PatientPaymentsScreen()));
  }

  void _goToSearch(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Find doctors')) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PatientSearchScreen()));
  }

  void _goToRecords(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Medical records')) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PatientMedicalRecordsScreen()));
  }

  void _goToEmergency(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Emergency care')) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const EmergencyBookingScreen()));
  }

  void _goToQuickClinic(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Quick clinic booking')) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const QuickClinicBookingScreen()));
  }

  void _goToFamily(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Family members')) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const FamilyMembersScreen()));
  }

  void _goToComplaints(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Help & complaints')) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ComplaintsScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final userName = auth.user?.name ?? 'Patient';
    final firstName = userName.split(' ').first;

    return RefreshIndicator(
      onRefresh: () async => _load(),
      child: FutureBuilder<_PatientDashboardData>(
        future: _future,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final data = snapshot.data;
          final appointments = data?.appointments ?? [];
          final upcomingList = appointments
              .where((a) => a.status == 'upcoming' || a.status == 'confirmed' || a.status == 'pending_payment')
              .toList();
          final nextUpcoming = upcomingList.isNotEmpty ? upcomingList.first : null;
          final pendingPayments = appointments.where((a) => a.paymentStatus == 'pending').length;
          final queueData = data?.queueStatus;
          final notifications = data?.notifications ?? [];

          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              PageHeader(
                kicker: 'Production database',
                title: 'Welcome, $firstName.',
                subtitle: 'Your authenticated workspace is connected to live records.',
                action: ElevatedButton.icon(
                  onPressed: () => _goToBook(context),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Book appointment'),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),

              // Metric cards
              Row(
                children: [
                  Expanded(
                    child: StatCard(
                      label: 'TOTAL APPOINTMENTS',
                      value: appointments.length.toString(),
                      icon: Icons.calendar_month_outlined,
                      onTap: () => _goToAppointments(context, isHistory: true),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: StatCard(
                      label: 'UPCOMING',
                      value: upcomingList.length.toString(),
                      icon: Icons.schedule_outlined,
                      onTap: () => _goToAppointments(context),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: StatCard(
                      label: 'PENDING PAYMENTS',
                      value: pendingPayments.toString(),
                      icon: Icons.currency_rupee,
                      onTap: () => _goToPayments(context),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),

              // Healthcare services quick actions
              SectionCard(
                title: 'Healthcare services',
                child: GridView.count(
                  crossAxisCount: 3,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: AppSpacing.sm,
                  crossAxisSpacing: AppSpacing.sm,
                  childAspectRatio: 0.95,
                  children: [
                    _QuickServiceTile(
                      icon: Icons.search_rounded,
                      label: 'Find doctors',
                      onTap: () => _goToSearch(context),
                    ),
                    _QuickServiceTile(
                      icon: Icons.description_outlined,
                      label: 'Medical records',
                      onTap: () => _goToRecords(context),
                    ),
                    _QuickServiceTile(
                      icon: Icons.emergency_outlined,
                      label: 'Emergency care',
                      onTap: () => _goToEmergency(context),
                    ),
                    _QuickServiceTile(
                      icon: Icons.qr_code_scanner_outlined,
                      label: 'Quick clinic',
                      onTap: () => _goToQuickClinic(context),
                    ),
                    _QuickServiceTile(
                      icon: Icons.people_outline,
                      label: 'Family members',
                      onTap: () => _goToFamily(context),
                    ),
                    _QuickServiceTile(
                      icon: Icons.support_agent_outlined,
                      label: 'Complaints',
                      onTap: () => _goToComplaints(context),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),

              if (loading) const Padding(padding: EdgeInsets.symmetric(vertical: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),

              // Recent live records section (mirrors web's section directly below stat cards)
              SectionCard(
                title: 'Recent live records',

                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Text(
                    'Connected',
                    style: TextStyle(color: AppColors.success, fontWeight: FontWeight.w700, fontSize: 11),
                  ),
                ),
                child: appointments.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                        child: EmptyStateView(
                          icon: Icons.calendar_today_outlined,
                          title: 'No appointments yet',
                          subtitle: 'Book your first appointment to see live records here.',
                        ),
                      )
                    : Column(
                        children: [
                          for (final appt in appointments.take(5))
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
                              child: InkWell(
                                onTap: () {
                                  Navigator.of(context).push(
                                    MaterialPageRoute(builder: (_) => const PatientAppointmentsScreen()),
                                  );
                                },
                                borderRadius: BorderRadius.circular(AppRadius.button),
                                child: Container(
                                  padding: const EdgeInsets.all(AppSpacing.sm),
                                  decoration: BoxDecoration(
                                    color: AppColors.background,
                                    borderRadius: BorderRadius.circular(AppRadius.button),
                                    border: Border.all(color: AppColors.border),
                                  ),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              appt.doctor?.name ?? 'Doctor',
                                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              '${appt.appointmentDate} · ${appt.appointmentTime} · ${appt.clinic?.name ?? "Clinic"}',
                                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                            ),
                                          ],
                                        ),
                                      ),
                                      const SizedBox(width: AppSpacing.sm),
                                      StatusBadge(status: appt.status),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          const SizedBox(height: AppSpacing.sm),
                          TextButton(
                            onPressed: () => _goToAppointments(context),
                            child: const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text('View all appointments'),
                                SizedBox(width: 4),
                                Icon(Icons.arrow_forward, size: 14),
                              ],
                            ),
                          ),
                        ],
                      ),
              ),
              const SizedBox(height: AppSpacing.md),

              // Live Next Visit Card (mirrors web's "Live Next Visit" & empty state)
              if (nextUpcoming != null) ...[
                Card(
                  elevation: 1,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppRadius.card),
                    side: BorderSide(color: AppColors.primary.withValues(alpha: 0.25)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppColors.tealDark.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  CircleAvatar(radius: 4, backgroundColor: AppColors.success),
                                  SizedBox(width: 6),
                                  Text(
                                    'Live Next Visit',
                                    style: TextStyle(color: AppColors.tealDark, fontWeight: FontWeight.w700, fontSize: 12),
                                  ),
                                ],
                              ),
                            ),
                            StatusBadge(status: nextUpcoming.status),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          nextUpcoming.doctor?.name ?? 'Doctor',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${nextUpcoming.clinic?.name ?? "Clinic"} · ${nextUpcoming.appointmentDate}, ${nextUpcoming.appointmentTime}',
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        Row(
                          children: [
                            Expanded(
                              child: Container(
                                padding: const EdgeInsets.all(AppSpacing.sm),
                                decoration: BoxDecoration(
                                  color: AppColors.background,
                                  borderRadius: BorderRadius.circular(AppRadius.button),
                                  border: Border.all(color: AppColors.border),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Token number', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                                    const SizedBox(height: 2),
                                    Text(
                                      nextUpcoming.tokenNumber != null ? '#${nextUpcoming.tokenNumber}' : '—',
                                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.primaryDark),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: Container(
                                padding: const EdgeInsets.all(AppSpacing.sm),
                                decoration: BoxDecoration(
                                  color: AppColors.background,
                                  borderRadius: BorderRadius.circular(AppRadius.button),
                                  border: Border.all(color: AppColors.border),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Patients ahead', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                                    const SizedBox(height: 2),
                                    Text(
                                      queueData?['patientsAhead'] != null ? '${queueData!["patientsAhead"]} ahead' : '—',
                                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.md),
                        if (nextUpcoming.status == 'pending_payment')
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: () async {
                                final updated = await Navigator.of(context).push<Appointment>(
                                  MaterialPageRoute(builder: (_) => PaymentRequiredScreen(appointment: nextUpcoming)),
                                );
                                if (updated != null && mounted) _load();
                              },
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.danger,
                                foregroundColor: Colors.white,
                              ),
                              icon: const Icon(Icons.payment, size: 16),
                              label: const Text('Complete payment to confirm appointment'),
                            ),
                          )
                        else
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: () {
                                Navigator.of(context).push(
                                  MaterialPageRoute(builder: (_) => QueueTrackerScreen(appointmentId: nextUpcoming.id)),
                                );
                              },
                              icon: const Icon(Icons.timelapse_outlined, size: 16),
                              label: const Text('Open live queue tracker'),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
              ] else ...[
                Card(
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppRadius.card),
                    side: const BorderSide(color: AppColors.border),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      children: [
                        const Text('🏥', style: TextStyle(fontSize: 32)),
                        const SizedBox(height: AppSpacing.sm),
                        const Text(
                          'No upcoming appointments scheduled',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Book a visit with verified doctors, follow your live queue token, and skip waiting room delays.',
                          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        ElevatedButton(
                          onPressed: () {
                            if (widget.onNavigateToBook != null) {
                              widget.onNavigateToBook!();
                            } else {
                              Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => const BookAppointmentScreen()),
                              );
                            }
                          },
                          child: const Text('Book an appointment'),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
              ],
              if (notifications.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.md),
                SectionCard(
                  title: 'Queue & Care Alerts',
                  trailing: TextButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const NotificationsScreen()),
                      );
                    },
                    child: const Text(
                      'View all',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.primaryDark),
                    ),
                  ),
                  child: Column(
                    children: [
                      for (final n in notifications.take(2)) ...[
                        Container(
                          margin: const EdgeInsets.only(bottom: AppSpacing.xs),
                          padding: const EdgeInsets.all(AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: n.isRead ? AppColors.surface : AppColors.primaryLight.withValues(alpha: 0.4),
                            borderRadius: BorderRadius.circular(8),
                            border: Border(
                              left: BorderSide(
                                color: n.isRead ? AppColors.border : AppColors.primary,
                                width: 4,
                              ),
                              top: const BorderSide(color: AppColors.border),
                              right: const BorderSide(color: AppColors.border),
                              bottom: const BorderSide(color: AppColors.border),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Expanded(
                                    child: Text(
                                      n.title,
                                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                    ),
                                  ),
                                  if (n.createdAt != null)
                                    Text(
                                      n.createdAt!.split('T').first,
                                      style: const TextStyle(fontSize: 10, color: AppColors.textSecondary),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                n.body,
                                style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, height: 1.3),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _QuickServiceTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _QuickServiceTile({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.button),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.button),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(
                color: AppColors.primaryLight,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 20, color: AppColors.primaryDark),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 11, color: AppColors.textPrimary),
            ),
          ],
        ),
      ),
    );
  }
}

