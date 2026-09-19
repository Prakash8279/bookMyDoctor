import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../models/admin_models.dart';
import '../../models/clinical_models.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';
import 'payment_required_screen.dart';

/// POST /appointments then poll GET /appointments/booking-status/:jobId —
/// booking is fully asynchronous server-side (integration_plan.md §1.8).
/// The initial POST returning 202 is NOT booking success; only a
/// `status:'confirmed'` from the polling endpoint is.
class BookAppointmentScreen extends StatefulWidget {
  final DoctorDirectoryItem? preselectedDoctor;
  // COMPLETENESS FIX (mobile parity — web's PatientEmergencyBooking links to
  // "/patient/book?emergency=1"): lets the emergency-booking screen land here with the emergency
  // toggle already on, same as the web query param does.
  final bool initialEmergency;
  const BookAppointmentScreen({super.key, this.preselectedDoctor, this.initialEmergency = false});

  @override
  State<BookAppointmentScreen> createState() => _BookAppointmentScreenState();
}

class _BookAppointmentScreenState extends State<BookAppointmentScreen> {
  List<DoctorDirectoryItem> _doctors = [];
  List<FamilyMember> _familyMembers = [];
  DoctorDirectoryItem? _selectedDoctor;
  ClinicSummary? _selectedClinic;
  // null = not yet chosen (patient must pick explicitly before submitting); 'self' = booking for
  // self; any other value is a FamilyMember id.
  String? _patientChoice;
  // Defaults to today, no separate time field any more — the backend auto-assigns the doctor's
  // next free slot on the selected date (appointments.service.js#runBookingJob); what the
  // patient sees back is a token/queue number, not a clock time.
  DateTime? _selectedDate = DateTime.now();
  final _reasonController = TextEditingController();
  bool _isEmergency = false;
  // WEBSITE PARITY FIX: the website's booking form (client/src/pages/PatientPages.jsx) has no
  // payment-method field at all — payment is decided later (pay-at-clinic vs. the online
  // PaymentRequiredScreen when prepayment is required). The mobile app used to ask for one here
  // (an extra feature the website doesn't have), and it was never sent as anything but a fixed
  // "cash"/"upi"/"card"/"online" guess anyway. Removed; paymentMethod is simply omitted from the
  // POST body below, exactly like the website's submit() does.
  PlatformCharges? _platformCharges;

  bool _loadingOptions = true;
  bool _submitting = false;
  String? _pollingStatus; // shown while polling after submit
  Object? _error;

  @override
  void initState() {
    super.initState();
    _selectedDoctor = widget.preselectedDoctor;
    _isEmergency = widget.initialEmergency;
    if (_selectedDoctor != null && _selectedDoctor!.clinics.isNotEmpty) {
      _selectedClinic = _selectedDoctor!.clinics.first;
    }
    _loadOptions();
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _loadOptions() async {
    try {
      final futures = await Future.wait([
        widget.preselectedDoctor == null
            ? ApiClient.instance.get('/doctors', query: {'pageSize': 100, 'sortBy': 'rating', 'sortOrder': 'desc'})
            : Future.value(null),
        ApiClient.instance.get('/family-members', query: {'pageSize': 50}),
        // WEBSITE PARITY: the website's booking form loads platformCharges alongside doctors/
        // familyMembers and shows a live Consultation/Platform charge/GST price preview once a
        // doctor is picked (PatientPages.jsx's "Book an appointment" form) — mobile had no
        // equivalent at all. GET /platform-charges is authenticate + any role, so this works fine
        // for a signed-in patient.
        ApiClient.instance.get('/platform-charges'),
      ]);
      setState(() {
        if (futures[0] != null) {
          _doctors = (futures[0] as ApiResponse).list.map(DoctorDirectoryItem.fromJson).toList();
        }
        _familyMembers = (futures[1] as ApiResponse).list.map(FamilyMember.fromJson).toList();
        _platformCharges = PlatformCharges.fromJson((futures[2] as ApiResponse).map);
        _loadingOptions = false;
      });
    } catch (err) {
      setState(() {
        _error = err;
        _loadingOptions = false;
      });
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final maxDays = _selectedDoctor?.maxDaysAdvance ?? 30;
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate ?? now,
      firstDate: now,
      lastDate: now.add(Duration(days: maxDays)),
    );
    if (picked != null) setState(() => _selectedDate = picked);
  }

  bool get _canSubmit =>
      _selectedDoctor != null && _selectedDate != null && _patientChoice != null && !_submitting;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _submitting = true;
      _error = null;
      _pollingStatus = 'Submitting booking...';
    });

    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate!);

      final postRes = await ApiClient.instance.post('/appointments', body: {
        'doctorUserId': _selectedDoctor!.id,
        if (_selectedClinic != null) 'clinicId': _selectedClinic!.id,
        'appointmentDate': dateStr,
        // No appointmentTime — the backend auto-assigns the doctor's next free slot on this
        // date (see runBookingJob's auto-assignment path). The patient only cares about their
        // token/queue number, shown in the confirmation dialog below.
        if (_reasonController.text.trim().isNotEmpty) 'reason': _reasonController.text.trim(),
        'isEmergency': _isEmergency,
        if (_patientChoice != null && _patientChoice != 'self') 'familyMemberId': _patientChoice,
      });

      final jobId = postRes.map['jobId'] as String;
      setState(() => _pollingStatus = 'Confirming your slot...');

      final result = await _pollBookingStatus(jobId);

      if (!mounted) return;
      if (result.status == 'confirmed' && result.appointment?.status == 'pending_payment') {
        // COMPLETENESS FIX (audit Priority 3 #3 — mobile parity): the booking job itself
        // succeeded, but a non-zero-fee online booking is created 'pending_payment' with no
        // token yet until it's paid (appointments.service.js#runBookingJob's
        // requiresPrepayment) — this used to fall straight into the "confirmed" dialog below and
        // show a blank/wrong token number. Route to the real payment screen instead, same as web.
        setState(() => _pollingStatus = null);
        final paidAppointment = await Navigator.of(context).push<Appointment>(
          MaterialPageRoute(builder: (_) => PaymentRequiredScreen(appointment: result.appointment!)),
        );
        if (mounted) Navigator.of(context).pop(paidAppointment != null);
      } else if (result.status == 'confirmed') {
        setState(() => _pollingStatus = null);
        await showDialog(
          context: context,
          builder: (_) => AlertDialog(
            title: const Text('Appointment confirmed'),
            content: Text(
              'Token number: ${result.appointment?.tokenNumber ?? "—"}\n'
              'Date: ${result.appointment?.appointmentDate ?? dateStr}\n'
              "You'll be seen in this order after check-in.",
            ),
            actions: [
              TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK')),
            ],
          ),
        );
        if (mounted) Navigator.of(context).pop(true);
      } else if (result.status == 'failed') {
        setState(() {
          _pollingStatus = null;
          _error = ApiException(
            message: (result.error?['message'] as String?) ?? 'Booking failed — the slot may already be taken.',
          );
        });
      } else {
        // Timed out still queued/processing.
        setState(() {
          _pollingStatus = null;
          _error = ApiException(
            message: 'Still processing — please check My Appointments in a moment.',
          );
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

  /// Polls every ~1.5s for up to ~40s, per integration_plan.md §1.8's
  /// recommended interval/timeout.
  Future<BookingStatus> _pollBookingStatus(String jobId) async {
    final deadline = DateTime.now().add(const Duration(seconds: 40));
    while (DateTime.now().isBefore(deadline)) {
      final res = await ApiClient.instance.get('/appointments/booking-status/$jobId');
      final status = BookingStatus.fromJson(res.map);
      if (status.status == 'confirmed' || status.status == 'failed') return status;
      final aheadOfYou = status.aheadOfYou;
      if (aheadOfYou != null && aheadOfYou > 0) {
        if (mounted) {
          setState(() => _pollingStatus =
              '$aheadOfYou ${aheadOfYou == 1 ? "person" : "people"} ahead of you — assigning your token…');
        }
      }
      await Future.delayed(const Duration(milliseconds: 1500));
    }
    return BookingStatus(jobId: jobId, status: 'timeout');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Book an appointment')),
      body: _loadingOptions
          ? const LoadingView()
          : ListView(
              padding: const EdgeInsets.all(AppSpacing.md),
              children: [
                const PageHeader(
                  title: 'Book an appointment',
                  subtitle: 'Choose a verified doctor; the clinic, visit time, and queue token are assigned automatically.',
                ),
                if (_error != null) ...[
                  ErrorBanner(error: _error!),
                  const SizedBox(height: AppSpacing.md),
                ],
                if (widget.preselectedDoctor == null) ...[
                  DropdownButtonFormField<DoctorDirectoryItem>(
                    value: _selectedDoctor,
                    decoration: const InputDecoration(labelText: 'Doctor'),
                    items: [
                      for (final d in _doctors) DropdownMenuItem(value: d, child: Text(d.name)),
                    ],
                    onChanged: (d) => setState(() {
                      _selectedDoctor = d;
                      _selectedClinic = d?.clinics.isNotEmpty == true ? d!.clinics.first : null;
                    }),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ] else ...[
                  SectionCard(
                    child: Row(
                      children: [
                        const Icon(Icons.person, color: AppColors.primary),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(child: Text(widget.preselectedDoctor!.name, style: const TextStyle(fontWeight: FontWeight.w700))),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                // Clinic is never chosen by the patient — it's always the doctor's primary
                // (first) clinic, set automatically by the Doctor dropdown's onChanged above.
                // Just show it here for confirmation.
                if (_selectedClinic != null) ...[
                  SectionCard(
                    child: Row(
                      children: [
                        const Icon(Icons.local_hospital_outlined, color: AppColors.primary),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(child: Text('Clinic: ${_selectedClinic!.name}')),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                DropdownButtonFormField<String>(
                  value: _patientChoice,
                  decoration: const InputDecoration(labelText: 'Booking for'),
                  hint: const Text('Select patient'),
                  items: [
                    const DropdownMenuItem(value: 'self', child: Text('Myself')),
                    for (final f in _familyMembers) DropdownMenuItem(value: f.id, child: Text('${f.name} (${f.relation})')),
                  ],
                  onChanged: (v) => setState(() => _patientChoice = v),
                ),
                const SizedBox(height: AppSpacing.md),
                OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today, size: 18),
                  label: Text(_selectedDate == null ? 'Select date' : DateFormat('dd MMM yyyy').format(_selectedDate!)),
                ),
                const SizedBox(height: AppSpacing.md),
                TextField(
                  controller: _reasonController,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Reason for visit (optional)'),
                ),
                const SizedBox(height: AppSpacing.md),
                // WEBSITE PARITY FIX: the fee actually charged for an emergency booking is the
                // flat platform-wide platformCharges.emergencyFee (appointments.service.js's
                // runBookingJob formula), not anything on the doctor's own profile — the website
                // shows platformCharges?.emergencyFee here for exactly that reason. Mobile used to
                // show _selectedDoctor.emergencyFee, a different, unrelated per-doctor field, which
                // could show a number that didn't match what the patient was actually charged.
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Emergency booking'),
                  subtitle: _platformCharges?.applyEmergencyFee != false
                      ? Text('+₹${(_platformCharges?.emergencyFee ?? 0).toStringAsFixed(0)}')
                      : null,
                  value: _isEmergency,
                  onChanged: (v) => setState(() => _isEmergency = v),
                ),
                // WEBSITE PARITY (added — was missing entirely on mobile): live price preview once
                // a doctor is selected, matching PatientPages.jsx's Consultation/Platform charge/
                // GST box exactly.
                if (_selectedDoctor != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  SectionCard(
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Consultation'),
                            Text('₹${_selectedDoctor!.consultationFee.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Platform charge'),
                            Text(
                              // MUTUAL-EXCLUSIVITY FIX (superadmin request, website parity — see
                              // appointments.service.js#runBookingJob): platform charge and
                              // emergency fee never stack on the same booking, so this preview
                              // shows ₹0 the moment "Emergency booking" is switched on above.
                              '₹${(_isEmergency || _platformCharges?.applyConvenienceFee == false ? 0 : (_platformCharges?.patientConvenienceFee ?? 0)).toStringAsFixed(0)}',
                              style: const TextStyle(fontWeight: FontWeight.w700),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Transaction charge'),
                            Text('${(_platformCharges?.gstPercent ?? 0).toStringAsFixed(0)}%', style: const TextStyle(fontWeight: FontWeight.w700)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
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
                PrimaryButton(label: 'Confirm booking', onPressed: _canSubmit ? _submit : null, loading: _submitting),
              ],
            ),
    );
  }
}
