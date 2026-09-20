import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'doctor_detail_screen.dart';

/// GET /doctors — public/optionalAuthenticate, always hard-filtered
/// server-side to verified+active doctors (integration_plan.md §1.4).
///
/// COMPLETENESS FIX (mobile parity — "ushke andar ke all feature nahi hai": the mobile search
/// screen only had a name box + specialization chips, while the real website's /search page
/// (client/src/pages/PublicPages.jsx#SearchResults) has a full "Filters" panel — Doctor or
/// symptom, City, Area, Specialization, Clinic, Fee range, Maximum fee, Experience, Rating,
/// Today booking / Active clinic / 24/7 emergency checkboxes, Sort by, Clear, and an explicit
/// Apply filters button). This screen now rebuilds that exact panel and its exact filtering
/// logic: like the website, ALL of it runs client-side over one fully-loaded doctor list (no
/// per-field server round trip), and editing a field doesn't change the results below until
/// "Apply filters" is tapped — matching SearchResults' `filters` (draft) vs `appliedFilters`
/// (applied) state split precisely. "Clear" resets both, same as the website's clearFilters().
class PatientSearchScreen extends StatefulWidget {
  /// Optional initial values so callers (e.g. the guest home hero search, or its specialization
  /// grid) can hand off a keyword/specialization/city/clinic the visitor already picked there,
  /// instead of landing here empty.
  final String? initialQuery;
  final String? initialSpecializationId;
  final String? initialCity;
  final String? initialClinicName;
  final bool? initialToday;

  const PatientSearchScreen({
    super.key,
    this.initialQuery,
    this.initialSpecializationId,
    this.initialCity,
    this.initialClinicName,
    this.initialToday,
  });

  @override
  State<PatientSearchScreen> createState() => _PatientSearchScreenState();
}

/// Mirrors SearchResults' `filters`/`appliedFilters` shape field-for-field. Every field here is
/// matched by NAME (not id) against the loaded doctor list, exactly like the website — the one
/// exception is the incoming `initialSpecializationId`, which _PatientSearchScreenState resolves
/// to a name as soon as the specializations list loads (see _load()).
class _SearchFilters {
  String name;
  String city;
  String area;
  String specialization;
  String clinic;
  String feeRange;
  String maxFee;
  String experience;
  String rating;
  bool today;
  bool activeClinic;
  bool emergency;
  String sort;

  _SearchFilters({
    this.name = '',
    this.city = '',
    this.area = '',
    this.specialization = '',
    this.clinic = '',
    this.feeRange = '',
    this.maxFee = '',
    this.experience = '',
    this.rating = '',
    this.today = false,
    this.activeClinic = false,
    this.emergency = false,
    this.sort = '',
  });

  _SearchFilters copy() => _SearchFilters(
        name: name,
        city: city,
        area: area,
        specialization: specialization,
        clinic: clinic,
        feeRange: feeRange,
        maxFee: maxFee,
        experience: experience,
        rating: rating,
        today: today,
        activeClinic: activeClinic,
        emergency: emergency,
        sort: sort,
      );
}

class _PatientSearchScreenState extends State<PatientSearchScreen> {
  late final _nameController = TextEditingController(text: widget.initialQuery ?? '');
  List<Specialization> _specializations = [];
  List<DoctorDirectoryItem> _allDoctors = [];
  // BUG FIX ("all city name v show nahi ho raha hai"): City/Area/Clinic options used to be
  // derived from whatever doctors happened to be in the loaded (pageSize:100) doctor list — so a
  // city, area, or clinic with no doctor in that page (or no doctor at all yet) never showed up as
  // a filter option. SearchResults on the website never does this: it pulls City/Area from the
  // master geography lists (GET /geography/cities, /geography/areas) and Clinic from the master
  // clinic list (GET /clinics), same lists client_search_screen.dart already fetches this same
  // way. These three fields now come from those same master lists instead.
  List<City> _cities = [];
  List<Area> _areas = [];
  List<Clinic> _clinics = [];
  bool _loading = true;
  Object? _error;

  late _SearchFilters _draft = _SearchFilters(
    name: widget.initialQuery ?? '',
    city: widget.initialCity ?? '',
    clinic: widget.initialClinicName ?? '',
    today: widget.initialToday ?? false,
  );
  late _SearchFilters _applied = _draft.copy();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([_fetchSpecializations(), _fetchDoctors(), _fetchCities(), _fetchAreas(), _fetchClinics()]);
      final specializations = results[0] as List<Specialization>;
      // The specialty grid on the guest home page hands off a specialization ID (its cards are
      // keyed by id, like the website's own /search?specialization=<name> link is not) — resolve
      // it to the matching name here, once, since every filter in this screen otherwise works by
      // name to match SearchResults' own filter shape exactly.
      if (widget.initialSpecializationId != null && _draft.specialization.isEmpty) {
        final match = specializations.where((s) => s.id == widget.initialSpecializationId);
        if (match.isNotEmpty) {
          _draft.specialization = match.first.name;
          _applied.specialization = match.first.name;
        }
      }
      setState(() {
        _specializations = specializations;
        _allDoctors = results[1] as List<DoctorDirectoryItem>;
        _cities = results[2] as List<City>;
        _areas = results[3] as List<Area>;
        _clinics = results[4] as List<Clinic>;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<List<Specialization>> _fetchSpecializations() async {
    try {
      final res = await ApiClient.instance.get('/geography/specializations', query: {'pageSize': 100});
      final list = <Specialization>[];
      for (final item in res.list) {
        try { list.add(Specialization.fromJson(item)); } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  Future<List<DoctorDirectoryItem>> _fetchDoctors() async {
    try {
      final res = await ApiClient.instance.get('/doctors', query: {'pageSize': 100});
      final list = <DoctorDirectoryItem>[];
      for (final item in res.list) {
        try { list.add(DoctorDirectoryItem.fromJson(item)); } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  // Full master lists — same source and same pageSize cap (the backend rejects pageSize over 100)
  // clinic_search_screen.dart already uses for its own City/Area filters.
  Future<List<City>> _fetchCities() async {
    try {
      final res = await ApiClient.instance.get('/geography/cities', query: {'pageSize': 100});
      final list = <City>[];
      for (final item in res.list) {
        try { list.add(City.fromJson(item)); } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  Future<List<Area>> _fetchAreas() async {
    // Unscoped (no cityId) — fetched once like SearchResults' own `data.areas`, then narrowed to
    // the selected city client-side in _areaOptions below, so picking a City never needs a second
    // network round trip.
    try {
      final res = await ApiClient.instance.get('/geography/areas', query: {'pageSize': 100});
      final list = <Area>[];
      for (final item in res.list) {
        try { list.add(Area.fromJson(item)); } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  Future<List<Clinic>> _fetchClinics() async {
    try {
      final res = await ApiClient.instance.get('/clinics', query: {'pageSize': 100});
      final list = <Clinic>[];
      for (final item in res.list) {
        try { list.add(Clinic.fromJson(item)); } catch (_) {}
      }
      return list;
    } catch (_) {
      return [];
    }
  }

  List<String> get _cityOptions => (_cities.map((c) => c.name).toList()..sort());

  // Scoped to the DRAFT city selection by matching cityId, exactly like SearchResults'
  // `areaOptions` memo (`area.cityId === selectedCity.id`) — all areas when no city is picked yet.
  List<String> get _areaOptions {
    if (_draft.city.isEmpty) return (_areas.map((a) => a.name).toList()..sort());
    final selectedCity = _cities.where((c) => c.name == _draft.city);
    if (selectedCity.isEmpty) return const [];
    final cityId = selectedCity.first.id;
    return (_areas.where((a) => a.cityId == cityId).map((a) => a.name).toList()..sort());
  }

  List<String> get _clinicOptions => (_clinics.map((c) => c.name).toList()..sort());

  // Exact translation of SearchResults' `doctors` useMemo predicate + sort.
  List<DoctorDirectoryItem> get _filteredDoctors {
    final f = _applied;
    final maxFeeValue = double.tryParse(f.maxFee);
    final result = _allDoctors.where((doctor) {
      final specializationName = doctor.specialization?.name ?? '';
      final fee = doctor.consultationFee;
      final matchesName = f.name.trim().isEmpty ||
          '${doctor.name} $specializationName'.toLowerCase().contains(f.name.trim().toLowerCase());
      final matchesCity = f.city.isEmpty || doctor.city == f.city || doctor.clinics.any((c) => c.city == f.city);
      final matchesArea = f.area.isEmpty || doctor.clinics.any((c) => c.area == f.area);
      final matchesSpecialization = f.specialization.isEmpty || specializationName == f.specialization;
      final matchesClinic = f.clinic.isEmpty || doctor.clinics.any((c) => c.name == f.clinic);
      final matchesEmergency = !f.emergency || doctor.emergencyAvailable;
      final matchesActiveClinic = !f.activeClinic || doctor.clinics.isNotEmpty;
      final matchesToday = !f.today || doctor.onlineBooking;
      final matchesExperience = f.experience.isEmpty || (doctor.experienceYears ?? 0) >= (int.tryParse(f.experience) ?? 0);
      final matchesRating = f.rating.isEmpty || doctor.rating >= (double.tryParse(f.rating) ?? 0);
      final matchesMaxFee = maxFeeValue == null || fee <= maxFeeValue;
      final matchesFeeRange = f.feeRange.isEmpty ||
          (f.feeRange == 'Under ₹600' && fee < 600) ||
          (f.feeRange == '₹600–₹900' && fee >= 600 && fee <= 900) ||
          (f.feeRange == 'Above ₹900' && fee > 900);
      return matchesName &&
          matchesCity &&
          matchesArea &&
          matchesSpecialization &&
          matchesClinic &&
          matchesEmergency &&
          matchesActiveClinic &&
          matchesToday &&
          matchesExperience &&
          matchesRating &&
          matchesMaxFee &&
          matchesFeeRange;
    }).toList();
    result.sort((a, b) {
      switch (f.sort) {
        case 'rating':
          return b.rating.compareTo(a.rating);
        case 'fee':
          return a.consultationFee.compareTo(b.consultationFee);
        case 'experience':
          return (b.experienceYears ?? 0).compareTo(a.experienceYears ?? 0);
        default:
          return 0;
      }
    });
    return result;
  }

  void _applyFilters() => setState(() => _applied = _draft.copy());

  void _clearFilters() => setState(() {
        _nameController.clear();
        _draft = _SearchFilters();
        _applied = _SearchFilters();
      });

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingView();
    if (_error != null) {
      return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: _error!, onRetry: _load));
    }
    final doctors = _filteredDoctors;
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        const PageHeader(
          kicker: 'Verified healthcare network',
          title: 'Find your doctor',
          subtitle: 'Compare expertise, location, fees, and live availability before you book.',
        ),
        // "Filters" panel — mirrors SearchResults' `<aside className="filter-panel">` field for
        // field, in the same order, with the same "Clear" action and explicit "Apply filters"
        // button (see the class doc comment above for why editing a field alone doesn't refilter
        // the list below).
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.surface,
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(AppRadius.card),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Filters', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  TextButton(onPressed: _clearFilters, child: const Text('Clear')),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              _FilterField(
                label: 'Doctor or symptom',
                child: TextField(
                  controller: _nameController,
                  decoration: const InputDecoration(hintText: 'Search name or specialty'),
                  onChanged: (v) => _draft.name = v,
                ),
              ),
              _dropdownField(
                label: 'City',
                value: _draft.city,
                options: _cityOptions,
                onChanged: (v) => setState(() {
                  _draft.city = v;
                  // Same as web: changing City can invalidate the current Area selection.
                  if (!_areaOptions.contains(_draft.area)) _draft.area = '';
                }),
              ),
              _dropdownField(label: 'Area', value: _draft.area, options: _areaOptions, onChanged: (v) => setState(() => _draft.area = v)),
              _dropdownField(
                label: 'Specialization',
                value: _draft.specialization,
                options: _specializations.map((s) => s.name).toList(),
                onChanged: (v) => setState(() => _draft.specialization = v),
              ),
              _dropdownField(label: 'Clinic', value: _draft.clinic, options: _clinicOptions, onChanged: (v) => setState(() => _draft.clinic = v)),
              _dropdownField(
                label: 'Fee range',
                value: _draft.feeRange,
                options: const ['Under ₹600', '₹600–₹900', 'Above ₹900'],
                onChanged: (v) => setState(() => _draft.feeRange = v),
              ),
              _dropdownField(
                label: 'Maximum fee',
                value: _draft.maxFee.isEmpty ? '' : 'Up to ₹${int.parse(_draft.maxFee)}',
                options: const ['Up to ₹500', 'Up to ₹1000', 'Up to ₹1500'],
                onChanged: (v) => setState(() => _draft.maxFee = v.replaceAll(RegExp(r'\D'), '')),
              ),
              _dropdownField(
                label: 'Experience',
                value: _draft.experience,
                options: const ['5', '10'],
                onChanged: (v) => setState(() => _draft.experience = v),
              ),
              _dropdownField(label: 'Rating', value: _draft.rating, options: const ['4.5', '4'], onChanged: (v) => setState(() => _draft.rating = v)),
              CheckboxListTile(
                value: _draft.today,
                onChanged: (v) => setState(() => _draft.today = v ?? false),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Today booking'),
              ),
              CheckboxListTile(
                value: _draft.activeClinic,
                onChanged: (v) => setState(() => _draft.activeClinic = v ?? false),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Active clinic'),
              ),
              CheckboxListTile(
                value: _draft.emergency,
                onChanged: (v) => setState(() => _draft.emergency = v ?? false),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('24/7 emergency'),
              ),
              _dropdownField(
                label: 'Sort by',
                value: switch (_draft.sort) { 'rating' => 'Top rated', 'fee' => 'Fee: low to high', 'experience' => 'Experience', _ => '' },
                options: const ['Top rated', 'Fee: low to high', 'Experience'],
                onChanged: (v) => setState(() => _draft.sort = switch (v) { 'Top rated' => 'rating', 'Fee: low to high' => 'fee', 'Experience' => 'experience', _ => '' }),
              ),
              const SizedBox(height: AppSpacing.sm),
              PrimaryButton(label: 'Apply filters', onPressed: _applyFilters),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        // Website's SearchResults shows "N doctors found" / "Live verified profiles with
        // transparent fees" above the results grid.
        Text('${doctors.length} doctor${doctors.length == 1 ? '' : 's'} found', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        const Text('Live verified profiles with transparent fees', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: AppSpacing.sm),
        if (doctors.isEmpty)
          const EmptyStateView(icon: Icons.search_off, title: 'No doctors match these filters', subtitle: 'Try another name or remove a filter.')
        else
          for (final doctor in doctors)
            Padding(padding: const EdgeInsets.only(bottom: AppSpacing.sm), child: _DoctorCard(doctor: doctor)),
      ],
    );
  }

  // A "Select <label>" dropdown that mirrors FormField's select styling (label above, bordered
  // rounded box below) and, like the crash guard already used on the guest home hero search,
  // falls back to no selection if the current value no longer exists in `options` (e.g. after
  // Clear, or a City change invalidating the Area list) rather than throwing.
  Widget _dropdownField({
    required String label,
    required String value,
    required List<String> options,
    required ValueChanged<String> onChanged,
  }) {
    final safeValue = options.contains(value) ? value : null;
    return _FilterField(
      label: label,
      child: DropdownButtonFormField<String>(
        initialValue: safeValue,
        isExpanded: true,
        hint: Text('Select $label'),
        items: [for (final option in options) DropdownMenuItem(value: option, child: Text(option, overflow: TextOverflow.ellipsis))],
        onChanged: (v) => onChanged(v ?? ''),
      ),
    );
  }
}

/// A single filter row: a bold label above a bordered field, matching FormField's
/// label-above-input layout on the website's own filter panel.
class _FilterField extends StatelessWidget {
  final String label;
  final Widget child;
  const _FilterField({required this.label, required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          const SizedBox(height: 4),
          child,
        ],
      ),
    );
  }
}

class _DoctorCard extends StatelessWidget {
  final DoctorDirectoryItem doctor;
  const _DoctorCard({required this.doctor});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => DoctorDetailScreen(doctorId: doctor.id)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                // CachedNetworkImageProvider is a drop-in ImageProvider that disk-caches
                // doctor photos, avoiding a re-download on every list rebuild/scroll.
                backgroundImage: doctor.photoUrl != null ? CachedNetworkImageProvider(doctor.photoUrl!) : null,
                child: doctor.photoUrl == null
                    ? Text(doctor.name.isNotEmpty ? doctor.name[0].toUpperCase() : '?',
                        style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.bold))
                    : null,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(doctor.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                    if (doctor.specialization != null)
                      Text(doctor.specialization!.name, style: const TextStyle(color: AppColors.textSecondary)),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        const Icon(Icons.star, size: 16, color: AppColors.warning),
                        const SizedBox(width: 2),
                        Text('${doctor.rating.toStringAsFixed(1)} (${doctor.reviewCount})'),
                        const SizedBox(width: AppSpacing.md),
                        if (doctor.experienceYears != null) Text('${doctor.experienceYears} yrs exp'),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text('₹${doctor.consultationFee.toStringAsFixed(0)} consultation',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
              if (doctor.emergencyAvailable)
                const Padding(
                  padding: EdgeInsets.only(left: 4),
                  child: Icon(Icons.emergency, color: AppColors.danger, size: 20),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
