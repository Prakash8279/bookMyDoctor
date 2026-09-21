/// Core identity/geography/doctor-directory models. Field names and
/// nullability follow integration_plan.md §1.1-§1.5 exactly (the same
/// ground truth the web app's rewrite used) — do not rename fields to be
/// "nicer," keep them matching the wire format so cross-referencing the
/// backend source stays easy.
library;

num asNum(dynamic v) => v == null ? 0 : (v is num ? v : num.parse(v.toString()));
double asDouble(dynamic v) => asNum(v).toDouble();
int asInt(dynamic v) => asNum(v).toInt();
String asString(dynamic v, [String fallback = '']) => v == null ? fallback : v.toString();
bool asBool(dynamic v, [bool fallback = false]) => v is bool ? v : fallback;

class AppUser {
  final String id;
  final String name;
  final String email;
  final String role; // patient | doctor | receptionist | admin | superadmin
  final String? phone;
  final String? city;
  final String? photoUrl;
  final String? status;

  AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.phone,
    this.city,
    this.photoUrl,
    this.status,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: asString(json['id']),
        name: asString(json['name']),
        email: asString(json['email']),
        role: asString(json['role']),
        phone: json['phone'] as String?,
        city: json['city'] as String?,
        photoUrl: json['photoUrl'] as String?,
        status: json['status'] as String?,
      );
}

/// COMPLETENESS FIX (audit Priority 3 #8 — mobile parity): {name, url, uploadedAt} shape
/// uploads.service.js#saveVerificationDocument appends to doctor_profiles.verification_documents
/// — GET /me already returns this array for a doctor (me.service.js's FULL_SELECT `include`s the
/// whole doctorProfile row with no field-level select, so nothing extra was needed server-side),
/// there was just no Dart model or mobile screen reading it before.
class VerificationDocument {
  final String name;
  final String url;
  final String? uploadedAt;

  VerificationDocument({required this.name, required this.url, this.uploadedAt});

  factory VerificationDocument.fromJson(Map<String, dynamic> json) => VerificationDocument(
        name: asString(json['name'], 'Document'),
        url: asString(json['url']),
        uploadedAt: json['uploadedAt'] as String?,
      );
}

/// COMPLETENESS FIX (mobile parity audit, doctor panel): ports web's doctor-only "Bank details"
/// section (StaffPages.jsx#DoctorProfileEdit, ~line 604) — payout bank details, visible only to
/// the doctor themself and admin/superadmin (doctors.service.js#shapeDoctor's includeContact
/// gate), never to a patient. Saved via the same PATCH /me action as the rest of the profile, but
/// as its own independent save unit (see profile_screen.dart's _BankDetailsSection) — web keeps
/// this as a separate <form> so a doctor filling in bank details doesn't have to resubmit their
/// whole professional profile at the same time.
class BankDetails {
  final String? accountHolderName;
  final String? accountNumber;
  final String? ifscCode;
  final String? bankName;
  final String? upiId;

  BankDetails({this.accountHolderName, this.accountNumber, this.ifscCode, this.bankName, this.upiId});

  factory BankDetails.fromJson(Map<String, dynamic>? json) {
    if (json == null) return BankDetails();
    return BankDetails(
      accountHolderName: json['accountHolderName'] as String?,
      accountNumber: json['accountNumber'] as String?,
      ifscCode: json['ifscCode'] as String?,
      bankName: json['bankName'] as String?,
      upiId: json['upiId'] as String?,
    );
  }
}

/// Nested `profile` object from GET /me — shape differs by role; every
/// field is nullable/optional here because a receptionist/admin has most of
/// them absent and a fresh doctor profile may be sparse.
class MeProfile {
  final String? dateOfBirth;
  final String? gender;
  final String? bloodGroup;
  final String? emergencyContact;
  final String? address;
  final String? medicalHistory;
  final String? about;

  final String? specializationId;
  final Map<String, dynamic>? specialization; // {id, name}
  final String? qualification;
  final String? registrationNumber;
  final int? experienceYears;
  final double? consultationFee;
  final double? emergencyFee;
  final List<String>? languages;
  final String? bio;
  final String? doctorStatus; // pending|verified|disabled
  final bool? onlineBooking;
  final bool? allowRebooking;
  final int? maxDaysAdvance;
  final int? maxOnlineBookingsPerDay;
  // COMPLETENESS FIX (mobile parity — web's ClinicSchedule "Token numbering for queue" selector,
  // client/src/pages/StaffPages.jsx): 'sequential' (default) or 'alternate'; onlineTokenParity
  // ('odd'/'even') only matters while tokenNumberingMode is 'alternate' — see
  // doctors.service.js#shapeDoctor and appointments.service.js#runBookingJob.
  final String? tokenNumberingMode;
  final String? onlineTokenParity;
  final double? rating;
  final int? reviewCount;
  final bool? emergencyAvailable;
  // COMPLETENESS FIX (mobile parity — web's DoctorProfileEdit "Minimum booking amount" field,
  // client/src/pages/StaffPages.jsx): lets a doctor offer "pay just this much now, rest at the
  // clinic" instead of always requiring the full consultationFee upfront. me.validation.js caps
  // it at consultationFee server-side.
  final double? minBookingAdvanceAmount;
  final List<VerificationDocument> verificationDocuments;
  final BankDetails? bankDetails;

  final String? clinicId; // receptionist
  final String? since; // receptionist

  MeProfile({
    this.dateOfBirth,
    this.gender,
    this.bloodGroup,
    this.emergencyContact,
    this.address,
    this.medicalHistory,
    this.about,
    this.specializationId,
    this.specialization,
    this.qualification,
    this.registrationNumber,
    this.experienceYears,
    this.consultationFee,
    this.emergencyFee,
    this.languages,
    this.bio,
    this.doctorStatus,
    this.onlineBooking,
    this.allowRebooking,
    this.maxDaysAdvance,
    this.maxOnlineBookingsPerDay,
    this.tokenNumberingMode,
    this.onlineTokenParity,
    this.rating,
    this.reviewCount,
    this.emergencyAvailable,
    this.minBookingAdvanceAmount,
    this.verificationDocuments = const [],
    this.bankDetails,
    this.clinicId,
    this.since,
  });

  factory MeProfile.fromJson(Map<String, dynamic>? json) {
    if (json == null) return MeProfile();
    return MeProfile(
      dateOfBirth: json['dateOfBirth'] as String?,
      gender: json['gender'] as String?,
      bloodGroup: json['bloodGroup'] as String?,
      emergencyContact: json['emergencyContact'] as String?,
      address: json['address'] as String?,
      medicalHistory: json['medicalHistory'] as String?,
      about: json['about'] as String?,
      specializationId: json['specializationId'] as String?,
      specialization: json['specialization'] as Map<String, dynamic>?,
      qualification: json['qualification'] as String?,
      registrationNumber: json['registrationNumber'] as String?,
      experienceYears: json['experienceYears'] == null ? null : asInt(json['experienceYears']),
      consultationFee: json['consultationFee'] == null ? null : asDouble(json['consultationFee']),
      emergencyFee: json['emergencyFee'] == null ? null : asDouble(json['emergencyFee']),
      languages: (json['languages'] as List?)?.map((e) => e.toString()).toList(),
      bio: json['bio'] as String?,
      doctorStatus: json['status'] as String?,
      onlineBooking: json['onlineBooking'] as bool?,
      allowRebooking: json['allowRebooking'] as bool?,
      maxDaysAdvance: json['maxDaysAdvance'] == null ? null : asInt(json['maxDaysAdvance']),
      maxOnlineBookingsPerDay: json['maxOnlineBookingsPerDay'] == null ? null : asInt(json['maxOnlineBookingsPerDay']),
      tokenNumberingMode: json['tokenNumberingMode'] as String?,
      onlineTokenParity: json['onlineTokenParity'] as String?,
      rating: json['rating'] == null ? null : asDouble(json['rating']),
      reviewCount: json['reviewCount'] == null ? null : asInt(json['reviewCount']),
      emergencyAvailable: json['emergencyAvailable'] as bool?,
      minBookingAdvanceAmount:
          json['minBookingAdvanceAmount'] == null ? null : asDouble(json['minBookingAdvanceAmount']),
      verificationDocuments: (json['verificationDocuments'] as List?)
              ?.map((e) => VerificationDocument.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      bankDetails: json['bankDetails'] == null ? null : BankDetails.fromJson(json['bankDetails'] as Map<String, dynamic>),
      clinicId: json['clinicId'] as String?,
      since: json['since'] as String?,
    );
  }
}

class MeResponse {
  final AppUser user;
  final MeProfile profile;
  MeResponse({required this.user, required this.profile});

  factory MeResponse.fromJson(Map<String, dynamic> json) => MeResponse(
        user: AppUser.fromJson(json),
        profile: MeProfile.fromJson(json['profile'] as Map<String, dynamic>?),
      );
}

class City {
  final String id;
  final String name;
  final String? state;
  City({required this.id, required this.name, this.state});
  factory City.fromJson(Map<String, dynamic> json) =>
      City(id: asString(json['id']), name: asString(json['name']), state: json['state'] as String?);
}

class Area {
  final String id;
  final String name;
  final String? pincode;
  final String cityId;
  Area({required this.id, required this.name, this.pincode, required this.cityId});
  factory Area.fromJson(Map<String, dynamic> json) => Area(
        id: asString(json['id']),
        name: asString(json['name']),
        pincode: json['pincode'] as String?,
        cityId: asString(json['cityId']),
      );
}

class Specialization {
  final String id;
  final String name;
  final String? icon;
  final String? description;
  Specialization({required this.id, required this.name, this.icon, this.description});
  factory Specialization.fromJson(Map<String, dynamic> json) => Specialization(
        id: asString(json['id']),
        name: asString(json['name']),
        icon: json['icon'] as String?,
        description: json['description'] as String?,
      );
}

class ClinicSummary {
  final String id;
  final String name;
  final String? city;
  final String? area;
  ClinicSummary({required this.id, required this.name, this.city, this.area});
  factory ClinicSummary.fromJson(Map<String, dynamic> json) => ClinicSummary(
        id: asString(json['id']),
        name: asString(json['name']),
        city: json['city'] as String?,
        area: json['area'] as String?,
      );
}

/// GET /doctors and GET /doctors/:id row shape.
class DoctorDirectoryItem {
  final String id;
  final String name;
  final String? photoUrl;
  final String? city;
  final Specialization? specialization;
  final String? qualification;
  final String? registrationNumber;
  final int? experienceYears;
  final double consultationFee;
  final double? emergencyFee;
  final List<String> languages;
  final double rating;
  final int reviewCount;
  final bool emergencyAvailable;
  final bool onlineBooking;
  final List<ClinicSummary> clinics;
  final String? bio;
  final bool? allowRebooking;
  final int? maxDaysAdvance;
  // COMPLETENESS FIX (audit Priority 4 — "no way to disable a doctor's or patient's login"):
  // users.status, only ever present when the API's caller is an admin/superadmin (see
  // doctors.service.js#shapeDoctor's includeContact gate — the same gate email/phone go
  // through), which is the only caller AdminDoctorsScreen ever is.
  final String? accountStatus;
  // Verification-lifecycle status ('pending'/'verified'/'disabled') — doctor_profiles.status,
  // returned by the API as a flattened top-level `status` key (see
  // doctors.service.js#shapeDoctor), distinct from `accountStatus` above (users.status,
  // login enable/disable). An admin/superadmin caller to GET /doctors gets every doctor's real
  // value here (that's what lets AdminDoctorsScreen build a "Pending verification" section); a
  // public/patient caller only ever sees already-verified rows, so this is always 'verified'
  // there.
  final String? doctorStatus;
  final String? scheduleSummary;
  final List<DoctorScheduleSlot> schedule;
  final double? minBookingAdvanceAmount;

  DoctorDirectoryItem({
    required this.id,
    required this.name,
    this.photoUrl,
    this.city,
    this.specialization,
    this.qualification,
    this.registrationNumber,
    this.experienceYears,
    required this.consultationFee,
    this.emergencyFee,
    required this.languages,
    required this.rating,
    required this.reviewCount,
    required this.emergencyAvailable,
    required this.onlineBooking,
    required this.clinics,
    this.bio,
    this.allowRebooking,
    this.maxDaysAdvance,
    this.accountStatus,
    this.doctorStatus,
    this.scheduleSummary,
    this.schedule = const [],
    this.minBookingAdvanceAmount,
  });

  factory DoctorDirectoryItem.fromJson(Map<String, dynamic> json) => DoctorDirectoryItem(
        id: asString(json['id']),
        name: asString(json['name']),
        photoUrl: json['photoUrl'] as String?,
        city: json['city'] as String?,
        specialization: json['specialization'] == null
            ? null
            : Specialization.fromJson(json['specialization'] as Map<String, dynamic>),
        qualification: json['qualification'] as String?,
        registrationNumber: json['registrationNumber'] as String?,
        experienceYears: json['experienceYears'] == null ? null : asInt(json['experienceYears']),
        consultationFee: asDouble(json['consultationFee']),
        emergencyFee: json['emergencyFee'] == null ? null : asDouble(json['emergencyFee']),
        languages: (json['languages'] as List? ?? []).map((e) => e.toString()).toList(),
        rating: asDouble(json['rating']),
        reviewCount: asInt(json['reviewCount']),
        emergencyAvailable: asBool(json['emergencyAvailable']),
        // PARITY FIX (mobile parity audit — Patient panel): web's DoctorProfile treats a
        // missing/null onlineBooking as bookable (`doctor.onlineBooking !== false`,
        // PublicPages.jsx) — only an explicit `false` blocks booking. This used to default a
        // missing value to `false` (asBool's own default), which would silently disable the
        // "Continue to booking" button for a perfectly bookable doctor if the field were ever
        // omitted from a response, unlike the web app. The column is NOT NULL server-side today
        // so this mostly guards against future drift, but it's the correct default to match web.
        onlineBooking: asBool(json['onlineBooking'], true),
        clinics: (json['clinics'] as List? ?? [])
            .map((e) => ClinicSummary.fromJson(e as Map<String, dynamic>))
            .toList(),
        bio: json['bio'] as String?,
        allowRebooking: json['allowRebooking'] as bool?,
        maxDaysAdvance: json['maxDaysAdvance'] == null ? null : asInt(json['maxDaysAdvance']),
        accountStatus: json['accountStatus'] as String?,
        doctorStatus: json['status'] as String?,
        scheduleSummary: json['scheduleSummary'] as String?,
        schedule: (json['schedule'] as List? ?? [])
            .map((e) => DoctorScheduleSlot.fromJson(e as Map<String, dynamic>))
            .toList(),
        minBookingAdvanceAmount: json['minBookingAdvanceAmount'] == null ? null : asDouble(json['minBookingAdvanceAmount']),
      );
}

class DoctorScheduleSlot {
  final String day;
  final String hours;
  final int? slotMinutes;
  DoctorScheduleSlot({required this.day, required this.hours, this.slotMinutes});
  factory DoctorScheduleSlot.fromJson(Map<String, dynamic> json) => DoctorScheduleSlot(
        day: asString(json['day']),
        hours: asString(json['hours']),
        slotMinutes: json['slotMinutes'] == null ? null : asInt(json['slotMinutes']),
      );
}

class ClinicDoctorLink {
  final String doctorUserId;
  final String name;
  final String? photoUrl;
  final bool isOwner;
  final bool isPrimary;
  final bool onlineBooking;
  // BUG FIX (mobile parity audit): web's ReceptionAvailability shows each doctor's specialization
  // — clinics.service.js's clinic-detail select now returns this too (see that file's comment).
  final Specialization? specialization;
  ClinicDoctorLink({
    required this.doctorUserId,
    required this.name,
    this.photoUrl,
    required this.isOwner,
    required this.isPrimary,
    required this.onlineBooking,
    this.specialization,
  });
  factory ClinicDoctorLink.fromJson(Map<String, dynamic> json) => ClinicDoctorLink(
        doctorUserId: asString(json['doctorUserId']),
        name: asString(json['name']),
        photoUrl: json['photoUrl'] as String?,
        isOwner: asBool(json['isOwner']),
        isPrimary: asBool(json['isPrimary']),
        onlineBooking: asBool(json['onlineBooking']),
        specialization: json['specialization'] == null ? null : Specialization.fromJson(json['specialization'] as Map<String, dynamic>),
      );
}

/// GET /clinics/:id full detail shape (list rows use a subset of this).
class Clinic {
  final String id;
  final String name;
  final String? phone;
  final String? address;
  final String approvalStatus;
  final String? rejectionReason;
  final bool emergencyAvailable;
  final bool paymentCashEnabled;
  final bool paymentUpiEnabled;
  final String? paymentUpiId;
  final String? paymentQrUrl;
  final City? city;
  final Area? area;
  final List<ClinicDoctorLink> doctors;

  Clinic({
    required this.id,
    required this.name,
    this.phone,
    this.address,
    required this.approvalStatus,
    this.rejectionReason,
    required this.emergencyAvailable,
    required this.paymentCashEnabled,
    required this.paymentUpiEnabled,
    this.paymentUpiId,
    this.paymentQrUrl,
    this.city,
    this.area,
    this.doctors = const [],
  });

  factory Clinic.fromJson(Map<String, dynamic> json) => Clinic(
        id: asString(json['id']),
        name: asString(json['name']),
        phone: json['phone'] as String?,
        address: json['address'] as String?,
        approvalStatus: asString(json['approvalStatus'], 'pending'),
        rejectionReason: json['rejectionReason'] as String?,
        emergencyAvailable: asBool(json['emergencyAvailable']),
        paymentCashEnabled: asBool(json['paymentCashEnabled']),
        paymentUpiEnabled: asBool(json['paymentUpiEnabled']),
        paymentUpiId: json['paymentUpiId'] as String?,
        paymentQrUrl: json['paymentQrUrl'] as String?,
        city: json['city'] == null ? null : City.fromJson(json['city'] as Map<String, dynamic>),
        area: json['area'] == null ? null : Area.fromJson(json['area'] as Map<String, dynamic>),
        doctors: (json['doctors'] as List? ?? [])
            .map((e) => ClinicDoctorLink.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class ClinicHours {
  final String id;
  final String doctorUserId;
  final String clinicId;
  final int weekday; // 0=Sun..6=Sat
  final String startTime;
  final String endTime;
  final int slotMinutes;
  final String status;

  ClinicHours({
    required this.id,
    required this.doctorUserId,
    required this.clinicId,
    required this.weekday,
    required this.startTime,
    required this.endTime,
    required this.slotMinutes,
    required this.status,
  });

  factory ClinicHours.fromJson(Map<String, dynamic> json) => ClinicHours(
        id: asString(json['id']),
        doctorUserId: asString(json['doctorUserId']),
        clinicId: asString(json['clinicId']),
        weekday: asInt(json['weekday']),
        startTime: asString(json['startTime']),
        endTime: asString(json['endTime']),
        slotMinutes: asInt(json['slotMinutes']),
        status: asString(json['status'], 'active'),
      );
}

class ClinicClosure {
  final String id;
  final String doctorUserId;
  final String clinicId;
  final String closedDate;
  final String? reason;

  ClinicClosure({
    required this.id,
    required this.doctorUserId,
    required this.clinicId,
    required this.closedDate,
    this.reason,
  });

  factory ClinicClosure.fromJson(Map<String, dynamic> json) => ClinicClosure(
        id: asString(json['id']),
        doctorUserId: asString(json['doctorUserId']),
        clinicId: asString(json['clinicId']),
        closedDate: asString(json['closedDate']),
        reason: json['reason'] as String?,
      );
}
