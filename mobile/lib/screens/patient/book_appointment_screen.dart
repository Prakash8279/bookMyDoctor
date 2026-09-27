import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../models/admin_models.dart';
import '../../models/clinical_models.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/booking_slip_sheet.dart';
import '../../widgets/common_widgets.dart';
import 'payment_required_screen.dart';

/// Patient appointment booking screen — 100% parity with web's Booking component
/// (client/src/pages/PatientPages.jsx §Booking):
/// - Filters card with City, Specialization, 24/7 emergency toggle, and Apply/Clear actions
/// - Automatic matching doctors count and filtered doctor list
/// - Booking form with Doctor, read-only auto-assigned Clinic, Patient (Myself / Family member),
///   Date (default today), Reason for visit, and Emergency booking with platform surcharge badge
/// - Live price breakdown preview (Consultation + Platform fee + GST transaction charge)
/// - Asynchronous booking with live queue polling status
/// - Full-page confirmed booking card (matching web's "Appointment booked") or routing to
///   PaymentRequiredScreen when prepayment is required
class BookAppointmentScreen extends StatefulWidget {
  final DoctorDirectoryItem? preselectedDoctor;
  final bool initialEmergency;

  const BookAppointmentScreen({super.key, this.preselectedDoctor, this.initialEmergency = false});

  @override
  State<BookAppointmentScreen> createState() => _BookAppointmentScreenState();
}

class _BookAppointmentScreenState extends State<BookAppointmentScreen> {
  List<DoctorDirectoryItem> _doctors = [];
  List<FamilyMember> _familyMembers = [];
  List<City> _cities = [];
  List<Specialization> _specializations = [];
  PlatformCharges? _platformCharges;

  // Filter draft state
  final _doctorNameFilterController = TextEditingController();
  String? _filterCity;
  String? _filterSpecialization;
  bool _filterEmergency = false;
  String _sortOption = 'default';

  // Filter applied state
  String _appliedDoctorName = '';
  String? _appliedCity;
  String? _appliedSpecialization;
  bool _appliedEmergency = false;
  String _appliedSortOption = 'default';

  // Form selections
  DoctorDirectoryItem? _selectedDoctor;
  ClinicSummary? _selectedClinic;
  String? _patientChoice = 'self';
  DateTime _selectedDate = DateTime.now();
  final _reasonController = TextEditingController();
  bool _isEmergency = false;

  // Booking outcome
  Appointment? _booked;

  bool _loadingOptions = true;
  bool _submitting = false;
  String? _pollingStatus;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _selectedDoctor = widget.preselectedDoctor;
    _isEmergency = widget.initialEmergency;
    _filterEmergency = widget.initialEmergency;
    _appliedEmergency = widget.initialEmergency;
    if (_selectedDoctor != null && _selectedDoctor!.clinics.isNotEmpty) {
      _selectedClinic = _selectedDoctor!.clinics.first;
    }
    _loadOptions();
  }

  @override
  void dispose() {
    _doctorNameFilterController.dispose();
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
        ApiClient.instance.get('/platform-charges'),
        ApiClient.instance.get('/geography/cities', query: {'pageSize': 100}),
        ApiClient.instance.get('/geography/specializations', query: {'pageSize': 100}),
      ]);

      if (!mounted) return;

      setState(() {
        if (futures[0] != null) {
          final docList = <DoctorDirectoryItem>[];
          for (final item in (futures[0] as ApiResponse).list) {
            try { docList.add(DoctorDirectoryItem.fromJson(item)); } catch (_) {}
          }
          _doctors = docList;
        } else if (widget.preselectedDoctor != null) {
          _doctors = [widget.preselectedDoctor!];
        }

        final fmList = <FamilyMember>[];
        for (final item in (futures[1] as ApiResponse).list) {
          try { fmList.add(FamilyMember.fromJson(item)); } catch (_) {}
        }
        _familyMembers = fmList;

        try {
          _platformCharges = PlatformCharges.fromJson((futures[2] as ApiResponse).map);
        } catch (_) {
          _platformCharges = PlatformCharges(
            patientConvenienceFee: 0,
            emergencyFee: 0,
            gstPercent: 0,
            applyConvenienceFee: false,
            applyEmergencyFee: false,
          );
        }

        final cityList = <City>[];
        for (final item in (futures[3] as ApiResponse).list) {
          try { cityList.add(City.fromJson(item)); } catch (_) {}
        }
        _cities = cityList;

        final specList = <Specialization>[];
        for (final item in (futures[4] as ApiResponse).list) {
          try { specList.add(Specialization.fromJson(item)); } catch (_) {}
        }
        _specializations = specList;
        _loadingOptions = false;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err;
        _loadingOptions = false;
      });
    }
  }

  List<DoctorDirectoryItem> get _filteredDoctors {
    final list = _doctors.where((doctor) {
      if (_appliedDoctorName.isNotEmpty) {
        final q = _appliedDoctorName.toLowerCase();
        final match = doctor.name.toLowerCase().contains(q) ||
            (doctor.specialization?.name ?? '').toLowerCase().contains(q) ||
            doctor.clinics.any((c) => c.name.toLowerCase().contains(q));
        if (!match) return false;
      }
      if (_appliedCity != null && _appliedCity!.isNotEmpty) {
        final matchesCity = doctor.city == _appliedCity ||
            doctor.clinics.any((c) => c.city == _appliedCity);
        if (!matchesCity) return false;
      }
      if (_appliedSpecialization != null && _appliedSpecialization!.isNotEmpty) {
        final specName = doctor.specialization?.name ?? '';
        if (specName != _appliedSpecialization) return false;
      }
      if (_appliedEmergency) {
        if (!doctor.emergencyAvailable) return false;
      }
      return true;
    }).toList();

    if (_appliedSortOption == 'clinic_asc') {
      list.sort((a, b) {
        final ca = a.clinics.isNotEmpty ? a.clinics.first.name : '';
        final cb = b.clinics.isNotEmpty ? b.clinics.first.name : '';
        return ca.compareTo(cb);
      });
    } else if (_appliedSortOption == 'clinic_desc') {
      list.sort((a, b) {
        final ca = a.clinics.isNotEmpty ? a.clinics.first.name : '';
        final cb = b.clinics.isNotEmpty ? b.clinics.first.name : '';
        return cb.compareTo(ca);
      });
    } else if (_appliedSortOption == 'doctor_asc') {
      list.sort((a, b) => a.name.compareTo(b.name));
    } else if (_appliedSortOption == 'rating') {
      list.sort((a, b) => b.rating.compareTo(a.rating));
    } else if (_appliedSortOption == 'fee') {
      list.sort((a, b) => a.consultationFee.compareTo(b.consultationFee));
    } else {
      // Default: sort by doctor join date (newest first)
      list.sort((a, b) {
        final da = a.createdAt;
        final db = b.createdAt;
        if (da != null && db != null) {
          return db.compareTo(da);
        } else if (db != null) {
          return 1;
        } else if (da != null) {
          return -1;
        }
        return 0;
      });
    }
    return list;
  }

  void _clearFilters() {
    setState(() {
      _doctorNameFilterController.clear();
      _appliedDoctorName = '';
      _filterCity = null;
      _filterSpecialization = null;
      _filterEmergency = false;
      _sortOption = 'default';
      _appliedCity = null;
      _appliedSpecialization = null;
      _appliedEmergency = false;
      _appliedSortOption = 'default';
    });
  }

  void _applyFilters() {
    setState(() {
      _appliedDoctorName = _doctorNameFilterController.text.trim();
      _appliedCity = _filterCity;
      _appliedSpecialization = _filterSpecialization;
      _appliedEmergency = _filterEmergency;
      _appliedSortOption = _sortOption;
      // If current doctor doesn't match new filter, reset selection
      if (_selectedDoctor != null && !_filteredDoctors.any((d) => d.id == _selectedDoctor!.id)) {
        _selectedDoctor = null;
        _selectedClinic = null;
      }
    });
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final maxDays = _selectedDoctor?.maxDaysAdvance ?? 30;
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: now,
      lastDate: now.add(Duration(days: maxDays)),
    );
    if (picked != null) setState(() => _selectedDate = picked);
  }

  bool get _canSubmit =>
      _selectedDoctor != null && _patientChoice != null && !_submitting;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _submitting = true;
      _error = null;
      _pollingStatus = 'Submitting booking...';
    });

    try {
      final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate);

      final postRes = await ApiClient.instance.post('/appointments', body: {
        'doctorUserId': _selectedDoctor!.id,
        if (_selectedClinic != null) 'clinicId': _selectedClinic!.id,
        'appointmentDate': dateStr,
        if (_reasonController.text.trim().isNotEmpty) 'reason': _reasonController.text.trim(),
        'isEmergency': _isEmergency,
        if (_patientChoice != null && _patientChoice != 'self') 'familyMemberId': _patientChoice,
      });

      final jobId = postRes.map['jobId'] as String;
      setState(() => _pollingStatus = 'Confirming your slot...');

      final result = await _pollBookingStatus(jobId);

      if (!mounted) return;
      if (result.status == 'confirmed' && result.appointment?.status == 'pending_payment') {
        setState(() => _pollingStatus = null);
        final paidAppointment = await Navigator.of(context).push<Appointment>(
          MaterialPageRoute(builder: (_) => PaymentRequiredScreen(appointment: result.appointment!)),
        );
        if (mounted) {
          if (paidAppointment != null) {
            setState(() => _booked = paidAppointment);
          } else {
            Navigator.of(context).pop(false);
          }
        }
      } else if (result.status == 'confirmed' && result.appointment != null) {
        setState(() {
          _pollingStatus = null;
          _booked = result.appointment;
        });
      } else if (result.status == 'failed') {
        setState(() {
          _pollingStatus = null;
          _error = ApiException(
            message: (result.error?['message'] as String?) ?? 'Booking failed — the slot may already be taken.',
          );
        });
      } else {
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

  Future<BookingStatus> _pollBookingStatus(String jobId) async {
    final deadline = DateTime.now().add(const Duration(seconds: 40));
    var intervalMs = 1500;
    while (mounted && DateTime.now().isBefore(deadline)) {
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
      await Future.delayed(Duration(milliseconds: intervalMs));
      intervalMs = (intervalMs + 500).clamp(1500, 4000);
    }
    return BookingStatus(jobId: jobId, status: 'timeout');
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingOptions) {
      return Scaffold(
        appBar: AppBar(title: const Text('Book an appointment')),
        body: const LoadingView(),
      );
    }

    // 1. Confirmed State (matches PatientPages.jsx lines 370)
    if (_booked != null) {
      return _buildConfirmedView(context);
    }

    // 2. Booking Form State (matches PatientPages.jsx lines 378-400)
    final filtered = _filteredDoctors;
    final consultationFee = _selectedDoctor?.consultationFee ?? 0.0;
    final isEmergencyFee = _isEmergency || _platformCharges?.applyConvenienceFee == false;
    final platformFee = isEmergencyFee ? 0.0 : (_platformCharges?.patientConvenienceFee ?? 0.0);
    final gstPercent = _platformCharges?.gstPercent ?? 0.0;

    // STEP 2: Dedicated Confirm Appointment Page (opens when doctor is selected, replacing doctor list)
    if (_selectedDoctor != null) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Confirm Appointment'),
          leading: widget.preselectedDoctor == null
              ? IconButton(
                  icon: const Icon(Icons.arrow_back),
                  onPressed: () {
                    setState(() {
                      _selectedDoctor = null;
                      _selectedClinic = null;
                    });
                  },
                )
              : null,
        ),
        body: ListView(
          padding: const EdgeInsets.all(AppSpacing.md),
          children: [
            if (widget.preselectedDoctor == null) ...[
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _selectedDoctor = null;
                      _selectedClinic = null;
                    });
                  },
                  icon: const Icon(Icons.arrow_back, size: 16),
                  label: const Text('Back to all doctors', style: TextStyle(fontWeight: FontWeight.w600)),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.primaryDark,
                    padding: EdgeInsets.zero,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
            ],

            // Selected Doctor Summary Card
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.04),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: AppColors.primaryDark,
                    child: Text(
                      _selectedDoctor!.name.split(' ').where((p) => p.isNotEmpty).take(2).map((p) => p[0]).join().toUpperCase(),
                      style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 16),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _selectedDoctor!.name,
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppColors.textPrimary),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${_selectedDoctor!.specialization?.name ?? 'General Practice'}${_selectedDoctor!.experienceYears != null ? ' · ${_selectedDoctor!.experienceYears} yrs experience' : ''}',
                          style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            const Icon(Icons.apartment_outlined, size: 14, color: AppColors.primaryDark),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                _selectedClinic != null ? _selectedClinic!.name : 'Clinic not assigned',
                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (widget.preselectedDoctor == null)
                    TextButton(
                      onPressed: () {
                        setState(() {
                          _selectedDoctor = null;
                          _selectedClinic = null;
                        });
                      },
                      style: TextButton.styleFrom(
                        backgroundColor: AppColors.surface,
                        foregroundColor: AppColors.primaryDark,
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                          side: const BorderSide(color: AppColors.border),
                        ),
                      ),
                      child: const Text('Change', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),

            if (_error != null) ...[
              ErrorBanner(error: _error!),
              const SizedBox(height: AppSpacing.md),
            ],

            // Appointment Details Form
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.primaryDark.withValues(alpha: 0.5), width: 1.5),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.04),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('APPOINTMENT DETAILS', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.primaryDark)),
                  const SizedBox(height: 2),
                  Text('Booking with ${_selectedDoctor!.name}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const Divider(height: 20),

                  // Clinic (Read-only, auto-assigned)
                  const Text('Clinic', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.apartment_outlined, size: 18, color: AppColors.primary),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Text(
                            _selectedClinic != null ? _selectedClinic!.name : 'Clinic not assigned',
                            style: const TextStyle(fontSize: 14, color: AppColors.textPrimary, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Patient Dropdown
                  DropdownButtonFormField<String>(
                    initialValue: _patientChoice,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: 'Patient',
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                    ),
                    items: [
                      const DropdownMenuItem(value: 'self', child: Text('Myself')),
                      for (final f in _familyMembers)
                        DropdownMenuItem(value: f.id, child: Text('${f.name} · ${f.relation}')),
                    ],
                    onChanged: (v) => setState(() => _patientChoice = v),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Appointment date
                  const Text('Appointment date', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
                  const SizedBox(height: 6),
                  InkWell(
                    onTap: _pickDate,
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            DateFormat('yyyy-MM-dd').format(_selectedDate),
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                          ),
                          const Icon(Icons.calendar_today_outlined, size: 18, color: AppColors.primary),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Reason for visit
                  TextField(
                    controller: _reasonController,
                    maxLines: 3,
                    decoration: InputDecoration(
                      labelText: 'Reason for visit',
                      hintText: 'Symptoms or follow-up details',
                      alignLabelWithHint: true,
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Emergency booking
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Emergency booking',
                            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                          ),
                        ),
                        if (_platformCharges?.applyEmergencyFee != false)
                          Container(
                            margin: const EdgeInsets.only(right: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              '+₹${(_platformCharges?.emergencyFee ?? 0).toStringAsFixed(0)}',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.primary),
                            ),
                          ),
                        Checkbox(
                          value: _isEmergency,
                          onChanged: (v) => setState(() => _isEmergency = v ?? false),
                          activeColor: AppColors.primary,
                        ),
                      ],
                    ),
                  ),

                  // Live Price Preview Box
                  const SizedBox(height: AppSpacing.md),
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFBF3EF),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFEAD5C8)),
                    ),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Consultation', style: TextStyle(fontSize: 14, color: AppColors.textPrimary)),
                            Text('₹${consultationFee.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Platform charge', style: TextStyle(fontSize: 14, color: AppColors.textPrimary)),
                            Text('₹${platformFee.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Transaction charge', style: TextStyle(fontSize: 14, color: AppColors.textPrimary)),
                            Text('${gstPercent.toStringAsFixed(0)}%', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          ],
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: AppSpacing.lg),

                  // Polling status
                  if (_pollingStatus != null) ...[
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.sm),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary)),
                          const SizedBox(width: AppSpacing.sm),
                          Flexible(
                            child: Text(
                              _pollingStatus!,
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.primaryDark),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                  ],

                  // Submit Button
                  ElevatedButton(
                    onPressed: _canSubmit ? _submit : null,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primaryDark,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: Text(
                      _submitting ? 'Confirming…' : 'Confirm booking',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      );
    }

    // STEP 1: Doctor Selection & Filter Page
    return Scaffold(
      appBar: AppBar(title: const Text('Book an appointment')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          const PageHeader(
            title: 'Book an appointment',
            subtitle: 'Choose a verified doctor; the clinic, visit time, and queue token are assigned automatically.',
          ),
          const SizedBox(height: AppSpacing.sm),

          if (_error != null) ...[
            ErrorBanner(error: _error!),
            const SizedBox(height: AppSpacing.md),
          ],

          // Card 1: Filters
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.04),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Filters',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
                    ),
                    TextButton(
                      onPressed: _clearFilters,
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.primaryDark,
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        minimumSize: Size.zero,
                      ),
                      child: const Text('Clear', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                TextFormField(
                  controller: _doctorNameFilterController,
                  decoration: InputDecoration(
                    labelText: 'Doctor name / Clinic name',
                    hintText: 'Search doctor or clinic name...',
                    filled: true,
                    fillColor: AppColors.surface,
                    prefixIcon: const Icon(Icons.search, size: 20),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                  ),
                  onFieldSubmitted: (_) => _applyFilters(),
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _filterCity,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: 'City',
                          filled: true,
                          fillColor: AppColors.surface,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                        ),
                        items: [
                          const DropdownMenuItem(value: null, child: Text('All cities')),
                          for (final c in _cities) DropdownMenuItem(value: c.name, child: Text(c.name)),
                        ],
                        onChanged: (v) => setState(() => _filterCity = v),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _filterSpecialization,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: 'Specialization',
                          filled: true,
                          fillColor: AppColors.surface,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                        ),
                        items: [
                          const DropdownMenuItem(value: null, child: Text('All specialties')),
                          for (final s in _specializations) DropdownMenuItem(value: s.name, child: Text(s.name)),
                        ],
                        onChanged: (v) => setState(() => _filterSpecialization = v),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                DropdownButtonFormField<String>(
                  initialValue: _sortOption,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: 'Sorted by',
                    filled: true,
                    fillColor: AppColors.surface,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'default', child: Text('Default')),
                    DropdownMenuItem(value: 'clinic_asc', child: Text('Clinic Name (A to Z)')),
                    DropdownMenuItem(value: 'clinic_desc', child: Text('Clinic Name (Z to A)')),
                    DropdownMenuItem(value: 'doctor_asc', child: Text('Doctor Name (A to Z)')),
                    DropdownMenuItem(value: 'rating', child: Text('Rating (High to Low)')),
                    DropdownMenuItem(value: 'fee', child: Text('Fee (Low to High)')),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      setState(() {
                        _sortOption = v;
                        _appliedSortOption = v;
                      });
                    }
                  },
                ),
                const SizedBox(height: AppSpacing.sm),
                InkWell(
                  onTap: () => setState(() => _filterEmergency = !_filterEmergency),
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Checkbox(
                          value: _filterEmergency,
                          onChanged: (v) => setState(() => _filterEmergency = v ?? false),
                          activeColor: AppColors.primary,
                        ),
                        const Text('24/7 emergency', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                ElevatedButton(
                  onPressed: _applyFilters,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primaryDark,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  ),
                  child: const Text('Apply filters', style: TextStyle(fontWeight: FontWeight.w700)),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  '${filtered.length} doctor${filtered.length == 1 ? '' : 's'} match — pick one below.',
                  style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),

          // Card 2: Matching Doctors List (Direct display from filters)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Matching Doctors (${filtered.length})',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          if (filtered.isEmpty)
            Container(
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                children: [
                  const Icon(Icons.search_off, size: 40, color: AppColors.textSecondary),
                  const SizedBox(height: AppSpacing.xs),
                  const Text('No doctors match these filters', style: TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text('Try adjusting or clearing your search filters.', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                  const SizedBox(height: AppSpacing.sm),
                  TextButton(onPressed: _clearFilters, child: const Text('Clear filters')),
                ],
              ),
            )
          else
            for (final doc in filtered) ...[
              Builder(
                builder: (context) {
                  final clinicName = doc.clinics.isNotEmpty ? doc.clinics.first.name : 'Clinic not assigned';
                  return GestureDetector(
                    onTap: () {
                      setState(() {
                        _selectedDoctor = doc;
                        _selectedClinic = doc.clinics.isNotEmpty ? doc.clinics.first : null;
                      });
                    },
                    child: Container(
                      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: AppColors.border,
                          width: 1,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.03),
                            blurRadius: 6,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              CircleAvatar(
                                radius: 20,
                                backgroundColor: AppColors.primaryLight,
                                child: Text(
                                  doc.name.split(' ').where((p) => p.isNotEmpty).take(2).map((p) => p[0]).join().toUpperCase(),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.primaryDark,
                                  ),
                                ),
                              ),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(doc.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                                    Text(
                                      '${doc.specialization?.name ?? 'General Practice'}${doc.experienceYears != null ? ' · ${doc.experienceYears} yrs' : ''}',
                                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                                    ),
                                  ],
                                ),
                              ),
                              if (doc.rating > 0)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Colors.amber.shade50,
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(color: Colors.amber.shade300),
                                  ),
                                  child: Text('★ ${doc.rating}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.amber.shade900)),
                                ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                            decoration: BoxDecoration(
                              color: AppColors.surface,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.apartment_outlined, size: 14, color: AppColors.primaryDark),
                                const SizedBox(width: 6),
                                Expanded(child: Text(clinicName, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
                              ],
                            ),
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('Fee: ₹${doc.consultationFee.toInt()}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                              TextButton(
                                onPressed: () {
                                  setState(() {
                                    _selectedDoctor = doc;
                                    _selectedClinic = doc.clinics.isNotEmpty ? doc.clinics.first : null;
                                  });
                                },
                                style: TextButton.styleFrom(
                                  backgroundColor: AppColors.surface,
                                  foregroundColor: AppColors.textPrimary,
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                  minimumSize: Size.zero,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                ),
                                child: const Text('Select & Book', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ],
          const SizedBox(height: AppSpacing.xl),
        ],
      ),
    );
  }

  /// 100% Web Parity Confirmed View (matches PatientPages.jsx lines 370)
  Widget _buildConfirmedView(BuildContext context) {
    final booked = _booked!;
    final totalAmount = booked.fees.totalAmount ?? 0.0;
    final doctorName = booked.doctor?.name ?? _selectedDoctor?.name ?? 'Doctor';

    return Scaffold(
      appBar: AppBar(title: const Text('Appointment booked')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          const PageHeader(
            title: 'Appointment booked',
            subtitle: 'Your booking has been confirmed.',
          ),
          const SizedBox(height: AppSpacing.md),

          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.success.withValues(alpha: 0.3)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.04),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Green checkmark
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.check, color: AppColors.success, size: 28),
                ),
                const SizedBox(height: AppSpacing.md),
                const Text(
                  'Booking confirmed',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
                ),
                const SizedBox(height: 4),
                Text(
                  '$doctorName · ${booked.appointmentDate}',
                  style: const TextStyle(fontSize: 14, color: AppColors.textSecondary),
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  'Token #${booked.tokenNumber ?? "—"}',
                  style: const TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryDark,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  "You'll be seen in this order after check-in — track live queue status under My Appointments.",
                  style: TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.4),
                ),
                const SizedBox(height: AppSpacing.lg),
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Consultation amount', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                          Text('₹${totalAmount.toStringAsFixed(0)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      if (booked.paymentStatus == 'paid')
                        const Row(
                          children: [
                            Icon(Icons.check_circle_outline, size: 16, color: AppColors.success),
                            SizedBox(width: 6),
                            Text('Paid online', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.success)),
                          ],
                        )
                      else if (booked.paymentStatus == 'partial')
                        const Row(
                          children: [
                            Icon(Icons.check_circle_outline, size: 16, color: AppColors.success),
                            SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                'Booking amount paid online — balance due at the clinic',
                                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.success),
                              ),
                            ),
                          ],
                        )
                      else
                        const Text(
                          'No online payment was required for this booking.',
                          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => showBookingSlipSheet(context, booked),
                        icon: const Icon(Icons.receipt_long, size: 18),
                        label: const Text('View slip', style: TextStyle(fontWeight: FontWeight.w700)),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () => Navigator.of(context).pop(true),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primaryDark,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        child: const Text('Appointments', style: TextStyle(fontWeight: FontWeight.w700)),
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
