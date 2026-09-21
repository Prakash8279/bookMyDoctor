import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/token_store.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../auth/login_screen.dart';
import '../auth/register_screen.dart';
import '../patient/book_appointment_screen.dart';
import '../patient/doctor_detail_screen.dart';
import '../shared/contact_support_screen.dart';
import '../shared/legal_policies_screen.dart';
import '../shared/privacy_screen.dart';
import '../shared/terms_screen.dart';
import 'guest_doctor_search_screen.dart';

/// Public landing screen — 100% parity with web's PatientLanding (PublicLanding.jsx)
/// and SiteHeader / SiteFooter:
/// - Light SiteHeader with brand logo, "BookMyDoctor24" lockup, Log in, and Get started buttons
/// - Hero section with two-tone typography, 5-field search box, trust indicators, and live queue card
/// - Stats strip (Verified doctors, Partner clinics, Appointments managed, Patient rating)
/// - "Browse by specialization" card grid with icons and doctor counts
/// - "Doctors patients trust" showcase with rating pills, fees, and dual "View profile" + "Book now" actions
/// - "Three simple steps" (Discover, Book instantly, Follow live)
/// - "The waiting room, redesigned." queue feature banner with live preview
/// - Testimonial quote card
/// - "Run a calmer, smarter clinic." doctor CTA
/// - Dark comprehensive SiteFooter matching web's SiteFooter.jsx
class GuestHomeScreen extends StatefulWidget {
  const GuestHomeScreen({super.key});

  @override
  State<GuestHomeScreen> createState() => _GuestHomeScreenState();
}

class _HomeData {
  final List<Specialization> specializations;
  final List<DoctorDirectoryItem> doctors;
  final int clinicsCount;
  final List<String> cities;
  final List<String> clinicNames;
  _HomeData({
    required this.specializations,
    required this.doctors,
    required this.clinicsCount,
    required this.cities,
    required this.clinicNames,
  });
}

class _GuestHomeScreenState extends State<GuestHomeScreen> {
  final _searchController = TextEditingController();
  String? _specializationId;
  String? _city;
  String? _clinicName;
  bool _todayOnly = true;
  late Future<_HomeData> _future;

  final _specializationsKey = GlobalKey();
  final _stepsKey = GlobalKey();

  void _scrollToSection(GlobalKey key, {VoidCallback? fallback}) {
    final sectionContext = key.currentContext;
    if (sectionContext == null) {
      fallback?.call();
      return;
    }
    Scrollable.ensureVisible(sectionContext, duration: const Duration(milliseconds: 400), curve: Curves.easeInOut);
  }

  Widget _drawerItem({required IconData icon, required String label, required VoidCallback onTap}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 1),
      child: ListTile(
        dense: true,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
        leading: Icon(icon, size: 20, color: Colors.white70),
        title: Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14)),
        onTap: onTap,
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<_HomeData> _load() async {
    final results = await Future.wait([
      _fetchSpecializations(),
      _fetchDoctors(),
      _fetchClinicsCount(),
    ]);
    final specializations = results[0] as List<Specialization>;
    final doctors = results[1] as List<DoctorDirectoryItem>;
    final clinicsCount = results[2] as int;

    final citySet = <String>{};
    final clinicSet = <String>{};
    for (final d in doctors) {
      if (d.city != null && d.city!.trim().isNotEmpty) citySet.add(d.city!.trim());
      for (final c in d.clinics) {
        if (c.city != null && c.city!.trim().isNotEmpty) citySet.add(c.city!.trim());
        if (c.name.trim().isNotEmpty) clinicSet.add(c.name.trim());
      }
    }
    final cities = citySet.toList()..sort();
    final clinicNames = clinicSet.toList()..sort();

    return _HomeData(
      specializations: specializations,
      doctors: doctors,
      clinicsCount: clinicsCount,
      cities: cities,
      clinicNames: clinicNames,
    );
  }

  static final List<Specialization> defaultSpecializations = [
    Specialization(id: '62549a9c-7986-4d2b-856e-ec41c53b5470', name: 'cardiologist', icon: null, description: null),
    Specialization(id: '99999999-9999-4999-8999-999999999999', name: 'Dermatologist', icon: 'skin', description: 'Skin, hair, and nail conditions'),
    Specialization(id: '77777777-7777-4777-8777-777777777777', name: 'General Physician', icon: 'stethoscope', description: 'General health checkups and common illnesses'),
  ];

  Future<List<Specialization>> _fetchSpecializations() async {
    try {
      final res = await ApiClient.instance.get('/geography/specializations', query: {'pageSize': 100});
      final list = <Specialization>[];
      for (final item in res.list) {
        try { list.add(Specialization.fromJson(item)); } catch (_) {}
      }
      if (list.isNotEmpty) return list;
      return defaultSpecializations;
    } catch (_) {
      return defaultSpecializations;
    }
  }

  Future<List<DoctorDirectoryItem>> _fetchDoctors() async {
    try {
      final res = await ApiClient.instance.get('/doctors', query: {'pageSize': 100, 'sortBy': 'rating', 'sortOrder': 'desc'});
      final list = <DoctorDirectoryItem>[];
      for (final item in res.list) {
        try { list.add(DoctorDirectoryItem.fromJson(item)); } catch (_) {}
      }
      return list;
    } catch (_) {
      return const [];
    }
  }

  Future<int> _fetchClinicsCount() async {
    try {
      final res = await ApiClient.instance.get('/clinics', query: {'pageSize': 100});
      return res.list.length;
    } catch (_) {
      return 0;
    }
  }

  void _goSearch({String? specializationId}) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => GuestDoctorSearchScreen(
        initialQuery: _searchController.text.trim().isEmpty ? null : _searchController.text.trim(),
        initialSpecializationId: specializationId ?? _specializationId,
        initialCity: _city,
        initialClinicName: _clinicName,
        initialToday: _todayOnly,
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFDFCFB),
      // Clean, light SiteHeader matching website navbar
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1, color: AppColors.border),
        ),
        iconTheme: const IconThemeData(color: AppColors.textPrimary),
        titleSpacing: 0,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(9),
              child: Image.asset('assets/branding/app_icon.png', width: 28, height: 28),
            ),
            const SizedBox(width: 6),
            const Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: 'BookMyDoctor', style: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w800, fontSize: 16)),
                  TextSpan(text: '24', style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w800, fontSize: 16)),
                ],
              ),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 4),
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.textPrimary,
                side: const BorderSide(color: Color(0xFFD4CDC8)),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
                minimumSize: const Size(0, 36),
              ),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              ),
              child: const Text('Log in', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 6),
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
                elevation: 0,
                minimumSize: const Size(0, 36),
              ),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const RegisterScreen()),
              ),
              child: const Text('Get started', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),

      drawer: Drawer(
        backgroundColor: AppColors.charcoal,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
                child: Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.all(Radius.circular(11)),
                      child: Image(image: AssetImage('assets/branding/app_icon.png'), width: 36, height: 36),
                    ),
                    SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(text: 'BookMyDoctor', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18)),
                            TextSpan(text: '24', style: TextStyle(color: Color(0xFFF5E9E3), fontWeight: FontWeight.w800, fontSize: 18)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(color: Colors.white24, height: 1),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
                  children: [
                    _drawerItem(icon: Icons.search, label: 'Find doctors', onTap: () {
                      Navigator.of(context).pop();
                      _goSearch();
                    }),
                    _drawerItem(icon: Icons.category_outlined, label: 'Specialties', onTap: () {
                      Navigator.of(context).pop();
                      _scrollToSection(_specializationsKey, fallback: () => _goSearch());
                    }),
                    _drawerItem(icon: Icons.route_outlined, label: 'How it works', onTap: () {
                      Navigator.of(context).pop();
                      _scrollToSection(_stepsKey);
                    }),
                    _drawerItem(icon: Icons.mail_outline, label: 'Contact', onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ContactSupportScreen()));
                    }),
                    _drawerItem(icon: Icons.privacy_tip_outlined, label: 'Privacy Policy', onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PrivacyScreen()));
                    }),
                    _drawerItem(icon: Icons.description_outlined, label: 'Terms of Service', onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const TermsScreen()));
                    }),
                    _drawerItem(icon: Icons.receipt_long_outlined, label: 'Cancellation & Refund', onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(MaterialPageRoute(
                        builder: (_) => const LegalDocumentScreen(
                          title: 'Cancellation & Refund Policy',
                          lastUpdated: '21 September 2026',
                          sections: kCancellationSections,
                          intro:
                              'Doctor Connect is a technology platform that enables patients to discover doctors and book appointments. Cancellation and refund matters related to an appointment are primarily handled by the respective doctor or clinic.',
                        ),
                      ));
                    }),
                    _drawerItem(icon: Icons.login_outlined, label: 'Log in', onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen()));
                    }),
                  ],
                ),
              ),
              const Divider(color: Colors.white24, height: 1),
              Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          side: const BorderSide(color: Colors.white54),
                        ),
                        onPressed: () {
                          Navigator.of(context).pop();
                          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen()));
                        },
                        child: const Text('Log in'),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                        ),
                        onPressed: () {
                          Navigator.of(context).pop();
                          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RegisterScreen()));
                        },
                        child: const Text('Get started'),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),

      body: RefreshIndicator(
        onRefresh: () async {
          setState(() {
            _future = _load();
          });
          await _future;
        },
        child: FutureBuilder<_HomeData>(
          future: _future,
          builder: (context, snapshot) {
            final loading = snapshot.connectionState != ConnectionState.done;
            final data = snapshot.data;
            final avgRating = (data != null && data.doctors.isNotEmpty)
                ? data.doctors.map((d) => d.rating).reduce((a, b) => a + b) / data.doctors.length
                : 0.0;
            final doctorCountBySpecialization = <String, int>{};
            for (final d in data?.doctors ?? <DoctorDirectoryItem>[]) {
              final name = d.specialization?.name.trim();
              if (name == null || name.isEmpty) continue;
              doctorCountBySpecialization[name] = (doctorCountBySpecialization[name] ?? 0) + 1;
              doctorCountBySpecialization[name.toLowerCase()] = (doctorCountBySpecialization[name.toLowerCase()] ?? 0) + 1;
            }

            return ListView(
              padding: EdgeInsets.zero,
              children: [
                // 1. Hero Section
                _HeroSection(
                  searchController: _searchController,
                  specializations: data?.specializations ?? const [],
                  specializationId: (_specializationId != null && (data?.specializations ?? const []).any((s) => s.id == _specializationId))
                      ? _specializationId
                      : null,
                  onSpecializationChanged: (value) => setState(() => _specializationId = value),
                  cities: data?.cities ?? const [],
                  city: (_city != null && (data?.cities ?? const []).contains(_city)) ? _city : null,
                  onCityChanged: (value) => setState(() => _city = value),
                  clinicNames: data?.clinicNames ?? const [],
                  clinicName: (_clinicName != null && (data?.clinicNames ?? const []).contains(_clinicName)) ? _clinicName : null,
                  onClinicChanged: (value) => setState(() => _clinicName = value),
                  todayOnly: _todayOnly,
                  onTodayOnlyChanged: (value) => setState(() => _todayOnly = value),
                  onSearch: _goSearch,
                  doctorsCount: data?.doctors.length ?? 0,
                ),

                if (loading) const Padding(padding: EdgeInsets.all(AppSpacing.xl), child: LoadingView()),
                if (snapshot.hasError)
                  Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: ErrorBanner(error: snapshot.error!, onRetry: () => setState(() { _future = _load(); })),
                  ),

                if (data != null) ...[
                  // 2. Stats Strip
                  _StatsStrip(
                    doctorsCount: data.doctors.length,
                    clinicsCount: data.clinicsCount,
                    avgRating: avgRating,
                  ),

                  // 3. Browse by Specialization
                  KeyedSubtree(
                    key: _specializationsKey,
                    child: _SpecializationsSection(
                      specializations: data.specializations,
                      doctorCountBySpecialization: doctorCountBySpecialization,
                      onTap: (id) => _goSearch(specializationId: id),
                      onSeeAll: () => _goSearch(),
                    ),
                  ),

                  // 4. Top-Rated Doctors
                  _TopDoctorsSection(
                    doctors: data.doctors.take(6).toList(),
                    onViewAll: () => _goSearch(),
                    onAddDoctor: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RegisterScreen())),
                  ),
                ],

                // 5. Three Simple Steps
                KeyedSubtree(key: _stepsKey, child: const _StepsSection()),

                // 6. The Waiting Room, Redesigned (Queue Feature)
                _QueueFeatureSection(
                  onCreateAccount: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RegisterScreen())),
                ),

                // 7. Patient Stories / Testimonial
                const _TestimonialSection(),

                // 8. For Healthcare Professionals (Doctor CTA)
                _DoctorCtaSection(
                  onJoin: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RegisterScreen())),
                ),

                // 9. Site Footer (100% parity with web's SiteFooter.jsx)
                _SiteFooter(
                  onSearchDoctors: () => _goSearch(),
                  onOpenLogin: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
                  onOpenRegister: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RegisterScreen())),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// 1. Hero Section — matches reference_site.css .hero and PublicLanding.jsx
class _HeroSection extends StatelessWidget {
  final TextEditingController searchController;
  final List<Specialization> specializations;
  final String? specializationId;
  final ValueChanged<String?> onSpecializationChanged;
  final List<String> cities;
  final String? city;
  final ValueChanged<String?> onCityChanged;
  final List<String> clinicNames;
  final String? clinicName;
  final ValueChanged<String?> onClinicChanged;
  final bool todayOnly;
  final ValueChanged<bool> onTodayOnlyChanged;
  final void Function({String? specializationId}) onSearch;
  final int doctorsCount;

  const _HeroSection({
    required this.searchController,
    required this.specializations,
    required this.specializationId,
    required this.onSpecializationChanged,
    required this.cities,
    required this.city,
    required this.onCityChanged,
    required this.clinicNames,
    required this.clinicName,
    required this.onClinicChanged,
    required this.todayOnly,
    required this.onTodayOnlyChanged,
    required this.onSearch,
    required this.doctorsCount,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFFFF), Color(0xFFFBF8F5), Color(0xFFF5EEE9)],
          stops: [0, 0.58, 1],
        ),
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Stack(
        children: [
          const Positioned(
            top: 60,
            right: -90,
            child: _HeroOrb(size: 220, color: Color(0x1FAD5D3B)),
          ),
          const Positioned(
            bottom: -60,
            left: -70,
            child: _HeroOrb(size: 160, color: Color(0x1AC17655)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.lg, AppSpacing.md, AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Eyebrow
                const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.verified_user_outlined, size: 16, color: AppColors.primary),
                    SizedBox(width: 6),
                    Text(
                      'TRUSTED HEALTHCARE, SIMPLER',
                      style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.2),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),

                // Hero H1
                const Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: 'Care without the ', style: TextStyle(color: AppColors.textPrimary)),
                      TextSpan(text: 'waiting room.', style: TextStyle(color: AppColors.primary)),
                    ],
                  ),
                  style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, height: 1.05, letterSpacing: -1),
                ),
                const SizedBox(height: AppSpacing.sm),

                // Hero Lead
                const Text(
                  'Find verified doctors, reserve your clinic slot, and follow your live queue token from home.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.5),
                ),
                const SizedBox(height: AppSpacing.md),

                // Hero Search Box (Stacked 5 fields + Search button)
                Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.border),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primaryDark.withValues(alpha: 0.1),
                        blurRadius: 30,
                        offset: const Offset(0, 14),
                      ),
                    ],
                  ),
                  child: Column(
                    children: [
                      _HeroSearchFieldRow(
                        icon: Icons.location_on_outlined,
                        label: 'City',
                        child: DropdownButtonFormField<String>(
                          initialValue: city,
                          isExpanded: true,
                          isDense: true,
                          decoration: const InputDecoration(border: InputBorder.none, isCollapsed: true, hintText: 'All cities'),
                          style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13),
                          items: [
                            const DropdownMenuItem(value: null, child: Text('All cities')),
                            for (final c in cities) DropdownMenuItem(value: c, child: Text(c)),
                          ],
                          onChanged: onCityChanged,
                        ),
                      ),
                      _HeroSearchFieldRow(
                        icon: Icons.medical_information_outlined,
                        label: 'Specialization',
                        child: DropdownButtonFormField<String>(
                          initialValue: specializationId,
                          isExpanded: true,
                          isDense: true,
                          decoration: const InputDecoration(border: InputBorder.none, isCollapsed: true, hintText: 'All specializations'),
                          style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13),
                          items: [
                            const DropdownMenuItem(value: null, child: Text('All specializations')),
                            for (final s in specializations) DropdownMenuItem(value: s.id, child: Text(s.name)),
                          ],
                          onChanged: onSpecializationChanged,
                        ),
                      ),
                      _HeroSearchFieldRow(
                        icon: Icons.apartment_outlined,
                        label: 'Clinic',
                        child: DropdownButtonFormField<String>(
                          initialValue: clinicName,
                          isExpanded: true,
                          isDense: true,
                          decoration: const InputDecoration(border: InputBorder.none, isCollapsed: true, hintText: 'All clinics'),
                          style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13),
                          items: [
                            const DropdownMenuItem(value: null, child: Text('All clinics')),
                            for (final c in clinicNames) DropdownMenuItem(value: c, child: Text(c)),
                          ],
                          onChanged: onClinicChanged,
                        ),
                      ),
                      _HeroSearchFieldRow(
                        icon: Icons.search,
                        label: 'Doctor or symptom',
                        child: TextField(
                          controller: searchController,
                          decoration: const InputDecoration(border: InputBorder.none, isCollapsed: true, hintText: 'e.g. fever, Dr. Sharma'),
                          style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13),
                          onSubmitted: (_) => onSearch(),
                        ),
                      ),
                      _HeroSearchFieldRow(
                        icon: Icons.calendar_today_outlined,
                        label: 'Booking',
                        last: true,
                        child: DropdownButtonFormField<bool>(
                          initialValue: todayOnly,
                          isExpanded: true,
                          isDense: true,
                          decoration: const InputDecoration(border: InputBorder.none, isCollapsed: true),
                          style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 13),
                          items: const [
                            DropdownMenuItem(value: true, child: Text('Today booking')),
                            DropdownMenuItem(value: false, child: Text('Any available date')),
                          ],
                          onChanged: (v) => onTodayOnlyChanged(v ?? true),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                        child: SizedBox(
                          width: double.infinity,
                          height: 48,
                          child: ElevatedButton.icon(
                            onPressed: () => onSearch(),
                            icon: const Icon(Icons.search, size: 19),
                            label: const Text('Search', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              elevation: 2,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                // Trust Row
                const Wrap(
                  spacing: AppSpacing.md,
                  runSpacing: 6,
                  children: [
                    _TrustItem(label: 'Verified clinicians'),
                    _TrustItem(label: 'Transparent fees'),
                    _TrustItem(label: 'Live queue updates'),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),

                // Live Queue Preview Card
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(AppRadius.card),
                    border: Border.all(color: const Color(0xFFDCDCDC)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.08),
                        blurRadius: 24,
                        offset: const Offset(0, 10),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(width: 8, height: 8, decoration: const BoxDecoration(color: AppColors.textPrimary, shape: BoxShape.circle)),
                          const SizedBox(width: 6),
                          const Text('Clinic queue', style: TextStyle(fontWeight: FontWeight.w700)),
                          const Spacer(),
                          const Text('Browser saved', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.md),
                      Container(
                        padding: const EdgeInsets.all(9),
                        decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(12)),
                        child: const Icon(Icons.hourglass_bottom, color: AppColors.primary),
                      ),
                      const SizedBox(height: 8),
                      const Text('No active queue right now', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
                      const SizedBox(height: 2),
                      const Text(
                        'New clinic tokens appear here after you book or check in.',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),

                // Two Floating Cards
                Row(
                  children: [
                    Expanded(
                      child: _FloatingInfoCard(
                        icon: Icons.verified_outlined,
                        title: doctorsCount > 0 ? '$doctorsCount doctor profile${doctorsCount == 1 ? '' : 's'}' : 'No doctor profiles yet',
                        subtitle: doctorsCount > 0 ? 'Added profiles appear in search' : 'Add a doctor profile to continue',
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    const Expanded(
                      child: _FloatingInfoCard(
                        icon: Icons.notifications_active_outlined,
                        title: 'Queue standing by',
                        subtitle: 'No fabricated token data',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroSearchFieldRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final Widget child;
  final bool last;
  const _HeroSearchFieldRow({required this.icon, required this.label, required this.child, this.last = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        border: last ? null : const Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(icon, size: 18, color: AppColors.textSecondary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.5),
                ),
                child,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroOrb extends StatelessWidget {
  final double size;
  final Color color;
  const _HeroOrb({required this.size, required this.color});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(shape: BoxShape.circle, color: color),
      ),
    );
  }
}

class _TrustItem extends StatelessWidget {
  final String label;
  const _TrustItem({required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.check_circle, size: 15, color: AppColors.teal),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class _FloatingInfoCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const _FloatingInfoCard({required this.icon, required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, color: AppColors.primary, size: 20),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textSecondary, fontSize: 10)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 2. Stats Strip — matches reference_site.css .stats-strip and 2x2 mobile grid
class _StatsStrip extends StatelessWidget {
  final int doctorsCount;
  final int clinicsCount;
  final double avgRating;
  const _StatsStrip({required this.doctorsCount, required this.clinicsCount, required this.avgRating});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: Color(0xFFFDFCFB),
        border: Border.symmetric(horizontal: BorderSide(color: AppColors.border)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 8),
                  decoration: const BoxDecoration(
                    border: Border(
                      right: BorderSide(color: AppColors.border),
                      bottom: BorderSide(color: AppColors.border),
                    ),
                  ),
                  child: Column(
                    children: [
                      Text('$doctorsCount', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.textPrimary, letterSpacing: -0.7)),
                      const SizedBox(height: 3),
                      const Text('Verified doctors', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 8),
                  decoration: const BoxDecoration(
                    border: Border(bottom: BorderSide(color: AppColors.border)),
                  ),
                  child: Column(
                    children: [
                      Text('$clinicsCount', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.textPrimary, letterSpacing: -0.7)),
                      const SizedBox(height: 3),
                      const Text('Partner clinics', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              ),
            ],
          ),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 8),
                  decoration: const BoxDecoration(
                    border: Border(right: BorderSide(color: AppColors.border)),
                  ),
                  child: const Column(
                    children: [
                      Text('0', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.textPrimary, letterSpacing: -0.7)),
                      SizedBox(height: 3),
                      Text('Appointments managed', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 8),
                  child: Column(
                    children: [
                      Text(avgRating > 0 ? avgRating.toStringAsFixed(1) : '0', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.textPrimary, letterSpacing: -0.7)),
                      const SizedBox(height: 3),
                      const Text('Patient rating', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

const List<IconData> _specializationIcons = [
  Icons.medical_services_outlined,
  Icons.favorite_outline,
  Icons.child_care_outlined,
  Icons.auto_awesome_outlined,
  Icons.healing_outlined,
  Icons.monitor_heart_outlined,
  Icons.psychology_outlined,
  Icons.sentiment_satisfied_outlined,
];

/// 3. Specializations Section — 2-column grid matching web's .specialty-grid with corner arrows
class _SpecializationsSection extends StatelessWidget {
  final List<Specialization> specializations;
  final Map<String, int> doctorCountBySpecialization;
  final ValueChanged<String> onTap;
  final VoidCallback onSeeAll;
  const _SpecializationsSection({
    required this.specializations,
    required this.doctorCountBySpecialization,
    required this.onTap,
    required this.onSeeAll,
  });

  static final List<Specialization> fallbackSpecializations = [
    Specialization(id: '62549a9c-7986-4d2b-856e-ec41c53b5470', name: 'cardiologist', icon: null, description: null),
    Specialization(id: '99999999-9999-4999-8999-999999999999', name: 'Dermatologist', icon: 'skin', description: 'Skin, hair, and nail conditions'),
    Specialization(id: '77777777-7777-4777-8777-777777777777', name: 'General Physician', icon: 'stethoscope', description: 'General health checkups and common illnesses'),
  ];

  @override
  Widget build(BuildContext context) {
    final list = specializations.isNotEmpty ? specializations : fallbackSpecializations;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PageHeader(
            kicker: 'Find the right care',
            title: 'Browse by specialization',
            subtitle: 'Experienced doctors across the most requested areas of care.',
            action: TextButton(
              onPressed: onSeeAll,
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('View all doctors', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.primary)),
                  SizedBox(width: 4),
                  Icon(Icons.arrow_forward_rounded, size: 16, color: AppColors.primary),
                ],
              ),
            ),
          ),
          LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth;
              final crossAxisCount = width >= 720
                  ? 4
                  : (width >= 460 ? 3 : 2);
              return GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: list.length,
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: crossAxisCount,
                  mainAxisSpacing: AppSpacing.sm,
                  crossAxisSpacing: AppSpacing.sm,
                  mainAxisExtent: 122,
                ),
                itemBuilder: (context, i) {
                  final s = list[i];
                  final count = doctorCountBySpecialization[s.name] ??
                      doctorCountBySpecialization[s.name.trim().toLowerCase()] ??
                      0;
                  return InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => onTap(s.id),
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: const Color(0xFFE9E5E0)),
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.02),
                            blurRadius: 6,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Stack(
                        children: [
                          const Positioned(
                            bottom: 0,
                            right: 0,
                            child: Icon(Icons.arrow_forward_rounded, size: 16, color: Color(0xFFB5B0AA)),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Container(
                                width: 38,
                                height: 38,
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFBF1EC),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Icon(_specializationIcons[i % _specializationIcons.length], color: AppColors.primaryDark, size: 20),
                              ),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    s.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: AppColors.textPrimary),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    '$count ${count == 1 ? 'doctor' : 'doctors'}',
                                    style: const TextStyle(color: Color(0xFF6F6A64), fontSize: 11.5, fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              );
            },
          ),
        ],
      ),
    );
  }
}

/// 4. Top-Rated Doctors Section — matches web's doctor-card layout with dual actions
class _TopDoctorsSection extends StatelessWidget {
  final List<DoctorDirectoryItem> doctors;
  final VoidCallback onViewAll;
  final VoidCallback onAddDoctor;
  const _TopDoctorsSection({required this.doctors, required this.onViewAll, required this.onAddDoctor});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: const Color(0xFFF8F6F3),
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: PageHeader(
              kicker: 'Top-rated care',
              title: 'Doctors patients trust',
              subtitle: 'Verified profiles, clear fees, and real availability.',
              action: doctors.isEmpty ? null : TextButton(onPressed: onViewAll, child: const Text('See all →')),
            ),
          ),
          if (doctors.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: EmptyStateView(
                icon: Icons.medical_services_outlined,
                title: 'No doctor profiles yet',
                subtitle: 'Add a doctor to continue — verified profiles will appear here for patients to find.',
                action: OutlinedButton(onPressed: onAddDoctor, child: const Text('Add a doctor')),
              ),
            )
          else ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: Column(
                children: [
                  for (final doctor in doctors.take(4))
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.md),
                      child: _HomeDoctorCard(doctor: doctor),
                    ),
                  if (doctors.length > 4)
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: onViewAll,
                        icon: const Icon(Icons.search, size: 16),
                        label: Text('View all ${doctors.length} doctors →', style: const TextStyle(fontWeight: FontWeight.w700)),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          side: const BorderSide(color: AppColors.border),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          foregroundColor: AppColors.primary,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _HomeDoctorCard extends StatelessWidget {
  final DoctorDirectoryItem doctor;
  const _HomeDoctorCard({required this.doctor});

  @override
  Widget build(BuildContext context) {
    final clinic = doctor.clinics.isNotEmpty ? doctor.clinics.first : null;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: AppColors.primaryLight,
                backgroundImage: doctor.photoUrl != null ? CachedNetworkImageProvider(doctor.photoUrl!) : null,
                child: doctor.photoUrl == null
                    ? Text(
                        doctor.name.isNotEmpty ? doctor.name.split(' ').map((p) => p.isNotEmpty ? p[0] : '').take(2).join('').toUpperCase() : 'DR',
                        style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w800, fontSize: 16),
                      )
                    : null,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.verified_user_outlined, size: 13, color: AppColors.primary),
                        SizedBox(width: 4),
                        Text('VERIFIED DOCTOR', style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w800, fontSize: 10, letterSpacing: 0.5)),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(doctor.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppColors.textPrimary)),
                    const SizedBox(height: 1),
                    Text('${doctor.specialization?.name ?? "Specialization not added"} · ${doctor.experienceYears} years', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: const Color(0xFFFFF6DD), borderRadius: BorderRadius.circular(9)),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.star, size: 13, color: AppColors.goldDark),
                    const SizedBox(width: 3),
                    Text(doctor.rating.toStringAsFixed(1), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.goldDark)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: const BoxDecoration(
              border: Border.symmetric(horizontal: BorderSide(color: Color(0xFFEDEDED))),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.location_on_outlined, size: 14, color: AppColors.primary),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        clinic != null ? '${clinic.name} · ${clinic.city ?? clinic.area ?? "India"}' : (doctor.city ?? 'Clinic not added'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.access_time, size: 14, color: AppColors.primary),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        doctor.scheduleSummary ?? 'Schedule not added',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Consultation', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                  Text('₹${doctor.consultationFee.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18, color: AppColors.textPrimary)),
                ],
              ),
              Row(
                children: [
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      side: const BorderSide(color: AppColors.border),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => DoctorDetailScreen(doctorId: doctor.id))),
                    child: const Text('View profile', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      elevation: 1,
                    ),
                    onPressed: () {
                      if (TokenStore.instance.current == null) {
                        Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen()));
                      } else {
                        Navigator.of(context).push(MaterialPageRoute(builder: (_) => BookAppointmentScreen(preselectedDoctor: doctor)));
                      }
                    },
                    child: const Text('Book now', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// 5. Three Simple Steps Section
class _StepsSection extends StatelessWidget {
  const _StepsSection();

  @override
  Widget build(BuildContext context) {
    const steps = [
      [Icons.search, 'Discover', 'Compare verified doctors by location, specialty, experience, fee, and availability.'],
      [Icons.event_available_outlined, 'Book instantly', 'Choose a clinic slot for yourself or a family member and receive your queue token.'],
      [Icons.hourglass_bottom, 'Follow live', 'Watch the queue move from home and arrive just before your consultation.'],
    ];
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const SizedBox(height: AppSpacing.md),
          const Text('THREE SIMPLE STEPS', textAlign: TextAlign.center, style: TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w800, fontSize: 11, letterSpacing: 1.2)),
          const SizedBox(height: 6),
          const Text('From search to consultation', textAlign: TextAlign.center, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.textPrimary, letterSpacing: -0.5)),
          const SizedBox(height: 6),
          const Text('Everything you need to visit a doctor, without wasting hours at the clinic.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
          const SizedBox(height: AppSpacing.md),
          for (int i = 0; i < steps.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg, horizontal: AppSpacing.md),
                decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: AppColors.border),
                  borderRadius: BorderRadius.circular(21),
                ),
                child: Stack(
                  children: [
                    Positioned(
                      top: 0,
                      right: 0,
                      child: Text('0${i + 1}', style: const TextStyle(color: Color(0xFFDCDCDC), fontSize: 25, fontWeight: FontWeight.w900)),
                    ),
                    Column(
                      children: [
                        Container(
                          width: 56,
                          height: 56,
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(color: const Color(0xFFEEEEEE), borderRadius: BorderRadius.circular(17)),
                          child: Icon(steps[i][0] as IconData, color: AppColors.primary),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text(steps[i][1] as String, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                        const SizedBox(height: 6),
                        Text(steps[i][2] as String, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5)),
                      ],
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// 6. Queue Feature Section — includes .queue-panel live card matching web
class _QueueFeatureSection extends StatelessWidget {
  final VoidCallback onCreateAccount;
  const _QueueFeatureSection({required this.onCreateAccount});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF080808), Color(0xFF252525)],
        ),
      ),
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.xl, AppSpacing.md, AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('BUILT AROUND YOUR TIME', style: TextStyle(color: Color(0xFFD8D8D8), fontWeight: FontWeight.w800, fontSize: 11, letterSpacing: 1.2)),
          const SizedBox(height: 8),
          const Text('The waiting room, redesigned.', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
          const SizedBox(height: 8),
          Text(
            'Patients get timely alerts while doctors and reception teams manage one synchronized clinic queue.',
            style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 14, height: 1.6),
          ),
          const SizedBox(height: AppSpacing.md),
          for (final line in const [
            'Token position and estimated waiting time',
            'Delay broadcasts and turn reminders',
            'Walk-in and online bookings in one queue',
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  const Icon(Icons.check_circle, size: 18, color: Colors.white),
                  const SizedBox(width: 10),
                  Expanded(child: Text(line, style: const TextStyle(color: Color(0xFFEEEEEE), fontSize: 13, fontWeight: FontWeight.w500))),
                ],
              ),
            ),
          const SizedBox(height: AppSpacing.md),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: AppColors.charcoal,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: onCreateAccount,
            child: const Text('Create free account →', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
          ),
          const SizedBox(height: AppSpacing.lg),

          // Live Queue Preview Card — matches web's .queue-panel exactly
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(22),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.25),
                  blurRadius: 30,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 9,
                      height: 9,
                      decoration: const BoxDecoration(color: Color(0xFF222222), shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 8),
                    const Text('Clinic queue', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppColors.textPrimary)),
                    const Spacer(),
                    const Text('No active OPD', style: TextStyle(color: AppColors.teal, fontSize: 12, fontWeight: FontWeight.w700)),
                  ],
                ),
                const Divider(height: 24, color: AppColors.border),
                Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
                    child: Column(
                      children: [
                        Container(
                          width: 48,
                          height: 48,
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.primaryLight,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(Icons.timer_outlined, color: AppColors.primary, size: 24),
                        ),
                        const SizedBox(height: 10),
                        const Text('No queued patients', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppColors.textPrimary)),
                        const SizedBox(height: 4),
                        const Text(
                          'This panel updates whenever a token changes in this browser.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 7. Testimonials Section
class _TestimonialSection extends StatelessWidget {
  const _TestimonialSection();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const SizedBox(height: AppSpacing.md),
          const Text('PATIENT STORIES', textAlign: TextAlign.center, style: TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w800, fontSize: 11, letterSpacing: 1.2)),
          const SizedBox(height: 6),
          const Text('Less waiting. Better care.', textAlign: TextAlign.center, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.textPrimary, letterSpacing: -0.5)),
          const SizedBox(height: AppSpacing.md),
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.03),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('★★★★★', style: TextStyle(color: Color(0xFFF2AA17), fontSize: 16, letterSpacing: 2)),
                SizedBox(height: 8),
                Text('“Clear explanation and a smooth live-queue experience.”', style: TextStyle(fontStyle: FontStyle.italic, fontSize: 15, height: 1.6, color: AppColors.textPrimary)),
                SizedBox(height: AppSpacing.md),
                Row(
                  children: [
                    CircleAvatar(radius: 16, backgroundColor: AppColors.primaryLight, child: Text('RV', style: TextStyle(fontSize: 12, color: AppColors.primaryDark, fontWeight: FontWeight.w800))),
                    SizedBox(width: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Rahul V.', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: AppColors.textPrimary)),
                        Text('Verified appointment', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 8. Doctor CTA Section
class _DoctorCtaSection extends StatelessWidget {
  final VoidCallback onJoin;
  const _DoctorCtaSection({required this.onJoin});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFFF7F7F7), Color(0xFFEEEEEE)]),
          border: Border.all(color: const Color(0xFFDEDEDE)),
          borderRadius: BorderRadius.circular(22),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [AppColors.primary, AppColors.teal]),
                borderRadius: BorderRadius.circular(17),
              ),
              child: const Icon(Icons.groups_outlined, color: Colors.white, size: 28),
            ),
            const SizedBox(height: AppSpacing.sm),
            const Text('FOR HEALTHCARE PROFESSIONALS', style: TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w800, fontSize: 11, letterSpacing: 0.8)),
            const SizedBox(height: 4),
            const Text('Run a calmer, smarter clinic.', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.textPrimary, letterSpacing: -0.5)),
            const SizedBox(height: 6),
            const Text('Appointments, live queue, payments, and patient history in one workspace.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5)),
            const SizedBox(height: AppSpacing.md),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: onJoin,
                icon: const Icon(Icons.arrow_forward, size: 18),
                label: const Text('Join as a doctor', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryDark,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  elevation: 2,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 9. Comprehensive Site Footer — 100% parity with web's SiteFooter.jsx
class _SiteFooter extends StatelessWidget {
  final VoidCallback onSearchDoctors;
  final VoidCallback onOpenLogin;
  final VoidCallback onOpenRegister;

  const _SiteFooter({
    required this.onSearchDoctors,
    required this.onOpenLogin,
    required this.onOpenRegister,
  });

  Widget _footerLink(String label, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: InkWell(
        onTap: onTap,
        child: Text(
          label,
          style: const TextStyle(color: Color(0xFFB5B5B5), fontSize: 13, fontWeight: FontWeight.w500),
        ),
      ),
    );
  }

  Widget _footerHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8, top: 16),
      child: Text(
        title,
        style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w700, letterSpacing: 0.3),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: const Color(0xFF090909),
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 48, AppSpacing.lg, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Brand Lockup
          Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(11),
                child: Image.asset('assets/branding/app_icon.png', width: 34, height: 34),
              ),
              const SizedBox(width: 10),
              const Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: 'BookMyDoctor', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18)),
                    TextSpan(text: '24', style: TextStyle(color: AppColors.primaryLight, fontWeight: FontWeight.w800, fontSize: 18)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text(
            'Healthcare that respects your time. Discover verified doctors, book instantly, and follow your clinic queue live.',
            style: TextStyle(color: Color(0xFFA3A3A3), fontSize: 13, height: 1.6),
          ),
          const SizedBox(height: 12),
          const Row(
            children: [
              Icon(Icons.mail_outline, size: 16, color: Color(0xFFB5B5B5)),
              SizedBox(width: 8),
              Text('bookmydoctor24@gmail.com', style: TextStyle(color: Color(0xFFB5B5B5), fontSize: 13)),
            ],
          ),
          const Divider(color: Color(0xFF222222), height: 40),

          // Patients section
          _footerHeader('Patients'),
          _footerLink('Find a doctor', onSearchDoctors),
          _footerLink('My appointments', onOpenLogin),
          _footerLink('Live queue', onOpenLogin),
          _footerLink('Health records', onOpenLogin),

          // Professionals section
          _footerHeader('Professionals'),
          _footerLink('Join as a doctor', onOpenRegister),
          _footerLink('Doctor portal', onOpenLogin),
          _footerLink('Reception portal', onOpenLogin),
          _footerLink('Admin portal', onOpenLogin),

          // Contact section
          _footerHeader('Contact'),
          const Row(
            children: [
              Icon(Icons.location_on_outlined, size: 16, color: Color(0xFFB5B5B5)),
              SizedBox(width: 8),
              Text('India', style: TextStyle(color: Color(0xFFB5B5B5), fontSize: 13)),
            ],
          ),
          const SizedBox(height: 8),
          const Row(
            children: [
              Icon(Icons.phone_outlined, size: 16, color: Color(0xFFB5B5B5)),
              SizedBox(width: 8),
              Text('Support available 9 AM–8 PM', style: TextStyle(color: Color(0xFFB5B5B5), fontSize: 13)),
            ],
          ),
          const SizedBox(height: 10),
          InkWell(
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ContactSupportScreen())),
            child: const Text('Contact support', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
          ),

          const Divider(color: Color(0xFF222222), height: 40),

          // Footer Bottom
          const Text(
            '© 2026 BookMyDoctor24. All rights reserved.',
            style: TextStyle(color: Color(0xFF858585), fontSize: 12),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              InkWell(
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PrivacyScreen())),
                child: const Text('Privacy', style: TextStyle(color: Color(0xFFB5B5B5), fontSize: 12, decoration: TextDecoration.underline)),
              ),
              const Text('·', style: TextStyle(color: Color(0xFF858585))),
              InkWell(
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const TermsScreen())),
                child: const Text('Terms', style: TextStyle(color: Color(0xFFB5B5B5), fontSize: 12, decoration: TextDecoration.underline)),
              ),
              const Text('·', style: TextStyle(color: Color(0xFF858585))),
              InkWell(
                onTap: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => const LegalDocumentScreen(
                    title: 'Cancellation & Refund Policy',
                    lastUpdated: '21 September 2026',
                    sections: kCancellationSections,
                    intro:
                        'Doctor Connect is a technology platform that enables patients to discover doctors and book appointments. Cancellation and refund matters related to an appointment are primarily handled by the respective doctor or clinic.',
                  ),
                )),
                child: const Text('Cancellation & Refund', style: TextStyle(color: Color(0xFFB5B5B5), fontSize: 12, decoration: TextDecoration.underline)),
              ),
              const Text('·', style: TextStyle(color: Color(0xFF858585))),
              const Text('Accessibility', style: TextStyle(color: Color(0xFF858585), fontSize: 12)),
            ],
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}


