import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../models/clinical_models.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Walk-in booking on behalf of a patient. Same async POST-then-poll flow
/// as the patient app's own booking screen (integration_plan.md §1.8), but
/// with the patient REQUIRED (the caller is a receptionist) and the
/// doctor list sourced from this clinic's linked doctors rather than the
/// public directory.
///
/// **Known gap (integration_plan.md §6.7):** there is no `/patients` search
/// endpoint anywhere in the API — a receptionist cannot look up an arbitrary
/// patient by name/phone. The best available substitute is a distinct-
/// patient list derived client-side from this clinic's own
/// `GET /appointments` history, so only patients who have visited this
/// clinic before appear in the "Existing patient" tab below.
///
/// COMPLETENESS FIX: a genuinely first-time walk-in patient (no prior visit
/// to this clinic, no Connect account) previously had no path onto this
/// screen at all. `POST /appointments` already accepts `patientName` +
/// `patientPhone` (+ optional `patientEmail`) as an alternative to
/// `patientUserId` — appointments.service.js#enqueueBooking /
/// #findOrCreateWalkInPatient looks the phone up and creates the account
/// server-side — and the website's own WalkIn form (StaffPages.jsx) is just
/// three plain text fields with no lookup. The "New patient" tab mirrors
/// that exact UX here.
class ReceptionistWalkInBookingScreen extends StatefulWidget {
  const ReceptionistWalkInBookingScreen({super.key});

  @override
  State<ReceptionistWalkInBookingScreen> createState() => _ReceptionistWalkInBookingScreenState();
}

class _ReceptionistWalkInBookingScreenState extends State<ReceptionistWalkInBookingScreen> {
  bool _loadingOptions = true;
  Object? _loadError;

  List<ClinicDoctorLink> _clinicDoctors = [];
  List<PatientRef> _knownPatients = [];
  final _patientSearchCtrl = TextEditingController();

  // "Existing patient" (pick from _knownPatients) vs "New patient" (plain
  // name/phone/email fields, matching the website's WalkIn form) — see the
  // class doc comment above.
  bool _isNewPatient = false;
  final _newPatientNameCtrl = TextEditingController();
  final _newPatientPhoneCtrl = TextEditingController();
  final _newPatientEmailCtrl = TextEditingController();

  ClinicDoctorLink? _selectedDoctor;
  PatientRef? _selectedPatient;
  DateTime? _selectedDate;
  TimeOfDay? _selectedTime;
  final _reasonController = TextEditingController();
  bool _isEmergency = false;
  String _paymentMethod = 'cash';

  bool _submitting = false;
  String? _pollingStatus;
  Object? _error;

  String? get _clinicId => context.read<AuthProvider>().profile?.clinicId;

  @override
  void initState() {
    super.initState();
    _loadOptions();
  }

  @override
  void dispose() {
    _patientSearchCtrl.dispose();
    _newPatientNameCtrl.dispose();
    _newPatientPhoneCtrl.dispose();
    _newPatientEmailCtrl.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _loadOptions() async {
    final clinicId = _clinicId;
    if (clinicId == null || clinicId.isEmpty) {
      setState(() {
        _loadError = ApiException(message: 'Your account has no clinic assignment yet — ask an admin/doctor to assign you before booking.');
        _loadingOptions = false;
      });
      return;
    }
    try {
      final results = await Future.wait([
        ApiClient.instance.get('/clinics/$clinicId'),
        ApiClient.instance.get('/appointments', query: {'pageSize': 100}),
      ]);
      final clinic = Clinic.fromJson(results[0].map);
      final appointments = results[1].list.map(Appointment.fromJson).toList();
      final seen = <String>{};
      final patients = <PatientRef>[];
      for (final a in appointments) {
        final p = a.patient;
        if (p != null && p.id.isNotEmpty && seen.add(p.id)) {
          patients.add(p);
        }
      }
      setState(() {
        _clinicDoctors = clinic.doctors;
        _knownPatients = patients;
        _loadingOptions = false;
      });
    } catch (err) {
      setState(() {
        _loadError = err;
        _loadingOptions = false;
      });
    }
  }

  List<PatientRef> get _filteredPatients {
    final q = _patientSearchCtrl.text.trim().toLowerCase();
    if (q.isEmpty) return _knownPatients;
    return _knownPatients.where((p) => '${p.name ?? ''} ${p.phone ?? ''}'.toLowerCase().contains(q)).toList();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 90)),
    );
    if (picked != null) setState(() => _selectedDate = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(context: context, initialTime: TimeOfDay.now());
    if (picked != null) setState(() => _selectedTime = picked);
  }

  bool get _hasPatient => _isNewPatient
      ? _newPatientNameCtrl.text.trim().isNotEmpty && _newPatientPhoneCtrl.text.trim().isNotEmpty
      : _selectedPatient != null;

  bool get _canSubmit =>
      _selectedDoctor != null && _hasPatient && _selectedDate != null && _selectedTime != null && !_submitting;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _submitting = true;
      _error = null;
      _pollingStatus = 'Submitting booking...';
    });
    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate!);
      final timeStr = '${_selectedTime!.hour.toString().padLeft(2, '0')}:${_selectedTime!.minute.toString().padLeft(2, '0')}';

      final postRes = await ApiClient.instance.post('/appointments', body: {
        'doctorUserId': _selectedDoctor!.doctorUserId,
        if (_isNewPatient) ...{
          'patientName': _newPatientNameCtrl.text.trim(),
          'patientPhone': _newPatientPhoneCtrl.text.trim(),
          if (_newPatientEmailCtrl.text.trim().isNotEmpty) 'patientEmail': _newPatientEmailCtrl.text.trim(),
        } else
          'patientUserId': _selectedPatient!.id,
        'clinicId': _clinicId,
        'appointmentDate': dateStr,
        'appointmentTime': timeStr,
        if (_reasonController.text.trim().isNotEmpty) 'reason': _reasonController.text.trim(),
        'isEmergency': _isEmergency,
        'paymentMethod': _paymentMethod,
      });

      final jobId = postRes.map['jobId'] as String;
      setState(() => _pollingStatus = 'Confirming the slot...');
      final result = await _pollBookingStatus(jobId);

      if (!mounted) return;
      if (result.status == 'confirmed') {
        setState(() => _pollingStatus = null);
        await showDialog(
          context: context,
          builder: (_) => AlertDialog(
            title: const Text('Appointment booked'),
            content: Text(
              'Token number: ${result.appointment?.tokenNumber ?? "—"}\n'
              'Date: ${result.appointment?.appointmentDate ?? dateStr} at ${result.appointment?.appointmentTime ?? timeStr}',
            ),
            actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK'))],
          ),
        );
        if (mounted) {
          setState(() {
            _selectedDoctor = null;
            _selectedPatient = null;
            _patientSearchCtrl.clear();
            _newPatientNameCtrl.clear();
            _newPatientPhoneCtrl.clear();
            _newPatientEmailCtrl.clear();
            _selectedDate = null;
            _selectedTime = null;
            _reasonController.clear();
            _isEmergency = false;
          });
        }
      } else if (result.status == 'failed') {
        setState(() {
          _pollingStatus = null;
          _error = ApiException(message: (result.error?['message'] as String?) ?? 'Booking failed — the slot may already be taken.');
        });
      } else {
        setState(() {
          _pollingStatus = null;
          _error = ApiException(message: 'Still processing — please check Appointments in a moment.');
        });
      }
    } catch (err) {
      setState(() {
        _pollingStatus = null;
        _error = err;
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<BookingStatus> _pollBookingStatus(String jobId) async {
    final deadline = DateTime.now().add(const Duration(seconds: 40));
    while (DateTime.now().isBefore(deadline)) {
      final res = await ApiClient.instance.get('/appointments/booking-status/$jobId');
      final status = BookingStatus.fromJson(res.map);
      if (status.status == 'confirmed' || status.status == 'failed') return status;
      await Future.delayed(const Duration(milliseconds: 1500));
    }
    return BookingStatus(jobId: jobId, status: 'timeout');
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingOptions) return const LoadingView();
    if (_loadError != null && _clinicDoctors.isEmpty) {
      return Padding(padding: const EdgeInsets.all(AppSpacing.md), child: ErrorBanner(error: _loadError!, onRetry: _loadOptions));
    }

    // No own Scaffold/AppBar — only ever embedded as a RoleScaffold nav-item body
    // (receptionist_home_screen.dart), which already supplies the app bar.
    return ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          const PageHeader(
            title: 'Walk-in registration',
            subtitle: 'Create or find a patient, book the visit, and issue a queue token.',
          ),
          if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('Existing patient'), icon: Icon(Icons.person_search)),
              ButtonSegment(value: true, label: Text('New patient'), icon: Icon(Icons.person_add_alt_1)),
            ],
            selected: {_isNewPatient},
            onSelectionChanged: (selection) => setState(() => _isNewPatient = selection.first),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_isNewPatient) ...[
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.08),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text(
                'First-time visitor with no Connect account yet? Enter their details below and a patient account will be created automatically when the visit is booked.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: _newPatientNameCtrl,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Patient name', prefixIcon: Icon(Icons.badge_outlined)),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _newPatientPhoneCtrl,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Phone',
                hintText: 'Used to find a returning patient next time',
                prefixIcon: Icon(Icons.call_outlined),
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _newPatientEmailCtrl,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Patient email (optional)', prefixIcon: Icon(Icons.email_outlined)),
              onChanged: (_) => setState(() {}),
            ),
          ] else ...[
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.08),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text(
                'Only patients who have visited this clinic before appear in the search below — there is no platform-wide patient search. Can\'t find them? Switch to "New patient" above.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: _patientSearchCtrl,
              decoration: const InputDecoration(labelText: 'Search known patients by name or phone', prefixIcon: Icon(Icons.search)),
              // Clearing a now-filtered-out selection avoids DropdownButtonFormField's
              // "exactly one item with this value" assertion when the search text
              // narrows the list past the currently selected patient.
              onChanged: (_) => setState(() {
                if (_selectedPatient != null && !_filteredPatients.any((p) => p.id == _selectedPatient!.id)) {
                  _selectedPatient = null;
                }
              }),
            ),
            const SizedBox(height: AppSpacing.sm),
            DropdownButtonFormField<PatientRef>(
              value: _selectedPatient,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Patient'),
              items: _filteredPatients
                  .map((p) => DropdownMenuItem(
                        value: p,
                        child: Text(p.phone != null ? '${p.name ?? "Patient"} · ${p.phone}' : (p.name ?? 'Patient')),
                      ))
                  .toList(),
              onChanged: (p) => setState(() => _selectedPatient = p),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          DropdownButtonFormField<ClinicDoctorLink>(
            value: _selectedDoctor,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Doctor'),
            items: _clinicDoctors.map((d) => DropdownMenuItem(value: d, child: Text(d.name, overflow: TextOverflow.ellipsis))).toList(),
            onChanged: (d) => setState(() => _selectedDoctor = d),
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today, size: 18),
                  label: Text(_selectedDate == null ? 'Select date' : DateFormat('dd MMM yyyy').format(_selectedDate!)),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pickTime,
                  icon: const Icon(Icons.access_time, size: 18),
                  label: Text(_selectedTime == null ? 'Select time' : _selectedTime!.format(context)),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _reasonController, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason for visit (optional)')),
          const SizedBox(height: AppSpacing.md),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Emergency booking'),
            value: _isEmergency,
            onChanged: (v) => setState(() => _isEmergency = v),
          ),
          const SizedBox(height: AppSpacing.md),
          DropdownButtonFormField<String>(
            value: _paymentMethod,
            decoration: const InputDecoration(labelText: 'Payment method'),
            items: const [
              DropdownMenuItem(value: 'cash', child: Text('Cash')),
              DropdownMenuItem(value: 'upi', child: Text('UPI')),
              DropdownMenuItem(value: 'card', child: Text('Card')),
              DropdownMenuItem(value: 'online', child: Text('Online')),
            ],
            onChanged: (v) => setState(() => _paymentMethod = v ?? 'cash'),
          ),
          const SizedBox(height: AppSpacing.lg),
          if (_pollingStatus != null) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                const SizedBox(width: AppSpacing.sm),
                Text(_pollingStatus!),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          PrimaryButton(label: 'Book walk-in appointment', onPressed: _canSubmit ? _submit : null, loading: _submitting),
        ],
      );
  }
}
