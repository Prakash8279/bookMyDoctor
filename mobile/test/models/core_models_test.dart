import 'package:flutter_test/flutter_test.dart';

import 'package:connect_mobile/models/core_models.dart';

void main() {
  group('City.fromJson', () {
    test('parses a full JSON map', () {
      final city = City.fromJson({
        'id': 'c1',
        'name': 'Mumbai',
        'state': 'MH',
      });

      expect(city.id, 'c1');
      expect(city.name, 'Mumbai');
      expect(city.state, 'MH');
    });

    test('parses a minimal JSON map without throwing', () {
      final city = City.fromJson({
        'id': 'c2',
        'name': 'Delhi',
      });

      expect(city.id, 'c2');
      expect(city.name, 'Delhi');
      expect(city.state, isNull);
    });
  });

  group('Area.fromJson', () {
    test('parses a full JSON map', () {
      final area = Area.fromJson({
        'id': 'a1',
        'name': 'Andheri',
        'pincode': '400058',
        'cityId': 'c1',
      });

      expect(area.id, 'a1');
      expect(area.name, 'Andheri');
      expect(area.pincode, '400058');
      expect(area.cityId, 'c1');
    });

    test('parses a minimal JSON map without throwing', () {
      final area = Area.fromJson({
        'id': 'a2',
        'name': 'Bandra',
        'cityId': 'c1',
      });

      expect(area.id, 'a2');
      expect(area.name, 'Bandra');
      expect(area.pincode, isNull);
      expect(area.cityId, 'c1');
    });
  });

  group('Specialization.fromJson', () {
    test('parses a full JSON map', () {
      final specialization = Specialization.fromJson({
        'id': 's1',
        'name': 'Cardiology',
        'icon': 'heart',
        'description': 'Heart specialist',
      });

      expect(specialization.id, 's1');
      expect(specialization.name, 'Cardiology');
      expect(specialization.icon, 'heart');
      expect(specialization.description, 'Heart specialist');
    });

    test('parses a minimal JSON map without throwing', () {
      final specialization = Specialization.fromJson({
        'id': 's2',
        'name': 'Dermatology',
      });

      expect(specialization.id, 's2');
      expect(specialization.name, 'Dermatology');
      expect(specialization.icon, isNull);
      expect(specialization.description, isNull);
    });
  });

  group('ClinicSummary.fromJson', () {
    test('parses a full JSON map', () {
      final clinic = ClinicSummary.fromJson({
        'id': 'cl1',
        'name': 'City Clinic',
        'city': 'Mumbai',
        'area': 'Andheri',
      });

      expect(clinic.id, 'cl1');
      expect(clinic.name, 'City Clinic');
      expect(clinic.city, 'Mumbai');
      expect(clinic.area, 'Andheri');
    });

    test('parses a minimal JSON map without throwing', () {
      final clinic = ClinicSummary.fromJson({
        'id': 'cl2',
        'name': 'Health Center',
      });

      expect(clinic.id, 'cl2');
      expect(clinic.name, 'Health Center');
      expect(clinic.city, isNull);
      expect(clinic.area, isNull);
    });
  });

  group('DoctorDirectoryItem.fromJson', () {
    test('parses a full JSON map, including nested specialization/clinics and the status->doctorStatus mapping', () {
      final doctor = DoctorDirectoryItem.fromJson({
        'id': 'd1',
        'name': 'Dr. Smith',
        'photoUrl': 'http://example.com/d1.png',
        'city': 'Mumbai',
        'specialization': {
          'id': 's1',
          'name': 'Cardiology',
          'icon': 'heart',
          'description': 'Heart specialist',
        },
        'qualification': 'MBBS',
        'registrationNumber': 'REG123',
        'experienceYears': 10,
        'consultationFee': 500,
        'emergencyFee': 800,
        'languages': ['English', 'Hindi'],
        'rating': 4.5,
        'reviewCount': 120,
        'emergencyAvailable': true,
        'onlineBooking': true,
        'clinics': [
          {'id': 'cl1', 'name': 'City Clinic', 'city': 'Mumbai', 'area': 'Andheri'},
        ],
        'bio': 'Experienced cardiologist',
        'allowRebooking': true,
        'maxDaysAdvance': 30,
        'accountStatus': 'active',
        'status': 'verified',
      });

      expect(doctor.id, 'd1');
      expect(doctor.name, 'Dr. Smith');
      expect(doctor.photoUrl, 'http://example.com/d1.png');
      expect(doctor.city, 'Mumbai');
      expect(doctor.specialization, isNotNull);
      expect(doctor.specialization!.id, 's1');
      expect(doctor.specialization!.name, 'Cardiology');
      expect(doctor.qualification, 'MBBS');
      expect(doctor.registrationNumber, 'REG123');
      expect(doctor.experienceYears, 10);
      expect(doctor.consultationFee, 500.0);
      expect(doctor.emergencyFee, 800.0);
      expect(doctor.languages, ['English', 'Hindi']);
      expect(doctor.rating, 4.5);
      expect(doctor.reviewCount, 120);
      expect(doctor.emergencyAvailable, isTrue);
      expect(doctor.onlineBooking, isTrue);
      expect(doctor.clinics, hasLength(1));
      expect(doctor.clinics.first.id, 'cl1');
      expect(doctor.clinics.first.name, 'City Clinic');
      expect(doctor.bio, 'Experienced cardiologist');
      expect(doctor.allowRebooking, isTrue);
      expect(doctor.maxDaysAdvance, 30);
      // accountStatus (users.status) and doctorStatus (flattened doctor_profiles.status,
      // returned by the API as top-level `status`) are distinct fields fed by distinct keys.
      expect(doctor.accountStatus, 'active');
      expect(doctor.doctorStatus, 'verified');
    });

    test('parses a minimal JSON map without throwing, defaulting numeric/bool/list fields', () {
      final doctor = DoctorDirectoryItem.fromJson({
        'id': 'd2',
        'name': 'Dr. Jones',
      });

      expect(doctor.id, 'd2');
      expect(doctor.name, 'Dr. Jones');
      expect(doctor.photoUrl, isNull);
      expect(doctor.city, isNull);
      expect(doctor.specialization, isNull);
      expect(doctor.qualification, isNull);
      expect(doctor.registrationNumber, isNull);
      expect(doctor.experienceYears, isNull);
      expect(doctor.consultationFee, 0);
      expect(doctor.emergencyFee, isNull);
      expect(doctor.languages, isEmpty);
      expect(doctor.rating, 0);
      expect(doctor.reviewCount, 0);
      expect(doctor.emergencyAvailable, isFalse);
      // TEST FIX (production-readiness pass, Sept 2026 — CI caught this): onlineBooking now
      // defaults to true for a missing/null field (core_models.dart's own PARITY FIX comment
      // above DoctorDirectoryItem.fromJson explains why — web treats a missing value as
      // bookable, only an explicit false blocks booking). This assertion was never updated
      // after that intentional behavior change.
      expect(doctor.onlineBooking, isTrue);
      expect(doctor.clinics, isEmpty);
      expect(doctor.bio, isNull);
      expect(doctor.allowRebooking, isNull);
      expect(doctor.maxDaysAdvance, isNull);
      expect(doctor.accountStatus, isNull);
      expect(doctor.doctorStatus, isNull);
    });
  });

  group('VerificationDocument.fromJson', () {
    test('parses a full JSON map', () {
      final doc = VerificationDocument.fromJson({
        'name': 'License',
        'url': 'http://example.com/doc.pdf',
        'uploadedAt': '2024-01-01',
      });

      expect(doc.name, 'License');
      expect(doc.url, 'http://example.com/doc.pdf');
      expect(doc.uploadedAt, '2024-01-01');
    });

    test('falls back to "Document" for a missing name, and null uploadedAt', () {
      final doc = VerificationDocument.fromJson({
        'url': 'http://example.com/doc.pdf',
      });

      expect(doc.name, 'Document');
      expect(doc.url, 'http://example.com/doc.pdf');
      expect(doc.uploadedAt, isNull);
    });
  });

  group('MeProfile.fromJson', () {
    test('parses a full JSON map, including nested verificationDocuments and the status->doctorStatus mapping', () {
      final profile = MeProfile.fromJson({
        'dateOfBirth': '1990-01-01',
        'gender': 'male',
        'bloodGroup': 'O+',
        'emergencyContact': '9999999999',
        'address': '123 Main St',
        'medicalHistory': 'None',
        'about': 'A short bio',
        'specializationId': 'sp1',
        'specialization': {'id': 'sp1', 'name': 'Cardiology'},
        'qualification': 'MBBS',
        'registrationNumber': 'REG1',
        'experienceYears': 5,
        'consultationFee': 600,
        'emergencyFee': 900,
        'languages': ['English', 'Hindi'],
        'bio': 'Doctor bio text',
        'status': 'verified',
        'onlineBooking': true,
        'allowRebooking': false,
        'maxDaysAdvance': 15,
        'maxOnlineBookingsPerDay': 10,
        'rating': 4.2,
        'reviewCount': 50,
        'emergencyAvailable': true,
        'minBookingAdvanceAmount': 100,
        'verificationDocuments': [
          {'name': 'License', 'url': 'http://example.com/doc.pdf', 'uploadedAt': '2024-01-01'},
        ],
        'clinicId': 'clinic1',
        'since': '2023-01-01',
      });

      expect(profile.dateOfBirth, '1990-01-01');
      expect(profile.gender, 'male');
      expect(profile.bloodGroup, 'O+');
      expect(profile.emergencyContact, '9999999999');
      expect(profile.address, '123 Main St');
      expect(profile.medicalHistory, 'None');
      expect(profile.about, 'A short bio');
      expect(profile.specializationId, 'sp1');
      expect(profile.specialization, {'id': 'sp1', 'name': 'Cardiology'});
      expect(profile.qualification, 'MBBS');
      expect(profile.registrationNumber, 'REG1');
      expect(profile.experienceYears, 5);
      expect(profile.consultationFee, 600.0);
      expect(profile.emergencyFee, 900.0);
      expect(profile.languages, ['English', 'Hindi']);
      expect(profile.bio, 'Doctor bio text');
      // doctorStatus is fed from the top-level `status` key, not a `doctorStatus` key.
      expect(profile.doctorStatus, 'verified');
      expect(profile.onlineBooking, isTrue);
      expect(profile.allowRebooking, isFalse);
      expect(profile.maxDaysAdvance, 15);
      expect(profile.maxOnlineBookingsPerDay, 10);
      expect(profile.rating, 4.2);
      expect(profile.reviewCount, 50);
      expect(profile.emergencyAvailable, isTrue);
      expect(profile.minBookingAdvanceAmount, 100.0);
      expect(profile.verificationDocuments, hasLength(1));
      expect(profile.verificationDocuments.first.name, 'License');
      expect(profile.verificationDocuments.first.url, 'http://example.com/doc.pdf');
      expect(profile.verificationDocuments.first.uploadedAt, '2024-01-01');
      expect(profile.clinicId, 'clinic1');
      expect(profile.since, '2023-01-01');
    });

    test('parses a minimal JSON map without throwing, leaving optional fields null/default', () {
      final profile = MeProfile.fromJson({});

      expect(profile.dateOfBirth, isNull);
      expect(profile.gender, isNull);
      expect(profile.bloodGroup, isNull);
      expect(profile.emergencyContact, isNull);
      expect(profile.address, isNull);
      expect(profile.medicalHistory, isNull);
      expect(profile.about, isNull);
      expect(profile.specializationId, isNull);
      expect(profile.specialization, isNull);
      expect(profile.qualification, isNull);
      expect(profile.registrationNumber, isNull);
      expect(profile.experienceYears, isNull);
      expect(profile.consultationFee, isNull);
      expect(profile.emergencyFee, isNull);
      expect(profile.languages, isNull);
      expect(profile.bio, isNull);
      expect(profile.doctorStatus, isNull);
      expect(profile.onlineBooking, isNull);
      expect(profile.allowRebooking, isNull);
      expect(profile.maxDaysAdvance, isNull);
      expect(profile.maxOnlineBookingsPerDay, isNull);
      expect(profile.rating, isNull);
      expect(profile.reviewCount, isNull);
      expect(profile.emergencyAvailable, isNull);
      expect(profile.minBookingAdvanceAmount, isNull);
      expect(profile.verificationDocuments, isEmpty);
      expect(profile.clinicId, isNull);
      expect(profile.since, isNull);
    });

    test('a null JSON map returns a default MeProfile without throwing', () {
      final profile = MeProfile.fromJson(null);

      expect(profile.dateOfBirth, isNull);
      expect(profile.specialization, isNull);
      expect(profile.verificationDocuments, isEmpty);
      expect(profile.clinicId, isNull);
    });
  });
}
