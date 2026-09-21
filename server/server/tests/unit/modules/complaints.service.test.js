/**
 * Unit tests for modules/complaints/complaints.service.js — the role-scoping rule that keeps one
 * patient's complaints invisible to another:
 *
 *   - listComplaints forces `where.raisedByUserId = requester.id` for a patient (query params can
 *     never override this), while admin/superadmin may filter freely by `status`.
 *   - updateComplaint requires at least one recognized field in the body, else a clean 400
 *     VALIDATION_ERROR instead of a no-op write.
 *
 * createComplaint and getComplaintById (and their tests) were removed along with the code they
 * tested (backend-cleanup audit — user request: "website frontend me nahi hai but backend bna
 * hua hai to backend se hata do"): no web/mobile screen, for any role, ever files a complaint or
 * fetches a single one by id.
 *
 * config/db is mocked (no real Postgres in this sandbox); activityLogService/cacheService are
 * mocked to isolate this module's own branching from their internals.
 */
jest.mock('../../../src/config/db', () => ({
  complaint: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttl, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));

const prisma = require('../../../src/config/db');
const complaintsService = require('../../../src/modules/complaints/complaints.service');

const PATIENT = { id: 'patient-1', role: 'patient' };
const ADMIN = { id: 'admin-1', role: 'admin' };

function complaintRow(overrides = {}) {
  return {
    id: 'complaint-1',
    raisedByUserId: PATIENT.id,
    subject: 'Billing issue',
    description: 'desc',
    status: 'open',
    adminResponse: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    raisedBy: { id: PATIENT.id, name: 'Patty' },
    ...overrides,
  };
}

describe('complaintsService.updateComplaint', () => {
  test('404 when the complaint does not exist', async () => {
    prisma.complaint.findUnique.mockResolvedValue(null);

    await expect(complaintsService.updateComplaint('missing', { status: 'resolved' }, ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'COMPLAINT_NOT_FOUND',
    });
  });

  test('400 VALIDATION_ERROR when the body has neither status nor adminResponse', async () => {
    prisma.complaint.findUnique.mockResolvedValue({ id: 'complaint-1', status: 'open', raisedByUserId: PATIENT.id });

    await expect(complaintsService.updateComplaint('complaint-1', {}, ADMIN)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.complaint.update).not.toHaveBeenCalled();
  });

  test('success updates and busts both the raiser\'s and admin\'s cache buckets', async () => {
    const cacheService = require('../../../src/services/cacheService');
    prisma.complaint.findUnique
      .mockResolvedValueOnce({ id: 'complaint-1', status: 'open', raisedByUserId: PATIENT.id })
      .mockResolvedValueOnce(complaintRow({ status: 'resolved' }));

    await complaintsService.updateComplaint('complaint-1', { status: 'resolved' }, ADMIN);

    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:complaints:list:admin:*');
    expect(cacheService.invalidate).toHaveBeenCalledWith(`cache:complaints:list:patient:${PATIENT.id}:*`);
  });
});

describe('complaintsService.listComplaints — role scoping', () => {
  test('a patient\'s where clause is forced to their own id, ignoring any other filter', async () => {
    prisma.complaint.findMany.mockResolvedValue([]);
    prisma.complaint.count.mockResolvedValue(0);

    await complaintsService.listComplaints({ status: 'resolved' }, PATIENT);

    expect(prisma.complaint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { raisedByUserId: PATIENT.id } })
    );
  });

  test('admin can filter by status, and sees all patients\' complaints when no status given', async () => {
    prisma.complaint.findMany.mockResolvedValue([]);
    prisma.complaint.count.mockResolvedValue(0);

    await complaintsService.listComplaints({ status: 'open' }, ADMIN);

    expect(prisma.complaint.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'open' } }));

    await complaintsService.listComplaints({}, ADMIN);
    expect(prisma.complaint.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });
});
