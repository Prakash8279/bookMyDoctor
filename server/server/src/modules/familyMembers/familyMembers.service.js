/**
 * Business logic for the familyMembers module.
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

// COMPLETENESS FIX (audit Priority 4 — "familyMembers list isn't cached like every sibling
// module"): every other list-returning module (medicalRecords, doctors, admin, etc.) wraps its
// list read in cacheService.getOrSet; this one was the one exception, hitting Postgres on every
// single call. Same 60s TTL as this module's closest siblings.
const LIST_CACHE_TTL_SECONDS = 60;

/**
 * Busts this patient's cached family-member list. Simpler than medicalRecords' invalidation
 * helper (which busts multiple scopes — doctor/patient/admin) because this module
 * has exactly one scope: every route is authorize('patient') acting on their own rows only (see
 * familyMembers.routes.js's header comment), so there is no doctor/admin cache bucket to bust.
 * @param {string} patientUserId
 */
async function invalidateFamilyMemberListCache(patientUserId) {
  await cacheService.invalidate(`cache:familyMembers:list:${patientUserId}:*`);
}

// name/relation are NOT NULL columns on family_members — an explicit `null` here must be
// rejected, not forwarded into a Prisma update. The validation layer (familyMembers.validation
// .js's update chain) already rejects it too; this is the second, defense-in-depth layer.
const FAMILY_MEMBER_UPDATE_NON_NULLABLE = ['name', 'relation'];

const SELECT = {
  id: true,
  patientUserId: true,
  name: true,
  relation: true,
  dateOfBirth: true,
  gender: true,
  bloodGroup: true,
};

/**
 * Computed on every read, never stored — fixes the "computed once at save time, goes stale"
 * bug. Returns null when there's no date of birth on file.
 * @param {Date|null} dateOfBirth
 */
function computeAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function shape(row) {
  const { patientUserId, ...rest } = row;
  return { ...rest, age: computeAge(row.dateOfBirth) };
}

/**
 * @param {string} patientUserId - always req.user.id, never from the request body/params.
 * @param {{page?:number, pageSize?:number}} query
 */
async function listFamilyMembers(patientUserId, { page, pageSize }) {
  // Single-scope key (always this caller's own rows — see this module's header comment), unlike
  // medicalRecords' list cache which also keys by role since those rows are visible to more than
  // one caller per row.
  const cacheKey = `cache:familyMembers:list:${patientUserId}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });
    const where = { patientUserId };

    const [rows, total] = await Promise.all([
      prisma.familyMember.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, skip, take }),
      prisma.familyMember.count({ where }),
    ]);

    return { rows: rows.map(shape), pagination: buildPaginationMeta({ page: p, pageSize: ps, total }) };
  });
}

/**
 * A mismatch between the record's owner and the caller returns 404, not 403 — deliberately
 * not distinguishing "doesn't exist" from "not yours", to avoid ID-enumeration leaking which
 * family-member ids belong to other patients.
 * @param {string} id
 * @param {string} patientUserId
 */
async function getOwnedFamilyMemberOrThrow(id, patientUserId) {
  const row = await prisma.familyMember.findUnique({ where: { id }, select: SELECT });
  if (!row || row.patientUserId !== patientUserId) {
    throw new ApiError(404, 'FAMILY_MEMBER_NOT_FOUND', 'Family member not found.');
  }
  return row;
}

/**
 * @param {string} id
 * @param {string} patientUserId
 */
async function getFamilyMemberById(id, patientUserId) {
  const row = await getOwnedFamilyMemberOrThrow(id, patientUserId);
  return shape(row);
}

/**
 * @param {string} patientUserId
 * @param {object} input
 */
async function createFamilyMember(patientUserId, input) {
  const { name, relation, dateOfBirth, gender, bloodGroup } = input;

  const row = await prisma.familyMember.create({
    data: {
      patientUserId,
      name: name.trim(),
      relation: relation.trim(),
      dateOfBirth: dateOfBirth ?? null,
      gender: gender ? gender.trim() : null,
      bloodGroup: bloodGroup ? bloodGroup.trim() : null,
    },
    select: SELECT,
  });

  // Description deliberately doesn't echo the family member's name — a real person's
  // identifying data, not just a reference-data label — into the audit trail (same
  // field-names-only-never-PII-values posture activityLogService.log's own docstring and
  // me.service.js's profile-update logging already follow for personal records).
  await activityLogService.log({
    actorUserId: patientUserId,
    actorRole: 'patient',
    actionType: 'family_member.create',
    targetEntityType: 'family_member',
    targetEntityId: row.id,
    description: `Added family member (relation: ${row.relation})`,
  });

  await invalidateFamilyMemberListCache(patientUserId);

  return shape(row);
}

/**
 * @param {string} id
 * @param {string} patientUserId
 * @param {object} body - already shape-validated
 */
async function updateFamilyMember(id, patientUserId, body) {
  await getOwnedFamilyMemberOrThrow(id, patientUserId);

  const updates = pickPresentFields(
    body,
    ['name', 'relation', 'dateOfBirth', 'gender', 'bloodGroup'],
    FAMILY_MEMBER_UPDATE_NON_NULLABLE
  );
  if ('name' in updates) updates.name = String(updates.name).trim();
  if ('relation' in updates) updates.relation = String(updates.relation).trim();
  if ('gender' in updates) updates.gender = updates.gender ? String(updates.gender).trim() : null;
  if ('bloodGroup' in updates) updates.bloodGroup = updates.bloodGroup ? String(updates.bloodGroup).trim() : null;

  if (Object.keys(updates).length === 0) {
    return getFamilyMemberById(id, patientUserId);
  }

  const row = await prisma.familyMember.update({ where: { id }, data: updates, select: SELECT });

  await activityLogService.log({
    actorUserId: patientUserId,
    actorRole: 'patient',
    actionType: 'family_member.update',
    targetEntityType: 'family_member',
    targetEntityId: id,
    description: `Updated family member fields: ${Object.keys(updates).join(', ')}`,
  });

  await invalidateFamilyMemberListCache(patientUserId);

  return shape(row);
}

/**
 * @param {string} id
 * @param {string} patientUserId
 */
async function deleteFamilyMember(id, patientUserId) {
  const existing = await getOwnedFamilyMemberOrThrow(id, patientUserId);

  try {
    await prisma.familyMember.delete({ where: { id } });
  } catch (err) {
    // Appointment.familyMember declares onDelete: Restrict explicitly in schema.prisma (an
    // optional relation otherwise defaults to Prisma's own SetNull, not Postgres' bare-FK
    // default, which would let this delete silently succeed and null out the appointment
    // instead of blocking it) — a family member referenced by an existing appointment can't be
    // hard-deleted, and Postgres surfaces that as a foreign-key-violation, which Prisma reports
    // as error code P2003.
    if (err.code === 'P2003') {
      throw new ApiError(
        409,
        'FAMILY_MEMBER_HAS_APPOINTMENTS',
        'Cannot delete a family member with existing appointments.'
      );
    }
    throw err;
  }

  await activityLogService.log({
    actorUserId: patientUserId,
    actorRole: 'patient',
    actionType: 'family_member.delete',
    targetEntityType: 'family_member',
    targetEntityId: id,
    description: `Removed family member (relation: ${existing.relation})`,
  });

  await invalidateFamilyMemberListCache(patientUserId);
}

module.exports = { listFamilyMembers, getFamilyMemberById, createFamilyMember, updateFamilyMember, deleteFamilyMember };
