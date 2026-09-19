/**
 * Unit tests for modules/uploads/uploads.service.js — the per-role ownership checks that gate
 * which Prisma row an already-saved-to-disk file's URL gets attached to:
 *
 *   - savePhoto: any authenticated user may set their OWN photoUrl; a doctor additionally busts
 *     the public directory cache (via a lazy require into doctors.service.js, mocked here) since
 *     photoUrl is embedded in every cached listDoctors/getDoctorById response — a non-doctor must
 *     NOT trigger that cross-module call.
 *   - saveVerificationDocument: APPENDS to the existing verification_documents array (never
 *     replaces it), and falls back to an auto-numbered label when no documentName is given.
 *   - saveClinicQr: a doctor must be the OWNING doctor at that exact clinic (isOwner:true, not
 *     merely linked); a receptionist must be staffed at that exact clinic
 *     (receptionist_profiles.clinicId match) — two structurally different ownership checks for
 *     the two roles this function accepts.
 *
 * config/db is mocked (no real Postgres in this sandbox); activityLogService/cacheService are
 * mocked to isolate this module's own branching; doctors.service is mocked because savePhoto
 * lazily requires it purely for its invalidateDoctorCaches side effect.
 */
jest.mock('../../../src/config/db', () => ({
  user: { update: jest.fn() },
  doctorProfile: { findUnique: jest.fn(), update: jest.fn() },
  clinic: { findUnique: jest.fn(), update: jest.fn() },
  doctorClinic: { findUnique: jest.fn() },
  receptionistProfile: { findUnique: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({ invalidate: jest.fn() }));
jest.mock('../../../src/modules/doctors/doctors.service', () => ({ invalidateDoctorCaches: jest.fn() }));

const prisma = require('../../../src/config/db');
const cacheService = require('../../../src/services/cacheService');
const doctorsService = require('../../../src/modules/doctors/doctors.service');
const uploadsService = require('../../../src/modules/uploads/uploads.service');

const DOCTOR = { id: 'doc-1', role: 'doctor' };
const PATIENT = { id: 'patient-1', role: 'patient' };
const RECEPTIONIST = { id: 'recep-1', role: 'receptionist' };

describe('uploadsService.savePhoto', () => {
  test('a doctor uploading a photo busts the public directory cache via the lazy doctors.service require', async () => {
    await uploadsService.savePhoto(DOCTOR, 'http://host/photo.jpg');

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: DOCTOR.id }, data: { photoUrl: 'http://host/photo.jpg' } });
    expect(doctorsService.invalidateDoctorCaches).toHaveBeenCalledWith(DOCTOR.id);
  });

  test('a non-doctor uploading a photo does NOT trigger the doctor-directory cache invalidation', async () => {
    await uploadsService.savePhoto(PATIENT, 'http://host/photo.jpg');

    expect(doctorsService.invalidateDoctorCaches).not.toHaveBeenCalled();
  });
});

describe('uploadsService.saveVerificationDocument', () => {
  test('404 DOCTOR_PROFILE_NOT_FOUND when the doctor has no profile row (defensive guard)', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue(null);

    await expect(uploadsService.saveVerificationDocument(DOCTOR, 'http://host/doc.pdf')).rejects.toMatchObject({
      statusCode: 404,
      code: 'DOCTOR_PROFILE_NOT_FOUND',
    });
  });

  test('APPENDS to an existing verification_documents array rather than replacing it', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({
      verificationDocuments: [{ name: 'Registration certificate', url: 'http://host/old.pdf', uploadedAt: '2026-01-01T00:00:00.000Z' }],
    });

    await uploadsService.saveVerificationDocument(DOCTOR, 'http://host/new.pdf', 'Degree certificate');

    expect(prisma.doctorProfile.update).toHaveBeenCalledWith({
      where: { userId: DOCTOR.id },
      data: {
        verificationDocuments: [
          { name: 'Registration certificate', url: 'http://host/old.pdf', uploadedAt: '2026-01-01T00:00:00.000Z' },
          { name: 'Degree certificate', url: 'http://host/new.pdf', uploadedAt: expect.any(String) },
        ],
      },
    });
  });

  test('falls back to an auto-numbered label when no documentName is given', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({ verificationDocuments: [] });

    await uploadsService.saveVerificationDocument(DOCTOR, 'http://host/new.pdf');

    expect(prisma.doctorProfile.update).toHaveBeenCalledWith({
      where: { userId: DOCTOR.id },
      data: { verificationDocuments: [expect.objectContaining({ name: 'Document 1' })] },
    });
  });

  test('a non-array existing verificationDocuments value is treated as empty (defensive coercion)', async () => {
    prisma.doctorProfile.findUnique.mockResolvedValue({ verificationDocuments: null });

    await uploadsService.saveVerificationDocument(DOCTOR, 'http://host/new.pdf');

    expect(prisma.doctorProfile.update).toHaveBeenCalledWith({
      where: { userId: DOCTOR.id },
      data: { verificationDocuments: [expect.objectContaining({ name: 'Document 1' })] },
    });
  });
});

describe('uploadsService.saveClinicQr — dual ownership check', () => {
  test('404 CLINIC_NOT_FOUND when the clinic does not exist', async () => {
    prisma.clinic.findUnique.mockResolvedValue(null);

    await expect(uploadsService.saveClinicQr(DOCTOR, 'clinic-1', 'http://host/qr.png')).rejects.toMatchObject({
      statusCode: 404,
      code: 'CLINIC_NOT_FOUND',
    });
  });

  test('403 FORBIDDEN when a doctor is linked to the clinic but is not its owner', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1' });
    prisma.doctorClinic.findUnique.mockResolvedValue({ isOwner: false });

    await expect(uploadsService.saveClinicQr(DOCTOR, 'clinic-1', 'http://host/qr.png')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  test('403 FORBIDDEN when the doctor has no link to the clinic at all', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1' });
    prisma.doctorClinic.findUnique.mockResolvedValue(null);

    await expect(uploadsService.saveClinicQr(DOCTOR, 'clinic-1', 'http://host/qr.png')).rejects.toMatchObject({ statusCode: 403 });
  });

  test('an owning doctor succeeds and busts the clinic\'s public detail cache', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1' });
    prisma.doctorClinic.findUnique.mockResolvedValue({ isOwner: true });

    await uploadsService.saveClinicQr(DOCTOR, 'clinic-1', 'http://host/qr.png');

    expect(prisma.clinic.update).toHaveBeenCalledWith({ where: { id: 'clinic-1' }, data: { paymentQrUrl: 'http://host/qr.png' } });
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:clinics:detail:clinic-1:public');
  });

  test('403 FORBIDDEN when a receptionist is staffed at a DIFFERENT clinic', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1' });
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-OTHER' });

    await expect(uploadsService.saveClinicQr(RECEPTIONIST, 'clinic-1', 'http://host/qr.png')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    // Doctor-only ownership lookup must never fire for a receptionist caller.
    expect(prisma.doctorClinic.findUnique).not.toHaveBeenCalled();
  });

  test('a receptionist staffed at exactly this clinic succeeds', async () => {
    prisma.clinic.findUnique.mockResolvedValue({ id: 'clinic-1' });
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });

    await uploadsService.saveClinicQr(RECEPTIONIST, 'clinic-1', 'http://host/qr.png');

    expect(prisma.clinic.update).toHaveBeenCalledWith({ where: { id: 'clinic-1' }, data: { paymentQrUrl: 'http://host/qr.png' } });
  });
});
