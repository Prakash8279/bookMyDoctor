/// Review/notification/complaint/family-member/admin-config models. See
/// integration_plan.md §1.6, §1.13-§1.18.
library;

import 'clinical_models.dart';
import 'core_models.dart';

class FamilyMember {
  final String id;
  final String name;
  final String relation;
  final String? dateOfBirth;
  final String? gender;
  final String? bloodGroup;
  final int? age;

  FamilyMember({
    required this.id,
    required this.name,
    required this.relation,
    this.dateOfBirth,
    this.gender,
    this.bloodGroup,
    this.age,
  });

  factory FamilyMember.fromJson(Map<String, dynamic> json) => FamilyMember(
        id: asString(json['id']),
        name: asString(json['name']),
        relation: asString(json['relation']),
        dateOfBirth: json['dateOfBirth'] as String?,
        gender: json['gender'] as String?,
        bloodGroup: json['bloodGroup'] as String?,
        age: json['age'] == null ? null : asInt(json['age']),
      );
}

class ReceptionistRow {
  final String id;
  final String name;
  final String email;
  final String? phone;
  final String status;
  final String? createdAt;
  final String? clinicId;
  final String? clinicName;
  final String? since;

  ReceptionistRow({
    required this.id,
    required this.name,
    required this.email,
    this.phone,
    required this.status,
    this.createdAt,
    this.clinicId,
    this.clinicName,
    this.since,
  });

  factory ReceptionistRow.fromJson(Map<String, dynamic> json) => ReceptionistRow(
        id: asString(json['id']),
        name: asString(json['name']),
        email: asString(json['email']),
        phone: json['phone'] as String?,
        status: asString(json['status'], 'active'),
        createdAt: json['createdAt'] as String?,
        clinicId: json['clinicId'] as String?,
        clinicName: json['clinicName'] as String?,
        since: json['since'] as String?,
      );
}

// COMPLETENESS FIX (audit Priority 3 #5 — mobile parity): GET /admin/patients is a real, working
// endpoint (admin.service.js#listPatients) with a real web page (AdminPages.jsx#ManagePatients)
// — there was no mobile model or screen for it at all. See admin_patients_screen.dart.
class PatientDirectoryItem {
  final String id;
  final String name;
  final String? email;
  final String? phone;
  final String? city;
  final String status;
  final String? registeredAt;
  final String? gender;
  final String? dateOfBirth;
  final String? bloodGroup;

  PatientDirectoryItem({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    this.city,
    required this.status,
    this.registeredAt,
    this.gender,
    this.dateOfBirth,
    this.bloodGroup,
  });

  factory PatientDirectoryItem.fromJson(Map<String, dynamic> json) => PatientDirectoryItem(
        id: asString(json['id']),
        name: asString(json['name']),
        email: json['email'] as String?,
        phone: json['phone'] as String?,
        city: json['city'] as String?,
        status: asString(json['status'], 'active'),
        registeredAt: json['registeredAt'] as String?,
        gender: json['gender'] as String?,
        dateOfBirth: json['dateOfBirth'] as String?,
        bloodGroup: json['bloodGroup'] as String?,
      );
}

class ReviewItem {
  final String id;
  final NamedRef doctor;
  final NamedRef patient;
  final int rating;
  final String? text;
  final String status; // pending|approved|rejected
  final String? createdAt;

  ReviewItem({
    required this.id,
    required this.doctor,
    required this.patient,
    required this.rating,
    this.text,
    required this.status,
    this.createdAt,
  });

  factory ReviewItem.fromJson(Map<String, dynamic> json) => ReviewItem(
        id: asString(json['id']),
        doctor: NamedRef.fromJson(json['doctor'] as Map<String, dynamic>?),
        patient: NamedRef.fromJson(json['patient'] as Map<String, dynamic>?),
        rating: asInt(json['rating']),
        text: json['text'] as String?,
        status: asString(json['status'], 'pending'),
        createdAt: json['createdAt'] as String?,
      );
}

class AppNotification {
  final String id;
  final String notificationId;
  final String title;
  final String body;
  final String? type;
  final String? createdAt;
  final String? readAt;

  AppNotification({
    required this.id,
    required this.notificationId,
    required this.title,
    required this.body,
    this.type,
    this.createdAt,
    this.readAt,
  });

  bool get isRead => readAt != null;

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: asString(json['id']),
        notificationId: asString(json['notificationId']),
        title: asString(json['title']),
        body: asString(json['body']),
        type: json['type'] as String?,
        createdAt: json['createdAt'] as String?,
        readAt: json['readAt'] as String?,
      );
}

class BroadcastLogItem {
  final String id;
  final String title;
  final String body;
  final String? type;
  final String audience;
  final String? targetUserId;
  final String? createdAt;
  final int recipientCount;
  final int readCount;

  BroadcastLogItem({
    required this.id,
    required this.title,
    required this.body,
    this.type,
    required this.audience,
    this.targetUserId,
    this.createdAt,
    required this.recipientCount,
    required this.readCount,
  });

  factory BroadcastLogItem.fromJson(Map<String, dynamic> json) => BroadcastLogItem(
        id: asString(json['id']),
        title: asString(json['title']),
        body: asString(json['body']),
        type: json['type'] as String?,
        audience: asString(json['audience']),
        targetUserId: json['targetUserId'] as String?,
        createdAt: json['createdAt'] as String?,
        recipientCount: asInt(json['recipientCount']),
        readCount: asInt(json['readCount']),
      );
}

class ComplaintItem {
  final String id;
  final NamedRef? raisedBy;
  final String subject;
  final String? description;
  final String status; // open|in_progress|resolved|closed
  final String? adminResponse;
  final String? createdAt;

  ComplaintItem({
    required this.id,
    this.raisedBy,
    required this.subject,
    this.description,
    required this.status,
    this.adminResponse,
    this.createdAt,
  });

  factory ComplaintItem.fromJson(Map<String, dynamic> json) => ComplaintItem(
        id: asString(json['id']),
        raisedBy: json['raisedBy'] == null ? null : NamedRef.fromJson(json['raisedBy'] as Map<String, dynamic>),
        subject: asString(json['subject']),
        description: json['description'] as String?,
        status: asString(json['status'], 'open'),
        adminResponse: json['adminResponse'] as String?,
        createdAt: json['createdAt'] as String?,
      );
}

class ContactRequestItem {
  final String id;
  final String name;
  final String email;
  final String subject;
  final String message;
  final String status;
  final String? response;
  final String? createdAt;

  ContactRequestItem({
    required this.id,
    required this.name,
    required this.email,
    required this.subject,
    required this.message,
    required this.status,
    this.response,
    this.createdAt,
  });

  factory ContactRequestItem.fromJson(Map<String, dynamic> json) => ContactRequestItem(
        id: asString(json['id']),
        name: asString(json['name']),
        email: asString(json['email']),
        subject: asString(json['subject']),
        message: asString(json['message']),
        status: asString(json['status'], 'open'),
        response: json['response'] as String?,
        createdAt: json['createdAt'] as String?,
      );
}

class PlatformCharges {
  final double? commissionPercent; // admin-only
  final double patientConvenienceFee;
  final double emergencyFee;
  final double gstPercent;
  final bool applyConvenienceFee;
  final bool applyEmergencyFee;

  PlatformCharges({
    this.commissionPercent,
    required this.patientConvenienceFee,
    required this.emergencyFee,
    required this.gstPercent,
    required this.applyConvenienceFee,
    required this.applyEmergencyFee,
  });

  factory PlatformCharges.fromJson(Map<String, dynamic> json) => PlatformCharges(
        commissionPercent: json['commissionPercent'] == null ? null : asDouble(json['commissionPercent']),
        patientConvenienceFee: asDouble(json['patientConvenienceFee']),
        emergencyFee: asDouble(json['emergencyFee']),
        gstPercent: asDouble(json['gstPercent']),
        applyConvenienceFee: asBool(json['applyConvenienceFee']),
        applyEmergencyFee: asBool(json['applyEmergencyFee']),
      );

  Map<String, dynamic> toJson() => {
        'commissionPercent': commissionPercent ?? 0,
        'patientConvenienceFee': patientConvenienceFee,
        'emergencyFee': emergencyFee,
        'gstPercent': gstPercent,
        'applyConvenienceFee': applyConvenienceFee,
        'applyEmergencyFee': applyEmergencyFee,
      };
}

class SystemSettings {
  final String id;
  final String platformName;
  final String? supportEmail;
  final String? supportPhone;
  final double bookingFee;
  final bool maintenanceMode;

  SystemSettings({
    required this.id,
    required this.platformName,
    this.supportEmail,
    this.supportPhone,
    required this.bookingFee,
    required this.maintenanceMode,
  });

  factory SystemSettings.fromJson(Map<String, dynamic> json) => SystemSettings(
        id: asString(json['id']),
        platformName: asString(json['platformName']),
        supportEmail: json['supportEmail'] as String?,
        supportPhone: json['supportPhone'] as String?,
        bookingFee: asDouble(json['bookingFee']),
        maintenanceMode: asBool(json['maintenanceMode']),
      );

  Map<String, dynamic> toJson() => {
        'platformName': platformName,
        if (supportEmail != null) 'supportEmail': supportEmail,
        if (supportPhone != null) 'supportPhone': supportPhone,
        'bookingFee': bookingFee,
        'maintenanceMode': maintenanceMode,
      };
}

class BookingRules {
  final String id;
  final int cancellationWindowHours;
  final int maxBookingsPerPatient;
  final int defaultSlotMinutes;
  // BUG FIX (mobile parity audit): PUT /admin/booking-rules is a full-replace of the platform's
  // singleton booking-rules row (admin.service.js#updateBookingRules sets every one of these to
  // `body.field ?? null`, even when the field is simply absent from the request body). The mobile
  // form used to send only the 3 fields above, which silently NULLED OUT these 3 platform-wide
  // settings every single time an admin saved the "Booking rules" screen. These 3 are carried
  // through the form unmodified (no UI to edit them here yet) so a save never erases them.
  final String? onlineBookingWindowStart;
  final String? onlineBookingWindowEnd;
  final int? onlineBookingMaxAdvanceDays;

  BookingRules({
    required this.id,
    required this.cancellationWindowHours,
    required this.maxBookingsPerPatient,
    required this.defaultSlotMinutes,
    this.onlineBookingWindowStart,
    this.onlineBookingWindowEnd,
    this.onlineBookingMaxAdvanceDays,
  });

  factory BookingRules.fromJson(Map<String, dynamic> json) => BookingRules(
        id: asString(json['id']),
        cancellationWindowHours: asInt(json['cancellationWindowHours']),
        maxBookingsPerPatient: asInt(json['maxBookingsPerPatient']),
        defaultSlotMinutes: asInt(json['defaultSlotMinutes']),
        onlineBookingWindowStart: json['onlineBookingWindowStart'] as String?,
        onlineBookingWindowEnd: json['onlineBookingWindowEnd'] as String?,
        onlineBookingMaxAdvanceDays:
            json['onlineBookingMaxAdvanceDays'] == null ? null : asInt(json['onlineBookingMaxAdvanceDays']),
      );

  Map<String, dynamic> toJson() => {
        'cancellationWindowHours': cancellationWindowHours,
        'maxBookingsPerPatient': maxBookingsPerPatient,
        'defaultSlotMinutes': defaultSlotMinutes,
        'onlineBookingWindowStart': onlineBookingWindowStart,
        'onlineBookingWindowEnd': onlineBookingWindowEnd,
        'onlineBookingMaxAdvanceDays': onlineBookingMaxAdvanceDays,
      };
}

class DashboardStats {
  final int verifiedDoctorsCount;
  final int registeredPatientsCount;
  final int todaysBookingsCount;
  final double monthlyRevenue;

  DashboardStats({
    required this.verifiedDoctorsCount,
    required this.registeredPatientsCount,
    required this.todaysBookingsCount,
    required this.monthlyRevenue,
  });

  factory DashboardStats.fromJson(Map<String, dynamic> json) => DashboardStats(
        verifiedDoctorsCount: asInt(json['verifiedDoctorsCount']),
        registeredPatientsCount: asInt(json['registeredPatientsCount']),
        todaysBookingsCount: asInt(json['todaysBookingsCount']),
        monthlyRevenue: asDouble(json['monthlyRevenue']),
      );
}

class ActivityLogEntry {
  final String id;
  final NamedRef? actor;
  final String? actorRole;
  final String actionType;
  final String? targetEntityType;
  final String? targetEntityId;
  final String? description;
  final String? createdAt;

  ActivityLogEntry({
    required this.id,
    this.actor,
    this.actorRole,
    required this.actionType,
    this.targetEntityType,
    this.targetEntityId,
    this.description,
    this.createdAt,
  });

  factory ActivityLogEntry.fromJson(Map<String, dynamic> json) => ActivityLogEntry(
        id: asString(json['id']),
        actor: json['actor'] == null ? null : NamedRef.fromJson(json['actor'] as Map<String, dynamic>),
        actorRole: json['actorRole'] as String?,
        actionType: asString(json['actionType']),
        targetEntityType: json['targetEntityType'] as String?,
        targetEntityId: json['targetEntityId'] as String?,
        description: json['description'] as String?,
        createdAt: json['createdAt'] as String?,
      );
}
