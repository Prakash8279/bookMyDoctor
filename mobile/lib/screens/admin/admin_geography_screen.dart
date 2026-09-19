import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Geography management — cities, areas (under a city), specializations.
/// COMPLETENESS FIX (audit Priority 3 #1 — mobile parity): this comment used to claim "POST
/// only, no PATCH/DELETE on any geography resource in this API version" — that was never
/// updated after DELETE /geography/cities/:id, /cities/:id/areas/:id and /specializations/:id
/// were added (geography.routes.js), which the web app's admin Cities & areas page already uses.
/// A mobile admin had no way to remove a mis-entered city/area/specialization without switching
/// to web — each Chip below now has a delete (x) affordance wired to those same endpoints. The
/// backend guards deletion against a city/area still in use by a clinic (geography.service.js#
/// deleteCity / #deleteArea) — that failure surfaces here as a normal error snackbar.
class AdminGeographyScreen extends StatefulWidget {
  const AdminGeographyScreen({super.key});

  @override
  State<AdminGeographyScreen> createState() => _AdminGeographyScreenState();
}

class _AdminGeographyScreenState extends State<AdminGeographyScreen> {
  Future<List<City>>? _citiesFuture;
  Future<List<Specialization>>? _specializationsFuture;
  City? _areaCity;
  Future<List<Area>>? _areasFuture;

  @override
  void initState() {
    super.initState();
    _loadCities();
    _loadSpecializations();
  }

  void _loadCities() {
    setState(() {
      _citiesFuture = ApiClient.instance.get('/geography/cities', query: {'pageSize': 200}).then((res) => res.list.map(City.fromJson).toList());
    });
  }

  void _loadSpecializations() {
    setState(() {
      _specializationsFuture =
          ApiClient.instance.get('/geography/specializations', query: {'pageSize': 200}).then((res) => res.list.map(Specialization.fromJson).toList());
    });
  }

  void _loadAreas(String cityId) {
    setState(() {
      _areasFuture = ApiClient.instance.get('/geography/areas', query: {'cityId': cityId, 'pageSize': 200}).then((res) => res.list.map(Area.fromJson).toList());
    });
  }

  Future<void> _addCity() async {
    final nameCtrl = TextEditingController();
    final stateCtrl = TextEditingController();
    try {
      final saved = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Add city'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'City name')),
              const SizedBox(height: AppSpacing.sm),
              TextField(controller: stateCtrl, decoration: const InputDecoration(labelText: 'State (optional)')),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Add')),
          ],
        ),
      );
      if (saved != true || nameCtrl.text.trim().isEmpty) return;
      try {
        await ApiClient.instance.post('/geography/cities', body: {
          'name': nameCtrl.text.trim(),
          if (stateCtrl.text.trim().isNotEmpty) 'state': stateCtrl.text.trim(),
        });
        _loadCities();
      } catch (err) {
        if (mounted) showErrorSnack(context, err);
      }
    } finally {
      nameCtrl.dispose();
      stateCtrl.dispose();
    }
  }

  Future<void> _addArea() async {
    if (_areaCity == null) return;
    final nameCtrl = TextEditingController();
    final pincodeCtrl = TextEditingController();
    try {
      final saved = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text('Add area in ${_areaCity!.name}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Area name')),
              const SizedBox(height: AppSpacing.sm),
              TextField(controller: pincodeCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Pincode (optional, 6 digits)')),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Add')),
          ],
        ),
      );
      if (saved != true || nameCtrl.text.trim().isEmpty) return;
      try {
        await ApiClient.instance.post('/geography/cities/${_areaCity!.id}/areas', body: {
          'name': nameCtrl.text.trim(),
          if (pincodeCtrl.text.trim().isNotEmpty) 'pincode': pincodeCtrl.text.trim(),
        });
        _loadAreas(_areaCity!.id);
      } catch (err) {
        if (mounted) showErrorSnack(context, err);
      }
    } finally {
      nameCtrl.dispose();
      pincodeCtrl.dispose();
    }
  }

  Future<void> _addSpecialization() async {
    final nameCtrl = TextEditingController();
    final iconCtrl = TextEditingController();
    // Mirrors the web app's Specializations page (PortalSectionPages.jsx), which collects a
    // description rather than an icon — both fields are accepted by the backend
    // (geography.service.js#createSpecialization), so this screen offers both.
    final descriptionCtrl = TextEditingController();
    try {
      final saved = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Add specialization'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
              const SizedBox(height: AppSpacing.sm),
              TextField(controller: descriptionCtrl, maxLines: 2, decoration: const InputDecoration(labelText: 'Description (optional)')),
              const SizedBox(height: AppSpacing.sm),
              TextField(controller: iconCtrl, decoration: const InputDecoration(labelText: 'Icon (optional)')),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Add')),
          ],
        ),
      );
      if (saved != true || nameCtrl.text.trim().isEmpty) return;
      try {
        await ApiClient.instance.post('/geography/specializations', body: {
          'name': nameCtrl.text.trim(),
          if (iconCtrl.text.trim().isNotEmpty) 'icon': iconCtrl.text.trim(),
          if (descriptionCtrl.text.trim().isNotEmpty) 'description': descriptionCtrl.text.trim(),
        });
        _loadSpecializations();
      } catch (err) {
        if (mounted) showErrorSnack(context, err);
      }
    } finally {
      nameCtrl.dispose();
      iconCtrl.dispose();
      descriptionCtrl.dispose();
    }
  }

  Future<bool> _confirmDelete(String label) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Delete $label?'),
        content: const Text('This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Delete')),
        ],
      ),
    );
    return confirmed == true;
  }

  Future<void> _deleteCity(City city) async {
    if (!await _confirmDelete(city.name)) return;
    try {
      await ApiClient.instance.delete('/geography/cities/${city.id}');
      if (_areaCity?.id == city.id) setState(() => _areaCity = null);
      _loadCities();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

  Future<void> _deleteArea(Area area) async {
    if (_areaCity == null) return;
    if (!await _confirmDelete(area.name)) return;
    try {
      await ApiClient.instance.delete('/geography/cities/${_areaCity!.id}/areas/${area.id}');
      _loadAreas(_areaCity!.id);
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

  Future<void> _deleteSpecialization(Specialization specialization) async {
    if (!await _confirmDelete(specialization.name)) return;
    try {
      await ApiClient.instance.delete('/geography/specializations/${specialization.id}');
      _loadSpecializations();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        // Mirrors the web app's CitiesAreas `Page` header (AdminPages.jsx) — same
        // title + subtitle copy.
        const PageHeader(
          title: 'Cities & areas',
          subtitle: 'Maintain supported locations and pincodes.',
        ),
        SectionCard(
          title: 'Cities',
          trailing: TextButton.icon(onPressed: _addCity, icon: const Icon(Icons.add, size: 18), label: const Text('Add')),
          child: FutureBuilder<List<City>>(
            future: _citiesFuture,
            builder: (context, snapshot) {
              final cities = snapshot.data ?? [];
              if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
              if (cities.isEmpty) return const Text('No cities yet', style: TextStyle(color: AppColors.textSecondary));
              return Wrap(
                spacing: 8,
                runSpacing: 8,
                children: cities
                    .map((c) => Chip(
                          label: Text('${c.name}${c.state != null ? ", ${c.state}" : ""}'),
                          onDeleted: () => _deleteCity(c),
                          deleteIcon: const Icon(Icons.close, size: 16),
                        ))
                    .toList(),
              );
            },
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        SectionCard(
          title: 'Areas',
          trailing: TextButton.icon(onPressed: _areaCity == null ? null : _addArea, icon: const Icon(Icons.add, size: 18), label: const Text('Add')),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              FutureBuilder<List<City>>(
                future: _citiesFuture,
                builder: (context, snapshot) {
                  final cities = snapshot.data ?? [];
                  return DropdownButtonFormField<City>(
                    value: _areaCity != null && cities.any((c) => c.id == _areaCity!.id) ? cities.firstWhere((c) => c.id == _areaCity!.id) : null,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Pick a city to view/add areas'),
                    items: cities.map((c) => DropdownMenuItem(value: c, child: Text(c.name))).toList(),
                    onChanged: (c) {
                      setState(() => _areaCity = c);
                      if (c != null) _loadAreas(c.id);
                    },
                  );
                },
              ),
              const SizedBox(height: AppSpacing.sm),
              if (_areaCity != null)
                FutureBuilder<List<Area>>(
                  future: _areasFuture,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                    final areas = snapshot.data ?? [];
                    if (areas.isEmpty) return const Text('No areas yet in this city', style: TextStyle(color: AppColors.textSecondary));
                    return Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: areas
                          .map((a) => Chip(
                                label: Text('${a.name}${a.pincode != null ? " (${a.pincode})" : ""}'),
                                onDeleted: () => _deleteArea(a),
                                deleteIcon: const Icon(Icons.close, size: 16),
                              ))
                          .toList(),
                    );
                  },
                ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        SectionCard(
          title: 'Specializations',
          trailing: TextButton.icon(onPressed: _addSpecialization, icon: const Icon(Icons.add, size: 18), label: const Text('Add')),
          child: FutureBuilder<List<Specialization>>(
            future: _specializationsFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
              final items = snapshot.data ?? [];
              if (items.isEmpty) return const Text('No specializations yet', style: TextStyle(color: AppColors.textSecondary));
              return Wrap(
                spacing: 8,
                runSpacing: 8,
                children: items
                    .map((s) => Chip(
                          label: Text(s.name),
                          onDeleted: () => _deleteSpecialization(s),
                          deleteIcon: const Icon(Icons.close, size: 16),
                        ))
                    .toList(),
              );
            },
          ),
        ),
      ],
    );
  }
}
