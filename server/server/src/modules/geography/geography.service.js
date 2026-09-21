/**
 * Business logic for the geography module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules,
 * and all Prisma/DB calls for this module live. Controllers call these functions; these
 * functions never touch req/res directly.
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

const LIST_CACHE_TTL_SECONDS = 60;

const CITY_SELECT = { id: true, name: true, state: true };
const AREA_SELECT = { id: true, name: true, pincode: true, cityId: true };
const SPECIALIZATION_SELECT = { id: true, name: true, icon: true, description: true };

// search filter removed (backend-cleanup audit — user request: "website frontend me nahi hai but
// backend bna hua hai to backend se hata do"): see geography.validation.js's comment — neither
// web nor mobile ever sends it.

/**
 * @param {{page?:number, pageSize?:number}} query
 */
async function listCities({ page, pageSize }) {
  const cacheKey = `cache:geography:cities:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const [rows, total] = await Promise.all([
      prisma.city.findMany({ select: CITY_SELECT, orderBy: { name: 'asc' }, skip, take }),
      prisma.city.count(),
    ]);

    return { rows, pagination: buildPaginationMeta({ page: p, pageSize: ps, total }) };
  });
}

/**
 * @param {{cityId?:string, page?:number, pageSize?:number}} query
 */
async function listAreas({ cityId, page, pageSize }) {
  const cacheKey = `cache:geography:areas:${cityId || ''}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = cityId ? { cityId } : {};

    const [rows, total] = await Promise.all([
      prisma.area.findMany({ where, select: AREA_SELECT, orderBy: { name: 'asc' }, skip, take }),
      prisma.area.count({ where }),
    ]);

    return { rows, pagination: buildPaginationMeta({ page: p, pageSize: ps, total }) };
  });
}

/**
 * @param {{page?:number, pageSize?:number}} query
 */
async function listSpecializations({ page, pageSize }) {
  const cacheKey = `cache:geography:specializations:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const [rows, total] = await Promise.all([
      prisma.specialization.findMany({ select: SPECIALIZATION_SELECT, orderBy: { name: 'asc' }, skip, take }),
      prisma.specialization.count(),
    ]);

    return { rows, pagination: buildPaginationMeta({ page: p, pageSize: ps, total }) };
  });
}

/**
 * @param {{name:string, state?:string}} input
 * @param {{id:string, role:string}} actor
 */
async function createCity({ name, state }, actor) {
  const trimmedName = name.trim();

  // No unique constraint on City.name in the schema, but duplicates would silently confuse
  // every downstream filter/dropdown — soft-guarded here with a case-insensitive pre-check.
  const existing = await prisma.city.findFirst({
    where: { name: { equals: trimmedName, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(409, 'CITY_ALREADY_EXISTS', 'A city with this name already exists.');
  }

  const city = await prisma.city.create({
    data: { name: trimmedName, state: state ? state.trim() : null },
    select: CITY_SELECT,
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'geography.city_create',
    targetEntityType: 'city',
    targetEntityId: city.id,
    description: `Created city "${city.name}"`,
  });

  await cacheService.invalidate('cache:geography:cities:*');

  return city;
}

/**
 * @param {string} cityId
 * @param {{name:string, pincode?:string}} input
 * @param {{id:string, role:string}} actor
 */
async function createArea(cityId, { name, pincode }, actor) {
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true } });
  if (!city) {
    throw new ApiError(404, 'CITY_NOT_FOUND', 'City not found.');
  }

  const trimmedName = name.trim();

  const existing = await prisma.area.findFirst({
    where: { cityId, name: { equals: trimmedName, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(409, 'AREA_ALREADY_EXISTS', 'An area with this name already exists in this city.');
  }

  const area = await prisma.area.create({
    data: { cityId, name: trimmedName, pincode: pincode ? pincode.trim() : null },
    select: AREA_SELECT,
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'geography.area_create',
    targetEntityType: 'area',
    targetEntityId: area.id,
    description: `Created area "${area.name}" in city ${cityId}`,
  });

  await cacheService.invalidate('cache:geography:areas:*');

  return area;
}

/**
 * @param {{name:string, icon?:string, description?:string}} input
 * @param {{id:string, role:string}} actor
 */
async function createSpecialization({ name, icon, description }, actor) {
  const trimmedName = name.trim();

  let specialization;
  try {
    specialization = await prisma.specialization.create({
      data: {
        name: trimmedName,
        icon: icon ? icon.trim() : null,
        description: description ? description.trim() : null,
      },
      select: SPECIALIZATION_SELECT,
    });
  } catch (err) {
    // Specialization.name IS @unique in the schema — the DB constraint is the real backstop
    // against a race between two concurrent creates of the same name.
    if (err.code === 'P2002') {
      throw new ApiError(409, 'SPECIALIZATION_ALREADY_EXISTS', 'A specialization with this name already exists.');
    }
    throw err;
  }

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'geography.specialization_create',
    targetEntityType: 'specialization',
    targetEntityId: specialization.id,
    description: `Created specialization "${specialization.name}"`,
  });

  await cacheService.invalidate('cache:geography:specializations:*');

  return specialization;
}

/**
 * @param {string} cityId
 * @param {{id:string, role:string}} actor
 */
async function deleteCity(cityId, actor) {
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true, name: true } });
  if (!city) {
    throw new ApiError(404, 'CITY_NOT_FOUND', 'City not found.');
  }

  // Deleting a City would CASCADE-delete every Area under it at the DB level (and SET NULL on
  // any Clinic.cityId/areaId pointing here) — silently wiping service areas an admin may not
  // realize still exist. Block instead, and make the admin clear both dependents first so the
  // deletion is a deliberate, visible action rather than a surprise cascade.
  const areaCount = await prisma.area.count({ where: { cityId } });
  if (areaCount > 0) {
    throw new ApiError(
      409,
      'CITY_HAS_AREAS',
      'This city still has service areas. Delete those areas first, then delete the city.'
    );
  }

  const clinicCount = await prisma.clinic.count({ where: { cityId } });
  if (clinicCount > 0) {
    throw new ApiError(
      409,
      'CITY_IN_USE',
      'This city is still assigned to one or more clinics and cannot be deleted.'
    );
  }

  await prisma.city.delete({ where: { id: cityId } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'geography.city_delete',
    targetEntityType: 'city',
    targetEntityId: cityId,
    description: `Deleted city "${city.name}"`,
  });

  await cacheService.invalidate('cache:geography:cities:*');

  return { id: cityId };
}

/**
 * @param {string} cityId
 * @param {string} areaId
 * @param {{id:string, role:string}} actor
 */
async function deleteArea(cityId, areaId, actor) {
  const area = await prisma.area.findFirst({ where: { id: areaId, cityId }, select: { id: true, name: true } });
  if (!area) {
    throw new ApiError(404, 'AREA_NOT_FOUND', 'Area not found.');
  }

  const clinicCount = await prisma.clinic.count({ where: { areaId } });
  if (clinicCount > 0) {
    throw new ApiError(
      409,
      'AREA_IN_USE',
      'This area is still assigned to one or more clinics and cannot be deleted.'
    );
  }

  await prisma.area.delete({ where: { id: areaId } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'geography.area_delete',
    targetEntityType: 'area',
    targetEntityId: areaId,
    description: `Deleted area "${area.name}" in city ${cityId}`,
  });

  await cacheService.invalidate('cache:geography:areas:*');

  return { id: areaId };
}

/**
 * @param {string} specializationId
 * @param {{id:string, role:string}} actor
 */
async function deleteSpecialization(specializationId, actor) {
  const specialization = await prisma.specialization.findUnique({
    where: { id: specializationId },
    select: { id: true, name: true },
  });
  if (!specialization) {
    throw new ApiError(404, 'SPECIALIZATION_NOT_FOUND', 'Specialization not found.');
  }

  // Deleting one would SET NULL every DoctorProfile.specializationId pointing at it — silently
  // un-specializing doctors who still have it set. Block instead, same guard shape as
  // deleteCity/deleteArea above.
  const doctorCount = await prisma.doctorProfile.count({ where: { specializationId } });
  if (doctorCount > 0) {
    throw new ApiError(
      409,
      'SPECIALIZATION_IN_USE',
      'This specialization is still assigned to one or more doctors and cannot be deleted.'
    );
  }

  await prisma.specialization.delete({ where: { id: specializationId } });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'geography.specialization_delete',
    targetEntityType: 'specialization',
    targetEntityId: specializationId,
    description: `Deleted specialization "${specialization.name}"`,
  });

  await cacheService.invalidate('cache:geography:specializations:*');

  return { id: specializationId };
}

module.exports = {
  listCities,
  listAreas,
  listSpecializations,
  createCity,
  createArea,
  createSpecialization,
  deleteCity,
  deleteArea,
  deleteSpecialization,
};
