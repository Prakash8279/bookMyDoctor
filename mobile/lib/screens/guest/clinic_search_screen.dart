import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../patient/book_appointment_screen.dart';
import '../patient/doctor_detail_screen.dart';

/// COMPLETENESS FIX (mobile parity — client/src/pages/FeaturePages.jsx#ClinicSearch, the public
/// "Find a clinic" page at web's /clinics, had no mobile equivalent at all: the mobile app had no
/// pre-login browsing of any kind). GET /clinics is optionalAuthenticate, so this works signed out
/// exactly as it does signed in.
class ClinicSearchScreen extends StatefulWidget {
  const ClinicSearchScreen({super.key});

  @override
  State<ClinicSearchScreen> createState() => _ClinicSearchScreenState();
}

class _ClinicSearchScreenState extends State<ClinicSearchScreen> {
  List<City> _cities = [];
  List<Area> _areas = [];
  String? _cityId;
  String? _areaId;
  bool _emergencyOnly = false;
  Future<List<Clinic>>? _future;

  @override
  void initState() {
    super.initState();
    _loadCities();
    _search();
  }

  Future<void> _loadCities() async {
    try {
      final res = await ApiClient.instance.get('/geography/cities', query: {'pageSize': 200});
      final list = <City>[];
      for (final item in res.list) {
        try { list.add(City.fromJson(item)); } catch (_) {}
      }
      if (mounted) setState(() => _cities = list);
    } catch (_) {
      // Non-fatal — city/area filters just won't show if this fails.
    }
  }

  Future<void> _loadAreas(String cityId) async {
    try {
      final res = await ApiClient.instance.get('/geography/areas', query: {'cityId': cityId, 'pageSize': 200});
      final list = <Area>[];
      for (final item in res.list) {
        try { list.add(Area.fromJson(item)); } catch (_) {}
      }
      if (mounted) setState(() => _areas = list);
    } catch (_) {
      if (mounted) setState(() => _areas = []);
    }
  }

  void _search() {
    _future = ApiClient.instance.get('/clinics', query: {
      'pageSize': 100,
      if (_cityId != null) 'city': _cityId,
      if (_areaId != null) 'area': _areaId,
      if (_emergencyOnly) 'emergencyAvailable': true,
    }).then((res) {
      final list = <Clinic>[];
      for (final item in res.list) {
        try { list.add(Clinic.fromJson(item)); } catch (_) {}
      }
      return list;
    }).catchError((_) => <Clinic>[]);
    if (mounted) setState(() {});
  }

  Future<void> _call(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'\s'), ''));
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  void _showClinicProfile(Clinic clinic) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _ClinicProfileSheet(clinic: clinic),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Find a clinic')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              children: [
                // Mirrors the web app's public clinic directory — client/src/pages/
                // FeaturePages.jsx#ClinicSearch renders "Find a clinic" / "Search trusted clinics
                // and hospital branches in your city." above its filters — via the same
                // title+subtitle PageHeader block used across the app.
                const PageHeader(
                  title: 'Find a clinic',
                  subtitle: 'Search trusted clinics and hospital branches in your city.',
                ),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _cityId,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'City'),
                        items: [
                          const DropdownMenuItem(value: null, child: Text('All cities')),
                          for (final c in _cities) DropdownMenuItem(value: c.id, child: Text(c.name)),
                        ],
                        onChanged: (value) {
                          setState(() {
                            _cityId = value;
                            _areaId = null;
                            _areas = [];
                          });
                          if (value != null) _loadAreas(value);
                          _search();
                        },
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _areaId,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Area'),
                        items: [
                          const DropdownMenuItem(value: null, child: Text('All areas')),
                          for (final a in _areas) DropdownMenuItem(value: a.id, child: Text(a.name)),
                        ],
                        onChanged: _cityId == null
                            ? null
                            : (value) {
                                setState(() => _areaId = value);
                                _search();
                              },
                      ),
                    ),
                  ],
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  title: const Text('Emergency services only'),
                  value: _emergencyOnly,
                  onChanged: (value) {
                    setState(() => _emergencyOnly = value ?? false);
                    _search();
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: FutureBuilder<List<Clinic>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: ErrorBanner(error: snapshot.error!, onRetry: _search),
                  );
                }
                final clinics = snapshot.data ?? [];
                if (clinics.isEmpty) {
                  return const EmptyStateView(
                    icon: Icons.storefront_outlined,
                    title: 'No clinics found',
                    subtitle: 'Try a different city, area, or filter.',
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => _search(),
                  // Website's ClinicSearch shows "N clinics found" above the results grid
                  // (client/src/pages/FeaturePages.jsx#ClinicSearch) — mirrored here as the
                  // list's first row.
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    itemCount: clinics.length + 1,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) {
                      if (i == 0) {
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Text(
                            '${clinics.length} clinic${clinics.length == 1 ? '' : 's'} found',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        );
                      }
                      final clinic = clinics[i - 1];
                      return Card(
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: () => _showClinicProfile(clinic),
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(clinic.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                                    ),
                                    StatusBadge(status: clinic.approvalStatus),
                                  ],
                                ),
                                if (clinic.area != null || clinic.city != null) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    [clinic.area?.name, clinic.city?.name].where((v) => v != null && v.isNotEmpty).join(', '),
                                    style: const TextStyle(color: AppColors.textSecondary),
                                  ),
                                ],
                                if (clinic.address != null) ...[
                                  const SizedBox(height: AppSpacing.sm),
                                  Text(clinic.address!, style: const TextStyle(color: AppColors.textSecondary)),
                                ],
                                if (clinic.emergencyAvailable) ...[
                                  const SizedBox(height: AppSpacing.sm),
                                  const Text('Emergency services available', style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600)),
                                ],
                                const SizedBox(height: AppSpacing.sm),
                                Row(
                                  children: [
                                    if (clinic.phone != null) ...[
                                      TextButton.icon(
                                        onPressed: () => _call(clinic.phone!),
                                        icon: const Icon(Icons.call, size: 16),
                                        label: const Text('Call clinic'),
                                      ),
                                      const SizedBox(width: AppSpacing.xs),
                                    ],
                                    TextButton.icon(
                                      onPressed: () => _showClinicProfile(clinic),
                                      icon: const Icon(Icons.medical_services_outlined, size: 16),
                                      label: const Text('Doctors & booking →'),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Clinic profile modal sheet — 100% parity with web's ClinicProfile (FeaturePages.jsx#ClinicProfile):
/// Shows clinic header, verification status, contact details, and all doctors practicing at this clinic.
class _ClinicProfileSheet extends StatefulWidget {
  final Clinic clinic;
  const _ClinicProfileSheet({required this.clinic});

  @override
  State<_ClinicProfileSheet> createState() => _ClinicProfileSheetState();
}

class _ClinicProfileSheetState extends State<_ClinicProfileSheet> {
  late Future<List<DoctorDirectoryItem>> _doctorsFuture;

  @override
  void initState() {
    super.initState();
    _doctorsFuture = _fetchClinicDoctors();
  }

  Future<List<DoctorDirectoryItem>> _fetchClinicDoctors() async {
    try {
      final res = await ApiClient.instance.get('/doctors', query: {'pageSize': 100});
      final doctors = <DoctorDirectoryItem>[];
      for (final item in res.list) {
        try {
          final doc = DoctorDirectoryItem.fromJson(item);
          if (doc.clinics.any((c) => c.id == widget.clinic.id)) {
            doctors.add(doc);
          }
        } catch (_) {}
      }
      return doctors;
    } catch (_) {
      return [];
    }
  }

  Future<void> _call(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'\s'), ''));
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  @override
  Widget build(BuildContext context) {
    final clinic = widget.clinic;
    final locationText = [clinic.address, clinic.area?.name, clinic.city?.name].where((s) => s != null && s.isNotEmpty).join(', ');

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            children: [
              // Top drag handle
              Center(
                child: Container(
                  margin: const EdgeInsets.symmetric(vertical: 10),
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: Colors.grey.shade300, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              // Header
              Container(
                color: AppColors.charcoal,
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.local_hospital, color: Colors.white70, size: 16),
                        const SizedBox(width: 6),
                        Text(
                          clinic.approvalStatus == 'disabled' ? 'Inactive clinic' : 'Active clinic',
                          style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                        const Spacer(),
                        if (clinic.emergencyAvailable)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.danger.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(color: AppColors.danger),
                            ),
                            child: const Text('Emergency 24/7', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(clinic.name, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
                    if (locationText.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.location_on_outlined, color: Colors.white60, size: 14),
                          const SizedBox(width: 4),
                          Expanded(child: Text(locationText, style: const TextStyle(color: Colors.white60, fontSize: 13))),
                        ],
                      ),
                    ],
                    if (clinic.phone != null && clinic.phone!.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      InkWell(
                        onTap: () => _call(clinic.phone!),
                        child: Row(
                          children: [
                            const Icon(Icons.phone, color: AppColors.primaryLight, size: 14),
                            const SizedBox(width: 6),
                            Text(clinic.phone!, style: const TextStyle(color: AppColors.primaryLight, fontWeight: FontWeight.w600, fontSize: 13)),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              // Doctors List Header
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.xs),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Doctors at ${clinic.name}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
              // Doctors List Body
              Expanded(
                child: FutureBuilder<List<DoctorDirectoryItem>>(
                  future: _doctorsFuture,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                    final doctors = snapshot.data ?? [];
                    if (doctors.isEmpty) {
                      return const Center(
                        child: Padding(
                          padding: EdgeInsets.all(AppSpacing.lg),
                          child: Text('No doctors currently listed at this clinic.', style: TextStyle(color: AppColors.textSecondary)),
                        ),
                      );
                    }
                    return ListView.separated(
                      controller: scrollController,
                      padding: const EdgeInsets.all(AppSpacing.md),
                      itemCount: doctors.length,
                      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                      itemBuilder: (context, index) {
                        final doc = doctors[index];
                        return Card(
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.md),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                CircleAvatar(
                                  radius: 22,
                                  backgroundColor: AppColors.primaryLight,
                                  child: Text(
                                    doc.name.split(' ').where((s) => s.isNotEmpty).take(2).map((s) => s[0]).join().toUpperCase(),
                                    style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.primaryDark),
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.sm),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(doc.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                                      const SizedBox(height: 2),
                                      Text(
                                        '${doc.specialization?.name ?? "General Physician"} · ${doc.experienceYears}y exp',
                                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                      ),
                                      const SizedBox(height: 2),
                                      Text('₹${doc.consultationFee.toStringAsFixed(0)} fee', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: AppColors.primaryDark)),
                                      const SizedBox(height: AppSpacing.xs),
                                      Wrap(
                                        spacing: AppSpacing.xs,
                                        children: [
                                          OutlinedButton(
                                            style: OutlinedButton.styleFrom(
                                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                              minimumSize: Size.zero,
                                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                            ),
                                            onPressed: () {
                                              Navigator.of(context).push(MaterialPageRoute(
                                                builder: (_) => DoctorDetailScreen(doctorId: doc.id),
                                              ));
                                            },
                                            child: const Text('View profile', style: TextStyle(fontSize: 12)),
                                          ),
                                          ElevatedButton(
                                            style: ElevatedButton.styleFrom(
                                              backgroundColor: AppColors.primaryDark,
                                              foregroundColor: Colors.white,
                                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                              minimumSize: Size.zero,
                                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                            ),
                                            onPressed: () {
                                              Navigator.of(context).push(MaterialPageRoute(
                                                builder: (_) => BookAppointmentScreen(
                                                  preselectedDoctor: doc,
                                                ),
                                              ));
                                            },
                                            child: const Text('Book now', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
