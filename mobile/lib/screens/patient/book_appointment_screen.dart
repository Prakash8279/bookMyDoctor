import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import '../../core/india_time.dart';
import '../../models/admin_models.dart';
import '../../models/clinical_models.dart';
import '../../models/core_models.dart';
import '../../theme/app_theme.dart';
import '../../widgets/booking_slip_sheet.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/role_scaffold.dart';
import '../../widgets/booking_member_form.dart';
import 'doctor_detail_screen.dart';
import 'payment_required_screen.dart';

/// Native two-step equivalent of the website's Booking component
/// (client/src/pages/PatientPages.jsx §Booking):
/// - Collapsible search/city/specialization/sort filters, then compact Profile/Book doctor cards
/// - Automatic matching doctors count and filtered doctor list
/// - Dedicated doctor selection, then confirmation with read-only clinic and complete member profiles,
///   Date (default today), reason for visit, and live slot availability
/// - Live price breakdown preview (Consultation + Platform fee + GST transaction charge)
/// - Asynchronous booking with live queue polling status
/// - Full-page confirmed booking card (matching web's "Appointment booked") or routing to
///   PaymentRequiredScreen when prepayment is required
class BookAppointmentScreen extends StatefulWidget {
  final DoctorDirectoryItem? preselectedDoctor;
  final String? preselectedClinicId;

  const BookAppointmentScreen(
      {super.key, this.preselectedDoctor, this.preselectedClinicId});

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
  String? _filterCity;
  String? _filterSpecialization;
  bool _filterEmergency = false;
  bool _filtersOpen = false;
  bool _addingMember = false;
  final _searchController = TextEditingController();
  final _pageScroll = ScrollController();
  String _filterSort = 'Default';
  String _appliedSort = 'Default';
  String _appliedSearch = '';
  final Map<String, Map<String, dynamic>> _doctorSlots = {};
  int _listRequest = 0;

  // Filter applied state
  String? _appliedCity;
  String? _appliedSpecialization;
  bool _appliedEmergency = false;

  // Form selections
  DoctorDirectoryItem? _selectedDoctor;
  ClinicSummary? _selectedClinic;
  String? _patientChoice;
  DateTime _selectedDate = DateTime.parse(indiaToday());
  final _reasonController = TextEditingController();
  Map<String, dynamic>? _availability;
  bool _availabilityLoading = false;
  Object? _availabilityError;
  int _availabilityRequest = 0;

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
    if (_selectedDoctor != null && _selectedDoctor!.clinics.isNotEmpty) {
      final matchingClinic = _selectedDoctor!.clinics
          .where((clinic) => clinic.id == widget.preselectedClinicId);
      _selectedClinic = matchingClinic.isNotEmpty
          ? matchingClinic.first
          : _selectedDoctor!.clinics.first;
    }
    _loadOptions();
  }

  @override
  void dispose() {
    _reasonController.dispose();
    _searchController.dispose();
    _pageScroll.dispose();
    super.dispose();
  }

  Future<void> _loadOptions() async {
    if (!mounted) return;
    ++_availabilityRequest;
    setState(() {
      _loadingOptions = true;
      _error = null;
      _availability = null;
      _availabilityError = null;
    });
    try {
      final futures = await Future.wait([
        ApiClient.instance.getAll('/doctors'),
        ApiClient.instance.getAll('/family-members', query: {'pageSize': 50}),
        ApiClient.instance.get('/platform-charges'),
        ApiClient.instance
            .getAll('/geography/cities', query: {'pageSize': 100}),
        ApiClient.instance
            .getAll('/geography/specializations', query: {'pageSize': 100}),
      ]);

      if (!mounted) return;

      setState(() {
        _doctors = futures[0].list.map(DoctorDirectoryItem.fromJson).toList();
        final matches =
            _doctors.where((doctor) => doctor.id == _selectedDoctor?.id);
        if (matches.isNotEmpty) {
          _selectedDoctor = matches.first;
        } else if (_selectedDoctor != null) {
          _selectedDoctor = null;
        }

        final fmList = <FamilyMember>[];
        for (final item in (futures[1]).list) {
          try {
            fmList.add(FamilyMember.fromJson(item));
          } catch (_) {}
        }
        _familyMembers = fmList;

        try {
          _platformCharges = PlatformCharges.fromJson((futures[2]).map);
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
        for (final item in (futures[3]).list) {
          try {
            cityList.add(City.fromJson(item));
          } catch (_) {}
        }
        _cities = cityList;

        final specList = <Specialization>[];
        for (final item in (futures[4]).list) {
          try {
            specList.add(Specialization.fromJson(item));
          } catch (_) {}
        }
        _specializations = specList;
        final clinics = _selectedDoctor?.clinics ?? <ClinicSummary>[];
        final selected =
            clinics.where((clinic) => clinic.id == _selectedClinic?.id);
        _selectedClinic = selected.isNotEmpty
            ? selected.first
            : (clinics.isEmpty ? null : clinics.first);
        _loadingOptions = false;
      });
      if (_selectedDoctor == null) {
        await _loadDoctorSlots();
      } else {
        await _loadAvailability();
      }
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _error = err;
        _loadingOptions = false;
      });
    }
  }

  List<DoctorDirectoryItem> get _filteredDoctors {
    final result = _doctors.where((doctor) {
      final search = _appliedSearch.trim().toLowerCase();
      if (search.isNotEmpty &&
          ![
            doctor.name,
            doctor.specialization?.name ?? '',
            ...doctor.clinics.map((clinic) => clinic.name)
          ].any((value) => value.toLowerCase().contains(search))) {
        return false;
      }
      if (_appliedCity != null && _appliedCity!.isNotEmpty) {
        final matchesCity = doctor.city == _appliedCity ||
            doctor.clinics.any((c) => c.city == _appliedCity);
        if (!matchesCity) return false;
      }
      if (_appliedSpecialization != null &&
          _appliedSpecialization!.isNotEmpty) {
        final specName = doctor.specialization?.name ?? '';
        if (specName != _appliedSpecialization) return false;
      }
      if (_appliedEmergency) {
        if (!doctor.emergencyAvailable) return false;
      }
      return true;
    }).toList();
    result.sort((left, right) {
      final leftClinic = left.clinics.isEmpty ? '' : left.clinics.first.name;
      final rightClinic = right.clinics.isEmpty ? '' : right.clinics.first.name;
      return switch (_appliedSort) {
        'Clinic Name (A to Z)' => leftClinic.compareTo(rightClinic),
        'Clinic Name (Z to A)' => rightClinic.compareTo(leftClinic),
        'Doctor Name (A to Z)' => left.name.compareTo(right.name),
        'Rating (High to Low)' => right.rating.compareTo(left.rating),
        'Fee (Low to High)' =>
          left.consultationFee.compareTo(right.consultationFee),
        _ => (right.createdAt?.millisecondsSinceEpoch ?? 0)
            .compareTo(left.createdAt?.millisecondsSinceEpoch ?? 0),
      };
    });
    return result;
  }

  void _clearFilters() {
    setState(() {
      _searchController.clear();
      _appliedSearch = '';
      _filterSort = 'Default';
      _appliedSort = 'Default';
      _filterCity = null;
      _filterSpecialization = null;
      _filterEmergency = false;
      _appliedCity = null;
      _appliedSpecialization = null;
      _appliedEmergency = false;
    });
  }

  void _applyFilters() {
    setState(() {
      _appliedSearch = _searchController.text;
      _appliedSort = _filterSort;
      _filtersOpen = false;
      _appliedCity = _filterCity;
      _appliedSpecialization = _filterSpecialization;
      _appliedEmergency = _filterEmergency;
      // If current doctor doesn't match new filter, reset selection
      if (_selectedDoctor != null &&
          !_filteredDoctors.any((d) => d.id == _selectedDoctor!.id)) {
        _selectedDoctor = null;
        _selectedClinic = null;
      }
    });
    _loadAvailability();
  }

  Future<void> _pickDate() async {
    final today = DateTime.parse(indiaToday());
    final maxDays = _selectedDoctor?.maxDaysAdvance ?? 30;
    final lastDate = DateTime(today.year, today.month, today.day + maxDays);
    final initialDate =
        _selectedDate.isBefore(today) || _selectedDate.isAfter(lastDate)
            ? today
            : _selectedDate;
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: today,
      lastDate: lastDate,
    );
    if (picked != null && mounted) {
      setState(() => _selectedDate = picked);
      await _loadAvailability();
    }
  }

  Future<void> _loadAvailability() async {
    if (!mounted) return;
    final request = ++_availabilityRequest;
    final doctor = _selectedDoctor;
    final clinic = _selectedClinic;
    final date = DateFormat('yyyy-MM-dd').format(_selectedDate);
    setState(() {
      _availability = null;
      _availabilityError = null;
      _availabilityLoading = doctor != null && clinic != null;
    });
    if (doctor == null || clinic == null) return;
    try {
      final response =
          await ApiClient.instance.get('/appointments/availability', query: {
        'date': date,
        'doctorId': doctor.id,
        'clinicId': clinic.id,
      });
      if (!mounted || request != _availabilityRequest) return;
      final matches = response.list.where((row) =>
          row['doctorUserId'] == doctor.id &&
          row['clinicId'] == clinic.id &&
          (row['date'] == null || row['date'] == date));
      setState(() => _availability = matches.isEmpty ? null : matches.first);
    } catch (error) {
      if (mounted && request == _availabilityRequest) {
        setState(() => _availabilityError = error);
      }
    } finally {
      if (mounted && request == _availabilityRequest) {
        setState(() => _availabilityLoading = false);
      }
    }
  }

  Future<void> _loadDoctorSlots() async {
    final request = ++_listRequest;
    try {
      final response = await ApiClient.instance
          .get('/appointments/availability', query: {'date': indiaToday()});
      if (!mounted || request != _listRequest) return;
      setState(() {
        _doctorSlots.clear();
        for (final row in response.list) {
          _doctorSlots['${row['doctorUserId']}:${row['clinicId']}'] = row;
        }
      });
    } catch (error) {
      if (mounted && request == _listRequest) setState(() => _error = error);
    }
  }

  void _selectDoctor(DoctorDirectoryItem doctor) {
    ++_listRequest;
    setState(() {
      _selectedDoctor = doctor;
      _selectedClinic = doctor.clinics.isEmpty ? null : doctor.clinics.first;
      _selectedDate = DateTime.parse(indiaToday());
      _addingMember = false;
      _error = null;
    });
    _loadAvailability();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _pageScroll.hasClients) _pageScroll.jumpTo(0);
    });
  }

  void _backToDoctors() {
    ++_availabilityRequest;
    setState(() {
      _selectedDoctor = null;
      _selectedClinic = null;
      _availability = null;
      _availabilityError = null;
      _availabilityLoading = false;
      _addingMember = false;
      _error = null;
    });
    _loadDoctorSlots();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _pageScroll.hasClients) _pageScroll.jumpTo(0);
    });
  }

  Widget _selectedSummary(BuildContext context) => Card(
          child: Padding(
        padding: const EdgeInsets.all(12),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Booking with ${_selectedDoctor!.name}',
              style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(
              '${_selectedDoctor!.specialization?.name ?? 'General practice'} · ${_selectedDoctor!.experienceYears ?? 0} yrs experience',
              style: TextStyle(
                  fontSize: 12, color: context.palette.textSecondary)),
          const SizedBox(height: 4),
          Text('Clinic: ${_selectedClinic?.name ?? 'Clinic not assigned'}',
              style: const TextStyle(fontSize: 12)),
          const Divider(height: 20),
          Row(children: [
            Expanded(
                child: Text(
                    'Consultation\n₹${_selectedDoctor!.consultationFee.toStringAsFixed(0)}/visit',
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 13))),
            OutlinedButton(
                onPressed: _submitting ? null : _backToDoctors,
                child: const Text('Change doctor',
                    style: TextStyle(fontSize: 12))),
          ]),
        ]),
      ));

  Widget _filterField(String label, String? value, List<String> options,
          ValueChanged<String?> change) =>
      DropdownButtonFormField<String>(
        key: ValueKey('$label:$value'),
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(labelText: label),
        items: [
          DropdownMenuItem(
              value: '', child: Text('All ${label.toLowerCase()}')),
          ...options.toSet().map((item) => DropdownMenuItem(
              value: item, child: Text(item, overflow: TextOverflow.ellipsis)))
        ],
        onChanged: (item) => change(item == '' ? null : item),
      );

  Widget _buildDoctorSelection(BuildContext context) {
    final doctors = _filteredDoctors;
    return Scaffold(
      appBar: RoleScaffold.of(context) == null
          ? AppBar(title: const Text('BookADoctors'))
          : null,
      body: ListView(
          controller: _pageScroll,
          padding: const EdgeInsets.all(16),
          children: [
            const PageHeader(
                title: 'Book an appointment',
                subtitle:
                    'Choose a verified doctor; the clinic, visit time, and queue token are assigned automatically.'),
            if (_error != null)
              ErrorBanner(error: _error!, onRetry: _loadOptions),
            Card(
                child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 10),
                    child: Column(children: [
                      InkWell(
                          key: const ValueKey('booking-filters-toggle'),
                          onTap: () =>
                              setState(() => _filtersOpen = !_filtersOpen),
                          child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                        child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                          const Text('Filters',
                                              style: TextStyle(
                                                  fontSize: 17,
                                                  fontWeight: FontWeight.w700)),
                                          const SizedBox(height: 3),
                                          Text(
                                              'Search doctor or clinic name, filter by city/specialization, or sort',
                                              style: TextStyle(
                                                  fontSize: 12,
                                                  color: context
                                                      .palette.textSecondary)),
                                        ])),
                                    Icon(
                                        _filtersOpen
                                            ? Icons.expand_less
                                            : Icons.expand_more,
                                        color: context.palette.primaryDark),
                                  ]))),
                      if (_filtersOpen) ...[
                        Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                                onPressed: _clearFilters,
                                child: const Text('Clear'))),
                        TextField(
                            controller: _searchController,
                            onChanged: (value) =>
                                setState(() => _appliedSearch = value),
                            decoration: const InputDecoration(
                                labelText: 'Doctor name / Clinic name',
                                hintText: 'Search doctor or clinic name...')),
                        const SizedBox(height: 12),
                        _filterField(
                            'City',
                            _filterCity,
                            _cities.map((city) => city.name).toList(),
                            (value) => setState(() {
                                  _filterCity = value;
                                  _appliedCity = value;
                                })),
                        const SizedBox(height: 12),
                        _filterField(
                            'Specialization',
                            _filterSpecialization,
                            _specializations.map((item) => item.name).toList(),
                            (value) => setState(() {
                                  _filterSpecialization = value;
                                  _appliedSpecialization = value;
                                })),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String>(
                            key: ValueKey(_filterSort),
                            initialValue: _filterSort,
                            isExpanded: true,
                            decoration:
                                const InputDecoration(labelText: 'Sorted by'),
                            items: const [
                              'Default',
                              'Clinic Name (A to Z)',
                              'Clinic Name (Z to A)',
                              'Doctor Name (A to Z)',
                              'Rating (High to Low)',
                              'Fee (Low to High)'
                            ]
                                .map((value) => DropdownMenuItem(
                                    value: value, child: Text(value)))
                                .toList(),
                            onChanged: (value) => setState(() {
                                  _filterSort = value ?? 'Default';
                                  _appliedSort = _filterSort;
                                })),
                        const SizedBox(height: 10),
                        CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                            title: const Text('Emergency available',
                                style: TextStyle(fontSize: 13)),
                            value: _filterEmergency,
                            onChanged: (value) => setState(() {
                                  _filterEmergency = value ?? false;
                                  _appliedEmergency = _filterEmergency;
                                })),
                        Align(
                            alignment: Alignment.centerRight,
                            child: ElevatedButton(
                                onPressed: _applyFilters,
                                child: const Text('Apply filters'))),
                      ],
                    ]))),
            const SizedBox(height: 14),
            Text('Matching Doctors (${doctors.length})',
                style:
                    const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            const SizedBox(height: 10),
            if (doctors.isEmpty)
              SectionCard(
                  child: Column(children: [
                const Text('No doctors found matching these filters'),
                TextButton(
                    onPressed: _clearFilters,
                    child: const Text('Clear filters')),
              ])),
            LayoutBuilder(builder: (context, constraints) {
              final columns = constraints.maxWidth >= 900
                  ? 3
                  : constraints.maxWidth >= 600
                      ? 2
                      : 1;
              final width =
                  (constraints.maxWidth - (columns - 1) * 12) / columns;
              return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: doctors
                      .map((doctor) => SizedBox(
                          width: width, child: _doctorCard(context, doctor)))
                      .toList());
            }),
          ]),
    );
  }

  Widget _doctorCard(BuildContext context, DoctorDirectoryItem doctor) {
    final clinic = doctor.clinics.isEmpty ? null : doctor.clinics.first;
    final slots = _doctorSlots['${doctor.id}:${clinic?.id}'];
    final words =
        doctor.name.split(' ').where((word) => word.isNotEmpty).toList();
    final initials = words
        .skip(words.length > 2 ? words.length - 2 : 0)
        .map((word) => word[0])
        .join();
    return Card(
        margin: EdgeInsets.zero,
        child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  CircleAvatar(
                      radius: 19,
                      backgroundColor: context.palette.primaryLight,
                      child: Text(initials,
                          style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: context.palette.primaryDark))),
                  const SizedBox(width: 10),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Text(doctor.name,
                            maxLines: 2,
                            style: const TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w700)),
                        Text(
                            '${doctor.specialization?.name ?? 'General practice'} · ${doctor.experienceYears ?? 0} yrs',
                            style: TextStyle(
                                fontSize: 11,
                                color: context.palette.textSecondary)),
                      ])),
                  if (doctor.rating > 0)
                    Text('★ ${doctor.rating}',
                        style: TextStyle(
                            fontSize: 12, color: context.palette.goldDark)),
                ]),
                const SizedBox(height: 10),
                Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                        color: context.palette.background,
                        borderRadius: BorderRadius.circular(8)),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                              'Clinic: ${clinic?.name ?? 'Clinic not assigned'}',
                              style: const TextStyle(
                                  fontSize: 12, fontWeight: FontWeight.w600)),
                          if (clinic?.city != null || doctor.city != null)
                            Text(
                                [clinic?.area, clinic?.city ?? doctor.city]
                                    .whereType<String>()
                                    .join(', '),
                                style: TextStyle(
                                    fontSize: 11,
                                    color: context.palette.textSecondary)),
                        ])),
                const SizedBox(height: 9),
                Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Expanded(
                      child: Text(
                          'Consultation\n₹${doctor.consultationFee.toStringAsFixed(0)}/visit',
                          style: const TextStyle(
                              fontSize: 12, fontWeight: FontWeight.w600))),
                  Flexible(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                        Text(
                            'Slot ${slots?['totalSlots'] ?? '—'}, Avl ${slots?['availableSlots'] ?? '—'}',
                            style: const TextStyle(
                                fontSize: 11, fontWeight: FontWeight.w600)),
                        if (doctor.emergencyAvailable)
                          Text('Emergency available',
                              style: TextStyle(
                                  fontSize: 10, color: context.palette.danger)),
                      ])),
                ]),
                const Divider(height: 20),
                Row(children: [
                  Expanded(
                      child: OutlinedButton(
                          key: ValueKey('booking-profile-${doctor.id}'),
                          onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                  builder: (_) =>
                                      DoctorDetailScreen(doctorId: doctor.id))),
                          child: const Text('Profile'))),
                  const SizedBox(width: 8),
                  Expanded(
                      child: ElevatedButton(
                          key: ValueKey('booking-select-${doctor.id}'),
                          onPressed: doctor.onlineBooking && clinic != null
                              ? () => _selectDoctor(doctor)
                              : null,
                          child: const Text('Book'))),
                ]),
              ],
            )));
  }

  Widget _priceLine(String label, String amount) =>
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: Text(label, style: const TextStyle(fontSize: 13))),
        const SizedBox(width: 8),
        Text(amount,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
      ]);

  bool get _canSubmit =>
      _selectedDoctor != null &&
      _selectedDoctor!.onlineBooking &&
      _selectedClinic != null &&
      !_loadingOptions &&
      !_availabilityLoading &&
      _availabilityError == null &&
      _availability != null &&
      _availability!['closed'] != true &&
      asInt(_availability!['availableSlots']) > 0 &&
      _familyMembers.any((m) =>
          m.id == _patientChoice &&
          m.name.trim().isNotEmpty &&
          m.relation.trim().isNotEmpty &&
          (m.dateOfBirth ?? '').isNotEmpty &&
          (m.gender ?? '').isNotEmpty &&
          (m.bloodGroup ?? '').isNotEmpty) &&
      !_addingMember &&
      !_submitting;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    final today = DateTime.parse(indiaToday());
    final maxDays = _selectedDoctor!.maxDaysAdvance ?? 30;
    final lastDate = DateTime(today.year, today.month, today.day + maxDays);
    if (_selectedDate.isBefore(today) || _selectedDate.isAfter(lastDate)) {
      setState(() => _error =
          'Choose a date within $maxDays days from today for this doctor.');
      return;
    }
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
        if (_reasonController.text.trim().isNotEmpty)
          'reason': _reasonController.text.trim(),
        'familyMemberId': _patientChoice,
      });

      final jobId = postRes.map['jobId'] as String;
      if (!mounted) return;
      setState(() => _pollingStatus = 'Confirming your slot...');

      final result = await _pollBookingStatus(jobId);

      if (!mounted) return;
      if (result.status == 'confirmed' &&
          result.appointment?.status == 'pending_payment') {
        setState(() => _pollingStatus = null);
        final paidAppointment = await Navigator.of(context).push<Appointment>(
          MaterialPageRoute(
              builder: (_) =>
                  PaymentRequiredScreen(appointment: result.appointment!)),
        );
        if (mounted) {
          if (paidAppointment != null) {
            setState(() => _booked = paidAppointment);
          } else {
            final portal = RoleScaffold.of(context);
            if (portal != null && portal.navigateToLabel('My appointments')) {
              return;
            }
            if (Navigator.of(context).canPop()) {
              Navigator.of(context).pop(false);
              return;
            }
            setState(() => _error = ApiException(
                message:
                    'Payment is not confirmed yet. Open My appointments to continue payment for this booking; do not create another booking.'));
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
            message: (result.error?['message'] as String?) ??
                'Booking failed — the slot may already be taken.',
          );
        });
      } else {
        setState(() {
          _pollingStatus = null;
          _error = ApiException(
            message:
                'Still processing — please check My Appointments in a moment.',
          );
        });
      }
    } catch (err) {
      if (!mounted) return;
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
      final res =
          await ApiClient.instance.get('/appointments/booking-status/$jobId');
      final status = BookingStatus.fromJson(res.map);
      if (status.status == 'confirmed' || status.status == 'failed') {
        return status;
      }
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
    if (_selectedDoctor == null) return _buildDoctorSelection(context);
    final platformOnly =
        _selectedDoctor!.bookingPaymentPolicy == 'platform_only';
    final consultationFee = _selectedDoctor?.consultationFee ?? 0.0;
    final platformFee = _platformCharges?.applyConvenienceFee == false
        ? 0.0
        : (_platformCharges?.patientConvenienceFee ?? 0.0);
    final gstPercent = _platformCharges?.gstPercent ?? 0.0;

    return Scaffold(
      appBar: RoleScaffold.of(context) == null
          ? AppBar(title: const Text('BookADoctors'))
          : null,
      body: ListView(
        controller: _pageScroll,
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          PageHeader(
              title: 'Confirm appointment',
              subtitle: 'Booking consultation with ${_selectedDoctor!.name}'),
          Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                  onPressed: _submitting ? null : _backToDoctors,
                  icon: const Icon(Icons.arrow_back, size: 16),
                  label: const Text('Back to all doctors'))),
          _selectedSummary(context),
          const SizedBox(height: 16),
          const SizedBox(height: AppSpacing.sm),

          if (_error != null) ...[
            ErrorBanner(error: _error!, onRetry: _loadOptions),
            const SizedBox(height: AppSpacing.md),
          ],

          // Card 2: Form (matches PatientPages.jsx lines 399)
          Container(
            decoration: BoxDecoration(
              color: context.palette.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: context.palette.border),
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
                const Text('Appointment Details',
                    style:
                        TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                const Divider(height: 24),
                const Text('Selected Doctor'),
                const SizedBox(height: 6),
                Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                        color: context.palette.background,
                        border: Border.all(color: context.palette.border),
                        borderRadius: BorderRadius.circular(10)),
                    child: Row(children: [
                      Expanded(
                          child: Text(_selectedDoctor!.name,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600))),
                      TextButton(
                          onPressed: _submitting ? null : _backToDoctors,
                          child: const Text('Change')),
                    ])),
                const SizedBox(height: AppSpacing.md),

                // 2. Clinic (Read-only, matching web)
                Text('Clinic',
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: context.palette.textPrimary)),
                const SizedBox(height: 6),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                  decoration: BoxDecoration(
                    color: context.palette.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: context.palette.border),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.apartment_outlined,
                          size: 18,
                          color: _selectedClinic != null
                              ? context.palette.primary
                              : context.palette.textSecondary),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Text(
                          _selectedClinic != null
                              ? _selectedClinic!.name
                              : 'Select a doctor first',
                          style: TextStyle(
                            fontSize: 14,
                            color: _selectedClinic != null
                                ? context.palette.textPrimary
                                : context.palette.textSecondary,
                            fontWeight: _selectedClinic != null
                                ? FontWeight.w600
                                : FontWeight.normal,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                // 3. Patient Dropdown
                DropdownButtonFormField<String>(
                  key: ValueKey(_patientChoice),
                  initialValue: _patientChoice,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: 'Patient',
                    filled: true,
                    fillColor: context.palette.surface,
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: context.palette.border)),
                    enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: context.palette.border)),
                  ),
                  items: [
                    for (final f in _familyMembers)
                      if (f.name.trim().isNotEmpty &&
                          f.relation.trim().isNotEmpty &&
                          (f.dateOfBirth ?? '').isNotEmpty &&
                          (f.gender ?? '').isNotEmpty &&
                          (f.bloodGroup ?? '').isNotEmpty)
                        DropdownMenuItem(
                          value: f.id,
                          child: Text(
                            '${f.name} · ${f.relation}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                  ],
                  onChanged: _submitting
                      ? null
                      : (v) => setState(() => _patientChoice = v),
                ),
                Text(
                    'Select a complete patient profile. For yourself, add your details with relationship “Self”. Incomplete profiles must be updated in Family members.',
                    style: TextStyle(
                        color: context.palette.textSecondary, fontSize: 12)),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: _submitting
                        ? null
                        : () => setState(() => _addingMember = !_addingMember),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Add member'),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                if (_addingMember) ...[
                  BookingMemberForm(
                      onSaved: (member) => setState(() {
                            _familyMembers = [..._familyMembers, member];
                            _patientChoice = member.id;
                            _addingMember = false;
                          }),
                      onCancel: () => setState(() => _addingMember = false)),
                  const SizedBox(height: 16),
                ],

                // 4. Appointment date
                Text('Appointment date',
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: context.palette.textPrimary)),
                const SizedBox(height: 6),
                InkWell(
                  onTap: _submitting ? null : _pickDate,
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 13),
                    decoration: BoxDecoration(
                      color: context.palette.surface,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: context.palette.border),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          DateFormat('yyyy-MM-dd').format(_selectedDate),
                          style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: context.palette.textPrimary),
                        ),
                        Icon(Icons.calendar_today_outlined,
                            size: 18, color: context.palette.primary),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                Text(
                    'Booking available through ${DateFormat('yyyy-MM-dd').format(DateTime.parse(indiaToday()).add(Duration(days: _selectedDoctor!.maxDaysAdvance ?? 30)))} (${_selectedDoctor!.maxDaysAdvance ?? 30} days ahead).',
                    style: TextStyle(
                        fontSize: 12, color: context.palette.textSecondary)),
                const SizedBox(height: 10),
                if (_selectedDoctor != null && _selectedClinic != null) ...[
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                        color: context.palette.surface,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: context.palette.border)),
                    child: _availabilityLoading
                        ? Text('Checking slots…',
                            textAlign: TextAlign.center,
                            style:
                                TextStyle(color: context.palette.textSecondary))
                        : _availabilityError != null
                            ? ErrorBanner(
                                error: _availabilityError!,
                                onRetry: _loadAvailability)
                            : _availability?['closed'] == true
                                ? const Text(
                                    'This doctor is unavailable at this clinic on the selected closing date. Please choose another date.')
                                : _availability == null
                                    ? Text(
                                        'No OPD slots configured for this date.',
                                        textAlign: TextAlign.center,
                                        style: TextStyle(
                                            color:
                                                context.palette.textSecondary))
                                    : Wrap(
                                        spacing: 12,
                                        runSpacing: 4,
                                        crossAxisAlignment:
                                            WrapCrossAlignment.center,
                                        children: [
                                          Text(
                                              'Slots · ${DateFormat('yyyy-MM-dd').format(_selectedDate)}',
                                              style: TextStyle(
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w700,
                                                  color: context
                                                      .palette.textSecondary)),
                                          Text(
                                              'Total ${_availability!['totalSlots'] ?? 0}',
                                              style: const TextStyle(
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.w600)),
                                          Text(
                                              'Available ${_availability!['availableSlots'] ?? 0}',
                                              style: TextStyle(
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.w700,
                                                  color:
                                                      context.palette.success)),
                                          Text(
                                              'Booked ${_availability!['bookedSlots'] ?? 0}',
                                              style: TextStyle(
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.w600,
                                                  color:
                                                      context.palette.primary)),
                                        ],
                                      ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],

                // 5. Reason for visit
                TextField(
                  controller: _reasonController,
                  maxLines: 3,
                  decoration: InputDecoration(
                    labelText: 'Reason for visit',
                    hintText: 'Symptoms or follow-up details',
                    alignLabelWithHint: true,
                    filled: true,
                    fillColor: context.palette.surface,
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: context.palette.border)),
                    enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: context.palette.border)),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),

                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                      color: context.palette.primaryLight,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: context.palette.border)),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (platformOnly)
                          const Padding(
                              padding: EdgeInsets.only(bottom: 8),
                              child: Text(
                                  'Pay online now: platform charge only. Doctor fee is payable at the clinic.',
                                  style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600))),
                        _priceLine(
                            platformOnly
                                ? 'Consultation (pay at clinic)'
                                : 'Consultation',
                            '₹${consultationFee.toStringAsFixed(0)}'),
                        const SizedBox(height: 6),
                        _priceLine('Platform charge',
                            '₹${platformFee.toStringAsFixed(0)}'),
                        if (!platformOnly) ...[
                          const SizedBox(height: 6),
                          _priceLine('Transaction charge',
                              '${gstPercent.toStringAsFixed(0)}%'),
                        ],
                      ]),
                ),
                const SizedBox(height: AppSpacing.lg),

                // Queue confirmation polling state
                if (_pollingStatus != null) ...[
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.sm),
                    decoration: BoxDecoration(
                      color: context.palette.primaryLight,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        SizedBox(
                            height: 16,
                            width: 16,
                            child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: context.palette.primary)),
                        const SizedBox(width: AppSpacing.sm),
                        Flexible(
                          child: Text(
                            _pollingStatus!,
                            style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: context.palette.primaryDark),
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
                    backgroundColor: context.palette.primaryDark,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                  child: Text(
                    _submitting ? 'Confirming…' : 'Confirm booking',
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.w700),
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
              color: context.palette.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                  color: context.palette.success.withValues(alpha: 0.3)),
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
                    color: context.palette.success.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.check,
                      color: context.palette.success, size: 28),
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  'Booking confirmed',
                  style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: context.palette.textPrimary),
                ),
                const SizedBox(height: 4),
                Text(
                  '$doctorName · ${booked.appointmentDate}',
                  style: TextStyle(
                      fontSize: 14, color: context.palette.textSecondary),
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  'Token #${booked.tokenNumber ?? "—"}',
                  style: TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w800,
                    color: context.palette.primaryDark,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  "You'll be seen in this order after check-in — track live queue status under My Appointments.",
                  style: TextStyle(
                      fontSize: 13,
                      color: context.palette.textSecondary,
                      height: 1.4),
                ),
                const SizedBox(height: AppSpacing.lg),
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: context.palette.surface,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Consultation amount',
                              style: TextStyle(
                                  fontSize: 14, fontWeight: FontWeight.w500)),
                          Text('₹${totalAmount.toStringAsFixed(0)}',
                              style: const TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      if (booked.paymentStatus == 'paid')
                        Row(
                          children: [
                            Icon(Icons.check_circle_outline,
                                size: 16, color: context.palette.success),
                            const SizedBox(width: 6),
                            Text('Paid online',
                                style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: context.palette.success)),
                          ],
                        )
                      else if (booked.paymentStatus == 'partial')
                        Row(
                          children: [
                            Icon(Icons.check_circle_outline,
                                size: 16, color: context.palette.success),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                'Booking amount paid online — balance due at the clinic',
                                style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: context.palette.success),
                              ),
                            ),
                          ],
                        )
                      else
                        Text(
                          'No online payment was required for this booking.',
                          style: TextStyle(
                              fontSize: 12,
                              color: context.palette.textSecondary),
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
                        label: const Text('View slip',
                            style: TextStyle(fontWeight: FontWeight.w700)),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10)),
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () => Navigator.of(context).pop(true),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: context.palette.primaryDark,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10)),
                        ),
                        child: const Text('Appointments',
                            style: TextStyle(fontWeight: FontWeight.w700)),
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
