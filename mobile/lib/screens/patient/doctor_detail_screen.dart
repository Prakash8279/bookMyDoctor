import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../models/admin_models.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'book_appointment_screen.dart';

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
    final reviewsRes = await ApiClient.instance.get('/reviews', query: {'doctorId': widget.doctorId, 'pageSize': 20});
    return _DoctorDetailData(
      doctor: DoctorDirectoryItem.fromJson(doctorRes.map),
      reviews: reviewsRes.list.map(ReviewItem.fromJson).toList(),
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
              child: ErrorBanner(error: snapshot.error!, onRetry: () => setState(() => _future = _load())),
            );
          }
          final data = snapshot.data!;
          final doctor = data.doctor;
          return ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(
                    radius: 34,
                    backgroundColor: AppColors.primary.withOpacity(0.12),
                    // CachedNetworkImageProvider is a drop-in ImageProvider that disk-caches
                    // doctor photos, avoiding a re-download every time this screen rebuilds.
                    backgroundImage: doctor.photoUrl != null ? CachedNetworkImageProvider(doctor.photoUrl!) : null,
                    child: doctor.photoUrl == null
                        ? Text(doctor.name.isNotEmpty ? doctor.name[0].toUpperCase() : '?',
                            style: const TextStyle(color: AppColors.primary, fontSize: 22, fontWeight: FontWeight.bold))
                        : null,
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(doctor.name, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                        if (doctor.specialization != null)
                          Text(doctor.specialization!.name, style: const TextStyle(color: AppColors.textSecondary)),
                        if (doctor.qualification != null) Text(doctor.qualification!),
                        Row(
                          children: [
                            const Icon(Icons.star, size: 16, color: AppColors.warning),
                            const SizedBox(width: 2),
                            Text('${doctor.rating.toStringAsFixed(1)} (${doctor.reviewCount} reviews)'),
                          ],
                        ),
                        // COMPLETENESS FIX (mobile parity — web's DoctorProfile header shows a
                        // red "Emergency available" Badge tone="error" for doctor.emergencyAvailable;
                        // mobile parsed this field but never rendered it).
                        if (doctor.emergencyAvailable) ...[
                          const SizedBox(height: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppColors.danger.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: const Text(
                              'Emergency available',
                              style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600, fontSize: 11),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              // Website's DoctorProfile always renders the "About" card, falling back to
              // "No description added yet." when the doctor hasn't written a bio — mobile used
              // to hide the whole section instead, which read as missing content rather than an
              // empty one.
              SectionCard(title: 'About ${doctor.name}', child: Text(doctor.bio ?? 'No description added yet.')),
              const SizedBox(height: AppSpacing.md),
              SectionCard(
                title: 'Consultation',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Fee: ₹${doctor.consultationFee.toStringAsFixed(0)}'),
                    if (doctor.emergencyFee != null) Text('Emergency fee: ₹${doctor.emergencyFee!.toStringAsFixed(0)}'),
                    if (doctor.experienceYears != null) Text('Experience: ${doctor.experienceYears} years'),
                    if (doctor.languages.isNotEmpty) Text('Languages: ${doctor.languages.join(", ")}'),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              SectionCard(
                title: 'Clinics',
                child: doctor.clinics.isEmpty
                    ? const Text('No clinics listed', style: TextStyle(color: AppColors.textSecondary))
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final c in doctor.clinics)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Text('${c.name}${c.area != null ? " · ${c.area}" : ""}${c.city != null ? ", ${c.city}" : ""}'),
                            ),
                        ],
                      ),
              ),
              const SizedBox(height: AppSpacing.md),
              SectionCard(
                title: 'Reviews (${data.reviews.length})',
                child: data.reviews.isEmpty
                    ? const Text('Reviews will appear after completed appointments.', style: TextStyle(color: AppColors.textSecondary))
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final r in data.reviews)
                            Padding(
                              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Text(r.patient.name ?? 'Patient', style: const TextStyle(fontWeight: FontWeight.w600)),
                                      const SizedBox(width: 8),
                                      Row(
                                        children: List.generate(
                                          5,
                                          (i) => Icon(
                                            i < r.rating ? Icons.star : Icons.star_border,
                                            size: 14,
                                            color: AppColors.warning,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  if (r.text != null && r.text!.isNotEmpty) Text(r.text!),
                                ],
                              ),
                            ),
                        ],
                      ),
              ),
              const SizedBox(height: AppSpacing.xl),
              PrimaryButton(
                label: 'Book appointment',
                onPressed: doctor.onlineBooking ? () => _handleBook(context, doctor) : null,
              ),
              if (!doctor.onlineBooking)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(
                    'This doctor is not accepting online bookings right now.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                ),
            ],
          );
        },
      ),
    );
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
  _DoctorDetailData({required this.doctor, required this.reviews});
}
