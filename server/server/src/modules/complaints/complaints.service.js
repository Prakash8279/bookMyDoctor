/**
 * Business logic for the complaints module.
 * Responsibility: THIS is where ownership checks, business rules, and all Prisma/DB calls for
 * this module live. Controllers call these functions; these functions never touch req/res
 * directly.
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const { pickPresentFields } = require('../../utils/pickPresentFields');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const { ADMIN_ROLES } = require('../../utils/roles');

const LIST_CACHE_TTL_SECONDS = 60;

/**
 * Busts every cached listComplaints page that could contain the given patient's complaints,
 * plus the admin's unfiltered/status-filtered views.
 */
async function invalidateComplaintListCaches(raisedByUserId) {
  const patterns = [`cache:complaints:list:admin:*`];
  if (raisedByUserId) patterns.push(`cache:complaints:list:patient:${raisedByUserId}:*`);
  await Promise.all(patterns.map((p) => cacheService.invalidate(p)));
}

const COMPLAINT_SELECT = {
  id: true,
  raisedByUserId: true,
  subject: true,
  description: true,
  status: true,
  adminResponse: true,
  createdAt: true,
  updatedAt: true,
  raisedBy: { select: { id: true, name: true } },
};

function shapeComplaint(row) {
  return {
    id: row.id,
    raisedBy: row.raisedBy ? { id: row.raisedBy.id, name: row.raisedBy.name } : { id: row.raisedByUserId, name: null },
    subject: row.subject,
    description: row.description,
    status: row.status,
    adminResponse: row.adminResponse,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * @param {{subject:string, description?:string}} body - already shape-validated.
 * @param {{id:string, role:string}} requester - always role 'patient' (route-enforced).
 */
async function createComplaint(body, requester) {
  const created = await prisma.complaint.create({
    data: {
      raisedByUserId: requester.id, // never from body — rule 3
      subject: String(body.subject).trim(),
      description: body.description ? String(body.description).trim() : null,
      status: 'open',
    },
    select: { id: true },
  });

  await activityLogService.log({
    actorUserId: requester.id,
    actorRole: requester.role,
    actionType: 'complaint.create',
    targetEntityType: 'complaint',
    targetEntityId: created.id,
    description: `Raised complaint (id=${created.id})`,
  });

  await invalidateComplaintListCaches(requester.id);

  const row = await prisma.complaint.findUnique({ where: { id: created.id }, select: COMPLAINT_SELECT });
  return shapeComplaint(row);
}

/**
 * @param {string} id
 * @param {{status?:string, adminResponse?:string}} body - already shape-validated.
 * @param {{id:string, role:string}} actor - always admin/superadmin (route-enforced).
 */
async function updateComplaint(id, body, actor) {
  const existing = await prisma.complaint.findUnique({
    where: { id },
    select: { id: true, status: true, raisedByUserId: true },
  });
  if (!existing) {
    throw new ApiError(404, 'COMPLAINT_NOT_FOUND', 'Complaint not found.');
  }

  const updates = pickPresentFields(body, ['status', 'adminResponse']);
  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'At least one of status or adminResponse is required.');
  }

  await prisma.complaint.update({ where: { id }, data: updates });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'complaint.status_update',
    targetEntityType: 'complaint',
    targetEntityId: id,
    description: `Updated complaint: ${Object.keys(updates).join(', ')}`,
  });

  await invalidateComplaintListCaches(existing.raisedByUserId);

  const row = await prisma.complaint.findUnique({ where: { id }, select: COMPLAINT_SELECT });
  return shapeComplaint(row);
}

/**
 * @param {{status?:string, page?:number, pageSize?:number}} query
 * @param {{id:string, role:string}} requester
 */
async function listComplaints({ status, page, pageSize }, requester) {
  // Ownership-scoped output -> key MUST include role + requester id for a patient; admin sees
  // everything, scoped only by its own `status` filter.
  const scope = requester.role === 'patient' ? `patient:${requester.id}` : 'admin';
  const cacheKey = `cache:complaints:list:${scope}:${status || ''}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {};
    if (requester.role === 'patient') {
      where.raisedByUserId = requester.id; // forced scoping, never the client's choice
    } else if (ADMIN_ROLES.includes(requester.role)) {
      if (status) where.status = status;
    }

    const [rows, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        select: COMPLAINT_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.complaint.count({ where }),
    ]);

    return {
      rows: rows.map(shapeComplaint),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

/**
 * 404 (not 403) for a non-owner patient — same enumeration-avoidance posture used throughout the
 * codebase (see appointments.service.js#getVisibleAppointmentOrThrow).
 * @param {string} id
 * @param {{id:string, role:string}} requester
 */
async function getComplaintById(id, requester) {
  const row = await prisma.complaint.findUnique({ where: { id }, select: COMPLAINT_SELECT });
  if (!row) {
    throw new ApiError(404, 'COMPLAINT_NOT_FOUND', 'Complaint not found.');
  }

  if (ADMIN_ROLES.includes(requester.role)) return shapeComplaint(row);
  if (requester.role === 'patient' && row.raisedByUserId === requester.id) return shapeComplaint(row);

  throw new ApiError(404, 'COMPLAINT_NOT_FOUND', 'Complaint not found.');
}

module.exports = { createComplaint, updateComplaint, listComplaints, getComplaintById };
