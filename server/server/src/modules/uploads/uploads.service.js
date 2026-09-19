/**
 * Business logic for the uploads module.
 * Responsibility: persist an already-saved-to-disk file's URL (req.uploadedFile.url, built by
 * services/fileUploadService.js's middleware BEFORE any function here runs) onto the right
 * Prisma row — users.photo_url, doctor_profiles.verification_documents, or clinics.payment_qr_url
 * — plus any ownership check a route's authorize(...) role gate alone can't express (e.g. "this
 * doctor owns THIS SPECIFIC clinic", not just "is a doctor"). The multipart parsing/disk
 * write/URL-building itself lives entirely in fileUploadService.js; nothing here touches multer,
 * req.file, or a filesystem path.
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');

const MAX_DOCUMENT_NAME_LENGTH = 150;

/**
 * Any authenticated user's own profile photo. Every role stores its photo on the same base
 * `users.photo_url` column (see schema.prisma User#photoUrl) — there is no per-role photo field,
 * unlike verificationDocuments/paymentQrUrl below, so no role branching is needed here.
 * @param {{id:string, role:string}} actor
 * @param {string} url
 */
async function savePhoto(actor, url) {
  await prisma.user.update({ where: { id: actor.id }, data: { photoUrl: url } });

  // FIX (cache-invalidation audit): DOCTOR_LIST_SELECT/DOCTOR_DETAIL_SELECT both select
  // photoUrl and doctors.service.js#shapeDoctor returns it in every cached listDoctors/
  // getDoctorById response (60s TTL) — every OTHER doctor-affecting write in this codebase
  // (me.service.js#updateMe, doctors.service.js itself, clinics.service.js, reviews.service.js)
  // already calls invalidateDoctorCaches after mutating something the public directory shows,
  // but this one didn't. Without this, a doctor uploading a new photo keeps showing their old
  // one on the public directory/detail pages for up to 60s. Lazy require, same reasoning as
  // me.service.js's own cross-module invalidation call: doctors.service.js doesn't require this
  // module, so this isn't a true cycle.
  if (actor.role === 'doctor') {
    const doctorsService = require('../doctors/doctors.service');
    await doctorsService.invalidateDoctorCaches(actor.id);
  }

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'uploads.photo',
    targetEntityType: 'user',
    targetEntityId: actor.id,
    description: 'Uploaded a new profile photo',
  });

  return url;
}

/**
 * Doctor-only verification document. APPENDS {name, url, uploadedAt} to the doctor's own
 * `doctor_profiles.verification_documents` Json array (the same {name, url} shape
 * doctors.validation.js#createDoctor already validates for this field) rather than replacing it
 * — a doctor uploading a second document (e.g. registration certificate, then a degree
 * certificate) must not silently drop the first.
 * @param {{id:string, role:string}} actor
 * @param {string} url
 * @param {string} [documentName] - caller-supplied label, e.g. "Registration certificate". This
 *   is a DISPLAY label only, never a filesystem path — the file itself was already written under
 *   a server-generated UUID filename by fileUploadService, never the client's original filename.
 */
async function saveVerificationDocument(actor, url, documentName) {
  const existing = await prisma.doctorProfile.findUnique({
    where: { userId: actor.id },
    select: { verificationDocuments: true },
  });
  // A doctor account always has a doctor_profiles row (created alongside the user in the same
  // transaction — see doctors.service.js#createDoctor), so this should be unreachable in
  // practice; guarded anyway rather than letting a raw Prisma "record not found" leak as a 500.
  if (!existing) {
    throw new ApiError(404, 'DOCTOR_PROFILE_NOT_FOUND', 'Doctor profile not found.');
  }

  const currentDocuments = Array.isArray(existing.verificationDocuments) ? existing.verificationDocuments : [];
  const label =
    (documentName || '').trim().slice(0, MAX_DOCUMENT_NAME_LENGTH) || `Document ${currentDocuments.length + 1}`;
  const nextDocuments = [...currentDocuments, { name: label, url, uploadedAt: new Date().toISOString() }];

  await prisma.doctorProfile.update({
    where: { userId: actor.id },
    data: { verificationDocuments: nextDocuments },
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'uploads.verification_document',
    targetEntityType: 'user',
    targetEntityId: actor.id,
    description: `Uploaded verification document: ${label}`,
  });

  return url;
}

/**
 * Doctor-or-receptionist clinic payment QR code. Unlike the two functions above (which always
 * act on the caller's own row), a clinic is a shared resource — the caller must additionally
 * prove a real relationship to THIS SPECIFIC clinicId, not just hold the right role:
 *   - doctor: must be the OWNING doctor at this clinic (doctor_clinics.isOwner=true), the same
 *     bar clinics.service.js#assertIsClinicOwner sets for PATCH /clinics/:id — a QR code
 *     controls where patients' payments land, so this is deliberately as strict as any other
 *     clinic financial-settings write, not merely "assigned to this clinic".
 *   - receptionist: must be staffed at this exact clinic (receptionist_profiles.clinic_id) — the
 *     only clinic scoping that role has anywhere in the schema (see that column's own header
 *     comment in schema.prisma for why it's nullable/additive).
 * admin/superadmin are deliberately NOT special-cased here — this route's authorize('doctor',
 * 'receptionist') already excludes them, matching the task's stated scope ("doctor or
 * receptionist role"); an admin needing to fix a clinic's QR code has PATCH /clinics/:id for that.
 * @param {{id:string, role:string}} actor
 * @param {string} clinicId
 * @param {string} url
 */
async function saveClinicQr(actor, clinicId, url) {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true } });
  if (!clinic) {
    throw new ApiError(404, 'CLINIC_NOT_FOUND', 'Clinic not found.');
  }

  if (actor.role === 'doctor') {
    const assignment = await prisma.doctorClinic.findUnique({
      where: { doctorUserId_clinicId: { doctorUserId: actor.id, clinicId } },
      select: { isOwner: true },
    });
    if (!assignment || !assignment.isOwner) {
      throw new ApiError(403, 'FORBIDDEN', 'You must be an owner of this clinic to upload its QR code.');
    }
  } else {
    // receptionist — the only other role authorize('doctor', 'receptionist') lets through to
    // this function (see uploads.routes.js).
    const receptionistProfile = await prisma.receptionistProfile.findUnique({
      where: { userId: actor.id },
      select: { clinicId: true },
    });
    if (!receptionistProfile || receptionistProfile.clinicId !== clinicId) {
      throw new ApiError(403, 'FORBIDDEN', 'You are not staffed at this clinic.');
    }
  }

  await prisma.clinic.update({ where: { id: clinicId }, data: { paymentQrUrl: url } });

  // Matches clinics.service.js#updateClinic's own invalidation of the cached PUBLIC detail
  // bucket (see that file's getClinicById header comment for why only the public bucket is ever
  // written to cache). paymentQrUrl is part of CLINIC_DETAIL_SELECT/shapeClinicDetail there, so
  // skipping this would keep serving the old QR code for up to DETAIL_CACHE_TTL_SECONDS.
  await cacheService.invalidate(`cache:clinics:detail:${clinicId}:public`);

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'uploads.clinic_qr',
    targetEntityType: 'clinic',
    targetEntityId: clinicId,
    description: 'Uploaded a new clinic payment QR code',
  });

  return url;
}

module.exports = { savePhoto, saveVerificationDocument, saveClinicQr };
