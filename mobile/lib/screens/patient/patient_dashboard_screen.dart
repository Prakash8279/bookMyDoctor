import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/india_time.dart';
import '../../models/admin_models.dart';
import '../../models/clinical_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../shared/notifications_screen.dart';
import '../../widgets/role_scaffold.dart';
import 'appointments_screen.dart';
import 'book_appointment_screen.dart';
import 'payment_required_screen.dart';
import 'queue_tracker_screen.dart';

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
      ApiClient.instance.getAll('/appointments', query: {'pageSize': 50}),
      ApiClient.instance.getAll('/notifications', query: {'pageSize': 10}),
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

    // PARITY FIX (mobile parity audit — Patient panel): web's PatientDashboard only counts
    // `['upcoming', 'confirmed'].includes(item.status)` as "upcoming" (PatientPages.jsx) — a
    // `pending_payment` booking isn't a confirmed visit yet (no token, nothing to queue for) and
    // web's dashboard simply doesn't surface it as the "Live Next Visit" card at all. Mobile's
    // "Pay to confirm" CTA for a pending-payment booking is a deliberate, useful mobile addition
    // (surfacing it here saves a trip to My Appointments) worth keeping — kept via
    // `pendingPaymentAppt` as a fallback below — but it must not inflate the UPCOMING stat count
    // or silently take over the queue widget the way lumping it into one list did before.
    final upcomingConfirmed = appointments
        .where((a) =>
            (a.status == 'upcoming' || a.status == 'confirmed') &&
            a.appointmentDate.compareTo(indiaToday()) >= 0)
        .toList();
    upcomingConfirmed
        .sort((a, b) => a.appointmentDate.compareTo(b.appointmentDate));
    Appointment? pendingPaymentAppt;
    for (final a in appointments) {
      if (a.status == 'pending_payment' &&
          a.appointmentDate.compareTo(indiaToday()) >= 0) {
        pendingPaymentAppt = a;
        break;
      }
    }
    final nextAppt = upcomingConfirmed.isNotEmpty
        ? upcomingConfirmed.first
        : pendingPaymentAppt;
    Map<String, dynamic>? queueStatus;

    if (nextAppt != null &&
        nextAppt.status != 'pending_payment' &&
        nextAppt.appointmentDate == indiaToday()) {
      try {
        final qRes = await ApiClient.instance.get('/queue/mine/${nextAppt.id}');
        queueStatus = qRes.map;
      } catch (_) {
        queueStatus = null;
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
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const BookAppointmentScreen()));
  }

  // COMPLETENESS FIX (mobile parity audit): web's "📞 Call clinic" quick action
  // (PatientPages.jsx `href="tel:+912240001111"`) — same hardcoded clinic number as web.
  Future<void> _callClinic(BuildContext context) async {
    final uri = Uri.parse('tel:+912240001111');
    if (!await launchUrl(uri) && context.mounted) {
      showErrorSnack(context, Exception('Could not start a call.'));
    }
  }

  void _goToAppointments(BuildContext context, {bool isHistory = false}) {
    if (widget.onNavigateToAppointments != null) {
      widget.onNavigateToAppointments!();
      return;
    }
    final role = RoleScaffold.of(context);
    if (isHistory) {
      if (role != null &&
          (role.navigateToLabel('Booking history') ||
              role.navigateToLabel('My appointments'))) {
        return;
      }
    } else {
      if (role != null && role.navigateToLabel('My appointments')) return;
    }
    Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => PatientAppointmentsScreen(isHistory: isHistory)));
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
          // PARITY FIX (mobile parity audit — Patient panel): see the matching comment in
          // _fetch() above — `upcomingConfirmed` (used for the UPCOMING stat card) now matches
          // web's `['upcoming', 'confirmed']` filter exactly, while `nextUpcoming` still falls
          // back to a pending-payment booking so the "Pay to confirm" CTA keeps working.
          final upcomingConfirmed = appointments
              .where((a) =>
                  (a.status == 'upcoming' || a.status == 'confirmed') &&
                  a.appointmentDate.compareTo(indiaToday()) >= 0)
              .toList();
          upcomingConfirmed
              .sort((a, b) => a.appointmentDate.compareTo(b.appointmentDate));
          Appointment? pendingPaymentAppt;
          for (final a in appointments) {
            if (a.status == 'pending_payment' &&
                a.appointmentDate.compareTo(indiaToday()) >= 0) {
              pendingPaymentAppt = a;
              break;
            }
          }
          final nextUpcoming = upcomingConfirmed.isNotEmpty
              ? upcomingConfirmed.first
              : pendingPaymentAppt;
          final queueData = data?.queueStatus;
          final notifications = data?.notifications ?? [];

          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              if (MediaQuery.sizeOf(context).width >= 960)
                PageHeader(
                  kicker: 'Production database',
                  title: 'Welcome, $firstName.',
                  subtitle:
                      'Your authenticated workspace is connected to live records.',
                  action: ElevatedButton.icon(
                    onPressed: () => _goToBook(context),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Book appointment'),
                  ),
                )
              else
                Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text('Welcome, $firstName.',
                        style: const TextStyle(
                            fontSize: 22, fontWeight: FontWeight.w600))),
              const PortalQuickActions(),
              const SizedBox(height: AppSpacing.sm),

              // Navigation is already provided by the compact quick-action grid.
              if (loading)
                const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpacing.xl),
                    child: LoadingView()),
              if (snapshot.hasError)
                ErrorBanner(error: snapshot.error!, onRetry: _load),

              // Recent live records section (mirrors web's section directly below stat cards)
              SectionCard(
                title: 'Recent live records',
                trailing: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: context.palette.success.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'Connected',
                    style: TextStyle(
                        color: context.palette.success,
                        fontWeight: FontWeight.w700,
                        fontSize: 11),
                  ),
                ),
                child: appointments.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                        child: EmptyStateView(
                          icon: Icons.calendar_today_outlined,
                          title: 'No appointments yet',
                          subtitle:
                              'Book your first appointment to see live records here.',
                        ),
                      )
                    : Column(
                        children: [
                          for (final appt in appointments.take(5))
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                  vertical: AppSpacing.xs),
                              child: InkWell(
                                onTap: () {
                                  Navigator.of(context).push(
                                    MaterialPageRoute(
                                        builder: (_) =>
                                            const PatientAppointmentsScreen()),
                                  );
                                },
                                borderRadius:
                                    BorderRadius.circular(AppRadius.button),
                                child: Container(
                                  padding: const EdgeInsets.all(AppSpacing.sm),
                                  decoration: BoxDecoration(
                                    color: context.palette.background,
                                    borderRadius:
                                        BorderRadius.circular(AppRadius.button),
                                    border: Border.all(
                                        color: context.palette.border),
                                  ),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              appt.doctor?.displayName ??
                                                  'Doctor',
                                              style: const TextStyle(
                                                  fontWeight: FontWeight.w700,
                                                  fontSize: 14),
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              '${appt.appointmentDate} · ${appt.displayTime} · ${appt.clinic?.name ?? "Clinic"}',
                                              style: TextStyle(
                                                  color: context
                                                      .palette.textSecondary,
                                                  fontSize: 12),
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
                    side: BorderSide(
                        color: context.palette.primary.withValues(alpha: 0.25)),
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
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: context.palette.tealDark
                                    .withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  CircleAvatar(
                                      radius: 4,
                                      backgroundColor: context.palette.success),
                                  const SizedBox(width: 6),
                                  Text(
                                    'Live Next Visit',
                                    style: TextStyle(
                                        color: context.palette.tealDark,
                                        fontWeight: FontWeight.w700,
                                        fontSize: 12),
                                  ),
                                ],
                              ),
                            ),
                            StatusBadge(status: nextUpcoming.status),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          nextUpcoming.doctor?.displayName ?? 'Doctor',
                          style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              color: context.palette.textPrimary),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${nextUpcoming.clinic?.name ?? "Clinic"} · ${nextUpcoming.appointmentDate}, ${nextUpcoming.displayTime}',
                          style: TextStyle(
                              color: context.palette.textSecondary,
                              fontSize: 13),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        // COMPLETENESS FIX (mobile parity audit): web's "View appointment details
                        // & QR" link, "Call clinic" and "Arrive at clinic" quick actions
                        // (PatientPages.jsx) — both non-call links go to the same appointments
                        // list on web (there's no separate "arrival" flow), matched here.
                        Wrap(
                          alignment: WrapAlignment.spaceBetween,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          runSpacing: AppSpacing.xs,
                          children: [
                            TextButton(
                              onPressed: () => _goToAppointments(context),
                              style: TextButton.styleFrom(
                                  padding: EdgeInsets.zero,
                                  minimumSize: Size.zero,
                                  tapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap),
                              child: const Text(
                                  'View appointment details & QR →',
                                  style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w700)),
                            ),
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                OutlinedButton(
                                  onPressed: () => _callClinic(context),
                                  style: OutlinedButton.styleFrom(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 10, vertical: 4)),
                                  child: const Text('📞 Call clinic',
                                      style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600)),
                                ),
                                const SizedBox(width: 6),
                                ElevatedButton(
                                  onPressed: () => _goToAppointments(context),
                                  style: ElevatedButton.styleFrom(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 10, vertical: 4)),
                                  child: const Text('Arrive at clinic',
                                      style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600)),
                                ),
                              ],
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.md),
                        // PARITY FIX (mobile parity audit — Patient panel): web's LiveQueueWidget
                        // (components/LiveQueueWidget.jsx) shows FOUR fields — Your token, Now
                        // serving, Patients ahead, Estimated wait — mobile only ever showed the
                        // first two. Added "Now serving" and "Estimated wait" as a second row.
                        Row(
                          children: [
                            Expanded(
                              child: _DashboardQueueStat(
                                label: 'Token number',
                                value: nextUpcoming.tokenNumber != null
                                    ? '#${nextUpcoming.tokenNumber}'
                                    : '—',
                                emphasize: true,
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: _DashboardQueueStat(
                                label: 'Now serving',
                                value: queueData?['nowServing'] != null
                                    ? '#${queueData!["nowServing"]}'
                                    : '—',
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Row(
                          children: [
                            Expanded(
                              child: _DashboardQueueStat(
                                label: 'Patients ahead',
                                value: queueData?['patientsAhead'] != null
                                    ? '${queueData!["patientsAhead"]} ahead'
                                    : '—',
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Expanded(
                              child: _DashboardQueueStat(
                                label: 'Estimated wait',
                                value: queueData?['estimatedWaitMinutes'] !=
                                        null
                                    ? '${queueData!["estimatedWaitMinutes"]} min'
                                    : '—',
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
                                final updated = await Navigator.of(context)
                                    .push<Appointment>(
                                  MaterialPageRoute(
                                      builder: (_) => PaymentRequiredScreen(
                                          appointment: nextUpcoming)),
                                );
                                if (updated != null && mounted) _load();
                              },
                              style: ElevatedButton.styleFrom(
                                backgroundColor: context.palette.danger,
                                foregroundColor: Colors.white,
                              ),
                              icon: const Icon(Icons.payment, size: 16),
                              label: const Text(
                                  'Complete payment to confirm appointment'),
                            ),
                          )
                        else
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: () {
                                Navigator.of(context).push(
                                  MaterialPageRoute(
                                      builder: (_) => QueueTrackerScreen(
                                          appointmentId: nextUpcoming.id)),
                                );
                              },
                              icon: const Icon(Icons.timelapse_outlined,
                                  size: 16),
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
                    side: BorderSide(color: context.palette.border),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      children: [
                        const Text('🏥', style: TextStyle(fontSize: 32)),
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          'No upcoming appointments scheduled',
                          style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: context.palette.textPrimary),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Book a visit with verified doctors, follow your live queue token, and skip waiting room delays.',
                          style: TextStyle(
                              fontSize: 12,
                              color: context.palette.textSecondary),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        ElevatedButton(
                          onPressed: () {
                            if (widget.onNavigateToBook != null) {
                              widget.onNavigateToBook!();
                            } else {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                    builder: (_) =>
                                        const BookAppointmentScreen()),
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
                        MaterialPageRoute(
                            builder: (_) =>
                                const NotificationsScreen(showLiveBadge: true)),
                      );
                    },
                    child: Text(
                      'View all',
                      style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: context.palette.primaryDark),
                    ),
                  ),
                  child: Column(
                    children: [
                      for (final n in notifications.take(2)) ...[
                        Container(
                          margin: const EdgeInsets.only(bottom: AppSpacing.xs),
                          padding: const EdgeInsets.all(AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: n.isRead
                                ? context.palette.surface
                                : context.palette.primaryLight
                                    .withValues(alpha: 0.4),
                            borderRadius: BorderRadius.circular(8),
                            border: Border(
                              left: BorderSide(
                                color: n.isRead
                                    ? context.palette.border
                                    : context.palette.primary,
                                width: 4,
                              ),
                              top: BorderSide(color: context.palette.border),
                              right: BorderSide(color: context.palette.border),
                              bottom: BorderSide(color: context.palette.border),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Expanded(
                                    child: Text(
                                      n.title,
                                      style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13),
                                    ),
                                  ),
                                  if (n.createdAt != null)
                                    Text(
                                      n.createdAt!.split('T').first,
                                      style: TextStyle(
                                          fontSize: 10,
                                          color: context.palette.textSecondary),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                n.body,
                                style: TextStyle(
                                    fontSize: 12,
                                    color: context.palette.textSecondary,
                                    height: 1.3),
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

class _DashboardQueueStat extends StatelessWidget {
  final String label;
  final String value;
  final bool emphasize;
  const _DashboardQueueStat(
      {required this.label, required this.value, this.emphasize = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: context.palette.background,
        borderRadius: BorderRadius.circular(AppRadius.button),
        border: Border.all(color: context.palette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(
                  color: context.palette.textSecondary, fontSize: 11)),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: emphasize
                  ? context.palette.primaryDark
                  : context.palette.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}
