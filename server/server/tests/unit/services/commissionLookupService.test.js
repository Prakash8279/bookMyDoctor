/**
 * Unit tests for services/commissionLookupService.js — a small but security-relevant guard:
 * commissionPercent must only ever be fetched (and thus only ever appear in a response) for an
 * admin/superadmin caller. Every other role must short-circuit to null WITHOUT even querying
 * platform_charges, so a non-admin path can never accidentally leak commission data through a
 * later code change that forgets to mask it.
 *
 * config/db is mocked (no real Postgres in this sandbox); utils/roles is left real (it's the
 * actual ADMIN_ROLES constant this function's whole branch depends on).
 */
jest.mock('../../../src/config/db', () => ({
  platformCharges: { findUnique: jest.fn() },
}));

const prisma = require('../../../src/config/db');
const { loadCommissionPercentIfAdmin } = require('../../../src/services/commissionLookupService');

describe('commissionLookupService.loadCommissionPercentIfAdmin', () => {
  test('a non-admin role (e.g. patient) short-circuits to null without querying the DB at all', async () => {
    const result = await loadCommissionPercentIfAdmin('patient');

    expect(result).toBeNull();
    expect(prisma.platformCharges.findUnique).not.toHaveBeenCalled();
  });

  test('doctor and receptionist roles also short-circuit to null', async () => {
    await expect(loadCommissionPercentIfAdmin('doctor')).resolves.toBeNull();
    await expect(loadCommissionPercentIfAdmin('receptionist')).resolves.toBeNull();
    expect(prisma.platformCharges.findUnique).not.toHaveBeenCalled();
  });

  test('admin queries platform_charges and returns its commissionPercent', async () => {
    prisma.platformCharges.findUnique.mockResolvedValue({ commissionPercent: '12.5' });

    const result = await loadCommissionPercentIfAdmin('admin');

    expect(prisma.platformCharges.findUnique).toHaveBeenCalledWith({ where: { id: 1 }, select: { commissionPercent: true } });
    expect(result).toBe('12.5');
  });

  test('superadmin also queries and returns commissionPercent', async () => {
    prisma.platformCharges.findUnique.mockResolvedValue({ commissionPercent: '10' });

    const result = await loadCommissionPercentIfAdmin('superadmin');

    expect(result).toBe('10');
  });

  test('admin with no platform_charges row on file returns null, not throw', async () => {
    prisma.platformCharges.findUnique.mockResolvedValue(null);

    const result = await loadCommissionPercentIfAdmin('admin');

    expect(result).toBeNull();
  });
});
