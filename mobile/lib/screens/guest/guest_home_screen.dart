import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../auth/login_screen.dart';
import '../auth/register_screen.dart';
import '../patient/doctor_detail_screen.dart';
import '../shared/about_screen.dart';
import '../shared/blog_screen.dart';
import '../shared/contact_support_screen.dart';
import '../shared/privacy_screen.dart';
import '../shared/terms_screen.dart';
import 'clinic_search_screen.dart';
import 'guest_doctor_search_screen.dart';
import 'guest_emergency_screen.dart';

/// COMPLETENESS FIX (mobile parity — "public page same to same karo"): this used to loosely
/// mirror an UNROUTED web component (PublicPages.jsx#Home, which App.jsx never actually mounts).
/// The real signed-out homepage — the one App.jsx mounts at "/" — is `PatientLanding` in
/// client/src/pages/PublicLanding.jsx. This screen now mirrors THAT page section-by-section:
/// hero (kicker/title/lead/search/trust row/live-queue preview card), stats strip, specializations
/// grid, top-rated doctors, three-steps, queue-feature CTA, a testimonial, and the doctor CTA —
/// using the same real GET /doctors, /geography/specializations, /clinics endpoints the rest of
/// the app already uses (all optionalAuthenticate, so they work signed out).
class GuestHomeScreen extends StatefulWidget {
  const GuestHomeScreen({super.key});

  @override
  State<GuestHomeScreen> createState() => _GuestHomeScreenState();
}

class _HomeData {
  final List<Specialization> specializations;
  final List<DoctorDirectoryItem> doctors;
  final int clinicsCount;
  // COMPLETENESS FIX (hero-search parity — client/src/pages/PublicLanding.jsx's hero-search
  // has City and Clinic selects too, not just specialization + keyword): derived client-side
  // from the already-fetched doctor list, the same way the web app's own city/clinic filtering
  // works (exact name match against data.doctors, not a server-side query param).
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
  // Mirrors web's default `useState('today')` on the Booking select — not wired to an actual
  // filter (no real-time slot data exists for a signed-out visitor to filter against, same
  // reason QueueTrackerScreen's empty state exists), kept for visual/field parity only.
  bool _todayOnly = true;
  late Future<_HomeData> _future;
  // WEBSITE PARITY (sidebar): these two sections are what the website's mobile nav's "Specialties"
  // and "How it works" links jump to via #anchor hrefs (SiteHeader in client/src/pages/
  // PublicPages.jsx: href="/#specializations" / href="/#how-it-works") — Flutter has no anchor-
  // link equivalent, so the drawer below scrolls this page's own ListView to the same section by
  // key instead, landing on the same content the website's link does.
  final _specializationsKey = GlobalKey();
  final _stepsKey = GlobalKey();

  // BUG FIX (sidebar item did nothing): the specializations/steps sections only exist in the tree
  // once the page's data has finished loading (specializations is inside the `if (data != null)`
  // block) — tapping "Specialties" in the drawer right after the page opens, before that first
  // fetch resolves, found no target and silently did nothing. [fallback] gives that tap somewhere
  // to go anyway instead of feeling broken.
  void _scrollToSection(GlobalKey key, {VoidCallback? fallback}) {
    final sectionContext = key.currentContext;
    if (sectionContext == null) {
      fallback?.call();
      return;
    }
    Scrollable.ensureVisible(sectionContext, duration: const Duration(milliseconds: 400), curve: Curves.easeInOut);
  }

  // Matches the exact ListTile look role_scaffold.dart's dashboard drawer uses, so the guest
  // drawer and the logged-in portal drawer read as the same "sidebar" component.
  Widget _drawerItem({required IconData icon, required String label, required VoidCallback onTap}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 1),
      child: ListTile(
        dense: true,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
        leading: Icon(icon, size: 20, color: Colors.white.withOpacity(0.75)),
        title: Text(label, style: TextStyle(color: Colors.white.withOpacity(0.85), fontWeight: FontWeight.w500, fontSize: 14)),
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

  // Each fetch is wrapped so ONE failing endpoint (say /clinics down) doesn't blank the whole
  // homepage — mirrors web's Promise.allSettled-based resilience for this same section set.
  Future<_HomeData> _load() async {
    final results = await Future.wait([
      _fetchSpecializations(),
      _fetchDoctors(),
      _fetchClinicsCount(),
    ]);
    final doctors = results[1] as List<DoctorDirectoryItem>;
    final cities = <String>{};
    final clinicNames = <String>{};
    for (final d in doctors) {
      if (d.city != null && d.city!.trim().isNotEmpty) cities.add(d.city!.trim());
      for (final c in d.clinics) {
        if (c.name.trim().isNotEmpty) clinicNames.add(c.name.trim());
      }
    }
    return _HomeData(
      specializations: results[0] as List<Specialization>,
      doctors: doctors,
      clinicsCount: results[2] as int,
      cities: cities.toList()..sort(),
      clinicNames: clinicNames.toList()..sort(),
    );
  }

  Future<List<Specialization>> _fetchSpecializations() async {
    try {
      final res = await ApiClient.instance.get('/geography/specializations', query: {'pageSize': 100});
      return res.list.map(Specialization.fromJson).toList();
    } catch (_) {
      return const [];
    }
  }

  Future<List<DoctorDirectoryItem>> _fetchDoctors() async {
    try {
      // pageSize 100 (not 20) — matches sibling call sites and gives an accurate average
      // rating / doctor count instead of undercounting against the real doctor pool.
      final res = await ApiClient.instance.get('/doctors', query: {'pageSize': 100, 'sortBy': 'rating', 'sortOrder': 'desc'});
      return res.list.map(DoctorDirectoryItem.fromJson).toList();
    } catch (_) {
      return const [];
    }
  }

  Future<int> _fetchClinicsCount() async {
    try {
      final res = await ApiClient.instance.get('/clinics', query: {'pageSize': 200});
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
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // WEBSITE PARITY: the real site's header always has a way to reach login/account (see
      // SiteHeader in client/src/pages/PublicPages.jsx) even on the public landing page — now
      // that this screen is the app's default (signed-out) entry point, login can't be tucked
      // away only in the footer, so it's also one tap away from every screen via the AppBar.
      appBar: AppBar(
        // WEBSITE PARITY (brand row — "sidebar ke baad icon do uske baad bookmydoctor24 ek hi
        // line me"): the automatic drawer/hamburger icon Flutter adds as `leading` (because
        // `drawer:` is set below) sits to the left of this `title`, so logo-icon + name here reads
        // as [hamburger][logo][BookMyDoctor24] in one row — the same brand lockup as the website's
        // own header (SiteHeader's brand-mark image + "BookMyDoctor24" text, side by side).
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.asset('assets/branding/app_icon.png', width: 28, height: 28),
            ),
            const SizedBox(width: AppSpacing.sm),
            const Text('BookMyDoctor24'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
            style: TextButton.styleFrom(foregroundColor: Colors.white),
            child: const Text('Log in'),
          ),
        ],
      ),
      // WEBSITE PARITY (sidebar — "jaise website me side bar hai waisa hi app me v"): the
      // logged-in dashboards already have this exact drawer (see widgets/role_scaffold.dart, which
      // mirrors components/Sidebar.jsx). This screen is now the app's signed-out entry point, and
      // the website's own mobile hamburger menu on the public page (SiteHeader's "Toggle
      // navigation" button in client/src/pages/PublicPages.jsx) has the same job — reachable from
      // anywhere on the public site, not just this one page's footer — so it gets the same
      // dark-drawer treatment for a consistent app-wide "sidebar" feel, with that menu's own links
      // (Find doctors / Specialties / How it works / Contact) plus Login / Get started at the
      // bottom, same as the website's mobile menu.
      drawer: Drawer(
        backgroundColor: AppColors.charcoal,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
                child: Row(
                  children: [
                    const ClipRRect(
                      borderRadius: BorderRadius.all(Radius.circular(11)),
                      child: Image(image: AssetImage('assets/branding/app_icon.png'), width: 36, height: 36),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    const Expanded(
                      child: Text(
                        'BookMyDoctor24',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 17),
                      ),
                    ),
                  ],
                ),
              ),
              Divider(color: Colors.white.withOpacity(0.1), height: 1),
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
                      _scrollToSection(_specializationsKey, fallback: _goSearch);
                    }),
                    _drawerItem(icon: Icons.list_alt_outlined, label: 'How it works', onTap: () {
                      Navigator.of(context).pop();
                      _scrollToSection(_stepsKey);
                    }),
                    // TRIM (exact website parity — "jitna website me hai utna hi rakho"): this
                    // drawer mirrors SiteHeader's mobile nav in client/src/pages/PublicPages.jsx,
                    // which lists exactly Find doctors / Specialties / How it works / Contact
                    // (+ Login/Get started below). "Find a clinic" and "Emergency" aren't part of
                    // that nav, so they were dropped from here — both stay reachable from this
                    // page's footer further down, same as before.
                    _drawerItem(icon: Icons.mail_outline, label: 'Contact', onTap: () {
                      Navigator.of(context).pop();
                      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ContactSupportScreen()));
                    }),
                  ],
                ),
              ),
              Divider(color: Colors.white.withOpacity(0.1), height: 1),
              Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          side: BorderSide(color: Colors.white.withOpacity(0.3)),
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
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async => setState(() => _future = _load()),
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
              final name = d.specialization?.name;
              if (name == null) continue;
              doctorCountBySpecialization[name] = (doctorCountBySpecialization[name] ?? 0) + 1;
            }
            return ListView(
              padding: EdgeInsets.zero,
              children: [
                _HeroSection(
                  searchController: _searchController,
                  specializations: data?.specializations ?? const [],
                  // BUG FIX (crash guard — DropdownButtonFormField throws "there should be
                  // exactly one item with [DropdownButton]'s value" if `value` isn't among
                  // `items`): a pull-to-refresh can return a narrower specializations/cities/
                  // clinics list than what the visitor already picked (e.g. a flaky/partial
                  // fetch). Passing the raw selection straight to `value` would then crash this
                  // screen outright. Falling back to null here whenever the current selection is
                  // no longer present keeps the dropdown always valid; the visitor's underlying
                  // selection state is untouched, so nothing is lost if the item reappears.
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
                    child: ErrorBanner(error: snapshot.error!, onRetry: () => setState(() => _future = _load())),
                  ),
                if (data != null) ...[
                  _StatsStrip(
                    doctorsCount: data.doctors.length,
                    clinicsCount: data.clinicsCount,
                    avgRating: avgRating,
                  ),
                  KeyedSubtree(
                    key: _specializationsKey,
                    child: _SpecializationsSection(
                      specializations: data.specializations,
                      doctorCountBySpecialization: doctorCountBySpecialization,
                      onTap: (id) => _goSearch(specializationId: id),
                      onSeeAll: () => _goSearch(),
                    ),
                  ),
                  _TopDoctorsSection(
                    doctors: data.doctors.take(6).toList(),
                    onViewAll: () => _goSearch(),
                    onAddDoctor: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RegisterScreen())),
                  ),
                ],
                KeyedSubtree(key: _stepsKey, child: const _StepsSection()),
                _QueueFeatureSection(
                  onCreateAccount: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RegisterScreen())),
                ),
                const _TestimonialSection(),
                _DoctorCtaSection(
                  onJoin: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RegisterScreen())),
                ),
                _FooterLinks(
                  onFindClinic: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ClinicSearchScreen())),
                  onEmergency: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const GuestEmergencyScreen())),
                  onContact: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ContactSupportScreen())),
                  // ROUTING FIX: GuestHomeScreen is now the app's root/first route for signed-out
                  // users (see app_router.dart), so there is nothing above it to pop back to —
                  // this used to assume it was pushed on top of LoginScreen. Push Login instead.
                  onLogin: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Mirrors PatientLanding's REAL hero — light cream/gradient background, a plain (no pill/chip)
/// terracotta eyebrow, a two-tone headline, and the full 5-field hero-search (City/Specialization/
/// Clinic/"Doctor or symptom"/Booking) — plus the trust row and the "hero-card-main" live-queue
/// preview in its default (no active queue) state, identical to what a signed-out visitor sees on
/// web.
///
/// COMPLETENESS FIX (visual — user sent a real screenshot of the website's mobile hero: a light
/// gradient, not the dark AppColors.charcoal panel this used to render, a plain terracotta eyebrow
/// instead of a gold pill, a two-tone dark+terracotta headline instead of solid white, and 5 search
/// fields instead of 2). Real colors below are lifted directly from client/src/reference_site.css's
/// `.hero`/`.eyebrow`/`.hero h1`/`.hero-search`/`.trust-row` rules (the light/default theme — NOT
/// client/src/index.css's `[data-theme=dark] .hero` overrides, which is what got mistakenly used
/// here originally).
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
      // reference_site.css .hero: linear-gradient(145deg,#fff 0%,#fbf8f5 58%,#f5eee9 100%)
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
          // .hero-orb-one / .hero-orb-two — soft decorative color washes, clipped so they never
          // push the section wider than the screen.
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
                // BUG FIX (duplicate branding): this hero used to repeat the app icon here — now
                // that the AppBar itself shows the logo + "BookMyDoctor24" (see build()'s AppBar
                // title above), showing the same icon again right below it was redundant. Removed.
                // .eyebrow — plain uppercase terracotta text with a shield-check icon, NO pill/chip
                // background (the gold pill this used to render doesn't exist on the real site).
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: const [
                    Icon(Icons.verified_user_outlined, size: 16, color: AppColors.primary),
                    SizedBox(width: 6),
                    Text(
                      'TRUSTED HEALTHCARE, SIMPLER',
                      style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.2),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                // .hero h1 / h1 span — two-tone: dark ink, then terracotta for the last phrase.
                Text.rich(
                  const TextSpan(
                    children: [
                      TextSpan(text: 'Care without the ', style: TextStyle(color: AppColors.textPrimary)),
                      TextSpan(text: 'waiting room.', style: TextStyle(color: AppColors.primary)),
                    ],
                  ),
                  style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, height: 1.05, letterSpacing: -1),
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Find verified doctors, reserve your clinic slot, and follow your live queue token from home.',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.5),
                ),
                const SizedBox(height: AppSpacing.md),
                // .hero-search — white card, bordered stacked rows (City/Specialization/Clinic/
                // "Doctor or symptom"/Booking), a Search button below.
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFFFFF),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.border),
                    boxShadow: [BoxShadow(color: AppColors.primaryDark.withOpacity(0.1), blurRadius: 30, offset: const Offset(0, 14))],
                  ),
                  child: Column(
                    children: [
                      _HeroSearchFieldRow(
                        icon: Icons.location_on_outlined,
                        label: 'City',
                        child: DropdownButtonFormField<String>(
                          value: city,
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
                          value: specializationId,
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
                          value: clinicName,
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
                          value: todayOnly,
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
                        padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
                        child: SizedBox(
                          width: double.infinity,
                          child: PrimaryButton(label: 'Search', icon: Icons.search, onPressed: () => onSearch()),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                // .trust-row — muted text, teal check icons (not white/generic green).
                Wrap(
                  spacing: AppSpacing.md,
                  runSpacing: 6,
                  children: const [
                    _TrustItem(label: 'Verified clinicians'),
                    _TrustItem(label: 'Transparent fees'),
                    _TrustItem(label: 'Live queue updates'),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                // hero-card-main, default/empty state — identical to what a signed-out visitor sees
                // on web (no queueAppointment to preview).
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFFFFF),
                    borderRadius: BorderRadius.circular(AppRadius.card),
                    border: Border.all(color: const Color(0xFFDCDCDC)),
                    boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.1), blurRadius: 30, offset: const Offset(0, 12))],
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
                      const Text(
                        'New clinic tokens appear here after you book or check in.',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
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

/// One row inside the hero search card — a small muted uppercase label above the field's value,
/// with a leading icon, separated from the next row by a hairline border. Mirrors
/// `.hero-search label{border-right:1px solid var(--line)}` (rendered as a bottom border here
/// since the mobile layout stacks fields instead of placing them side by side).
class _HeroSearchFieldRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final Widget child;
  final bool last;
  const _HeroSearchFieldRow({required this.icon, required this.label, required this.child, this.last = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        border: last ? null : const Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(icon, size: 16, color: AppColors.textSecondary),
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

/// .hero-orb — a soft, low-opacity color wash behind the hero copy.
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
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(AppRadius.card)),
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

/// Mirrors PatientLanding's stats-strip section (verified doctors / partner clinics /
/// appointments managed / patient rating). "Appointments managed" reads 0 for a signed-out
/// visitor here for the same reason it does on web: /appointments requires auth, so a guest's
/// store never populates it either.
class _StatsStrip extends StatelessWidget {
  final int doctorsCount;
  final int clinicsCount;
  final double avgRating;
  const _StatsStrip({required this.doctorsCount, required this.clinicsCount, required this.avgRating});

  @override
  Widget build(BuildContext context) {
    final items = [
      ['$doctorsCount', 'Verified doctors'],
      ['$clinicsCount', 'Partner clinics'],
      ['0', 'Appointments managed'],
      [avgRating > 0 ? avgRating.toStringAsFixed(1) : '0', 'Patient rating'],
    ];
    // reference_site.css .stats-strip{background:#fdfcfb} — a near-white surface, NOT the
    // tinted primaryLight peach this used to render; .stats-grid strong has no color override,
    // so the numbers are plain dark ink, not brand-terracotta.
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md, horizontal: AppSpacing.sm),
      decoration: const BoxDecoration(
        color: AppColors.background,
        border: Border.symmetric(horizontal: BorderSide(color: AppColors.border)),
      ),
      child: Wrap(
        alignment: WrapAlignment.spaceAround,
        runSpacing: AppSpacing.sm,
        children: [
          for (final item in items)
            SizedBox(
              width: 150,
              child: Column(
                children: [
                  Text(item[0], style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.textPrimary, letterSpacing: -0.5)),
                  Text(item[1], style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
                ],
              ),
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

/// Mirrors PatientLanding's "Browse by specialization" section.
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

  @override
  Widget build(BuildContext context) {
    if (specializations.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PageHeader(
            kicker: 'Find the right care',
            title: 'Browse by specialization',
            subtitle: 'Experienced doctors across the most requested areas of care.',
            // BUG FIX (text parity — this and the doctors-section link below had swapped labels):
            // PatientLanding's specializations section link reads "View all doctors →" (its
            // doctors section below reads "See all →", not this one).
            action: TextButton(onPressed: onSeeAll, child: const Text('View all doctors →')),
          ),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: specializations.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              mainAxisSpacing: AppSpacing.sm,
              crossAxisSpacing: AppSpacing.sm,
              childAspectRatio: 0.95,
            ),
            itemBuilder: (context, i) {
              final s = specializations[i];
              final count = doctorCountBySpecialization[s.name] ?? 0;
              return InkWell(
                borderRadius: BorderRadius.circular(AppRadius.card),
                onTap: () => onTap(s.id),
                child: Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    border: Border.all(color: AppColors.border),
                    borderRadius: BorderRadius.circular(AppRadius.card),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // .specialty-icon{color:var(--primary);background:var(--primary-light)} —
                      // a tinted badge behind the icon, not a bare colored glyph.
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(13)),
                        child: Icon(_specializationIcons[i % _specializationIcons.length], color: AppColors.primary, size: 20),
                      ),
                      const SizedBox(height: 6),
                      Text(s.name, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                      Text('$count ${count == 1 ? 'doctor' : 'doctors'}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 10)),
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

/// Mirrors PatientLanding's "Doctors patients trust" section — a horizontally scrolling row of
/// the same doctor-card content web shows (verified badge, rating, clinic/city, fee, actions).
class _TopDoctorsSection extends StatelessWidget {
  final List<DoctorDirectoryItem> doctors;
  final VoidCallback onViewAll;
  final VoidCallback onAddDoctor;
  const _TopDoctorsSection({required this.doctors, required this.onViewAll, required this.onAddDoctor});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: AppColors.surface,
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: PageHeader(
              kicker: 'Top-rated care',
              title: 'Doctors patients trust',
              subtitle: 'Verified profiles, clear fees, and real availability.',
              // BUG FIX (text parity — see the matching fix note in _SpecializationsSection):
              // PatientLanding's doctors section link reads "See all →".
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
          else
            SizedBox(
              height: 210,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                itemCount: doctors.length,
                separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.sm),
                itemBuilder: (context, i) => SizedBox(width: 260, child: _HomeDoctorCard(doctor: doctors[i])),
              ),
            ),
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
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.card),
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => DoctorDetailScreen(doctorId: doctor.id))),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: AppColors.primaryLight,
                    backgroundImage: doctor.photoUrl != null ? CachedNetworkImageProvider(doctor.photoUrl!) : null,
                    child: doctor.photoUrl == null
                        ? Text(doctor.name.isNotEmpty ? doctor.name[0].toUpperCase() : '?', style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w700))
                        : null,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(doctor.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                        Text(doctor.specialization?.name ?? 'General practice', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  // .rating-pill{color:#b77900;background:#fff6dd} — a tinted gold pill, not a
                  // bare star + plain-colored number.
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                    decoration: BoxDecoration(color: const Color(0xFFFFF6DD), borderRadius: BorderRadius.circular(8)),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.star, size: 12, color: AppColors.goldDark),
                        Text(' ${doctor.rating.toStringAsFixed(1)}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.goldDark)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      clinic != null ? '${clinic.name}${clinic.city != null ? ', ${clinic.city}' : ''}' : (doctor.city ?? 'Clinic not added'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                    ),
                  ),
                ],
              ),
              const Spacer(),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Consultation', style: TextStyle(color: AppColors.textSecondary, fontSize: 10)),
                      Text('₹${doctor.consultationFee.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                    ],
                  ),
                  FilledButton(
                    style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 12), minimumSize: const Size(0, 34)),
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => DoctorDetailScreen(doctorId: doctor.id))),
                    child: const Text('View', style: TextStyle(fontSize: 12)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Mirrors PatientLanding's "Three simple steps" section (Discover / Book instantly / Follow live).
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
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // WEBSITE PARITY: reference_site.css marks this section's heading `.section-heading
          // centered` (unlike the split/left-aligned headings elsewhere on this page) — PageHeader
          // is built for the left-aligned+action-link layout, so this section gets its own
          // centered header instead, including the subtitle line PatientLanding shows here that
          // was previously dropped.
          const Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text('THREE SIMPLE STEPS', textAlign: TextAlign.center, style: TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.1)),
              SizedBox(height: 4),
              Text('From search to consultation', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
              SizedBox(height: 6),
              Text('Everything you need to visit a doctor, without wasting hours at the clinic.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          for (int i = 0; i < steps.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg, horizontal: AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  border: Border.all(color: AppColors.border),
                  borderRadius: BorderRadius.circular(21),
                ),
                child: Stack(
                  children: [
                    // .step-card > span — the step number sits large and light-gray in the card's
                    // top-right corner, not merged into the title text.
                    Positioned(
                      top: 0,
                      right: 0,
                      child: Text('0${i + 1}', style: const TextStyle(color: Color(0xFFCCCCCC), fontSize: 25, fontWeight: FontWeight.w900)),
                    ),
                    Column(
                      children: [
                        // .step-card > svg — icon sits in a soft gray rounded badge, not bare.
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
                        Text(steps[i][2] as String, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSecondary)),
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

/// Mirrors PatientLanding's "queue-feature" section ("The waiting room, redesigned.") plus its
/// "Create free account" CTA.
class _QueueFeatureSection extends StatelessWidget {
  final VoidCallback onCreateAccount;
  const _QueueFeatureSection({required this.onCreateAccount});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      // .queue-feature{background:linear-gradient(135deg,#080808,#252525)} — a near-black diagonal
      // gradient, not the flat AppColors.charcoal this used to render.
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF080808), Color(0xFF252525)]),
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // .kicker-light{color:#d8d8d8} — a light neutral gray on this section's dark
          // background, not the app's gold accent (which the real site never uses here).
          const Text('BUILT AROUND YOUR TIME', style: TextStyle(color: Color(0xFFD8D8D8), fontWeight: FontWeight.w800, fontSize: 11, letterSpacing: 0.5)),
          const SizedBox(height: 6),
          const Text('The waiting room, redesigned.', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(
            'Patients get timely alerts while doctors and reception teams manage one synchronized clinic queue.',
            style: TextStyle(color: Colors.white.withOpacity(0.75)),
          ),
          const SizedBox(height: AppSpacing.md),
          for (final line in const [
            'Token position and estimated waiting time',
            'Delay broadcasts and turn reminders',
            'Walk-in and online bookings in one queue',
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  const Icon(Icons.check_circle, size: 16, color: AppColors.success),
                  const SizedBox(width: 8),
                  Expanded(child: Text(line, style: const TextStyle(color: Colors.white))),
                ],
              ),
            ),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton(
            style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54)),
            onPressed: onCreateAccount,
            child: const Text('Create free account'),
          ),
        ],
      ),
    );
  }
}

/// Mirrors PatientLanding's testimonials section (a single featured quote).
class _TestimonialSection extends StatelessWidget {
  const _TestimonialSection();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // WEBSITE PARITY: reference_site.css also marks this heading `.section-heading
          // centered` (kicker + title only — PatientLanding shows no subtitle line here).
          const Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text('PATIENT STORIES', textAlign: TextAlign.center, style: TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w700, fontSize: 11, letterSpacing: 1.1)),
              SizedBox(height: 4),
              Text('Less waiting. Better care.', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('★★★★★', style: TextStyle(color: AppColors.gold, fontSize: 16)),
                  const SizedBox(height: 6),
                  // Curly quotes to match PatientLanding's literal “ ” characters exactly.
                  const Text('“Clear explanation and a smooth live-queue experience.”', style: TextStyle(fontStyle: FontStyle.italic)),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    children: [
                      const CircleAvatar(radius: 14, backgroundColor: AppColors.primaryLight, child: Text('RV', style: TextStyle(fontSize: 11, color: AppColors.primaryDark))),
                      const SizedBox(width: 8),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: const [
                          Text('Rahul V.', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                          Text('Verified appointment', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                        ],
                      ),
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

/// Mirrors PatientLanding's "For healthcare professionals" doctor-CTA section.
class _DoctorCtaSection extends StatelessWidget {
  final VoidCallback onJoin;
  const _DoctorCtaSection({required this.onJoin});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        // BUG FIX (color parity): .doctor-cta-card{background:linear-gradient(110deg,#f7f7f7,#eee);
        // border:1px solid #dedede} — a neutral light-gray gradient card, not the peach
        // AppColors.primaryLight tint this used to render (the real site never tints this card
        // with the brand accent — only the icon badge below carries the brand color).
        decoration: BoxDecoration(
          gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFFF7F7F7), Color(0xFFEEEEEE)]),
          border: Border.all(color: const Color(0xFFDEDEDE)),
          borderRadius: BorderRadius.circular(AppRadius.card),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // .cta-icon{color:#fff;background:linear-gradient(145deg, var(--primary), var(--teal));
            // border-radius:19px;width:65px;height:65px} — a brand-gradient badge, not a bare icon.
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
            const Text('FOR HEALTHCARE PROFESSIONALS', style: TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w800, fontSize: 11, letterSpacing: 0.5)),
            const SizedBox(height: 6),
            const Text('Run a calmer, smarter clinic.', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            const Text('Appointments, live queue, payments, and patient history in one workspace.', style: TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: AppSpacing.md),
            PrimaryButton(label: 'Join as a doctor', icon: Icons.arrow_forward, onPressed: onJoin),
          ],
        ),
      ),
    );
  }
}

/// Quick-links footer so a guest can still reach the other already-built browsing screens
/// (Find a clinic, Emergency care, Contact) that aren't part of PatientLanding's own nav, plus a
/// way back to Login for someone who already has an account.
class _FooterLinks extends StatelessWidget {
  final VoidCallback onFindClinic;
  final VoidCallback onEmergency;
  final VoidCallback onContact;
  final VoidCallback onLogin;
  const _FooterLinks({required this.onFindClinic, required this.onEmergency, required this.onContact, required this.onLogin});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, 0, AppSpacing.md, AppSpacing.lg),
      child: Column(
        children: [
          const Divider(),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: AppSpacing.sm,
            children: [
              TextButton.icon(onPressed: onFindClinic, icon: const Icon(Icons.storefront_outlined, size: 18), label: const Text('Find a clinic')),
              TextButton.icon(
                onPressed: onEmergency,
                icon: const Icon(Icons.local_hospital_outlined, size: 18, color: AppColors.danger),
                label: const Text('Emergency', style: TextStyle(color: AppColors.danger)),
              ),
              TextButton.icon(onPressed: onContact, icon: const Icon(Icons.mail_outline, size: 18), label: const Text('Contact')),
              // COMPLETENESS FIX (mobile parity): these 4 standalone marketing/legal pages exist on
              // web (About/Blog/Terms/Privacy) but previously had no reachable mobile screen at all.
              TextButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AboutScreen())),
                icon: const Icon(Icons.info_outline, size: 18),
                label: const Text('About'),
              ),
              TextButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BlogScreen())),
                icon: const Icon(Icons.article_outlined, size: 18),
                label: const Text('Blog'),
              ),
              TextButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const TermsScreen())),
                icon: const Icon(Icons.description_outlined, size: 18),
                label: const Text('Terms'),
              ),
              TextButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PrivacyScreen())),
                icon: const Icon(Icons.privacy_tip_outlined, size: 18),
                label: const Text('Privacy'),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton(onPressed: onLogin, child: const Text('Already have an account? Log in')),
        ],
      ),
    );
  }
}
