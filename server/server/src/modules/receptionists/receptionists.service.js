/**
 * Business logic for the receptionists module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules,
 * and all Prisma/DB calls for this module live. Controllers call these functions; these
 * functions never touch req/res directly.
 *
 * Clinic scoping note: receptionist_profiles.clinicId is an ADDITIVE field added in this phase
 * (see the comment on ReceptionistProfile in prisma/schema.prisma for full rationale) — the
 * original schema had no queryable way to record which clinic a receptionist belongs to at
 * all, which would have made "tied to a specific clinic" (an explicit requirement of this
 * module) unimplementable without either corrupting the doctor_clinics table's semantics or
 * relying on activity_log as a fake source of truth. Flagged prominently here and in this
 * phase's summary for review.
 */
const bcrypt = require('bcrypt');
const prisma = require('../../config/db');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { ADMIN_ROLES } = require('../../utils/roles');

const LIST_CACHE_TTL_SECONDS = 60;

const RECEPTIONIST_SELECT = {
  id: true,
  role: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  receptionistProfile: {
    select: {
      clinicId: true,
      since: true,
      clinic: { select: { id: true, name: true } },
    },
  },
};

function isAdmin(actor) {
  return !!actor && ADMIN_ROLES.includes(actor.role);
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function shape(row) {
  const rp = row.receptionistProfile;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    createdAt: row.createdAt,
    clinicId: rp ? rp.clinicId : null,
    clinicName: rp && rp.clinic ? rp.clinic.name : null,
    since: rp ? rp.since : null,
  };
}

/**
 * Enforces "clinic exists, is active, and the caller is an owning doctor there (or admin)" —
 * the combined precondition for creating a receptionist at a clinic, or reassigning one to a
 * new clinic. Returns the clinic row on success.
 * @param {string} clinicId
 * @param {{id:string, role:string}} actor
 */
async function assertClinicUsableForReceptionist(clinicId, actor) {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, approvalStatus: true },
  });
  if (!clinic) {
    throw new ApiError(404, 'CLINIC_NOT_FOUND', 'Clinic not found.');
  }
  if (clinic.approvalStatus !== 'active') {
    throw new ApiError(400, 'CLINIC_NOT_ACTIVE', 'The selected clinic is not active.');
  }
  await assertOwnsClinic(clinicId, actor);
  return clinic;
}

/**
 * Lighter check used on an already-assigned clinic (e.g. editing a receptionist's name without
 * reassigning them) — ownership only, no active-status requirement, since a clinic later going
 * inactive shouldn't block fixing a typo in a receptionist's phone number.
 * @param {string} clinicId
 * @param {{id:string, role:string}} actor
 */
async function assertOwnsClinic(clinicId, actor) {
  if (isAdmin(actor)) return;
  const link = await prisma.doctorClinic.findUnique({
    where: { doctorUserId_clinicId: { doctorUserId: actor.id, clinicId } },
    select: { isOwner: true },
  });
  if (!link || !link.isOwner) {
    throw new ApiError(403, 'FORBIDDEN', 'You must be an owner of this clinic to manage its receptionists.');
  }
}

/**
 * Admin/doctor-provisioned receptionist account. Creates User + ReceptionistProfile in one
 * transaction (mirrors auth.service.js#register's shape). No token pair is issued — the
 * caller is provisioning an account for someone else, not logging them in.
 * @param {object} input
 * @param {{id:string, role:string}} actor
 */
async function createReceptionist(input, actor) {
  const { name, email, password, phone, clinicId } = input;
  const normalizedEmail = normalizeEmail(email);

  const clinic = await assertClinicUsableForReceptionist(clinicId, actor);

  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
  if (existingUser) {
    throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'receptionist',
          phone: phone ? phone.trim() : null,
          status: 'active',
        },
        select: { id: true },
      });

      await tx.receptionistProfile.create({
        data: { userId: user.id, clinicId, since: new Date() },
      });

      return user;
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    throw err;
  }

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'receptionist.create_account',
    targetEntityType: 'receptionist',
    targetEntityId: created.id,
    description: `Created receptionist account for clinic "${clinic.name}"`,
  });

  // Ownership here is doctor-linked-clinics, which is cheap enough to just bust every cached
  // page rather than compute exactly which doctors' scopes are affected.
  await cacheService.invalidate('cache:receptionists:list:*');

  return getReceptionistById(created.id, actor);
}

/**
 * Doctor callers see only receptionists at clinics they're linked to (any assignment, not
 * owner-only — read is lower-risk than the create/edit privilege); admin sees every
 * receptionist platform-wide. `clinicId` narrows further within whatever the caller is
 * already allowed to see.
 * @param {{clinicId?:string, page?:number, pageSize?:number}} query
 * @param {{id:string, role:string}} actor
 */
async function listReceptionists({ clinicId, page, pageSize }, actor) {
  // Ownership-scoped output (a doctor only sees receptionists at clinics they're linked to) ->
  // key MUST include the actor's scope, not just query params.
  const scope = isAdmin(actor) ? 'admin' : `doctor:${actor.id}`;
  const cacheKey = `cache:receptionists:list:${scope}:${clinicId || ''}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    let allowedClinicIds; // undefined = no restriction (admin)
    if (!isAdmin(actor)) {
      const links = await prisma.doctorClinic.findMany({
        where: { doctorUserId: actor.id },
        select: { clinicId: true },
      });
      allowedClinicIds = links.map((l) => l.clinicId);
    }

    let effectiveClinicIds = allowedClinicIds;
    if (clinicId) {
      if (allowedClinicIds) {
        effectiveClinicIds = allowedClinicIds.includes(clinicId) ? [clinicId] : [];
      } else {
        effectiveClinicIds = [clinicId];
      }
    }

    if (effectiveClinicIds && effectiveClinicIds.length === 0) {
      return { rows: [], pagination: buildPaginationMeta({ page: p, pageSize: ps, total: 0 }) };
    }

    const where = {
      role: 'receptionist',
      ...(effectiveClinicIds ? { receptionistProfile: { clinicId: { in: effectiveClinicIds } } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, select: RECEPTIONIST_SELECT, orderBy: { name: 'asc' }, skip, take }),
      prisma.user.count({ where }),
    ]);

    return { rows: rows.map(shape), pagination: buildPaginationMeta({ page: p, pageSize: ps, total }) };
  });
}

/**
 * 404s (not 403) when the caller can't see this receptionist — same "don't leak existence"
 * posture as familyMembers.
 * @param {string} id
 * @param {{id:string, role:string}} actor
 */
async function getReceptionistById(id, actor) {
  const row = await prisma.user.findUnique({ where: { id }, select: RECEPTIONIST_SELECT });
  if (!row || row.role !== 'receptionist') {
    throw new ApiError(404, 'RECEPTIONIST_NOT_FOUND', 'Receptionist not found.');
  }

  if (!isAdmin(actor)) {
    const clinicId = row.receptionistProfile ? row.receptionistProfile.clinicId : null;
    const visible =
      clinicId &&
      (await prisma.doctorClinic.findUnique({
        where: { doctorUserId_clinicId: { doctorUserId: actor.id, clinicId } },
        select: { doctorUserId: true },
      }));
    if (!visible) {
      throw new ApiError(404, 'RECEPTIONIST_NOT_FOUND', 'Receptionist not found.');
    }
  }

  return shape(row);
}

// updateReceptionist/updateReceptionistStatus removed (mobile parity audit round 2 — user
// request: "backend hai but website me nahi hai to hata do app se backend v oo hata do"): neither
// was ever reachable from any web page (DoctorStaff and admin's ManageReceptionists only ever
// create + list), and their own client-side store actions were dead code. See
// receptionists.routes.js's comment for the full rationale.

module.exports = {
  createReceptionist,
  listReceptionists,
  getReceptionistById,
};
