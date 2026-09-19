/**
 * Unit tests for modules/familyMembers/familyMembers.service.js — the single-scope ownership
 * guard (every route acts on the caller's own rows only) and the two pieces of real logic this
 * module contains:
 *
 *   - computeAge: computed fresh on every read (never stored), including the "hasn't had this
 *     year's birthday yet" off-by-one that a naive `now.getFullYear() - dob.getFullYear()` gets
 *     wrong for anyone whose birthday hasn't occurred yet this calendar year.
 *   - getOwnedFamilyMemberOrThrow: a family member that exists but belongs to a DIFFERENT patient
 *     404s (never 403) — deliberately indistinguishable from "doesn't exist" to avoid id
 *     enumeration leaking which family-member ids belong to other patients.
 *   - deleteFamilyMember's P2003 -> 409 FAMILY_MEMBER_HAS_APPOINTMENTS translation (the
 *     Appointment.familyMember onDelete:Restrict FK surfacing as a clean, actionable error
 *     instead of a raw Prisma foreign-key-violation).
 *
 * config/db is mocked (no real Postgres in this sandbox); activityLogService/cacheService are
 * mocked to isolate this module's own branching from their internals.
 */
jest.mock('../../../src/config/db', () => ({
  familyMember: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttl, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));

const prisma = require('../../../src/config/db');
const cacheService = require('../../../src/services/cacheService');
const familyMembersService = require('../../../src/modules/familyMembers/familyMembers.service');

const PATIENT_ID = 'patient-1';

function row(overrides = {}) {
  return {
    id: 'fm-1',
    patientUserId: PATIENT_ID,
    name: 'Junior',
    relation: 'son',
    dateOfBirth: null,
    gender: null,
    bloodGroup: null,
    ...overrides,
  };
}

describe('familyMembersService — computeAge (via shape())', () => {
  test('null dateOfBirth -> age is null', async () => {
    prisma.familyMember.create.mockResolvedValue(row({ dateOfBirth: null }));

    const result = await familyMembersService.createFamilyMember(PATIENT_ID, { name: 'A', relation: 'son' });

    expect(result.age).toBeNull();
  });

  test('birthday already occurred this year -> age is the straightforward year difference', async () => {
    const now = new Date();
    const dob = new Date(now.getFullYear() - 10, 0, 1); // Jan 1, definitely already passed
    prisma.familyMember.create.mockResolvedValue(row({ dateOfBirth: dob }));

    const result = await familyMembersService.createFamilyMember(PATIENT_ID, { name: 'A', relation: 'son' });

    expect(result.age).toBe(10);
  });

  test('birthday has NOT yet occurred this year -> age is one less than the naive year difference', async () => {
    const now = new Date();
    // A birthday 2 days in the future (relative to "now") this year, born exactly 10 years ago by
    // calendar year — the naive `now.getFullYear() - dob.getFullYear()` would say 10, but since
    // this year's birthday hasn't happened yet, the true age is still 9.
    const future = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    const dob = new Date(now.getFullYear() - 10, future.getMonth(), future.getDate());
    prisma.familyMember.create.mockResolvedValue(row({ dateOfBirth: dob }));

    const result = await familyMembersService.createFamilyMember(PATIENT_ID, { name: 'A', relation: 'son' });

    expect(result.age).toBe(9);
  });
});

describe('familyMembersService.getOwnedFamilyMemberOrThrow — enumeration avoidance', () => {
  test('404 when the row does not exist', async () => {
    prisma.familyMember.findUnique.mockResolvedValue(null);

    await expect(familyMembersService.getFamilyMemberById('missing', PATIENT_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'FAMILY_MEMBER_NOT_FOUND',
    });
  });

  test('404 (not 403) when the row belongs to a DIFFERENT patient', async () => {
    prisma.familyMember.findUnique.mockResolvedValue(row({ patientUserId: 'someone-else' }));

    await expect(familyMembersService.getFamilyMemberById('fm-1', PATIENT_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'FAMILY_MEMBER_NOT_FOUND',
    });
  });

  test('returns the shaped row for the true owner', async () => {
    prisma.familyMember.findUnique.mockResolvedValue(row());

    const result = await familyMembersService.getFamilyMemberById('fm-1', PATIENT_ID);

    expect(result.id).toBe('fm-1');
    expect(result).not.toHaveProperty('patientUserId');
  });
});

describe('familyMembersService.updateFamilyMember', () => {
  test('422 when name is explicitly set to null (non-nullable field)', async () => {
    prisma.familyMember.findUnique.mockResolvedValue(row());

    await expect(familyMembersService.updateFamilyMember('fm-1', PATIENT_ID, { name: null })).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  test('a no-op body skips the write entirely and just re-reads', async () => {
    prisma.familyMember.findUnique.mockResolvedValue(row());

    await familyMembersService.updateFamilyMember('fm-1', PATIENT_ID, {});

    expect(prisma.familyMember.update).not.toHaveBeenCalled();
  });

  test('trims string fields and nulls out empty optional fields before writing', async () => {
    prisma.familyMember.findUnique.mockResolvedValue(row());
    prisma.familyMember.update.mockResolvedValue(row({ name: 'New Name', gender: null }));

    await familyMembersService.updateFamilyMember('fm-1', PATIENT_ID, { name: '  New Name  ', gender: '' });

    expect(prisma.familyMember.update).toHaveBeenCalledWith({
      where: { id: 'fm-1' },
      data: { name: 'New Name', gender: null },
      select: expect.any(Object),
    });
  });
});

describe('familyMembersService.deleteFamilyMember — P2003 translation', () => {
  test('a family member with existing appointments cannot be deleted (409, translated from P2003)', async () => {
    prisma.familyMember.findUnique.mockResolvedValue(row());
    prisma.familyMember.delete.mockRejectedValue(Object.assign(new Error('FK violation'), { code: 'P2003' }));

    await expect(familyMembersService.deleteFamilyMember('fm-1', PATIENT_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'FAMILY_MEMBER_HAS_APPOINTMENTS',
    });
  });

  test('an unrelated delete error is rethrown unchanged', async () => {
    prisma.familyMember.findUnique.mockResolvedValue(row());
    prisma.familyMember.delete.mockRejectedValue(new Error('boom'));

    await expect(familyMembersService.deleteFamilyMember('fm-1', PATIENT_ID)).rejects.toThrow('boom');
  });

  test('success deletes and busts this patient\'s list cache', async () => {
    prisma.familyMember.findUnique.mockResolvedValue(row());
    prisma.familyMember.delete.mockResolvedValue({});

    await familyMembersService.deleteFamilyMember('fm-1', PATIENT_ID);

    expect(cacheService.invalidate).toHaveBeenCalledWith(`cache:familyMembers:list:${PATIENT_ID}:*`);
  });
});

describe('familyMembersService.listFamilyMembers', () => {
  test('always scopes the where clause to the given patientUserId', async () => {
    prisma.familyMember.findMany.mockResolvedValue([row()]);
    prisma.familyMember.count.mockResolvedValue(1);

    await familyMembersService.listFamilyMembers(PATIENT_ID, {});

    expect(prisma.familyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientUserId: PATIENT_ID } })
    );
  });
});
