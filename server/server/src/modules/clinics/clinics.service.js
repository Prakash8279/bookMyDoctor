/**
 * Business logic for the clinics module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules,
 * and all Prisma/DB calls for this module live. Controllers call these functions; these
 * functions never touch req/res directly.
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { pickPresentFields } = require('../../utils/pickPresentFields');
const { ADMIN_ROLES } = require('../../utils/roles');
const idGenerators = require('../../utils/idGenerators');

const LIST_CACHE_TTL_SECONDS = 60;
const DETAIL_CACHE_TTL_SECONDS = 60;

/**
 * Invalidates every cached listClinics page plus the given clinic's cached PUBLIC detail bucket
 * (see getClinicById for why only the public bucket is ever written to cache). Also busts the
 * doctors-module cache (any doctor linked to this clinic — the clinics[] array embedded in a
 * doctor's shape, and city/area-based doctor filtering, both depend on doctor_clinics/clinic
 * state) via a lazy require to avoid a load-order cycle with doctors.service.js. When the write
 * that triggered this is a specific doctor's assignment change (assign/update/remove), pass
 * `doctorUserId` so that doctor's own cached detail page (its embedded clinics[] array) is busted
 * too, not just the doctors list — omit it for clinic-level writes with no single affected doctor.
 * @param {string} [clinicId]
 * @param {string} [doctorUserId]
 */
async function invalidateClinicCaches(clinicId, doctorUserId) {
  const patterns = [`cache:clinics:list:*`];
  if (clinicId) patterns.push(`cache:clinics:detail:${clinicId}:public`);
  await Promise.all(patterns.map((p) => cacheService.invalidate(p)));

  // Lazy require: doctors.service.js does not require clinics.service.js, so this isn't a true
  // cycle, but requiring lazily here keeps both modules' cache-invalidation helpers independent
  // of require-order.
  const doctorsService = require('../doctors/doctors.service');
  await doctorsService.invalidateDoctorCaches(doctorUserId);
}

// name/emergencyAvailable/paymentCashEnabled/paymentUpiEnabled are all NOT NULL columns on
// clinics — an explicit `null` here must be rejected, not forwarded into a Prisma update. The
// validation layer (clinics.validation.js's patchClinic) already rejects it too; this is the
// second, defense-in-depth layer.
const CLINIC_UPDATE_NON_NULLABLE = ['name', 'emergencyAvailable', 'paymentCashEnabled', 'paymentUpiEnabled'];

// isOwner/isPrimary/onlineBooking are all NOT NULL Boolean columns on doctor_clinics — see the
// comment on CLINIC_UPDATE_NON_NULLABLE above for why this defense-in-depth layer exists
// alongside the validation-layer rejectNull() guards in clinics.validation.js.
const ASSIGNMENT_NON_NULLABLE = ['isOwner', 'isPrimary', 'onlineBooking'];

const CLINIC_DETAIL_SELECT = {
  id: true,
  name: true,
  phone: true,
  address: true,
  approvalStatus: true,
  rejectionReason: true,
  emergencyAvailable: true,
  paymentCashEnabled: true,
  paymentUpiEnabled: true,
  paymentUpiId: true,
  paymentQrUrl: true,
  createdAt: true,
  updatedAt: true,
  // Stable "DCC<N>" display number (see prisma/migrations/
  // 20260919130000_add_patient_doctor_clinic_numbers) — never derived from list position, unlike
  // the pre-existing sequenceId() index-based numbering it replaces on the admin Clinics table.
  clinicNumber: true,
  city: { select: { id: true, name: true, state: true } },
  area: { select: { id: true, name: true, pincode: true } },
  doctorClinics: {
    select: {
      doctorUserId: true,
      isOwner: true,
      isPrimary: true,
      onlineBooking: true,
      // BUG FIX (mobile parity audit): web's ReceptionAvailability shows each team doctor's
      // specialization (via the separate public /doctors directory) — this clinic-scoped detail
      // endpoint never selected it at all, so there was no way to add it to the "Doctors & OPD"
      // screen (the correct, clinic-scoped data source) without this select.
      doctor: {
        select: {
          id: true,
          name: true,
          photoUrl: true,
          doctorProfile: { select: { specialization: { select: { id: true, name: true } } } },
        },
      },
    },
  },
};

const CLINIC_LIST_SELECT = {
  id: true,
  name: true,
  phone: true,
  address: true,
  approvalStatus: true,
  emergencyAvailable: true,
  paymentCashEnabled: true,
  paymentUpiEnabled: true,
  createdAt: true,
  clinicNumber: true,
  city: { select: { id: true, name: true } },
  area: { select: { id: true, name: true } },
};

function isAdmin(actor) {
  return !!actor && ADMIN_ROLES.includes(actor.role);
}

function shapeClinicDetail(clinic) {
  return {
    id: clinic.id,
    name: clinic.name,
    phone: clinic.phone,
    address: clinic.address,
    approvalStatus: clinic.approvalStatus,
    rejectionReason: clinic.rejectionReason,
    emergencyAvailable: clinic.emergencyAvailable,
    paymentCashEnabled: clinic.paymentCashEnabled,
    paymentUpiEnabled: clinic.paymentUpiEnabled,
    paymentUpiId: clinic.paymentUpiId,
    paymentQrUrl: clinic.paymentQrUrl,
    createdAt: clinic.createdAt,
    updatedAt: clinic.updatedAt,
    clinicNumber: clinic.clinicNumber ?? null,
    city: clinic.city,
    area: clinic.area,
    doctors: (clinic.doctorClinics || []).map((dc) => ({
      doctorUserId: dc.doctorUserId,
      name: dc.doctor ? dc.doctor.name : null,
      photoUrl: dc.doctor ? dc.doctor.photoUrl : null,
      isOwner: dc.isOwner,
      isPrimary: dc.isPrimary,
      onlineBooking: dc.onlineBooking,
      // BUG FIX (mobile parity audit): see the doctorClinics select above.
      specialization: dc.doctor?.doctorProfile?.specialization
        ? { id: dc.doctor.doctorProfile.specialization.id, name: dc.doctor.doctorProfile.specialization.name }
        : null,
    })),
  };
}

function shapeClinicListItem(clinic) {
  return {
    id: clinic.id,
    name: clinic.name,
    phone: clinic.phone,
    address: clinic.address,
    approvalStatus: clinic.approvalStatus,
    emergencyAvailable: clinic.emergencyAvailable,
    paymentCashEnabled: clinic.paymentCashEnabled,
    paymentUpiEnabled: clinic.paymentUpiEnabled,
    createdAt: clinic.createdAt,
    clinicNumber: clinic.clinicNumber ?? null,
    city: clinic.city,
    area: clinic.area,
  };
}

/**
 * Throws 403 FORBIDDEN unless `actor` is admin/superadmin or holds an isOwner:true
 * doctor_clinics row at this clinic. Shared by PATCH /clinics/:id and the doctor-assignment
 * endpoints, which both require "I own this clinic", not just "I'm assigned to it".
 * @param {string} clinicId
 * @param {{id:string, role:string}} actor
 */
async function assertIsClinicOwner(clinicId, actor) {
  if (isAdmin(actor)) return;

  const row = await prisma.doctorClinic.findUnique({
    where: { doctorUserId_clinicId: { doctorUserId: actor.id, clinicId } },
    select: { isOwner: true },
  });
  if (!row || !row.isOwner) {
    throw new ApiError(403, 'FORBIDDEN', 'You must be an owner of this clinic to perform this action.');
  }
}

/**
 * Fetches a clinic and enforces the shared visibility rule: a non-active clinic is visible
 * only to a doctor assigned to it (any assignment, not owner-only — read is lower-risk than
 * write) or an admin; everyone else gets 404 (never 403, to avoid confirming existence of a
 * not-yet-approved clinic).
 * @param {string} clinicId
 * @param {{id:string, role:string}|undefined} requester
 */
async function getVisibleClinicOrThrow(clinicId, requester) {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: CLINIC_DETAIL_SELECT });
  if (!clinic) {
    throw new ApiError(404, 'CLINIC_NOT_FOUND', 'Clinic not found.');
  }

  const isAssignedDoctor = !!requester && clinic.doctorClinics.some((dc) => dc.doctorUserId === requester.id);

  if (clinic.approvalStatus !== 'active' && !isAdmin(requester) && !isAssignedDoctor) {
    throw new ApiError(404, 'CLINIC_NOT_FOUND', 'Clinic not found.');
  }

  return clinic;
}

async function assertCityAndAreaValid(cityId, areaId) {
  // Guard against a falsy cityId (e.g. an explicit `null` slipping through — express-validator's
  // `optional()` only gates validation ERRORS, it doesn't strip the field from req.body) before
  // it ever reaches Prisma: `findUnique({ where: { id: null } })` throws a raw Prisma client
  // validation error, not a clean ApiError. cityId is required-in-practice for every clinic
  // even though the column itself is nullable in the schema.
  if (!cityId) {
    throw new ApiError(400, 'CITY_NOT_FOUND', 'City not found.');
  }

  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true } });
  if (!city) {
    throw new ApiError(404, 'CITY_NOT_FOUND', 'City not found.');
  }
  if (areaId) {
    const area = await prisma.area.findUnique({ where: { id: areaId }, select: { cityId: true } });
    if (!area || area.cityId !== cityId) {
      throw new ApiError(400, 'AREA_CITY_MISMATCH', 'The selected area does not belong to the selected city.');
    }
  }
}

// ── A. Clinic CRUD + approval ───────────────────────────────────────────

/**
 * @param {object} input
 * @param {{id:string, role:string}} actor
 */
async function createClinic(input, actor) {
  const { name, phone, address, cityId, areaId, emergencyAvailable, paymentCashEnabled, paymentUpiEnabled, paymentUpiId, paymentQrUrl } =
    input;

  await assertCityAndAreaValid(cityId, areaId);

  // Clinics created by a doctor start pending real admin review; admin/superadmin-created
  // clinics go straight to active. This is the from-scratch fix for "clinics created via the
  // doctor's Clinic settings page go straight into active; no pending-review path was wired."
  const approvalStatus = actor.role === 'doctor' ? 'pending' : 'active';

  const clinic = await prisma.$transaction(async (tx) => {
    // Drawn once, right before the insert that stores it — same posture as
    // auth.service.js#register's nextPatientNumber call (see its comment for the sequence's
    // non-transactional-gap note, which applies identically here).
    const clinicNumber = await idGenerators.nextClinicNumber();

    const created = await tx.clinic.create({
      data: {
        name: name.trim(),
        phone: phone ? phone.trim() : null,
        address: address ? address.trim() : null,
        cityId,
        areaId: areaId || null,
        approvalStatus,
        emergencyAvailable: emergencyAvailable ?? false,
        paymentCashEnabled: paymentCashEnabled ?? true,
        paymentUpiEnabled: paymentUpiEnabled ?? false,
        paymentUpiId: paymentUpiId ? paymentUpiId.trim() : null,
        paymentQrUrl: paymentQrUrl || null,
        clinicNumber,
      },
      select: { id: true },
    });

    if (actor.role === 'doctor') {
      const existingClinicCount = await tx.doctorClinic.count({ where: { doctorUserId: actor.id } });
      await tx.doctorClinic.create({
        data: {
          doctorUserId: actor.id,
          clinicId: created.id,
          isOwner: true,
          isPrimary: existingClinicCount === 0,
          onlineBooking: true,
        },
      });
    }

    return created;
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.create',
    targetEntityType: 'clinic',
    targetEntityId: clinic.id,
    description: `Created clinic (approvalStatus=${approvalStatus})`,
  });

  await invalidateClinicCaches(clinic.id);

  return getVisibleClinicOrThrow(clinic.id, actor).then(shapeClinicDetail);
}

/**
 * @param {object} query
 * @param {{id:string, role:string}|undefined} requester
 */
async function listClinics({ city, area, search, emergencyAvailable, approvalStatus, mine, page, pageSize }, requester) {
  const wantsMine = mine === true && !!requester && requester.role === 'doctor';
  // Output is role-invariant EXCEPT for the `mine` branch (a doctor's own, all-statuses view)
  // and the admin branch (sees every status by default) — both must be scoped to the actor.
  const scope = wantsMine ? `mine:${requester.id}` : isAdmin(requester) ? 'admin' : 'public';
  const cacheKey = `cache:clinics:list:${scope}:${city || ''}:${area || ''}:${search || ''}:${
    emergencyAvailable ?? ''
  }:${approvalStatus || ''}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    let statusWhere;
    if (wantsMine) {
      // A doctor viewing their own clinics sees every status, not just active.
      statusWhere = {};
    } else if (isAdmin(requester)) {
      // Admin default (no approvalStatus given) sees every status; an explicit filter narrows it.
      statusWhere = approvalStatus ? { approvalStatus } : {};
    } else {
      // Public/patient/non-owning-doctor default: pending/disabled clinics are never listed.
      // Any approvalStatus query param from a non-admin caller is silently ignored.
      statusWhere = { approvalStatus: 'active' };
    }

    const where = {
      ...statusWhere,
      ...(city ? { cityId: city } : {}),
      ...(area ? { areaId: area } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(typeof emergencyAvailable === 'boolean' ? { emergencyAvailable } : {}),
      ...(wantsMine ? { doctorClinics: { some: { doctorUserId: requester.id } } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.clinic.findMany({ where, select: CLINIC_LIST_SELECT, orderBy: { name: 'asc' }, skip, take }),
      prisma.clinic.count({ where }),
    ]);

    return { rows: rows.map(shapeClinicListItem), pagination: buildPaginationMeta({ page: p, pageSize: ps, total }) };
  });
}

/**
 * SECURITY: only an `active` clinic's shape is safe to cache keyed by id alone — an active
 * clinic is visible to every requester (including anonymous) with an identical shape, so there
 * is nothing requester-specific that could leak. A non-active (pending/disabled) clinic is
 * gated by getVisibleClinicOrThrow to admins and assigned doctors only; that gate MUST be
 * re-evaluated on every single request for such a clinic, so its result is NEVER written to
 * cache — otherwise the first authorized caller's fetch (e.g. the owning doctor viewing their
 * own pending clinic, or an admin reviewing it) would get cached and served verbatim to any
 * later caller, including an anonymous one, bypassing the visibility check entirely. This is
 * the same public/private split doctors.service.js#getDoctorById makes, just drawn differently:
 * there the "private" shape is cached per-requester (self/admin bucket); here it is simply left
 * uncached, since a gated clinic detail page is low-traffic enough that per-requester caching
 * isn't worth the added complexity.
 * @param {string} id
 * @param {{id:string, role:string}|undefined} requester
 */
async function getClinicById(id, requester) {
  const publicCacheKey = `cache:clinics:detail:${id}:public`;
  const publicShape = await cacheService.getOrSet(publicCacheKey, DETAIL_CACHE_TTL_SECONDS, async () => {
    const clinic = await prisma.clinic.findUnique({ where: { id }, select: CLINIC_DETAIL_SELECT });
    // Sentinel `null`: missing or non-active clinics are never cached, only "this id is
    // currently a publicly-visible active clinic, and here is its shape" is.
    return clinic && clinic.approvalStatus === 'active' ? shapeClinicDetail(clinic) : null;
  });
  if (publicShape) return publicShape;

  // Not publicly cacheable (missing, pending, or disabled) — always re-run the full
  // visibility-gated fetch, uncached, so admin/assigned-doctor-only access is checked fresh.
  const clinic = await getVisibleClinicOrThrow(id, requester);
  return shapeClinicDetail(clinic);
}

/**
 * @param {string} id
 * @param {object} body - already shape-validated
 * @param {{id:string, role:string}} actor
 */
async function updateClinic(id, body, actor) {
  // Visibility before ownership: getVisibleClinicOrThrow 404s a caller with zero relation to
  // this clinic (not admin, not assigned, clinic not active) exactly the way a plain
  // GET /clinics/:id would. Checking "does the clinic exist" with a lighter, visibility-blind
  // query first (as this used to) let an unrelated doctor tell a real-but-invisible clinic
  // (403 FORBIDDEN from assertIsClinicOwner) apart from a nonexistent one (404) — an existence
  // oracle this same clinic would never leak through its own GET endpoint.
  const existing = await getVisibleClinicOrThrow(id, actor);

  await assertIsClinicOwner(id, actor);

  // approvalStatus/rejectionReason are never accepted here — only via /approve and /reject.
  // This is the explicit fix that prevents an owning doctor from self-approving their own
  // clinic by PATCHing the status field directly.
  const updates = pickPresentFields(
    body,
    ['name', 'phone', 'address', 'cityId', 'areaId', 'emergencyAvailable', 'paymentCashEnabled', 'paymentUpiEnabled', 'paymentUpiId', 'paymentQrUrl'],
    CLINIC_UPDATE_NON_NULLABLE
  );

  const effectiveCityId = 'cityId' in updates ? updates.cityId : existing.city && existing.city.id;
  if ('cityId' in updates || 'areaId' in updates) {
    await assertCityAndAreaValid(effectiveCityId, updates.areaId ?? undefined);
  }

  if ('name' in updates) updates.name = String(updates.name).trim();
  if ('phone' in updates) updates.phone = updates.phone ? String(updates.phone).trim() : null;
  if ('address' in updates) updates.address = updates.address ? String(updates.address).trim() : null;
  if ('paymentUpiId' in updates) updates.paymentUpiId = updates.paymentUpiId ? String(updates.paymentUpiId).trim() : null;

  if (Object.keys(updates).length > 0) {
    await prisma.clinic.update({ where: { id }, data: updates });

    await activityLogService.log({
      actorUserId: actor.id,
      actorRole: actor.role,
      actionType: 'clinic.update',
      targetEntityType: 'clinic',
      targetEntityId: id,
      description: `Updated clinic fields: ${Object.keys(updates).join(', ')}`,
    });

    await invalidateClinicCaches(id);
  }

  return getClinicById(id, actor);
}

/**
 * Admin/superadmin only. Doubles as "re-enable a previously disabled clinic" — one action for
 * both. Idempotent.
 * @param {string} id
 * @param {{id:string, role:string}} actor
 */
async function approveClinic(id, actor) {
  const existing = await prisma.clinic.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, 'CLINIC_NOT_FOUND', 'Clinic not found.');
  }

  await prisma.clinic.update({ where: { id }, data: { approvalStatus: 'active', rejectionReason: null } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.approve',
    targetEntityType: 'clinic',
    targetEntityId: id,
    description: 'Approved clinic',
  });

  await invalidateClinicCaches(id);

  return getClinicById(id, actor);
}

/**
 * Admin/superadmin only. Deliberately merges "reject a pending clinic" and "disable an
 * already-active clinic" into one action/meaning — disabled always carries a reason,
 * whichever path led there.
 * @param {string} id
 * @param {string} rejectionReason
 * @param {{id:string, role:string}} actor
 */
async function rejectClinic(id, rejectionReason, actor) {
  const existing = await prisma.clinic.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, 'CLINIC_NOT_FOUND', 'Clinic not found.');
  }

  await prisma.clinic.update({
    where: { id },
    data: { approvalStatus: 'disabled', rejectionReason: rejectionReason.trim() },
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.reject',
    targetEntityType: 'clinic',
    targetEntityId: id,
    description: `Disabled clinic: ${rejectionReason.trim()}`,
  });

  await invalidateClinicCaches(id);

  return getClinicById(id, actor);
}

// ── B. doctor_clinics assignment ────────────────────────────────────────

function shapeAssignment(row) {
  return {
    doctorUserId: row.doctorUserId,
    clinicId: row.clinicId,
    isOwner: row.isOwner,
    isPrimary: row.isPrimary,
    onlineBooking: row.onlineBooking,
  };
}

/**
 * @param {string} clinicId
 * @param {object} body
 * @param {{id:string, role:string}} actor
 */
async function assignDoctorToClinic(clinicId, body, actor) {
  const { doctorUserId } = body;
  // Destructuring defaults (`isOwner = false`) only apply to `undefined`, NOT to an explicit
  // JSON `null` — so pickPresentFields is used here instead, with ASSIGNMENT_NON_NULLABLE
  // throwing a clean 422 on `null` rather than letting it survive into the Prisma create below
  // and crash with an unhandled PrismaClientValidationError (isOwner/isPrimary/onlineBooking
  // are all NOT NULL columns). Fields absent from the body still fall back to their defaults.
  const flags = pickPresentFields(body, ['isOwner', 'isPrimary', 'onlineBooking'], ASSIGNMENT_NON_NULLABLE);
  const isOwner = 'isOwner' in flags ? flags.isOwner : false;
  const isPrimary = 'isPrimary' in flags ? flags.isPrimary : false;
  const onlineBooking = 'onlineBooking' in flags ? flags.onlineBooking : true;

  // Visibility before ownership — see the comment on the same pattern in updateClinic. A
  // caller with zero relation to this clinic gets 404, matching what GET /clinics/:id would
  // tell them, instead of a 403 from assertIsClinicOwner that confirms the clinic exists.
  await getVisibleClinicOrThrow(clinicId, actor);

  await assertIsClinicOwner(clinicId, actor);

  const targetDoctor = await prisma.user.findUnique({
    where: { id: doctorUserId },
    select: { id: true, role: true, doctorProfile: { select: { status: true } } },
  });
  if (!targetDoctor || targetDoctor.role !== 'doctor') {
    throw new ApiError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
  }
  if (!targetDoctor.doctorProfile || targetDoctor.doctorProfile.status !== 'verified') {
    throw new ApiError(400, 'DOCTOR_NOT_VERIFIED', 'Only a verified doctor can be assigned to a clinic.');
  }

  const existingAssignment = await prisma.doctorClinic.findUnique({
    where: { doctorUserId_clinicId: { doctorUserId, clinicId } },
    select: { doctorUserId: true },
  });
  if (existingAssignment) {
    throw new ApiError(409, 'ALREADY_ASSIGNED', 'This doctor is already assigned to this clinic.');
  }

  const created = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      // isPrimary is exclusive per clinic (at most one true row); isOwner is not (co-ownership
      // is allowed — no schema constraint forbids it, and nothing in the docs says otherwise).
      await tx.doctorClinic.updateMany({ where: { clinicId, isPrimary: true }, data: { isPrimary: false } });
    }
    return tx.doctorClinic.create({
      data: { doctorUserId, clinicId, isOwner, isPrimary, onlineBooking },
    });
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.doctor_assign',
    targetEntityType: 'clinic',
    targetEntityId: clinicId,
    description: `Assigned doctor ${doctorUserId} to clinic (isOwner=${isOwner}, isPrimary=${isPrimary})`,
  });

  await invalidateClinicCaches(clinicId, doctorUserId);

  return shapeAssignment(created);
}

/**
 * @param {string} clinicId
 * @param {string} doctorUserId
 * @param {object} body
 * @param {{id:string, role:string}} actor
 */
async function updateDoctorAssignment(clinicId, doctorUserId, body, actor) {
  // Visibility before ownership, and before even looking up the specific assignment — see the
  // comment on the same pattern in updateClinic. Otherwise a caller who can't see this clinic
  // at all could tell "this clinic+assignment exists" (403 from assertIsClinicOwner) apart from
  // "it doesn't" (404 ASSIGNMENT_NOT_FOUND), an oracle GET /clinics/:id would never give them.
  await getVisibleClinicOrThrow(clinicId, actor);

  const existing = await prisma.doctorClinic.findUnique({
    where: { doctorUserId_clinicId: { doctorUserId, clinicId } },
  });
  if (!existing) {
    throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'This doctor is not assigned to this clinic.');
  }

  await assertIsClinicOwner(clinicId, actor);

  const updates = pickPresentFields(body, ['isOwner', 'isPrimary', 'onlineBooking'], ASSIGNMENT_NON_NULLABLE);

  if ('isOwner' in updates && updates.isOwner === false && existing.isOwner === true) {
    const otherOwners = await prisma.doctorClinic.count({
      where: { clinicId, isOwner: true, doctorUserId: { not: doctorUserId } },
    });
    if (otherOwners === 0 && !isAdmin(actor)) {
      throw new ApiError(409, 'CLINIC_MUST_HAVE_OWNER', 'A clinic must always have at least one owner.');
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (updates.isPrimary === true) {
      await tx.doctorClinic.updateMany({
        where: { clinicId, isPrimary: true, doctorUserId: { not: doctorUserId } },
        data: { isPrimary: false },
      });
    }
    return tx.doctorClinic.update({
      where: { doctorUserId_clinicId: { doctorUserId, clinicId } },
      data: updates,
    });
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.doctor_assignment_update',
    targetEntityType: 'clinic',
    targetEntityId: clinicId,
    description: `Updated assignment flags for doctor ${doctorUserId}: ${Object.keys(updates).join(', ')}`,
  });

  await invalidateClinicCaches(clinicId, doctorUserId);

  return shapeAssignment(updated);
}

/**
 * @param {string} clinicId
 * @param {string} doctorUserId
 * @param {{id:string, role:string}} actor
 */
async function removeDoctorAssignment(clinicId, doctorUserId, actor) {
  // Visibility before ownership, and before even looking up the specific assignment — see the
  // comment on the same pattern in updateClinic/updateDoctorAssignment.
  await getVisibleClinicOrThrow(clinicId, actor);

  const existing = await prisma.doctorClinic.findUnique({
    where: { doctorUserId_clinicId: { doctorUserId, clinicId } },
  });
  if (!existing) {
    throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'This doctor is not assigned to this clinic.');
  }

  await assertIsClinicOwner(clinicId, actor);

  if (existing.isOwner) {
    const otherOwners = await prisma.doctorClinic.count({
      where: { clinicId, isOwner: true, doctorUserId: { not: doctorUserId } },
    });
    if (otherOwners === 0 && !isAdmin(actor)) {
      throw new ApiError(409, 'CLINIC_MUST_HAVE_OWNER', 'A clinic must always have at least one owner.');
    }
  }

  await prisma.$transaction(async (tx) => {
    // No onDelete cascade is wired for this relationship — deleting the assignment without
    // also clearing schedule data would leave orphaned hours/closures referencing a severed
    // doctor-clinic pairing.
    await tx.doctorClinicHours.deleteMany({ where: { doctorUserId, clinicId } });
    await tx.doctorClinicClosure.deleteMany({ where: { doctorUserId, clinicId } });
    await tx.doctorClinic.delete({ where: { doctorUserId_clinicId: { doctorUserId, clinicId } } });
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.doctor_unassign',
    targetEntityType: 'clinic',
    targetEntityId: clinicId,
    description: `Unassigned doctor ${doctorUserId} from clinic`,
  });

  await invalidateClinicCaches(clinicId, doctorUserId);
}

// ── C. doctor_clinic_hours ──────────────────────────────────────────────

function shapeHours(row) {
  return {
    id: row.id,
    doctorUserId: row.doctorUserId,
    clinicId: row.clinicId,
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    slotMinutes: row.slotMinutes,
    status: row.status,
  };
}

/**
 * Resolves which doctor a hours/closure write applies to: a doctor caller always uses their
 * own id (the request body is never trusted for this); an admin/superadmin caller must supply
 * doctorUserId explicitly.
 * @param {object} body
 * @param {{id:string, role:string}} actor
 */
function resolveTargetDoctorId(body, actor) {
  if (actor.role === 'doctor') return actor.id;
  if (!body.doctorUserId) {
    throw new ApiError(400, 'DOCTOR_USER_ID_REQUIRED', 'doctorUserId is required for an admin-initiated request.');
  }
  return body.doctorUserId;
}

async function assertAssignedToClinic(doctorUserId, clinicId) {
  const assignment = await prisma.doctorClinic.findUnique({
    where: { doctorUserId_clinicId: { doctorUserId, clinicId } },
    select: { doctorUserId: true },
  });
  if (!assignment) {
    throw new ApiError(404, 'NOT_ASSIGNED_TO_CLINIC', 'This doctor is not assigned to this clinic.');
  }
}

/**
 * Real upsert-by-(doctor,clinic,weekday), backed by the schema's
 * @@unique([doctorUserId, clinicId, weekday]) constraint.
 * @param {string} clinicId
 * @param {object} body
 * @param {{id:string, role:string}} actor
 */
async function upsertHours(clinicId, body, actor) {
  const doctorUserId = resolveTargetDoctorId(body, actor);
  await assertAssignedToClinic(doctorUserId, clinicId);

  const { weekday, startTime, endTime, slotMinutes = 15, status = 'active' } = body;

  if (startTime >= endTime) {
    throw new ApiError(400, 'INVALID_TIME_RANGE', 'startTime must be earlier than endTime.');
  }

  const row = await prisma.doctorClinicHours.upsert({
    where: { doctorUserId_clinicId_weekday: { doctorUserId, clinicId, weekday } },
    update: { startTime, endTime, slotMinutes, status },
    create: { doctorUserId, clinicId, weekday, startTime, endTime, slotMinutes, status },
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.hours_upsert',
    targetEntityType: 'clinic',
    targetEntityId: clinicId,
    description: `Set OPD hours for doctor ${doctorUserId}, weekday ${weekday}`,
  });

  // FIX (cache-invalidation audit): doctorClinicHours rows feed buildSchedule()'s
  // schedule/scheduleSummary fields in doctors.service.js#shapeDoctor, cached inside both
  // listDoctors and getDoctorById (60s TTL) — every OTHER write to clinic/doctor-clinic state in
  // this file (assignDoctorToClinic, updateDoctorAssignment, removeDoctorAssignment,
  // updateClinic, approveClinic, rejectClinic) already calls invalidateClinicCaches, but this one
  // didn't. Without this, a doctor changing their weekly OPD hours keeps showing the stale
  // schedule to patients for up to 60s.
  await invalidateClinicCaches(clinicId, doctorUserId);

  return shapeHours(row);
}

/**
 * @param {string} clinicId
 * @param {object} query
 * @param {{id:string, role:string}|undefined} requester
 */
async function listHours(clinicId, { doctorId, page, pageSize }, requester) {
  await getVisibleClinicOrThrow(clinicId, requester);

  const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });
  const where = { clinicId, ...(doctorId ? { doctorUserId: doctorId } : {}) };

  const [rows, total] = await Promise.all([
    prisma.doctorClinicHours.findMany({ where, orderBy: [{ doctorUserId: 'asc' }, { weekday: 'asc' }], skip, take }),
    prisma.doctorClinicHours.count({ where }),
  ]);

  return { rows: rows.map(shapeHours), pagination: buildPaginationMeta({ page: p, pageSize: ps, total }) };
}

/**
 * @param {string} clinicId
 * @param {string} hoursId
 * @param {{id:string, role:string}} actor
 */
async function deleteHoursRow(clinicId, hoursId, actor) {
  const row = await prisma.doctorClinicHours.findUnique({ where: { id: hoursId } });
  if (!row || row.clinicId !== clinicId) {
    throw new ApiError(404, 'HOURS_NOT_FOUND', 'OPD hours entry not found.');
  }

  if (actor.role === 'doctor' && row.doctorUserId !== actor.id) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only manage your own OPD hours.');
  }

  await prisma.doctorClinicHours.delete({ where: { id: hoursId } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.hours_delete',
    targetEntityType: 'clinic',
    targetEntityId: clinicId,
    description: `Deleted OPD hours entry ${hoursId}`,
  });

  // Same reasoning as upsertHours above — deleting an hours row changes this doctor's schedule
  // just as much as adding/editing one does.
  await invalidateClinicCaches(clinicId, row.doctorUserId);
}

// ── D. doctor_clinic_closures ───────────────────────────────────────────

function shapeClosure(row) {
  return {
    id: row.id,
    doctorUserId: row.doctorUserId,
    clinicId: row.clinicId,
    closedDate: row.closedDate,
    reason: row.reason,
  };
}

/**
 * No unique constraint exists in the schema for (doctorUserId, clinicId, closedDate), so a
 * true DB-level upsert isn't available — implemented as findFirst-then-create/update inside a
 * transaction, treated as an upsert-by-that-triple to avoid silent duplicate closure rows.
 * This narrows, but does not fully eliminate, a race between two concurrent identical requests
 * (no partial unique index backs it, unlike the appointments slot guard).
 * @param {string} clinicId
 * @param {object} body
 * @param {{id:string, role:string}} actor
 */
async function upsertClosure(clinicId, body, actor) {
  const doctorUserId = resolveTargetDoctorId(body, actor);
  await assertAssignedToClinic(doctorUserId, clinicId);

  const { closedDate, reason } = body;

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.doctorClinicClosure.findFirst({
      where: { doctorUserId, clinicId, closedDate },
    });
    if (existing) {
      return tx.doctorClinicClosure.update({
        where: { id: existing.id },
        data: { reason: reason ? reason.trim() : null },
      });
    }
    return tx.doctorClinicClosure.create({
      data: { doctorUserId, clinicId, closedDate, reason: reason ? reason.trim() : null },
    });
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.closure_upsert',
    targetEntityType: 'clinic',
    targetEntityId: clinicId,
    description: `Set closure for doctor ${doctorUserId} on ${closedDate.toISOString().slice(0, 10)}`,
  });

  return shapeClosure(row);
}

/**
 * @param {string} clinicId
 * @param {object} query
 * @param {{id:string, role:string}|undefined} requester
 */
async function listClosures(clinicId, { doctorId, from, to, page, pageSize }, requester) {
  await getVisibleClinicOrThrow(clinicId, requester);

  const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });
  const where = {
    clinicId,
    ...(doctorId ? { doctorUserId: doctorId } : {}),
    ...(from || to
      ? { closedDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.doctorClinicClosure.findMany({ where, orderBy: { closedDate: 'asc' }, skip, take }),
    prisma.doctorClinicClosure.count({ where }),
  ]);

  return { rows: rows.map(shapeClosure), pagination: buildPaginationMeta({ page: p, pageSize: ps, total }) };
}

/**
 * @param {string} clinicId
 * @param {string} closureId
 * @param {{id:string, role:string}} actor
 */
async function deleteClosureRow(clinicId, closureId, actor) {
  const row = await prisma.doctorClinicClosure.findUnique({ where: { id: closureId } });
  if (!row || row.clinicId !== clinicId) {
    throw new ApiError(404, 'CLOSURE_NOT_FOUND', 'Closure entry not found.');
  }

  if (actor.role === 'doctor' && row.doctorUserId !== actor.id) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only manage your own closures.');
  }

  await prisma.doctorClinicClosure.delete({ where: { id: closureId } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'clinic.closure_delete',
    targetEntityType: 'clinic',
    targetEntityId: clinicId,
    description: `Deleted closure entry ${closureId}`,
  });
}

module.exports = {
  createClinic,
  listClinics,
  getClinicById,
  updateClinic,
  approveClinic,
  rejectClinic,
  assignDoctorToClinic,
  updateDoctorAssignment,
  removeDoctorAssignment,
  upsertHours,
  listHours,
  deleteHoursRow,
  upsertClosure,
  listClosures,
  deleteClosureRow,
};
