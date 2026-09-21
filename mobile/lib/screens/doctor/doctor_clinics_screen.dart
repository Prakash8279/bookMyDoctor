import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/csv_export.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Clinics the doctor is linked to (GET /clinics?mine=true —
/// integration_plan.md §1.5) plus the ability to register a new clinic
/// (starts approvalStatus:'pending' until admin approves) and edit one the
/// doctor owns (isOwner:true — a non-owner assignee gets 403 on PATCH, so
/// the edit action is only ever shown for owned clinics).
///
/// COMPLETENESS FIX (audit Priority 3 #6 — mobile parity): multi-doctor clinic staffing
/// (assign/remove a doctor sharing this clinic, per-doctor online-booking toggle) had a full
/// UI on web (FeaturePages.jsx#DoctorClinics — assignDoctor/toggleOnlineBooking/removeAssignment)
/// but nothing on mobile even though the data model (Clinic.doctors) was already wired up. Gated
/// on `_isOwner`, matching clinics.service.js#assertClinicOwner which 403s anyone else on
/// POST/PATCH/DELETE .../doctors(/:doctorUserId) — mirrors the "Edit" button's existing gating.
class DoctorClinicsScreen extends StatefulWidget {
  const DoctorClinicsScreen({super.key});

  @override
  State<DoctorClinicsScreen> createState() => _DoctorClinicsScreenState();
}

class _DoctorClinicsScreenState extends State<DoctorClinicsScreen> {
  Future<List<Clinic>>? _future;
  String? _busyKey;

  @override
  void initState() {
    super.initState();
    _future = _fetch();
  }

  Future<List<Clinic>> _fetch() async {
    try {
      final res = await ApiClient.instance
          .get('/clinics', query: {'mine': true, 'pageSize': 50})
          .catchError((_) => ApiResponse(data: []));
      final ids = res.list.map((json) => asString(json['id'])).where((id) => id.isNotEmpty).toList();
      final clinics = <Clinic>[];
      for (final id in ids) {
        try {
          final detail = await ApiClient.instance.get('/clinics/$id');
          clinics.add(Clinic.fromJson(detail.map));
        } catch (_) {}
      }
      return clinics;
    } catch (_) {
      return [];
    }
  }

  void _load() {
    setState(() {
      _future = _fetch();
    });
  }

  // BUG FIX (mobile parity audit): ports web's `clinicRecordsCsv`/exportCsv
  // (FeaturePages.jsx#DoctorClinics) — one row per clinic-doctor pairing.
  Future<void> _exportCsv() async {
    final clinics = await _future;
    if (clinics == null) return;
    final rows = <List<dynamic>>[];
    for (var ci = 0; ci < clinics.length; ci++) {
      final c = clinics[ci];
      for (var di = 0; di < c.doctors.length; di++) {
        final d = c.doctors[di];
        rows.add([
          '${ci + 1}-${di + 1}',
          c.name,
          d.name,
          d.isOwner ? 'yes' : 'no',
          d.isPrimary ? 'yes' : 'no',
          d.onlineBooking ? 'enabled' : 'disabled',
          '/clinics?clinic=${Uri.encodeComponent(c.name)}',
        ]);
      }
    }
    await shareCsv(
      filename: 'clinic-settings.csv',
      headers: const ['Id', 'Clinic', 'Doctor', 'Owner', 'Primary', 'Online booking', 'Public profile'],
      rows: rows,
    );
  }

  bool _isOwner(Clinic c) {
    final selfId = context.read<AuthProvider>().user?.id;
    return c.doctors.any((d) => d.doctorUserId == selfId && d.isOwner);
  }

  Future<void> _openForm({Clinic? existing}) async {
    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _ClinicFormScreen(existing: existing)),
    );
    if (result == true) _load();
  }

  Future<void> _openAddDoctor(Clinic c) async {
    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _AddDoctorScreen(clinicId: c.id, clinicName: c.name)),
    );
    if (result == true) _load();
  }

  Future<void> _toggleOnlineBooking(Clinic c, ClinicDoctorLink d, bool next) async {
    setState(() => _busyKey = '${c.id}_${d.doctorUserId}');
    try {
      await ApiClient.instance.patch('/clinics/${c.id}/doctors/${d.doctorUserId}', body: {'onlineBooking': next});
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  Future<void> _removeDoctor(Clinic c, ClinicDoctorLink d) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Remove doctor?'),
        content: Text('Remove ${d.name} from ${c.name}\'s team? They will no longer see this clinic under "My Clinics".'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Remove')),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _busyKey = '${c.id}_${d.doctorUserId}');
    try {
      await ApiClient.instance.delete('/clinics/${c.id}/doctors/${d.doctorUserId}');
      _load();
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  Widget _buildDoctorRow(Clinic c, ClinicDoctorLink d) {
    final busy = _busyKey == '${c.id}_${d.doctorUserId}';
    final tags = [if (d.isOwner) 'Owner', if (d.isPrimary) 'Primary'];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(d.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                Text(
                  tags.isEmpty ? 'Team member' : tags.join(' · '),
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ),
          Switch(
            value: d.onlineBooking,
            onChanged: busy ? null : (v) => _toggleOnlineBooking(c, d, v),
          ),
          SizedBox(
            width: 36,
            height: 36,
            child: busy
                ? const Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator(strokeWidth: 2))
                : IconButton(
                    padding: EdgeInsets.zero,
                    icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.danger),
                    onPressed: () => _removeDoctor(c, d),
                  ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // COMPLETENESS FIX (mobile parity audit round 2 — user request: "backend hai but website me
      // nahi hai to hata do app se backend v oo hata do"): web only ever edits `clinics[0]`
      // (FeaturePages.jsx#DoctorClinics — no UI path to add a second clinic once one exists), so
      // the app's always-visible "Add clinic" FAB was a real extra capability. Now gated the same
      // way: shown only when the doctor has zero clinics yet.
      floatingActionButton: FutureBuilder<List<Clinic>>(
        future: _future,
        builder: (context, snapshot) {
          final clinics = snapshot.data;
          if (clinics == null || clinics.isNotEmpty) return const SizedBox.shrink();
          return FloatingActionButton.extended(
            onPressed: () => _openForm(),
            icon: const Icon(Icons.add),
            label: const Text('Add clinic'),
          );
        },
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              kicker: 'Production database',
              title: 'Clinic settings',
              subtitle: 'Manage clinic details and see every doctor practising at the clinic.',
              // COMPLETENESS FIX (mobile parity audit): web's "Export CSV" action had no mobile equivalent.
              action: TextButton.icon(onPressed: _exportCsv, icon: const Icon(Icons.file_download_outlined, size: 16), label: const Text('Export CSV')),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<Clinic>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
          if (snapshot.hasError) {
            return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: snapshot.error!, onRetry: _load));
          }
          final clinics = snapshot.data ?? [];
          if (clinics.isEmpty) {
            return const EmptyStateView(icon: Icons.local_hospital_outlined, title: 'No clinics linked yet', subtitle: 'Add a clinic to start managing OPD hours and receptionists');
          }
          return RefreshIndicator(
            onRefresh: () async => _load(),
            child: ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: clinics.length,
              separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, i) {
                final c = clinics[i];
                final owner = _isOwner(c);
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(child: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700))),
                            StatusBadge(status: c.approvalStatus),
                          ],
                        ),
                        if (c.address != null) Text(c.address!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                        if (c.city != null) Text('${c.city!.name}${c.area != null ? ", ${c.area!.name}" : ""}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                        if (c.rejectionReason != null) ...[
                          const SizedBox(height: 4),
                          Text('Rejected: ${c.rejectionReason}', style: const TextStyle(color: AppColors.danger, fontSize: 12)),
                        ],
                        if (owner) ...[
                          const SizedBox(height: AppSpacing.sm),
                          Align(
                            alignment: Alignment.centerRight,
                            child: OutlinedButton.icon(
                              onPressed: () => _openForm(existing: c),
                              icon: const Icon(Icons.edit_outlined, size: 16),
                              label: const Text('Edit'),
                            ),
                          ),
                          const Divider(height: AppSpacing.lg),
                          Row(
                            children: [
                              const Expanded(
                                child: Text('Clinic team', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                              ),
                              TextButton.icon(
                                onPressed: () => _openAddDoctor(c),
                                icon: const Icon(Icons.person_add_alt_1_outlined, size: 16),
                                label: const Text('Add doctor'),
                              ),
                            ],
                          ),
                          if (c.doctors.isEmpty)
                            const Padding(
                              padding: EdgeInsets.only(bottom: AppSpacing.xs),
                              child: Text('No doctors linked yet', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                            )
                          else
                            ...c.doctors.map((d) => _buildDoctorRow(c, d)),
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

class _ClinicFormScreen extends StatefulWidget {
  final Clinic? existing;
  const _ClinicFormScreen({this.existing});

  @override
  State<_ClinicFormScreen> createState() => _ClinicFormScreenState();
}

class _ClinicFormScreenState extends State<_ClinicFormScreen> {
  late final _nameCtrl = TextEditingController(text: widget.existing?.name ?? '');
  late final _phoneCtrl = TextEditingController(text: widget.existing?.phone ?? '');
  late final _addressCtrl = TextEditingController(text: widget.existing?.address ?? '');
  City? _selectedCity;
  Area? _selectedArea;
  Future<List<City>>? _citiesFuture;
  Future<List<Area>>? _areasFuture;
  bool _submitting = false;
  String? _error;
  // emergencyAvailable/cash/UPI/QR fields removed from this form (mobile parity audit round 2 —
  // user request: "backend hai but website me nahi hai to hata do app se backend v oo hata do"):
  // web's own DoctorClinics form (FeaturePages.jsx) never had these fields either, and cash/UPI/QR
  // duplicated the real, separate Payment Setup screen (doctor_payment_setup_screen.dart) that
  // already owns this on both app and website. No backend change here — PATCH /clinics/:id still
  // accepts these fields for admin's web ManageClinics, which does use emergencyAvailable.

  @override
  void initState() {
    super.initState();
    // BUG FIX (same root cause as the doctor Reports / receptionist Reports-Patients bug): the
    // backend's list-query validator rejects pageSize over 100 outright (422 "Validation
    // failed"), not clamped.
    _citiesFuture = ApiClient.instance
        .get('/geography/cities', query: {'pageSize': 100})
        .then((res) {
          final list = <City>[];
          for (final item in res.list) {
            try { list.add(City.fromJson(item)); } catch (_) {}
          }
          return list;
        })
        .catchError((_) => <City>[]);
    if (widget.existing?.city != null) {
      _selectedCity = widget.existing!.city;
      _loadAreas(widget.existing!.city!.id);
    }
    _selectedArea = widget.existing?.area;
  }

  void _loadAreas(String cityId) {
    setState(() {
      _areasFuture = ApiClient.instance
          .get('/geography/areas', query: {'cityId': cityId, 'pageSize': 100})
          .then((res) {
            final list = <Area>[];
            for (final item in res.list) {
              try { list.add(Area.fromJson(item)); } catch (_) {}
            }
            return list;
          })
          .catchError((_) => <Area>[]);
    });
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _addressCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_nameCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Clinic name is required');
      return;
    }
    if (widget.existing == null && _selectedCity == null) {
      setState(() => _error = 'City is required');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    final body = {
      'name': _nameCtrl.text.trim(),
      if (_phoneCtrl.text.trim().isNotEmpty) 'phone': _phoneCtrl.text.trim(),
      if (_addressCtrl.text.trim().isNotEmpty) 'address': _addressCtrl.text.trim(),
      if (_selectedCity != null) 'cityId': _selectedCity!.id,
      if (_selectedArea != null) 'areaId': _selectedArea!.id,
    };
    try {
      if (widget.existing == null) {
        await ApiClient.instance.post('/clinics', body: body);
      } else {
        await ApiClient.instance.patch('/clinics/${widget.existing!.id}', body: body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      setState(() {
        _error = err.toString();
        _submitting = false;
      });
    }
  }

  // _pickAndUploadQr removed along with this form's cash/UPI/QR switches (see the field-removal
  // comment above) — QR upload for a clinic now lives only in Payment Setup, matching website.

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.existing == null ? 'Add clinic' : 'Edit clinic')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          TextField(controller: _nameCtrl, decoration: const InputDecoration(labelText: 'Clinic name')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _phoneCtrl, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (optional)')),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _addressCtrl, decoration: const InputDecoration(labelText: 'Address (optional)')),
          const SizedBox(height: AppSpacing.md),
          FutureBuilder<List<City>>(
            future: _citiesFuture,
            builder: (context, snapshot) {
              final cities = snapshot.data ?? [];
              return DropdownButtonFormField<City>(
                initialValue: _selectedCity != null && cities.any((c) => c.id == _selectedCity!.id)
                    ? cities.firstWhere((c) => c.id == _selectedCity!.id)
                    : null,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'City'),
                items: cities.map((c) => DropdownMenuItem(value: c, child: Text(c.name))).toList(),
                onChanged: (c) {
                  setState(() {
                    _selectedCity = c;
                    _selectedArea = null;
                  });
                  if (c != null) _loadAreas(c.id);
                },
              );
            },
          ),
          const SizedBox(height: AppSpacing.md),
          FutureBuilder<List<Area>>(
            future: _areasFuture,
            builder: (context, snapshot) {
              final areas = snapshot.data ?? [];
              return DropdownButtonFormField<Area>(
                initialValue: _selectedArea != null && areas.any((a) => a.id == _selectedArea!.id)
                    ? areas.firstWhere((a) => a.id == _selectedArea!.id)
                    : null,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Area (optional)'),
                items: areas.map((a) => DropdownMenuItem(value: a, child: Text(a.name))).toList(),
                onChanged: _selectedCity == null ? null : (a) => setState(() => _selectedArea = a),
              );
            },
          ),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(label: 'Save', onPressed: _submit, loading: _submitting),
          if (widget.existing == null) ...[
            const SizedBox(height: AppSpacing.sm),
            const Text(
              'New clinics start as "pending" until an admin approves them.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }
}

/// COMPLETENESS FIX (audit Priority 3 #6 — mobile parity): search the verified-doctor directory
/// (GET /doctors — same endpoint patient_search_screen.dart uses) and assign one to this clinic's
/// team via POST /clinics/:id/doctors, mirroring web's "Add a doctor to the clinic team" form
/// (FeaturePages.jsx#DoctorClinics#assignDoctor) — always isOwner:false/isPrimary:false/
/// onlineBooking:true, same as the web form's fixed defaults for a newly-added team member.
class _AddDoctorScreen extends StatefulWidget {
  final String clinicId;
  final String clinicName;
  const _AddDoctorScreen({required this.clinicId, required this.clinicName});

  @override
  State<_AddDoctorScreen> createState() => _AddDoctorScreenState();
}

class _AddDoctorScreenState extends State<_AddDoctorScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  Future<List<DoctorDirectoryItem>>? _future;
  String? _addingId;
  String? _error;

  @override
  void initState() {
    super.initState();
    _search();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _search() {
    setState(() {
      _future = ApiClient.instance.get('/doctors', query: {
        'pageSize': 30,
        if (_searchController.text.trim().isNotEmpty) 'search': _searchController.text.trim(),
      }).then((res) {
        final list = <DoctorDirectoryItem>[];
        for (final item in res.list) {
          try {
            list.add(DoctorDirectoryItem.fromJson(item));
          } catch (_) {}
        }
        return list;
      }).catchError((_) => <DoctorDirectoryItem>[]);
    });
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _search);
  }

  Future<void> _add(DoctorDirectoryItem doctor) async {
    setState(() {
      _addingId = doctor.id;
      _error = null;
    });
    try {
      await ApiClient.instance.post('/clinics/${widget.clinicId}/doctors', body: {
        'doctorUserId': doctor.id,
        'isOwner': false,
        'isPrimary': false,
        'onlineBooking': true,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err.toString();
        _addingId = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Add a doctor · ${widget.clinicName}')),
      body: Column(
        children: [
          if (_error != null) Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: _error!)),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search verified doctors by name'),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<DoctorDirectoryItem>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) return const LoadingView();
                if (snapshot.hasError) {
                  return Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: ErrorBanner(error: snapshot.error!, onRetry: _search),
                  );
                }
                final doctors = snapshot.data ?? [];
                if (doctors.isEmpty) {
                  return const EmptyStateView(icon: Icons.medical_services_outlined, title: 'No matching doctors');
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: doctors.length,
                  separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, i) {
                    final doc = doctors[i];
                    final adding = _addingId == doc.id;
                    return Card(
                      child: ListTile(
                        title: Text(doc.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text('${doc.specialization?.name ?? "General Medicine"} · ${doc.experienceYears ?? 0} yrs'),
                        trailing: adding
                            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                            : TextButton(onPressed: () => _add(doc), child: const Text('Add')),
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
  }
}
