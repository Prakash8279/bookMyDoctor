/**
 * Unit tests for utils/idGenerators.js#nextReceiptNumber — the CDR-00000001-style formatting of
 * whatever the `payment_receipt_seq` Postgres sequence returns. config/db is mocked as a plain
 * jest.fn() (not an object with methods) because `prisma.$queryRaw` is invoked as a TAGGED
 * TEMPLATE (`` prisma.$queryRaw`SELECT ...` ``) — under the hood that's just prisma.$queryRaw
 * being called with a template-strings array as its first argument, so the mock must itself be
 * callable.
 */
jest.mock('../../../src/config/db', () => ({ $queryRaw: jest.fn() }));

const prisma = require('../../../src/config/db');
const { nextReceiptNumber } = require('../../../src/utils/idGenerators');

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
