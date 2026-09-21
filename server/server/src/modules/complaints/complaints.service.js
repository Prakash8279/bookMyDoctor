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

// createComplaint (POST /) and getComplaintById (GET /:id) removed (backend-cleanup audit — user
// request: "website frontend me nahi hai but backend bna hua hai to backend se hata do"): no
// web/mobile screen, for any role, ever files a complaint or fetches a single one by id — see
// complaints.routes.js's header comment.

module.exports = { updateComplaint, listComplaints };
