/**
 * Unit tests for modules/contact/contact.service.js — the public contact-us intake and its admin
 * moderation. Smaller surface than most modules (no ownership scoping — a contact request has no
 * owning user, just an admin-only read/update side), so tests focus on:
 *
 *   - createContactRequest trims every field before persisting and always seeds status:'open'.
 *   - updateContactRequest's "at least one of status/response" guard (a bare {} body must not
 *     silently no-op a write) and its 404 on a missing request.
 *   - listContactRequests' status filter and cache-key/TTL wiring.
 *
 * config/db is mocked (no real Postgres in this sandbox); activityLogService/cacheService are
 * mocked to isolate this module's own branching from their internals.
 */
jest.mock('../../../src/config/db', () => ({
  contactRequest: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttl, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));

const prisma = require('../../../src/config/db');
const activityLogService = require('../../../src/services/activityLogService');
const cacheService = require('../../../src/services/cacheService');
const contactService = require('../../../src/modules/contact/contact.service');

const ADMIN = { id: 'admin-1', role: 'admin' };

function contactRow(overrides = {}) {
  return {
    id: 'contact-1',
    name: 'Alice',
    email: 'alice@example.com',
    subject: 'Question',
    message: 'Hi',
    status: 'open',
    response: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('contactService.createContactRequest', () => {
  test('trims every string field and forces status:open, then busts the list cache', async () => {
    prisma.contactRequest.create.mockResolvedValue(contactRow());

    await contactService.createContactRequest({
      name: '  Alice  ',
      email: '  alice@example.com  ',
      subject: '  Question  ',
      message: '  Hi  ',
    });

    expect(prisma.contactRequest.create).toHaveBeenCalledWith({
      data: { name: 'Alice', email: 'alice@example.com', subject: 'Question', message: 'Hi', status: 'open' },
      select: expect.any(Object),
    });
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:contact:list:*');
  });

  test('never calls activityLogService — anonymous public submission has no actor to log', async () => {
    prisma.contactRequest.create.mockResolvedValue(contactRow());

    await contactService.createContactRequest({ name: 'A', email: 'a@x.com', subject: 'S', message: 'M' });

    expect(activityLogService.log).not.toHaveBeenCalled();
  });
});

describe('contactService.updateContactRequest', () => {
  test('404 when the contact request does not exist', async () => {
    prisma.contactRequest.findUnique.mockResolvedValue(null);

    await expect(contactService.updateContactRequest('missing', { status: 'closed' }, ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'CONTACT_REQUEST_NOT_FOUND',
    });
  });

  test('400 VALIDATION_ERROR when neither status nor response is present', async () => {
    prisma.contactRequest.findUnique.mockResolvedValue({ id: 'contact-1' });

    await expect(contactService.updateContactRequest('contact-1', {}, ADMIN)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.contactRequest.update).not.toHaveBeenCalled();
  });

  test('success updates, logs the changed field names, and busts the list cache', async () => {
    prisma.contactRequest.findUnique.mockResolvedValue({ id: 'contact-1' });
    prisma.contactRequest.update.mockResolvedValue(contactRow({ status: 'closed', response: 'Resolved' }));

    const result = await contactService.updateContactRequest('contact-1', { status: 'closed', response: 'Resolved' }, ADMIN);

    expect(prisma.contactRequest.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: { status: 'closed', response: 'Resolved' },
      select: expect.any(Object),
    });
    expect(activityLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Updated contact request: status, response' })
    );
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:contact:list:*');
    expect(result.status).toBe('closed');
  });
});

describe('contactService.listContactRequests', () => {
  test('applies the status filter to the where clause when given', async () => {
    prisma.contactRequest.findMany.mockResolvedValue([]);
    prisma.contactRequest.count.mockResolvedValue(0);

    await contactService.listContactRequests({ status: 'open' });

    expect(prisma.contactRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'open' } }));
  });

  test('omits the status filter entirely when not given', async () => {
    prisma.contactRequest.findMany.mockResolvedValue([]);
    prisma.contactRequest.count.mockResolvedValue(0);

    await contactService.listContactRequests({});

    expect(prisma.contactRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
