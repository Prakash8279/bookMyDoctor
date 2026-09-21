import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../models/clinical_models.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'book_appointment_screen.dart';
import 'queue_tracker_screen.dart';

class DoctorDetailScreen extends StatefulWidget {
  final String doctorId;
  const DoctorDetailScreen({super.key, required this.doctorId});

  @override
  State<DoctorDetailScreen> createState() => _DoctorDetailScreenState();
}

class _DoctorDetailScreenState extends State<DoctorDetailScreen> {
  late Future<_DoctorDetailData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_DoctorDetailData> _load() async {
    final doctorRes = await ApiClient.instance.get('/doctors/${widget.doctorId}');
    final reviewsRes = await ApiClient.instance
        .get('/reviews', query: {'doctorId': widget.doctorId, 'pageSize': 20})
        .catchError((_) => ApiResponse(data: []));
    final reviews = <ReviewItem>[];
    for (final item in reviewsRes.list) {
      try {
        reviews.add(ReviewItem.fromJson(item));
      } catch (_) {}
    }
    // COMPLETENESS FIX (mobile parity audit): web's DoctorProfile finds any of the patient's own
    // appointments with this doctor (`data.appointments.find(item => item.doctor?.id ===
    // doctor.id)`, PublicPages.jsx) and shows a live-queue preview for it — mobile never checked
    // for this at all, so a patient re-visiting a doctor they already booked with never saw their
    // live token status here (they'd have to go find it under Queue tracker separately).
    String? myAppointmentId;
    try {
      final apptRes = await ApiClient.instance.get('/appointments', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: []));
      for (final item in apptRes.list) {
        final a = Appointment.fromJson(item);
        if (a.doctor?.id == widget.doctorId) {
          myAppointmentId = a.id;
          break;
        }
      }
    } catch (_) {}

    final doctor = DoctorDirectoryItem.fromJson(doctorRes.map);

    // PARITY FIX (mobile parity audit — Patient panel): GET /doctors/:id's embedded clinic
    // summary (DoctorDirectoryItem.clinics, a ClinicSummary) only ever carries id/name/city/
    // area — it never included phone/address. Web's DoctorProfile (PublicPages.jsx) works around
    // the exact same backend gap by separately looking up the FULL clinic record from the public
    // clinics directory it already has loaded (`data.clinics.find(...)`) instead of the doctor's
    // embedded summary. Mobile has no such directory preloaded, so this fetches the one clinic
    // detail it actually needs (GET /clinics/:id, same endpoint the web app's clinics list is
    // built from) to get the real phone/address — a patient couldn't see either at all before.
    Clinic? primaryClinicDetail;
    final primaryClinicId = doctor.clinics.isNotEmpty ? doctor.clinics.first.id : null;
    if (primaryClinicId != null) {
      try {
        final clinicRes = await ApiClient.instance.get('/clinics/$primaryClinicId');
        primaryClinicDetail = Clinic.fromJson(clinicRes.map);
      } catch (_) {
        // Non-fatal — the screen still shows the name/city/area it already had from the
        // embedded summary; phone/address simply won't be available for this load.
      }
    }

    return _DoctorDetailData(
      doctor: doctor,
      reviews: reviews,
      myAppointmentId: myAppointmentId,
      primaryClinicDetail: primaryClinicDetail,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Doctor profile')),
      body: FutureBuilder<_DoctorDetailData>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
          if (snapshot.hasError) {
            return Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: ErrorBanner(error: snapshot.error!, onRetry: () => setState(() { _future = _load(); })),
            );
          }
          final data = snapshot.data!;
          final doctor = data.doctor;
          final primaryClinic = doctor.clinics.isNotEmpty ? doctor.clinics.first : null;
          final initials = doctor.name.split(' ').where((s) => s.isNotEmpty).take(2).map((s) => s[0]).join().toUpperCase();
          final minAdvance = doctor.minBookingAdvanceAmount ?? 0.0;

          return ListView(
            padding: EdgeInsets.zero,
            children: [
              // 1. Charcoal Hero Section (mirrors web DoctorProfile hero)
              Container(
                color: AppColors.charcoal,
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(AppRadius.card),
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            initials.isNotEmpty ? initials : 'DR',
                            style: const TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 22,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Icon(Icons.verified, size: 14, color: Colors.white.withValues(alpha: 0.8)),
                                  const SizedBox(width: 4),
                                  Text(
                                    'VERIFIED PRACTITIONER',
                                    style: TextStyle(
                                      color: Colors.white.withValues(alpha: 0.75),
                                      fontWeight: FontWeight.w700,
                                      fontSize: 11,
                                      letterSpacing: 1.1,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                doctor.name,
                                style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                doctor.qualification ?? doctor.specialization?.name ?? 'General practitioner',
                                style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 13),
                              ),
                              const SizedBox(height: 6),
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(Icons.location_on_outlined, size: 14, color: Colors.white.withValues(alpha: 0.6)),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      '${primaryClinic?.name ?? "Clinic not added"}${primaryClinic?.city != null ? ", ${primaryClinic!.city}" : ""}',
                                      style: TextStyle(color: Colors.white.withValues(alpha: 0.65), fontSize: 12),
                                    ),
                                  ),
                                ],
                              ),
                              if (doctor.emergencyAvailable) ...[
                                const SizedBox(height: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AppColors.danger,
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: const Text(
                                    'Emergency available',
                                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 11),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),
                    const Divider(color: Colors.white12),
                    const SizedBox(height: AppSpacing.xs),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Text(
                              doctor.rating.toStringAsFixed(1),
                              style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800),
                            ),
                            const SizedBox(width: 6),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Row(
                                  children: [
                                    Icon(Icons.star, color: AppColors.gold, size: 14),
                                    SizedBox(width: 2),
                                    Text('Patient rating', style: TextStyle(color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.w600)),
                                  ],
                                ),
                                Text(
                                  '${doctor.reviewCount} verified review(s)',
                                  style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 11),
                                ),
                              ],
                            ),
                          ],
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text('Consultation', style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 11)),
                            Text(
                              '₹${doctor.consultationFee.toStringAsFixed(0)}',
                              style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // 2. Main Content Body
              Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Book clinic appointment card (prominent top card, matching web sidebar)
                    Card(
                      elevation: 2,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppRadius.card),
                        side: const BorderSide(color: AppColors.primary, width: 1.5),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(Icons.calendar_month, size: 16, color: AppColors.primaryDark),
                                SizedBox(width: 6),
                                Text(
                                  'BOOK CLINIC APPOINTMENT',
                                  style: TextStyle(
                                    color: AppColors.primaryDark,
                                    fontWeight: FontWeight.w700,
                                    fontSize: 11,
                                    letterSpacing: 1.1,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            Text(
                              '₹${doctor.consultationFee.toStringAsFixed(0)}',
                              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              minAdvance > 0
                                  ? '₹${minAdvance.toStringAsFixed(0)} online advance confirms the booking — the remaining fee is payable at the clinic.'
                                  : 'Online payment of the full consultation fee confirms the booking.',
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                            ),
                            const SizedBox(height: 6),
                            const Text(
                              'Your visit time and queue token are assigned from the doctor\'s OPD schedule.',
                              style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                            ),
                            const SizedBox(height: AppSpacing.md),
                            PrimaryButton(
                              label: 'Continue to booking',
                              onPressed: doctor.onlineBooking ? () => _handleBook(context, doctor) : null,
                            ),
                            if (!doctor.onlineBooking)
                              const Padding(
                                padding: EdgeInsets.only(top: 8),
                                child: Text(
                                  'This doctor is not accepting online bookings right now.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: AppColors.danger, fontSize: 12, fontWeight: FontWeight.w600),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // COMPLETENESS FIX (mobile parity audit): web's PatientLiveQueuePreview.
                    if (data.myAppointmentId != null) ...[
                      _DoctorLiveQueuePreview(appointmentId: data.myAppointmentId!),
                      const SizedBox(height: AppSpacing.md),
                    ],

                    // About Doctor card
                    SectionCard(
                      title: 'About ${doctor.name}',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            doctor.bio ?? 'No description added yet.',
                            style: const TextStyle(height: 1.5, color: AppColors.textPrimary),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          const Divider(height: 1),
                          const SizedBox(height: AppSpacing.md),
                          Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Experience', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                                    const SizedBox(height: 2),
                                    Text('${doctor.experienceYears ?? 0} years', style: const TextStyle(fontWeight: FontWeight.w700)),
                                  ],
                                ),
                              ),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Languages', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                                    const SizedBox(height: 2),
                                    Text(
                                      doctor.languages.isNotEmpty ? doctor.languages.join(', ') : 'Not specified',
                                      style: const TextStyle(fontWeight: FontWeight.w700),
                                    ),
                                  ],
                                ),
                              ),
                              // PARITY FIX (mobile parity audit — Patient panel): web's DoctorProfile
                              // (PublicPages.jsx) shows a third "Availability" stat here alongside
                              // Experience/Languages, falling back through scheduleSummary then an
                              // onlineBooking-aware message — mobile only ever showed two stats.
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Availability', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                                    const SizedBox(height: 2),
                                    Text(
                                      doctor.scheduleSummary ??
                                          (!doctor.onlineBooking ? 'Not accepting online bookings' : 'Schedule not added'),
                                      style: const TextStyle(fontWeight: FontWeight.w700),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // Clinic Information & Weekly OPD Schedule (matches web's table)
                    SectionCard(
                      title: 'Clinic information',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            primaryClinic?.name ?? 'Clinic not added',
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${primaryClinic?.area != null ? "${primaryClinic!.area}, " : ""}${primaryClinic?.city ?? ""}',
                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                          ),
                          // PARITY FIX (mobile parity audit — Patient panel): web's DoctorProfile
                          // shows the clinic's phone/address (cross-referenced from the full clinic
                          // directory) here — mobile showed only name/area/city from the embedded
                          // summary. data.primaryClinicDetail is the separately-fetched full Clinic
                          // record (see _load()); it's null if that lookup failed, in which case we
                          // simply omit these lines rather than show empty fields.
                          if (data.primaryClinicDetail?.address != null && data.primaryClinicDetail!.address!.isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(Icons.location_on_outlined, size: 15, color: AppColors.textSecondary),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    data.primaryClinicDetail!.address!,
                                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                                  ),
                                ),
                              ],
                            ),
                          ],
                          if (data.primaryClinicDetail?.phone != null && data.primaryClinicDetail!.phone!.isNotEmpty) ...[
                            const SizedBox(height: 6),
                            InkWell(
                              onTap: () => _callClinic(data.primaryClinicDetail!.phone!),
                              child: Row(
                                children: [
                                  const Icon(Icons.call_outlined, size: 15, color: AppColors.primaryDark),
                                  const SizedBox(width: 6),
                                  Text(
                                    data.primaryClinicDetail!.phone!,
                                    style: const TextStyle(color: AppColors.primaryDark, fontSize: 13, fontWeight: FontWeight.w700),
                                  ),
                                ],
                              ),
                            ),
                          ],
                          const SizedBox(height: AppSpacing.md),
                          const Text(
                            'Weekly OPD Schedule',
                            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          if (doctor.schedule.isNotEmpty) ...[
                            for (final slot in doctor.schedule)
                              Container(
                                margin: const EdgeInsets.only(bottom: 6),
                                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                                decoration: BoxDecoration(
                                  color: AppColors.background,
                                  borderRadius: BorderRadius.circular(AppRadius.button),
                                  border: Border.all(color: AppColors.border),
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(slot.day, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                                    Text(slot.hours, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                  ],
                                ),
                              ),
                          ] else ...[
                            Text(
                              doctor.scheduleSummary ?? 'Weekly OPD schedule not added yet.',
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),

                    // Patient Reviews card
                    SectionCard(
                      title: 'Patient reviews',
                      trailing: Text(
                        '${doctor.rating.toStringAsFixed(1)} / 5 (${data.reviews.length} reviews)',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                      ),
                      child: data.reviews.isEmpty
                          ? const Padding(
                              padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
                              child: Text(
                                'Reviews will appear after completed appointments.',
                                style: TextStyle(color: AppColors.textSecondary),
                              ),
                            )
                          : Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                for (final r in data.reviews.take(5))
                                  Container(
                                    margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                                    padding: const EdgeInsets.all(AppSpacing.md),
                                    decoration: BoxDecoration(
                                      color: AppColors.background,
                                      borderRadius: BorderRadius.circular(AppRadius.button),
                                      border: Border.all(color: AppColors.border),
                                    ),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                          children: [
                                            Text(
                                              r.patient.name ?? 'Verified patient',
                                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                                            ),
                                            Row(
                                              children: List.generate(
                                                5,
                                                (i) => Icon(
                                                  i < r.rating ? Icons.star : Icons.star_border,
                                                  size: 13,
                                                  color: AppColors.warning,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                        if (r.text != null && r.text!.isNotEmpty) ...[
                                          const SizedBox(height: 6),
                                          Text(r.text!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                                        ],
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  // PARITY FIX (mobile parity audit — Patient panel): tap-to-call for the clinic phone number
  // shown above, matching the "_call" pattern already used on the guest clinic directory screen.
  Future<void> _callClinic(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'\s'), ''));
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  // COMPLETENESS FIX (mobile parity): this screen is now reachable while signed out (guest
  // browsing — see screens/guest/guest_home_screen.dart), same as the web app's public
  // /doctors/:id page. Booking itself still requires an account (POST /appointments is
  // authenticated-only), so a guest tapping "Book appointment" is prompted to log in here
  // instead of hitting an API error.
  void _handleBook(BuildContext context, DoctorDirectoryItem doctor) {
    final auth = context.read<AuthProvider>();
    if (!auth.isLoggedIn) {
      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Login required'),
          content: const Text('Please log in or create a patient account to book an appointment.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
            TextButton(
              onPressed: () {
                Navigator.of(context).pop();
                Navigator.of(context).popUntil((route) => route.isFirst);
              },
              child: const Text('Log in'),
            ),
          ],
        ),
      );
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => BookAppointmentScreen(preselectedDoctor: doctor)),
    );
  }
}

class _DoctorDetailData {
  final DoctorDirectoryItem doctor;
  final List<ReviewItem> reviews;
  final String? myAppointmentId;
  // PARITY FIX (mobile parity audit — Patient panel): see the comment in _load() above — the
  // doctor's embedded ClinicSummary never carries phone/address, so this holds the separately
  // fetched full Clinic record (may be null if that lookup failed or there's no primary clinic).
  final Clinic? primaryClinicDetail;
  _DoctorDetailData({
    required this.doctor,
    required this.reviews,
    this.myAppointmentId,
    this.primaryClinicDetail,
  });
}

/// Compact "your live queue status with this doctor" card — mirrors web's
/// PatientLiveQueuePreview (PublicPages.jsx), polling GET /queue/mine/:appointmentId every 15s
/// same as the dedicated QueueTrackerScreen, but shown inline here since a patient landing back on
/// a doctor's profile page is a natural place to check their token without navigating away.
class _DoctorLiveQueuePreview extends StatefulWidget {
  final String appointmentId;
  const _DoctorLiveQueuePreview({required this.appointmentId});

  @override
  State<_DoctorLiveQueuePreview> createState() => _DoctorLiveQueuePreviewState();
}

class _DoctorLiveQueuePreviewState extends State<_DoctorLiveQueuePreview> {
  MyQueueStatus? _status;
  Object? _error;
  bool _loading = true;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient.instance.get('/queue/mine/${widget.appointmentId}');
      if (!mounted) return;
      setState(() {
        _status = MyQueueStatus.fromJson(res.map);
        _loading = false;
        _error = null;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err;
        _loading = false;
      });
    }
    _pollTimer?.cancel();
    _pollTimer = Timer(const Duration(seconds: 15), () {
      if (mounted) _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('YOUR LIVE QUEUE', style: TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.1)),
            const SizedBox(height: AppSpacing.sm),
            if (_loading && status == null)
              const Center(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: CircularProgressIndicator(strokeWidth: 2)))
            else if (_error != null && status == null)
              ErrorBanner(error: _error!, onRetry: _load)
            else if (status == null || !status.hasActiveQueue)
              const Text('No active queue right now.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13))
            else
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Token #${status.token}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20, color: AppColors.primaryDark)),
                        if (status.patientsAhead != null)
                          Text('${status.patientsAhead} ahead · ~${status.estimatedWaitMinutes ?? "—"} min', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                      ],
                    ),
                  ),
                  if (status.status != null) StatusBadge(status: status.status!),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
