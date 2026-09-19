/// Appointment/queue/medical-record/payment models. See
/// integration_plan.md §1.8-§1.12 — especially the fee-masking rules (a
/// doctor/receptionist NEVER sees convenienceFee/gstAmount/totalAmount, a
/// patient never sees commission/clinicPayout — those keys are simply
/// absent from the JSON, not null, hence every field here is nullable and
/// UI code must render "—" rather than assume presence).
library;

import 'core_models.dart';

class NamedRef {
  final String id;
  final String? name;
  // Only ever populated when this NamedRef came from an appointment's `familyMember` field —
  // appointments.service.js#shapeAppointment sends `{id, name, relation}` for that one field
  // (see relation: e.g. "Spouse", "Child"), unlike every other NamedRef use (clinic, etc.) which
  // sends just {id, name}. Kept here (rather than a separate FamilyMemberRef class) since NamedRef
  // is already the generic shape every other reference uses and this is the only extra key.
  final String? relation;
  NamedRef({required this.id, this.name, this.relation});
  factory NamedRef.fromJson(Map<String, dynamic>? json) => NamedRef(
        id: json == null ? '' : asString(json['id']),
        name: json?['name'] as String?,
        relation: json?['relation'] as String?,
      );
}

class Fees {
  final double? consultationFee;
  final double? convenienceFee;
  final double? emergencyFee;
  final double? gstAmount;
  final double? totalAmount; // appointments
  final double? amount; // payments (same slot, different key name)
  final double? commission;
  final double? clinicPayout;

  Fees({
    this.consultationFee,
    this.convenienceFee,
    this.emergencyFee,
    this.gstAmount,
    this.totalAmount,
    this.amount,
    this.commission,
    this.clinicPayout,
  });

  factory Fees.fromJson(Map<String, dynamic>? json) {
    if (json == null) return Fees();
    double? d(String key) => json[key] == null ? null : asDouble(json[key]);
    return Fees(
      consultationFee: d('consultationFee'),
      convenienceFee: d('convenienceFee'),
      emergencyFee: d('emergencyFee'),
      gstAmount: d('gstAmount'),
      totalAmount: d('totalAmount'),
      amount: d('amount'),
      commission: d('commission'),
      clinicPayout: d('clinicPayout'),
    );
  }
}

/// Patient data attached to an appointment/queue token — role-scoped SERVER-SIDE (never on the
/// client): appointments.service.js#shapePatientRef / queue.service.js#shapeQueuePatientRef only
/// ever include phone + the clinical fields (dateOfBirth/gender/bloodGroup/medicalHistory/
/// emergencyContact) for a doctor or admin/superadmin caller. A receptionist caller gets
/// name+phone only; a patient viewing their own booking gets just {id, name}. Every clinical
/// field here is therefore nullable not just for JSON-safety but because it is routinely and
/// deliberately absent, depending on who's asking — mirrors the web app's PatientHistory/
/// AppointmentTable handling in client/src/pages/StaffPages.jsx.
class PatientRef {
  final String id;
  final String? name;
  final String? phone;
  final String? gender;
  final String? dateOfBirth; // "YYYY-MM-DD", doctor/admin only
  final String? bloodGroup;
  final String? medicalHistory;
  final String? emergencyContact;

  PatientRef({
    required this.id,
    this.name,
    this.phone,
    this.gender,
    this.dateOfBirth,
    this.bloodGroup,
    this.medicalHistory,
    this.emergencyContact,
  });

  factory PatientRef.fromJson(Map<String, dynamic>? json) {
    if (json == null) return PatientRef(id: '');
    return PatientRef(
      id: asString(json['id']),
      name: json['name'] as String?,
      phone: json['phone'] as String?,
      gender: json['gender'] as String?,
      dateOfBirth: json['dateOfBirth'] as String?,
      bloodGroup: json['bloodGroup'] as String?,
      medicalHistory: json['medicalHistory'] as String?,
      emergencyContact: json['emergencyContact'] as String?,
    );
  }

  /// Age computed from dateOfBirth — null whenever dateOfBirth wasn't sent (receptionist/patient
  /// callers never receive it at all). Mirrors the web app's ageFromDob() in StaffPages.jsx.
  int? get age {
    if (dateOfBirth == null) return null;
    final dob = DateTime.tryParse(dateOfBirth!);
    if (dob == null) return null;
    final now = DateTime.now();
    var years = now.year - dob.year;
    final beforeBirthdayThisYear =
        now.month < dob.month || (now.month == dob.month && now.day < dob.day);
    if (beforeBirthdayThisYear) years -= 1;
    return years >= 0 ? years : null;
  }

  /// "Gender · Age · Blood group" one-line summary — mirrors the web app's patientVitals() in
  /// StaffPages.jsx. Returns null (never an empty string) when nothing is available, so callers
  /// can cleanly fall back to not rendering the row at all.
  String? get vitalsSummary {
    final parts = <String>[];
    if (gender != null && gender!.trim().isNotEmpty) parts.add(gender!);
    final a = age;
    if (a != null) parts.add('${a}y');
    if (bloodGroup != null && bloodGroup!.trim().isNotEmpty) parts.add(bloodGroup!);
    return parts.isEmpty ? null : parts.join(' · ');
  }

  bool get hasHealthNotes =>
      (medicalHistory != null && medicalHistory!.trim().isNotEmpty) ||
      (emergencyContact != null && emergencyContact!.trim().isNotEmpty);

  /// "History: ... · Emergency contact: ..." combined text for a detail view — null when
  /// hasHealthNotes is false.
  String? get healthNotesSummary {
    if (!hasHealthNotes) return null;
    final parts = <String>[];
    if (medicalHistory != null && medicalHistory!.trim().isNotEmpty) {
      parts.add('History: $medicalHistory');
    }
    if (emergencyContact != null && emergencyContact!.trim().isNotEmpty) {
      parts.add('Emergency contact: $emergencyContact');
    }
    return parts.join(' · ');
  }
}

class DoctorRef {
  final String id;
  final String? name;
  final String? photoUrl;
  final Specialization? specialization;
  DoctorRef({required this.id, this.name, this.photoUrl, this.specialization});
  factory DoctorRef.fromJson(Map<String, dynamic>? json) {
    if (json == null) return DoctorRef(id: '');
    return DoctorRef(
      id: asString(json['id']),
      name: json['name'] as String?,
      photoUrl: json['photoUrl'] as String?,
      specialization: json['specialization'] == null
          ? null
          : Specialization.fromJson(json['specialization'] as Map<String, dynamic>),
    );
  }
}

class Appointment {
  final String id;
  final PatientRef? patient;
  final NamedRef? familyMember;
  final DoctorRef? doctor;
  final NamedRef? clinic;
  final String appointmentDate;
  final String appointmentTime;
  final String? reason;
  final bool isEmergency;
  final String status; // upcoming|confirmed|completed|cancelled|no_show
  final String source; // online|walk_in
  final String? tokenNumber;
  final String? paymentStatus;
  final String? paymentMethod;
  final Fees fees;
  final String? notes;
  final String? checkedInAt;
  final String? createdAt;

  Appointment({
    required this.id,
    this.patient,
    this.familyMember,
    this.doctor,
    this.clinic,
    required this.appointmentDate,
    required this.appointmentTime,
    this.reason,
    required this.isEmergency,
    required this.status,
    required this.source,
    this.tokenNumber,
    this.paymentStatus,
    this.paymentMethod,
    required this.fees,
    this.notes,
    this.checkedInAt,
    this.createdAt,
  });

  factory Appointment.fromJson(Map<String, dynamic> json) => Appointment(
        id: asString(json['id']),
        patient: json['patient'] == null ? null : PatientRef.fromJson(json['patient'] as Map<String, dynamic>),
        familyMember:
            json['familyMember'] == null ? null : NamedRef.fromJson(json['familyMember'] as Map<String, dynamic>),
        doctor: json['doctor'] == null ? null : DoctorRef.fromJson(json['doctor'] as Map<String, dynamic>),
        clinic: json['clinic'] == null ? null : NamedRef.fromJson(json['clinic'] as Map<String, dynamic>),
        appointmentDate: asString(json['appointmentDate']),
        appointmentTime: asString(json['appointmentTime']),
        reason: json['reason'] as String?,
        isEmergency: asBool(json['isEmergency']),
        status: asString(json['status'], 'upcoming'),
        source: asString(json['source'], 'online'),
        tokenNumber: json['tokenNumber']?.toString(),
        paymentStatus: json['paymentStatus'] as String?,
        paymentMethod: json['paymentMethod'] as String?,
        fees: Fees.fromJson(json['fees'] as Map<String, dynamic>?),
        notes: json['notes'] as String?,
        checkedInAt: json['checkedInAt'] as String?,
        createdAt: json['createdAt'] as String?,
      );
}

/// GET /appointments/booking-status/:jobId polling result.
class BookingStatus {
  final String jobId;
  final String status; // queued|processing|confirmed|failed
  final Appointment? appointment;
  final Map<String, dynamic>? error;
  final int? queuePosition;
  final int? aheadOfYou;
  final int? etaSeconds;

  BookingStatus({
    required this.jobId,
    required this.status,
    this.appointment,
    this.error,
    this.queuePosition,
    this.aheadOfYou,
    this.etaSeconds,
  });

  factory BookingStatus.fromJson(Map<String, dynamic> json) => BookingStatus(
        jobId: asString(json['jobId']),
        status: asString(json['status']),
        appointment: json['appointment'] == null ? null : Appointment.fromJson(json['appointment'] as Map<String, dynamic>),
        error: json['error'] as Map<String, dynamic>?,
        queuePosition: json['queuePosition'] == null ? null : asInt(json['queuePosition']),
        aheadOfYou: json['aheadOfYou'] == null ? null : asInt(json['aheadOfYou']),
        etaSeconds: json['etaSeconds'] == null ? null : asInt(json['etaSeconds']),
      );
}

class QueueTokenItem {
  final String id;
  final String appointmentId;
  final String tokenNumber;
  final String status; // waiting|called|in_consultation|completed
  final int patientsAhead;
  final int estimatedWaitMinutes;
  final PatientRef? patient;
  final String? source;

  QueueTokenItem({
    required this.id,
    required this.appointmentId,
    required this.tokenNumber,
    required this.status,
    required this.patientsAhead,
    required this.estimatedWaitMinutes,
    this.patient,
    this.source,
  });

  factory QueueTokenItem.fromJson(Map<String, dynamic> json) => QueueTokenItem(
        id: asString(json['id']),
        appointmentId: asString(json['appointmentId']),
        tokenNumber: json['tokenNumber']?.toString() ?? '',
        status: asString(json['status'], 'waiting'),
        patientsAhead: asInt(json['patientsAhead']),
        estimatedWaitMinutes: asInt(json['estimatedWaitMinutes']),
        patient: json['patient'] == null ? null : PatientRef.fromJson(json['patient'] as Map<String, dynamic>),
        source: json['source'] as String?,
      );
}

class MedicalRecordItem {
  final String id;
  final NamedRef? appointment;
  final NamedRef? doctor;
  final NamedRef? patient;
  final String title;
  final String? type;
  final String? notes;
  final String? carePlan;
  final String? createdAt;

  MedicalRecordItem({
    required this.id,
    this.appointment,
    this.doctor,
    this.patient,
    required this.title,
    this.type,
    this.notes,
    this.carePlan,
    this.createdAt,
  });

  factory MedicalRecordItem.fromJson(Map<String, dynamic> json) => MedicalRecordItem(
        id: asString(json['id']),
        appointment:
            json['appointment'] == null ? null : NamedRef.fromJson(json['appointment'] as Map<String, dynamic>),
        doctor: json['doctor'] == null ? null : NamedRef.fromJson(json['doctor'] as Map<String, dynamic>),
        patient: json['patient'] == null ? null : NamedRef.fromJson(json['patient'] as Map<String, dynamic>),
        title: asString(json['title']),
        type: json['type'] as String?,
        notes: json['notes'] as String?,
        carePlan: json['carePlan'] as String?,
        createdAt: json['createdAt'] as String?,
      );
}

class PaymentItem {
  final String id;
  final String? receiptNumber;
  final NamedRef? appointment;
  final NamedRef? patient;
  final NamedRef? doctor;
  final NamedRef? clinic;
  final String mode; // cash|upi|card|online
  final String? transactionRef;
  final String status; // pending|paid|refunded
  final Fees fees;
  final String? createdAt;

  PaymentItem({
    required this.id,
    this.receiptNumber,
    this.appointment,
    this.patient,
    this.doctor,
    this.clinic,
    required this.mode,
    this.transactionRef,
    required this.status,
    required this.fees,
    this.createdAt,
  });

  factory PaymentItem.fromJson(Map<String, dynamic> json) => PaymentItem(
        id: asString(json['id']),
        receiptNumber: json['receiptNumber'] as String?,
        appointment:
            json['appointment'] == null ? null : NamedRef.fromJson(json['appointment'] as Map<String, dynamic>),
        patient: json['patient'] == null ? null : NamedRef.fromJson(json['patient'] as Map<String, dynamic>),
        doctor: json['doctor'] == null ? null : NamedRef.fromJson(json['doctor'] as Map<String, dynamic>),
        clinic: json['clinic'] == null ? null : NamedRef.fromJson(json['clinic'] as Map<String, dynamic>),
        mode: asString(json['mode']),
        transactionRef: json['transactionRef'] as String?,
        status: asString(json['status'], 'pending'),
        fees: Fees.fromJson(json['fees'] as Map<String, dynamic>?),
        createdAt: json['createdAt'] as String?,
      );
}
