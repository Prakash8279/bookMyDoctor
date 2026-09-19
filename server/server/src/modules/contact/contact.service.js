/**
 * Business logic for the contact module.
 * Responsibility: all Prisma/DB calls for this module live here. Controllers call these
 * functions; these functions never touch req/res directly.
 *
 * POST / is anonymous (public contact-us form) — no activityLogService call is made for it:
 * there is no actorUserId for an unauthenticated submission, and audit logging in this codebase
 * is for authenticated mutating actions, not public intake. PATCH / (admin) does log, same as
 * every other admin mutation.
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const { pickPresentFields } = require('../../utils/pickPresentFields');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

const LIST_CACHE_TTL_SECONDS = 60;

const CONTACT_SELECT = {
  id: true,
  name: true,
  email: true,
  subject: true,
  message: true,
  status: true,
  response: true,
  createdAt: true,
};

function shapeContactRequest(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    status: row.status,
    response: row.response,
    createdAt: row.createdAt,
  };
}

/**
 * @param {{name:string, email:string, subject:string, message:string}} body - already
 *   shape-validated by contact.validation.js#createContactRequest.
 */
async function createContactRequest(body) {
  const created = await prisma.contactRequest.create({
    data: {
      name: String(body.name).trim(),
      email: String(body.email).trim(),
      subject: String(body.subject).trim(),
      message: String(body.message).trim(),
      status: 'open',
    },
    select: CONTACT_SELECT,
  });

  await cacheService.invalidate('cache:contact:list:*');

  return shapeContactRequest(created);
}

/**
 * @param {string} id
 * @param {{status?:string, response?:string}} body - already shape-validated.
 * @param {{id:string, role:string}} actor - always admin/superadmin (route-enforced).
 */
async function updateContactRequest(id, body, actor) {
  const existing = await prisma.contactRequest.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new ApiError(404, 'CONTACT_REQUEST_NOT_FOUND', 'Contact request not found.');
  }

  const updates = pickPresentFields(body, ['status', 'response']);
  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'At least one of status or response is required.');
  }

  const row = await prisma.contactRequest.update({ where: { id }, data: updates, select: CONTACT_SELECT });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'contact.status_update',
    targetEntityType: 'contactRequest',
    targetEntityId: id,
    description: `Updated contact request: ${Object.keys(updates).join(', ')}`,
  });

  await cacheService.invalidate('cache:contact:list:*');

  return shapeContactRequest(row);
}

/**
 * @param {{status?:string, page?:number, pageSize?:number}} query
 */
async function listContactRequests({ status, page, pageSize }) {
  // Admin-only, role-invariant -> key by query params only.
  const cacheKey = `cache:contact:list:${status || ''}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = {};
    if (status) where.status = status;

    const [rows, total] = await Promise.all([
      prisma.contactRequest.findMany({
        where,
        select: CONTACT_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.contactRequest.count({ where }),
    ]);

    return {
      rows: rows.map(shapeContactRequest),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

module.exports = { createContactRequest, updateContactRequest, listContactRequests };
