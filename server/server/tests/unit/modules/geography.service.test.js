/**
 * Unit tests for modules/geography/geography.service.js — the create/delete guard clauses that
 * keep the city/area/specialization reference data consistent, since none of this is enforced by
 * a DB constraint alone:
 *
 *   - createCity/createArea: duplicate names are blocked with a case-INSENSITIVE, trimmed
 *     comparison ("Pune" vs " pune " must collide) even though City.name has no DB-level unique
 *     constraint at all — this pre-check is the only thing standing between a typo'd duplicate
 *     and a confusing duplicate entry in every downstream filter/dropdown.
 *   - deleteCity/deleteArea/deleteSpecialization: each blocks deletion while dependents still
 *     reference the row (areas/clinics under a city, clinics under an area, doctors under a
 *     specialization) — a real DB cascade would otherwise silently orphan/null those references,
 *     which is exactly what these guards exist to force an admin to handle explicitly first.
 *
 * config/db is mocked (no real Postgres in this sandbox — see tests/setupEnv.js's header
 * comment); cacheService/activityLogService are mocked to isolate this module's own branching
 * from their internals.
 */
jest.mock('../../../src/config/db', () => ({
  city: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
  area: { findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), delete: jest.fn() },
  clinic: { count: jest.fn() },
  specialization: { findUnique: jest.fn(), delete: jest.fn() },
  doctorProfile: { count: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({ invalidate: jest.fn() }));

const prisma = require('../../../src/config/db');
const cacheService = require('../../../src/services/cacheService');
const geographyService = require('../../../src/modules/geography/geography.service');

const ACTOR = { id: 'admin-1', role: 'admin' };

describe('geographyService.createCity — case-insensitive duplicate guard', () => {
  test('rejects a duplicate that differs only by case/whitespace with 409 CITY_ALREADY_EXISTS', async () => {
    prisma.city.findFirst.mockResolvedValue({ id: 'city-existing' });

    await expect(geographyService.createCity({ name: '  pune  ' }, ACTOR)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_ALREADY_EXISTS',
    });
    // The pre-check itself must use a trimmed, case-insensitive comparison — asserting the call
    // shape catches a regression back to an exact/case-sensitive match.
    expect(prisma.city.findFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'pune', mode: 'insensitive' } },
      select: { id: true },
    });
    expect(prisma.city.create).not.toHaveBeenCalled();
  });

  test('trims the name before creating, and stores a null state (not empty string) when none is given', async () => {
    prisma.city.findFirst.mockResolvedValue(null);
    prisma.city.create.mockResolvedValue({ id: 'city-1', name: 'Pune', state: null });

    await geographyService.createCity({ name: '  Pune  ' }, ACTOR);

    expect(prisma.city.create).toHaveBeenCalledWith({
      data: { name: 'Pune', state: null },
      select: { id: true, name: true, state: true },
    });
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:geography:cities:*');
  });
});

describe('geographyService.createArea', () => {
  test('404s with AREA-specific city check when the parent city does not exist', async () => {
    prisma.city.findUnique.mockResolvedValue(null);

    await expect(geographyService.createArea('city-missing', { name: 'Kothrud' }, ACTOR)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CITY_NOT_FOUND',
    });
    expect(prisma.area.findFirst).not.toHaveBeenCalled();
  });

  test('rejects a duplicate area name WITHIN the same city (case-insensitive) with 409 AREA_ALREADY_EXISTS', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1' });
    prisma.area.findFirst.mockResolvedValue({ id: 'area-existing' });

    await expect(geographyService.createArea('city-1', { name: 'KOTHRUD' }, ACTOR)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AREA_ALREADY_EXISTS',
    });
  });

  test('an empty/undefined pincode is stored as null, not an empty string', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1' });
    prisma.area.findFirst.mockResolvedValue(null);
    prisma.area.create.mockResolvedValue({ id: 'area-1', name: 'Kothrud', pincode: null, cityId: 'city-1' });

    await geographyService.createArea('city-1', { name: 'Kothrud' }, ACTOR);

    expect(prisma.area.create).toHaveBeenCalledWith({
      data: { cityId: 'city-1', name: 'Kothrud', pincode: null },
      select: { id: true, name: true, pincode: true, cityId: true },
    });
  });
});

describe('geographyService.deleteCity — dependent-guard cascade order', () => {
  test('404s when the city does not exist', async () => {
    prisma.city.findUnique.mockResolvedValue(null);

    await expect(geographyService.deleteCity('city-1', ACTOR)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CITY_NOT_FOUND',
    });
  });

  test('blocks deletion with CITY_HAS_AREAS when areas still exist, and never even checks clinics', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1', name: 'Pune' });
    prisma.area.count.mockResolvedValue(2);

    await expect(geographyService.deleteCity('city-1', ACTOR)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_HAS_AREAS',
    });
    expect(prisma.clinic.count).not.toHaveBeenCalled();
    expect(prisma.city.delete).not.toHaveBeenCalled();
  });

  test('blocks deletion with CITY_IN_USE when no areas remain but a clinic still points at this city', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1', name: 'Pune' });
    prisma.area.count.mockResolvedValue(0);
    prisma.clinic.count.mockResolvedValue(1);

    await expect(geographyService.deleteCity('city-1', ACTOR)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_IN_USE',
    });
    expect(prisma.city.delete).not.toHaveBeenCalled();
  });

  test('deletes and invalidates the cache once both dependent counts are zero', async () => {
    prisma.city.findUnique.mockResolvedValue({ id: 'city-1', name: 'Pune' });
    prisma.area.count.mockResolvedValue(0);
    prisma.clinic.count.mockResolvedValue(0);
    prisma.city.delete.mockResolvedValue({ id: 'city-1' });

    const result = await geographyService.deleteCity('city-1', ACTOR);

    expect(prisma.city.delete).toHaveBeenCalledWith({ where: { id: 'city-1' } });
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:geography:cities:*');
    expect(result).toEqual({ id: 'city-1' });
  });
});

describe('geographyService.deleteSpecialization', () => {
  test('404s when the specialization does not exist', async () => {
    prisma.specialization.findUnique.mockResolvedValue(null);

    await expect(geographyService.deleteSpecialization('spec-1', ACTOR)).rejects.toMatchObject({
      statusCode: 404,
      code: 'SPECIALIZATION_NOT_FOUND',
    });
  });

  test('blocks deletion with SPECIALIZATION_IN_USE while any doctor still references it (would otherwise SET NULL silently)', async () => {
    prisma.specialization.findUnique.mockResolvedValue({ id: 'spec-1', name: 'Cardiology' });
    prisma.doctorProfile.count.mockResolvedValue(3);

    await expect(geographyService.deleteSpecialization('spec-1', ACTOR)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SPECIALIZATION_IN_USE',
    });
    expect(prisma.specialization.delete).not.toHaveBeenCalled();
  });

  test('deletes once no doctor references it', async () => {
    prisma.specialization.findUnique.mockResolvedValue({ id: 'spec-1', name: 'Cardiology' });
    prisma.doctorProfile.count.mockResolvedValue(0);
    prisma.specialization.delete.mockResolvedValue({ id: 'spec-1' });

    const result = await geographyService.deleteSpecialization('spec-1', ACTOR);

    expect(prisma.specialization.delete).toHaveBeenCalledWith({ where: { id: 'spec-1' } });
    expect(result).toEqual({ id: 'spec-1' });
  });
});
