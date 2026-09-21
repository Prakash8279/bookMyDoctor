import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../models/clinical_models.dart';
import '../../models/core_models.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/booking_slip_sheet.dart';
import '../../widgets/common_widgets.dart';

/// Walk-in booking on behalf of a patient. Same async POST-then-poll flow
/// as the patient app's own booking screen (integration_plan.md §1.8), but
/// with the patient REQUIRED (the caller is a receptionist) and the
/// doctor list sourced from this clinic's linked doctors rather than the
/// public directory.
///
/// PARITY FIX (mobile parity audit — Receptionist panel, user request:
/// "receptionist me jitna v extra feature add hai website se oo sab hata
/// do"): this used to offer an "Existing patient" search tab (a
/// client-derived patient list with no real backend search endpoint behind
/// it), an "Emergency booking" toggle, and a "Payment method" dropdown —
/// none of which exist on the website's own WalkIn form (StaffPages.jsx),
/// which is just Patient name / Phone / Patient email / Doctor / Visit date
/// / Slot time / Reason, always creating the appointment via
/// `patientName`+`patientPhone` (never `patientUserId`, never `isEmergency`,
/// never `paymentMethod`). All three mobile-only additions removed so this
/// screen now submits the exact same fields as the website.
class ReceptionistWalkInBookingScreen extends StatefulWidget {
  const ReceptionistWalkInBookingScreen({super.key});

  @override
  State<ReceptionistWalkInBookingScreen> createState() => _ReceptionistWalkInBookingScreenState();
}

class _ReceptionistWalkInBookingScreenState extends State<ReceptionistWalkInBookingScreen> {
  bool _loadingOptions = true;
  Object? _loadError;

  List<ClinicDoctorLink> _clinicDoctors = [];
  // BUG FIX (mobile parity audit): web's WalkIn form shows a trailing "recent bookings" table
  // built from the same already-fetched appointments list (StaffPages.jsx) — mobile fetched this
  // list and now only uses it for that trailing table (see class doc comment for why the
  // client-derived "known patients" search tab that used to also come from this list was removed).
  List<Appointment> _recentAppointments = [];

  final _newPatientNameCtrl = TextEditingController();
  final _newPatientPhoneCtrl = TextEditingController();
  final _newPatientEmailCtrl = TextEditingController();

  ClinicDoctorLink? _selectedDoctor;
  DateTime? _selectedDate;
  TimeOfDay? _selectedTime;
  final _reasonController = TextEditingController();

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
        ApiClient.instance.get('/appointments', query: {'pageSize': 100}).catchError((_) => ApiResponse(data: [])),
      ]);
      final clinic = Clinic.fromJson(results[0].map);
      final appointments = <Appointment>[];
      for (final item in results[1].list) {
        try {
          appointments.add(Appointment.fromJson(item));
        } catch (_) {}
      }
      setState(() {
        _clinicDoctors = clinic.doctors;
        _recentAppointments = appointments;
        _loadingOptions = false;
      });
    } catch (err) {
      setState(() {
        _loadError = err;
        _loadingOptions = false;
      });
    }
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

  bool get _hasPatient => _newPatientNameCtrl.text.trim().isNotEmpty && _newPatientPhoneCtrl.text.trim().isNotEmpty;

  // BUG FIX (mobile parity audit): web's WalkIn form treats the time slot as optional
  // ("Slot time (optional)", StaffPages.jsx) — appointments.validation.js#createAppointment only
  // requires doctorUserId + appointmentDate; when appointmentTime is omitted,
  // appointments.service.js#runBookingJob auto-assigns the doctor's next free slot. Mobile
  // hard-required a time pick here, making that auto-assign path unreachable from the UI.
  bool get _canSubmit => _selectedDoctor != null && _hasPatient && _selectedDate != null && !_submitting;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _submitting = true;
      _error = null;
      _pollingStatus = 'Submitting booking...';
    });
    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate!);
      // BUG FIX (mobile parity audit): omit the key entirely when no time was picked (mirrors
      // web's `appointmentTime: values.time || undefined`), letting runBookingJob auto-assign the
      // next free slot server-side — sending a forced value here made that path unreachable.
      final timeStr = _selectedTime == null
          ? null
          : '${_selectedTime!.hour.toString().padLeft(2, '0')}:${_selectedTime!.minute.toString().padLeft(2, '0')}';

      final postRes = await ApiClient.instance.post('/appointments', body: {
        'doctorUserId': _selectedDoctor!.doctorUserId,
        'patientName': _newPatientNameCtrl.text.trim(),
        'patientPhone': _newPatientPhoneCtrl.text.trim(),
        if (_newPatientEmailCtrl.text.trim().isNotEmpty) 'patientEmail': _newPatientEmailCtrl.text.trim(),
        'clinicId': _clinicId,
        'appointmentDate': dateStr,
        if (timeStr != null) 'appointmentTime': timeStr,
        if (_reasonController.text.trim().isNotEmpty) 'reason': _reasonController.text.trim(),
      });

      final jobId = postRes.map['jobId'] as String;
      setState(() => _pollingStatus = 'Confirming the slot...');
      final result = await _pollBookingStatus(jobId);

      if (!mounted) return;
      if (result.status == 'confirmed') {
        setState(() => _pollingStatus = null);
        final bookedAppt = result.appointment ??
            Appointment(
              id: result.jobId,
              status: 'confirmed',
              appointmentDate: dateStr,
              appointmentTime: timeStr ?? '',
              tokenNumber: result.appointment?.tokenNumber,
              isEmergency: false,
              source: 'walkin',
              paymentStatus: 'pending',
              doctor: _selectedDoctor != null
                  ? DoctorRef(
                      id: _selectedDoctor!.doctorUserId,
                      name: _selectedDoctor!.name,
                    )
                  : null,
              clinic: null,
              patient: PatientRef(
                id: '',
                name: _newPatientNameCtrl.text.trim(),
                phone: _newPatientPhoneCtrl.text.trim(),
              ),
              reason: _reasonController.text.trim(),
              fees: Fees(),
            );

        await showDialog(
          context: context,
          builder: (dialogCtx) => AlertDialog(
            title: const Row(
              children: [
                Icon(Icons.check_circle, color: AppColors.success, size: 24),
                SizedBox(width: 8),
                Text('Appointment Booked'),
              ],
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Token #${bookedAppt.tokenNumber ?? "—"}',
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.primaryDark),
                ),
                const SizedBox(height: 6),
                Text('Date: ${bookedAppt.appointmentDate} at ${bookedAppt.appointmentTime}'),
                if (bookedAppt.doctor?.name != null)
                  Text('Doctor: Dr. ${bookedAppt.doctor!.name}'),
                if (bookedAppt.patient?.name != null)
                  Text('Patient: ${bookedAppt.patient!.name}'),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogCtx).pop(),
                child: const Text('Close'),
              ),
              ElevatedButton.icon(
                onPressed: () {
                  Navigator.of(dialogCtx).pop();
                  showBookingSlipSheet(context, bookedAppt);
                },
                icon: const Icon(Icons.receipt_long, size: 18),
                label: const Text('View Slip'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryDark,
                  foregroundColor: Colors.white,
                ),
              ),
            ],
          ),
        );
        if (mounted) {
          setState(() {
            _selectedDoctor = null;
            _newPatientNameCtrl.clear();
            _newPatientPhoneCtrl.clear();
            _newPatientEmailCtrl.clear();
            _selectedDate = null;
            _selectedTime = null;
            _reasonController.clear();
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
          // PARITY FIX (mobile parity audit — Receptionist panel): matches web's WalkIn form
          // exactly — just Patient name / Phone / Patient email, no existing-patient lookup (see
          // class doc comment for why that tab was removed).
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
          const SizedBox(height: AppSpacing.md),
          DropdownButtonFormField<ClinicDoctorLink>(
            initialValue: _selectedDoctor,
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
                  onPressed: _selectedTime == null ? _pickTime : () => setState(() => _selectedTime = null),
                  icon: Icon(_selectedTime == null ? Icons.access_time : Icons.close, size: 18),
                  // BUG FIX (mobile parity audit): "(optional)" label matches web's placeholder
                  // copy ("Leave blank to auto-assign the next slot"); once a time is picked,
                  // tapping the button clears it back to auto-assign (a receptionist who picked
                  // one by mistake can undo it without a date/time picker round-trip).
                  label: Text(_selectedTime == null ? 'Select time (optional)' : _selectedTime!.format(context)),
                ),
              ),
            ],
          ),
          if (_selectedTime == null) ...[
            const SizedBox(height: 4),
            const Text('Leave blank to auto-assign the next slot.', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          ],
          const SizedBox(height: AppSpacing.md),
          TextField(controller: _reasonController, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason for visit (optional)')),
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
          const SizedBox(height: AppSpacing.lg),
          // BUG FIX (mobile parity audit): web's WalkIn form has a trailing read-only table of
          // this clinic's bookings (StaffPages.jsx) — mobile fetches the same list and shows it
          // here.
          SectionCard(
            title: 'Recent bookings',
            child: _recentAppointments.isEmpty
                ? const Text('No bookings yet.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13))
                : Column(
                    children: [
                      for (var i = 0; i < _recentAppointments.length; i++) ...[
                        if (i > 0) const Divider(height: AppSpacing.lg),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(_recentAppointments[i].patient?.name ?? '—', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                  const SizedBox(height: 2),
                                  Text(
                                    '${_recentAppointments[i].appointmentDate} · ${_recentAppointments[i].appointmentTime}',
                                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                  ),
                                ],
                              ),
                            ),
                            StatusBadge(status: _recentAppointments[i].status),
                          ],
                        ),
                      ],
                    ],
                  ),
          ),
        ],
      );
  }
}
