import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
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
    _load();
  }

  void _load() {
    setState(() {
      // The list endpoint's rows are a SUBSET of the full clinic shape (see the Clinic model's
      // doc comment in core_models.dart) — shapeClinicListItem in the server's
      // clinics.service.js never includes `doctors`, so ownership can't be read off a
      // list-sourced Clinic. Fetch each clinic's full detail (which does include `doctors`,
      // via shapeClinicDetail) so `_isOwner` below has real data to check.
      _future = ApiClient.instance
          .get('/clinics', query: {'mine': true, 'pageSize': 50})
          .then((res) => res.list.map((json) => asString(json['id'])).toList())
          .then((ids) => Future.wait(ids.map(
                (id) => ApiClient.instance.get('/clinics/$id').then((res) => Clinic.fromJson(res.map)),
              )));
    });
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(),
        icon: const Icon(Icons.add),
        label: const Text('Add clinic'),
      ),
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, 0),
            child: PageHeader(
              kicker: 'Production database',
              title: 'Clinic settings',
              subtitle: 'Manage clinic details and see every doctor practising at the clinic.',
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
  late final _upiIdCtrl = TextEditingController(text: widget.existing?.paymentUpiId ?? '');
  City? _selectedCity;
  Area? _selectedArea;
  Future<List<City>>? _citiesFuture;
  Future<List<Area>>? _areasFuture;
  late bool _emergencyAvailable = widget.existing?.emergencyAvailable ?? false;
  late bool _cashEnabled = widget.existing?.paymentCashEnabled ?? true;
  late bool _upiEnabled = widget.existing?.paymentUpiEnabled ?? false;
  late String? _qrUrl = widget.existing?.paymentQrUrl;
  bool _submitting = false;
  bool _uploadingQr = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _citiesFuture = ApiClient.instance.get('/geography/cities', query: {'pageSize': 200}).then((res) => res.list.map(City.fromJson).toList());
    if (widget.existing?.city != null) {
      _selectedCity = widget.existing!.city;
      _loadAreas(widget.existing!.city!.id);
    }
    _selectedArea = widget.existing?.area;
  }

  void _loadAreas(String cityId) {
    setState(() {
      _areasFuture = ApiClient.instance.get('/geography/areas', query: {'cityId': cityId, 'pageSize': 200}).then((res) => res.list.map(Area.fromJson).toList());
    });
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _addressCtrl.dispose();
    _upiIdCtrl.dispose();
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
      'emergencyAvailable': _emergencyAvailable,
      'paymentCashEnabled': _cashEnabled,
      'paymentUpiEnabled': _upiEnabled,
      if (_upiEnabled && _upiIdCtrl.text.trim().isNotEmpty) 'paymentUpiId': _upiIdCtrl.text.trim(),
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

  /// COMPLETENESS FIX (audit Priority 3 #8 — mobile parity): POST /media/qr — doctor-or-
  /// receptionist, ownership-checked against THIS clinicId server-side (uploads.service.js#
  /// saveClinicQr — a doctor must be the OWNING doctor at this clinic, matching the same bar
  /// PATCH /clinics/:id itself uses). Only offered when editing an EXISTING clinic (a brand-new
  /// clinic has no id yet to attach the QR to) and only doctor-owner reaches this form at all
  /// (the "Edit" button that opens it is itself gated on `_isOwner` in the list screen above).
  Future<void> _pickAndUploadQr() async {
    if (widget.existing == null) return;
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take a photo'), onTap: () => Navigator.of(context).pop(ImageSource.camera)),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose from gallery'), onTap: () => Navigator.of(context).pop(ImageSource.gallery)),
          ],
        ),
      ),
    );
    if (source == null) return;
    final picked = await ImagePicker().pickImage(source: source, maxWidth: 1200);
    if (picked == null || !mounted) return;
    setState(() => _uploadingQr = true);
    try {
      final ext = picked.path.toLowerCase().split('.').last;
      final mimeType = ext == 'png' ? 'image/png' : (ext == 'webp' ? 'image/webp' : 'image/jpeg');
      final res = await ApiClient.instance.uploadFile(
        '/media/qr',
        filePath: picked.path,
        mimeType: mimeType,
        extraFields: {'clinicId': widget.existing!.id},
      );
      if (mounted) {
        setState(() => _qrUrl = res.map['url'] as String?);
        showSuccessSnack(context, 'QR code uploaded');
      }
    } catch (err) {
      if (mounted) showErrorSnack(context, err);
    } finally {
      if (mounted) setState(() => _uploadingQr = false);
    }
  }

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
                value: _selectedCity != null && cities.any((c) => c.id == _selectedCity!.id)
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
                value: _selectedArea != null && areas.any((a) => a.id == _selectedArea!.id)
                    ? areas.firstWhere((a) => a.id == _selectedArea!.id)
                    : null,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Area (optional)'),
                items: areas.map((a) => DropdownMenuItem(value: a, child: Text(a.name))).toList(),
                onChanged: _selectedCity == null ? null : (a) => setState(() => _selectedArea = a),
              );
            },
          ),
          const SizedBox(height: AppSpacing.md),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Emergency available'),
            value: _emergencyAvailable,
            onChanged: (v) => setState(() => _emergencyAvailable = v),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Accepts cash'),
            value: _cashEnabled,
            onChanged: (v) => setState(() => _cashEnabled = v),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Accepts UPI'),
            value: _upiEnabled,
            onChanged: (v) => setState(() => _upiEnabled = v),
          ),
          if (_upiEnabled) ...[
            const SizedBox(height: AppSpacing.sm),
            TextField(controller: _upiIdCtrl, decoration: const InputDecoration(labelText: 'UPI ID')),
            // COMPLETENESS FIX (audit Priority 3 #8 — mobile parity): see _pickAndUploadQr — only
            // offered once the clinic exists (needs a real clinicId to attach the QR to).
            if (widget.existing != null) ...[
              const SizedBox(height: AppSpacing.md),
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  if (_qrUrl != null)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: CachedNetworkImage(imageUrl: _qrUrl!, width: 64, height: 64, fit: BoxFit.cover),
                    )
                  else
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.border)),
                      child: const Icon(Icons.qr_code_2_outlined, color: AppColors.textSecondary),
                    ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _uploadingQr ? null : _pickAndUploadQr,
                      icon: _uploadingQr
                          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.upload_file_outlined, size: 16),
                      label: Text(_qrUrl != null ? 'Replace QR code' : 'Upload QR code'),
                    ),
                  ),
                ],
              ),
            ],
          ],
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
      }).then((res) => res.list.map(DoctorDirectoryItem.fromJson).toList());
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
