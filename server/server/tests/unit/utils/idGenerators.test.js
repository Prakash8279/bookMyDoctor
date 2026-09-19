/**
 * Unit tests for utils/idGenerators.js#nextReceiptNumber — the CDR-00000001-style formatting of
 * whatever the `payment_receipt_seq` Postgres sequence returns. config/db is mocked as a plain
 * jest.fn() (not an object with methods) because `prisma.$queryRaw` is invoked as a TAGGED
 * TEMPLATE (`` prisma.$queryRaw`SELECT ...` ``) — under the hood that's just prisma.$queryRaw
 * being called with a template-strings array as its first argument, so the mock must itself be
 * callable.
 *
 * Also covers nextPatientNumber/nextDoctorNumber/nextClinicNumber (prisma/migrations/
 * 20260919130000_add_patient_doctor_clinic_numbers) — same tagged-template $queryRaw call
 * against their own sequences, but returning a plain Number (no CDR-style prefix/padding: that
 * formatting is a frontend concern, see client/src/lib/format.js#stableId).
 */
jest.mock('../../../src/config/db', () => ({ $queryRaw: jest.fn() }));

const prisma = require('../../../src/config/db');
const { nextReceiptNumber, nextPatientNumber, nextDoctorNumber, nextClinicNumber } = require('../../../src/utils/idGenerators');

describe('idGenerators.nextReceiptNumber', () => {
  test('pads a small sequence value out to 8 digits with the CDR- prefix', async () => {
    prisma.$queryRaw.mockResolvedValue([{ value: 1n }]);

    const result = await nextReceiptNumber();

    expect(result).toBe('CDR-00000001');
  });

  test('a value already 8+ digits long is not truncated, just prefixed', async () => {
    prisma.$queryRaw.mockResolvedValue([{ value: 123456789n }]);

    const result = await nextReceiptNumber();

    expect(result).toBe('CDR-123456789');
  });

  test('invokes $queryRaw as a tagged template (receives the SQL text mentioning the sequence name)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ value: 42n }]);

    await nextReceiptNumber();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('')).toContain('payment_receipt_seq');
  });

  test('zero pads correctly too (edge case at the low end of the sequence)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ value: 0n }]);

    const result = await nextReceiptNumber();

    expect(result).toBe('CDR-00000000');
  });
});

describe('idGenerators.nextPatientNumber / nextDoctorNumber / nextClinicNumber', () => {
  test.each([
    ['nextPatientNumber', nextPatientNumber, 'patient_number_seq'],
    ['nextDoctorNumber', nextDoctorNumber, 'doctor_number_seq'],
    ['nextClinicNumber', nextClinicNumber, 'clinic_number_seq'],
  ])('%s returns a plain Number (unformatted, unpadded) drawn from %s', async (_name, fn, seqName) => {
    prisma.$queryRaw.mockResolvedValue([{ value: 7n }]);

    const result = await fn();

    expect(result).toBe(7);
    expect(typeof result).toBe('number');
    const [strings] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('')).toContain(seqName);
  });

  test.each([
    ['nextPatientNumber', nextPatientNumber],
    ['nextDoctorNumber', nextDoctorNumber],
    ['nextClinicNumber', nextClinicNumber],
  ])('%s converts a BigInt sequence value to a real Number, not a string or BigInt', async (_name, fn) => {
    prisma.$queryRaw.mockResolvedValue([{ value: 123456789n }]);

    const result = await fn();

    expect(result).toBe(123456789);
    expect(typeof result).toBe('number');
  });
});
