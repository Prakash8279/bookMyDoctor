import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

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
                              if (clinic.phone != null) ...[
                                const SizedBox(height: AppSpacing.sm),
                                Align(
                                  alignment: Alignment.centerLeft,
                                  child: TextButton.icon(
                                    onPressed: () => _call(clinic.phone!),
                                    icon: const Icon(Icons.call, size: 16),
                                    label: const Text('Call clinic'),
                                  ),
                                ),
                              ],
                            ],
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
