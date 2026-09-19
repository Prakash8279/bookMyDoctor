/**
 * Unit tests for modules/complaints/complaints.service.js — the role-scoping and enumeration-
 * avoidance rules that keep one patient's complaints invisible to another:
 *
 *   - createComplaint always uses `requester.id` as raisedByUserId, never anything from the body.
 *   - listComplaints forces `where.raisedByUserId = requester.id` for a patient (query params can
 *     never override this), while admin/superadmin may filter freely by `status`.
 *   - getComplaintById 404s (not 403) for a non-owner patient — same enumeration-avoidance
 *     posture used throughout this codebase.
 *   - updateComplaint requires at least one recognized field in the body, else a clean 400
 *     VALIDATION_ERROR instead of a no-op write.
 *
 * config/db is mocked (no real Postgres in this sandbox); activityLogService/cacheService are
 * mocked to isolate this module's own branching from their internals.
 */
jest.mock('../../../src/config/db', () => ({
  complaint: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttl, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));

const prisma = require('../../../src/config/db');
const complaintsService = require('../../../src/modules/complaints/complaints.service');

const PATIENT = { id: 'patient-1', role: 'patient' };
const OTHER_PATIENT = { id: 'patient-2', role: 'patient' };
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

describe('complaintsService.createComplaint', () => {
  test('raisedByUserId is always requester.id, never trusted from the body', async () => {
    prisma.complaint.create.mockResolvedValue({ id: 'complaint-new' });
    prisma.complaint.findUnique.mockResolvedValue(complaintRow({ id: 'complaint-new' }));

    await complaintsService.createComplaint({ subject: 'X', raisedByUserId: 'attacker-controlled' }, PATIENT);

    expect(prisma.complaint.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ raisedByUserId: PATIENT.id, status: 'open' }) })
    );
  });
});

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

describe('complaintsService.getComplaintById — 404-not-403 ownership', () => {
  test('404 when the complaint does not exist', async () => {
    prisma.complaint.findUnique.mockResolvedValue(null);
    await expect(complaintsService.getComplaintById('x', PATIENT)).rejects.toMatchObject({ code: 'COMPLAINT_NOT_FOUND' });
  });

  test('404 (not 403) for a patient who did not raise this complaint', async () => {
    prisma.complaint.findUnique.mockResolvedValue(complaintRow({ raisedByUserId: OTHER_PATIENT.id }));

    await expect(complaintsService.getComplaintById('complaint-1', PATIENT)).rejects.toMatchObject({
      statusCode: 404,
      code: 'COMPLAINT_NOT_FOUND',
    });
  });

  test('the raising patient can view their own complaint', async () => {
    prisma.complaint.findUnique.mockResolvedValue(complaintRow());
    const result = await complaintsService.getComplaintById('complaint-1', PATIENT);
    expect(result.id).toBe('complaint-1');
  });

  test('admin/superadmin can view any complaint', async () => {
    prisma.complaint.findUnique.mockResolvedValue(complaintRow({ raisedByUserId: OTHER_PATIENT.id }));
    const result = await complaintsService.getComplaintById('complaint-1', ADMIN);
    expect(result.id).toBe('complaint-1');
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
