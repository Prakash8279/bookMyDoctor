/**
 * Unit tests for modules/platformCharges/platformCharges.service.js — the singleton fee-config
 * row every booking/payment price calculation is built on. Two things here would be easy to
 * silently break without a test noticing:
 *
 *   - shapeCharges (exercised through getPlatformCharges): commissionPercent is the platform's
 *     internal margin — Rule 8 requires it never reach a doctor/receptionist/patient. Getting
 *     the role check backwards (or dropping it) would leak the platform's margin to every
 *     caller of a public-ish "what will this booking cost" endpoint.
 *   - updatePlatformCharges: the boolean coercion `body.applyConvenienceFee === true` is a
 *     strict-equality guard against a truthy-but-not-boolean value (a validation gap upstream,
 *     a stray `"true"` string from a form) silently being treated as "on" — and the upsert must
 *     ALWAYS target id:1 (never create a second row) since this table is a singleton by
 *     convention, backed only by a DB CHECK(id=1) constraint as a backstop.
 *
 * config/db is mocked (the real module would try to open a Postgres connection). @prisma/client
 * is ALSO mocked here with a minimal Decimal stand-in (constructor + toString) rather than using
 * the real package's generated Decimal: the real one only exists after `prisma generate` has
 * downloaded its query-engine binary, which this sandbox's network policy blocks — a plain
 * value-wrapper class is all `new Prisma.Decimal(x)` / `instanceof Prisma.Decimal` / `.toString()`
 * need to exercise this module's actual behavior (it never does Decimal arithmetic, only wraps
 * and stringifies).
 */
jest.mock('@prisma/client', () => {
  class Decimal {
    constructor(value) {
      this.value = String(value);
    }
    toString() {
      return this.value;
    }
  }
  return { Prisma: { Decimal } };
});
jest.mock('../../../src/config/db', () => ({
  platformCharges: { findUnique: jest.fn(), upsert: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({ invalidate: jest.fn() }));

const { Prisma } = require('@prisma/client');
const prisma = require('../../../src/config/db');
const activityLogService = require('../../../src/services/activityLogService');
const cacheService = require('../../../src/services/cacheService');
const platformChargesService = require('../../../src/modules/platformCharges/platformCharges.service');

const RAW_ROW = {
  id: 1,
  commissionPercent: '10.5',
  patientConvenienceFee: '20',
  emergencyFee: '100',
  gstPercent: '18',
  applyConvenienceFee: true,
  applyEmergencyFee: false,
};

describe('platformChargesService.getPlatformCharges — role-based masking', () => {
  test.each(['admin', 'superadmin'])('%s sees commissionPercent alongside the other fields', async (role) => {
    prisma.platformCharges.findUnique.mockResolvedValue(RAW_ROW);

    const result = await platformChargesService.getPlatformCharges(role);

    expect(result).toEqual({
      patientConvenienceFee: RAW_ROW.patientConvenienceFee,
      emergencyFee: RAW_ROW.emergencyFee,
      gstPercent: RAW_ROW.gstPercent,
      applyConvenienceFee: true,
      applyEmergencyFee: false,
      commissionPercent: RAW_ROW.commissionPercent,
    });
  });

  test.each(['patient', 'doctor', 'receptionist'])(
    '%s never receives commissionPercent — the platform\'s internal margin stays hidden',
    async (role) => {
      prisma.platformCharges.findUnique.mockResolvedValue(RAW_ROW);

      const result = await platformChargesService.getPlatformCharges(role);

      expect(result.commissionPercent).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(result, 'commissionPercent')).toBe(false);
      // The four booking-relevant fields must still be there — this is masking, not a blank page.
      expect(result).toEqual({
        patientConvenienceFee: RAW_ROW.patientConvenienceFee,
        emergencyFee: RAW_ROW.emergencyFee,
        gstPercent: RAW_ROW.gstPercent,
        applyConvenienceFee: true,
        applyEmergencyFee: false,
      });
    }
  );

  test('throws a 500 PLATFORM_CHARGES_NOT_CONFIGURED (not a 404) when the singleton row is missing', async () => {
    prisma.platformCharges.findUnique.mockResolvedValue(null);

    await expect(platformChargesService.getPlatformCharges('admin')).rejects.toMatchObject({
      statusCode: 500,
      code: 'PLATFORM_CHARGES_NOT_CONFIGURED',
    });
  });
});

describe('platformChargesService.updatePlatformCharges', () => {
  const ACTOR = { id: 'admin-1', role: 'admin' };
  const BODY = {
    commissionPercent: 12,
    patientConvenienceFee: 25,
    emergencyFee: 150,
    gstPercent: 18,
    applyConvenienceFee: true,
    applyEmergencyFee: true,
  };

  test('upsert always targets id:1, both on the `where` and inside `create` — a singleton table can never grow a second row', async () => {
    prisma.platformCharges.upsert.mockResolvedValue({ id: 1, ...BODY });

    await platformChargesService.updatePlatformCharges(BODY, ACTOR);

    expect(prisma.platformCharges.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.platformCharges.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: 1 });
    expect(call.create.id).toBe(1);
  });

  test('numeric fee/percent fields are wrapped as Prisma.Decimal, never left as plain JS numbers', async () => {
    prisma.platformCharges.upsert.mockResolvedValue({ id: 1, ...BODY });

    await platformChargesService.updatePlatformCharges(BODY, ACTOR);

    const { update } = prisma.platformCharges.upsert.mock.calls[0][0];
    expect(update.commissionPercent).toBeInstanceOf(Prisma.Decimal);
    expect(update.commissionPercent.toString()).toBe('12');
    expect(update.patientConvenienceFee).toBeInstanceOf(Prisma.Decimal);
    expect(update.emergencyFee.toString()).toBe('150');
    expect(update.gstPercent.toString()).toBe('18');
  });

  test('applyConvenienceFee/applyEmergencyFee are coerced with strict `=== true` — a truthy non-boolean must become false', async () => {
    prisma.platformCharges.upsert.mockResolvedValue({ id: 1 });

    await platformChargesService.updatePlatformCharges(
      { ...BODY, applyConvenienceFee: 'true', applyEmergencyFee: 1 },
      ACTOR
    );

    const { update } = prisma.platformCharges.upsert.mock.calls[0][0];
    expect(update.applyConvenienceFee).toBe(false);
    expect(update.applyEmergencyFee).toBe(false);
  });

  test('logs the update and busts both the payments-list and admin-appointments-list caches (both bake commission into cached figures)', async () => {
    prisma.platformCharges.upsert.mockResolvedValue({ id: 1, ...BODY });

    await platformChargesService.updatePlatformCharges(BODY, ACTOR);

    expect(activityLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'platformCharges.update', actorUserId: 'admin-1' })
    );
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:payments:list:*');
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:appointments:list:admin:*');
  });

  test('returns the full unmasked row as-is (caller is already admin-only, so no shapeCharges masking applies here)', async () => {
    const upserted = { id: 1, ...BODY, commissionPercent: new Prisma.Decimal(12) };
    prisma.platformCharges.upsert.mockResolvedValue(upserted);

    const result = await platformChargesService.updatePlatformCharges(BODY, ACTOR);

    expect(result).toBe(upserted);
  });
});
