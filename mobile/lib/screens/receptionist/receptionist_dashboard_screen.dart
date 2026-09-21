import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/clinical_models.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/role_scaffold.dart';
import 'receptionist_appointments_screen.dart';
import 'receptionist_patients_screen.dart';
import 'receptionist_payments_screen.dart';
import 'receptionist_queue_screen.dart';
import 'receptionist_walkin_booking_screen.dart';

/// Receptionist dashboard — 100% parity with web's ReceptionDashboard (StaffPages.jsx):
/// Header with "Register walk-in", 4 StatCards (Today's patients, Consultations done,
/// Waiting in queue, Pending payments), "Recent live records" with Connected badge,
/// "Quick actions", and "Assigned doctors".
class ReceptionistDashboardScreen extends StatefulWidget {
  const ReceptionistDashboardScreen({super.key});

  @override
  State<ReceptionistDashboardScreen> createState() => _ReceptionistDashboardScreenState();
}

class _ReceptionistDashboardScreenState extends State<ReceptionistDashboardScreen> {
  Future<_DashboardData>? _future;

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

  // BUG FIX (user report: "dashbord ka data jo database se aana hai ooo nahi aa raha hai"): this
  // used to send `date: today` on the `/appointments` fetch, which — since GET /appointments has
  // no default date scoping server-side (unlike /queue, which always defaults to today) — silently
  // narrowed the ENTIRE clinic appointments list down to just today's rows, before any of
  // Consultations done / Pending payments / Recent live records were computed from it. Web's own
  // ReceptionDashboard (StaffPages.jsx) fetches the full, undated `data.appointments` and only
  // filters locally for the "Today's patients" stat card — every other stat and the records list
  // uses the complete set. Mirrored here now: the fetch is undated, and only `todaysPatients`
  // (computed in build() below) filters by date.
  // DIAGNOSTIC FIX (user report: "dashbord ka data jo database se aana hai ooo nahi aa raha
  // hai"): each of these three calls used to have its own `.catchError((_) => ApiResponse(data:
  // []))`, silently turning any real fetch failure into "zero appointments/queue/payments" with
  // no way to distinguish that from a genuinely empty clinic. Since the Appointments/Payments
  // tabs (same endpoints, same account) show real data, this was hiding the actual error. Now a
  // genuine failure propagates out of Future.wait to the FutureBuilder's existing
  // `snapshot.hasError` branch (ErrorBanner) instead of rendering all-zero stat cards.
  Future<_DashboardData> _fetch() async {
    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    final clinicId = context.read<AuthProvider>().profile?.clinicId;
    final futures = <Future<ApiResponse>>[
      ApiClient.instance.get('/appointments', query: {'pageSize': 100}),
      ApiClient.instance.get('/queue', query: {'date': today, 'pageSize': 100}),
      ApiClient.instance.get('/payments', query: {'pageSize': 50}),
    ];
    final results = await Future.wait(futures);
    Clinic? clinic;
    if (clinicId != null && clinicId.isNotEmpty) {
      try {
        final res = await ApiClient.instance.get('/clinics/$clinicId');
        clinic = Clinic.fromJson(res.map);
      } catch (_) {
        // Non-fatal
      }
    }
    final appointments = <Appointment>[];
    for (final item in results[0].list) {
      try {
        appointments.add(Appointment.fromJson(item));
      } catch (_) {}
    }
    final queue = <QueueTokenItem>[];
    for (final item in results[1].list) {
      try {
        queue.add(QueueTokenItem.fromJson(item));
      } catch (_) {}
    }
    final payments = <PaymentItem>[];
    for (final item in results[2].list) {
      try {
        payments.add(PaymentItem.fromJson(item));
      } catch (_) {}
    }
    return _DashboardData(
      appointments: appointments,
      queue: queue,
      payments: payments,
      clinic: clinic,
    );
  }

  void _goToWalkIn(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Walk-in')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Walk-in')), body: const ReceptionistWalkInBookingScreen()),
    ));
  }

  void _goToPatients(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Patients')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Patients')), body: const ReceptionistPatientsScreen()),
    ));
  }

  void _goToAppointments(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Appointments')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Appointments')), body: const ReceptionistAppointmentsScreen()),
    ));
  }

  void _goToQueue(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Queue')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Queue')), body: const ReceptionistQueueScreen()),
    ));
  }

  void _goToPayments(BuildContext context) {
    final role = RoleScaffold.of(context);
    if (role != null && role.navigateToLabel('Payments')) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(appBar: AppBar(title: const Text('Payments')), body: const ReceptionistPaymentsScreen()),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    final firstName = (user?.name ?? 'Receptionist').split(' ').first;

    return RefreshIndicator(
      onRefresh: () async => _load(),
      child: FutureBuilder<_DashboardData>(
        future: _future,
        builder: (context, snapshot) {
          final loading = snapshot.connectionState != ConnectionState.done;
          final data = snapshot.data;

          final appointments = data?.appointments ?? [];
          final queue = data?.queue ?? [];
          final clinic = data?.clinic;

          // BUG FIX: only this stat is date-filtered (matches web's own local
          // `item.appointmentDate === today` filter) — every other stat/list below uses the full,
          // undated appointments list fetched in _fetch() above.
          final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
          final todaysPatients = appointments.where((a) => a.appointmentDate == today).length;
          final consultationsDone = appointments.where((a) => a.status == 'completed').length;
          final waitingInQueue = queue.where((q) => q.status == 'waiting').length;
          final pendingPayments = appointments.where((a) => a.paymentStatus == 'pending').length;

          final recentRecords = appointments.reversed.take(6).toList();

          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              // Mirrors web PageHeader with "Register walk-in" action
              PageHeader(
                kicker: 'Production database',
                title: 'Welcome, $firstName.',
                subtitle: 'Your authenticated workspace is connected to live records.',
                action: ElevatedButton(
                  onPressed: () => _goToWalkIn(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primaryDark,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: const Text('Register walk-in', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                ),
              ),

              if (loading) const Padding(padding: EdgeInsets.only(top: AppSpacing.xl), child: LoadingView()),
              if (snapshot.hasError) ErrorBanner(error: snapshot.error!, onRetry: _load),

              if (data != null) ...[
                // Stat Cards (2x2 Grid matching web)
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: "TODAY'S PATIENTS",
                        value: '$todaysPatients',
                        icon: Icons.people_outline,
                        onTap: () => _goToPatients(context),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'CONSULTATIONS DONE',
                        value: '$consultationsDone',
                        icon: Icons.check,
                        onTap: () => _goToAppointments(context),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: StatCard(
                        label: 'WAITING IN QUEUE',
                        value: '$waitingInQueue',
                        icon: Icons.format_list_bulleted,
                        onTap: () => _goToQueue(context),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: StatCard(
                        label: 'PENDING PAYMENTS',
                        value: '$pendingPayments',
                        icon: Icons.currency_rupee,
                        onTap: () => _goToPayments(context),
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
                            child: Text('No live records yet. Walk-ins and bookings will appear here as they happen.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                          )
                        else
                          ...recentRecords.asMap().entries.map((entry) {
                            final index = entry.key;
                            final item = entry.value;
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
                                        // COMPLETENESS FIX (mobile parity audit — Receptionist
                                        // panel): web's "Recent live records" table has a
                                        // "Details" column (StaffPages.jsx's ReceptionDashboard,
                                        // `Appointment #${index + 1}`) — this card never showed it.
                                        Text(
                                          'Appointment #${index + 1}',
                                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
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
                          icon: Icons.person_add_alt_outlined,
                          label: 'Walk-in registration',
                          onTap: () => _goToWalkIn(context),
                        ),
                        _buildActionRow(
                          context,
                          icon: Icons.people_alt_outlined,
                          label: 'Queue monitor',
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
                          icon: Icons.receipt_long_outlined,
                          label: 'Payments',
                          onTap: () => _goToPayments(context),
                        ),
                      ],
                    ),
                  ),
                ),

                // Assigned doctors
                if (clinic != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text('Assigned doctors', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                              Text(clinic.name, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          if (clinic.doctors.isEmpty)
                            const Padding(
                              padding: EdgeInsets.symmetric(vertical: AppSpacing.sm),
                              child: Text('No doctors assigned to clinic yet.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                            )
                          else
                            // PARITY FIX (mobile parity audit — Receptionist panel, user request:
                            // "receptionist me jitna v extra feature add hai website se oo sab
                            // hata do"): this used to show an isOwner/isPrimary-derived "Clinic
                            // Owner"/"Primary Doctor"/"Doctor" role label — web's own
                            // ReceptionDashboard (StaffPages.jsx) shows the doctor's
                            // specialization here instead, never an ownership role.
                            ...clinic.doctors.map((doc) {
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
                                          Text(doc.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                                          Text(
                                            doc.specialization?.name ?? 'Specialization not added',
                                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                          ),
                                        ],
                                      ),
                                    ),
                                    StatusBadge(status: doc.onlineBooking ? 'active' : 'paused'),
                                  ],
                                ),
                              );
                            }),
                        ],
                      ),
                    ),
                  ),
                ],
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
  final Clinic? clinic;
  _DashboardData({required this.appointments, required this.queue, required this.payments, this.clinic});
}
