/**
 * Business logic for the notifications module.
 * Responsibility: THIS is where audience resolution, ownership checks, and all Prisma/DB calls
 * for this module live. Controllers call these functions; these functions never touch req/res
 * directly.
 *
 * This is the module that actually implements real per-user notification targeting: every list/
 * read/read-all endpoint is hard-scoped to req.user.id via the notification_recipients join
 * table — no endpoint here ever reads or writes another user's notification state.
 */
const prisma = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const activityLogService = require('../../services/activityLogService');
const cacheService = require('../../services/cacheService');
const logger = require('../../config/logger');
const emailService = require('../../services/emailService');
const pushService = require('../../services/pushService');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

const MY_LIST_CACHE_TTL_SECONDS = 30;
const BROADCASTS_CACHE_TTL_SECONDS = 30;

// Maps a role-scoped audience value to the User.role it targets. 'all' and 'single_user' are
// deliberately absent — 'all' means every role (no role filter at all) and 'single_user' is
// resolved from targetUserId directly, not from a role.
const AUDIENCE_ROLE_MAP = {
  patients: 'patient',
  doctors: 'doctor',
  receptionists: 'receptionist',
};

function shapeNotification(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    audience: row.audience,
    targetUserId: row.targetUserId,
    createdAt: row.createdAt,
  };
}

/**
 * Single-user, SYSTEM-GENERATED alert — no human sender (senderUserId stays null), used by other
 * modules (appointments/payments/queue/doctors) to raise a real-time alert when a concrete event
 * happens to one user: "your booking is confirmed", "payment received", "your turn — token #4
 * called", "your account has been verified", etc. Fans out across channels: always writes the
 * in-app inbox notification, and (COMPLETENESS FIX, audit Priority 4) also best-effort
 * dispatches the same content via emailService/pushService's placeholder channels — see those
 * files' header comments for why they're log-only today (no vendor chosen yet) and how a real
 * provider gets swapped in later with zero changes to this function or any of its callers.
 * smsService deliberately is NOT part of this automatic fan-out: some call sites here fire
 * often (e.g. queue.service.js on every token call), and SMS is the one channel with a real
 * per-message cost once a provider is chosen — call smsService.sendSms directly from a specific
 * high-value call site instead (auth.service.js#forgotPassword already does).
 *
 * This is the single-user analogue of broadcastNotification's 'single_user' audience, but
 * without an admin `actor` — broadcastNotification requires one (route-enforced, always
 * admin/superadmin) and is wired for admin-initiated broadcasts only. Mirrors the exact
 * Notification+NotificationRecipient shape auth.service.js's local notifyUserInApp already uses
 * for password-reset heads-ups; centralized here now that several modules need the same thing,
 * rather than duplicating this same 6-line helper in each of them.
 *
 * Deliberately fire-and-forget from the CALLER's point of view in spirit (errors still throw,
 * but callers should treat a failure here as non-fatal to the real action that triggered it —
 * e.g. a booking must still succeed even if raising its "booking confirmed" notification fails;
 * see each call site's try/catch). The email/push fan-out below can never be the source of such
 * a throw — both helpers already swallow their own errors — only the in-app write above can.
 * @param {string} userId
 * @param {{title:string, body:string, type?:string}} content
 */
async function notifySystemEvent(userId, { title, body, type = 'system' }) {
  const notification = await prisma.notification.create({
    data: { title, body, type, audience: 'single_user', targetUserId: userId, senderUserId: null },
  });
  await prisma.notificationRecipient.create({ data: { notificationId: notification.id, userId } });
  // Bust this recipient's inbox cache immediately — without this the new notification would stay
  // invisible to them for up to MY_LIST_CACHE_TTL_SECONDS (same reasoning as
  // markNotificationRead/markAllNotificationsRead below).
  await cacheService.invalidate(`cache:notifications:mylist:${userId}:*`);

  // COMPLETENESS FIX (audit Priority 4 — "no email/SMS/push provider anywhere" / "no
  // notification actually fires from a real event"): every call site of this function (booking
  // confirmed, appointment status change, payment received, queue token called, doctor
  // verification/account-status changes, ...) is a real app event, not a manual admin action —
  // this is the one place to fan those out to the placeholder email/push channels too, so every
  // existing and future caller gets both automatically with no call-site changes anywhere.
  // Best-effort (both helpers already swallow their own errors) and fire-and-forget from this
  // function's point of view — awaited so a failure surfaces in logs promptly, never so it can
  // block or fail the in-app write above, which has already committed by this point.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null);
  await Promise.all([
    emailService.sendEmail({ to: user?.email, subject: title, text: body }),
    pushService.sendPush(userId, { title, body }),
  ]);
}

/**
 * notifySystemEvent, but never throws — for every real-event call site (a new booking, a
 * payment, a queue-token call, a doctor verification) the notification is a side-effect of an
 * action that has ALREADY succeeded; a transient failure raising the alert (DB hiccup, whatever)
 * must never fail or roll back that already-successful booking/payment/status-change. Logs a
 * warning and swallows the error instead.
 * @param {string} userId
 * @param {{title:string, body:string, type?:string}} content
 */
async function notifySystemEventSafe(userId, content) {
  try {
    await notifySystemEvent(userId, content);
  } catch (err) {
    logger.warn(`[notifications] notifySystemEventSafe failed for user ${userId}: ${err.message}`);
  }
}

/**
 * Resolves the recipient user-id list for a broadcast, creates the Notification, and fans it out
 * to notification_recipients — all inside one transaction so a partial fan-out can never persist.
 *  - 'all': every active User, any role (including admin/superadmin — deliberate: "all" means
 *    all registered accounts).
 *  - 'patients'/'doctors'/'receptionists': active Users of that role.
 *  - 'single_user': the exact targetUserId, regardless of account status — an admin explicitly
 *    targeting one named user should still land even if that account is temporarily disabled.
 * Broad audiences exclude disabled accounts from fan-out (no point notifying an account that
 * can't log in); explicit single-user targeting doesn't apply that filter.
 * @param {{audience:string, title:string, body:string, type?:string, targetUserId?:string}} body
 *   - already shape-validated by notifications.validation.js#broadcast.
 * @param {{id:string, role:string}} actor - always admin/superadmin (route-enforced).
 */
async function broadcastNotification(body, actor) {
  const audience = body.audience;
  const title = String(body.title).trim();
  const messageBody = String(body.body).trim();
  // type field removed from the request body (backend-cleanup audit — see
  // notifications.validation.js#broadcast's comment): an admin-initiated broadcast always saves
  // as this fixed type now, distinguishing it from a system-generated notifySystemEvent alert.
  const type = 'broadcast';
  const targetUserId = audience === 'single_user' ? body.targetUserId : null;

  if (audience === 'single_user') {
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!targetUser) {
      throw new ApiError(404, 'TARGET_USER_NOT_FOUND', 'Target user not found.');
    }
  }

  const { notification, recipientCount } = await prisma.$transaction(async (tx) => {
    const created = await tx.notification.create({
      data: {
        title,
        body: messageBody,
        type,
        senderUserId: actor.id,
        audience,
        targetUserId,
      },
    });

    let userIds;
    if (audience === 'single_user') {
      userIds = [targetUserId];
    } else {
      const roleFilter = AUDIENCE_ROLE_MAP[audience]; // undefined for 'all' -> no role filter
      const where = { status: 'active', ...(roleFilter ? { role: roleFilter } : {}) };
      const users = await tx.user.findMany({ where, select: { id: true } });
      userIds = users.map((u) => u.id);
    }

    if (userIds.length > 0) {
      await tx.notificationRecipient.createMany({
        data: userIds.map((userId) => ({ notificationId: created.id, userId })),
        skipDuplicates: true,
      });
    }

    return { notification: created, recipientCount: userIds.length };
  });

  await activityLogService.log({
    actorUserId: actor.id,
    actorRole: actor.role,
    actionType: 'notification.broadcast',
    targetEntityType: 'notification',
    targetEntityId: notification.id,
    description: `Broadcast notification (audience=${audience}, recipients=${recipientCount})`,
  });

  await cacheService.invalidate(`cache:notifications:broadcasts:*`);
  // NOT attempting per-recipient invalidation of listMyNotifications here — a broad audience can
  // touch thousands of users' caches, not worth walking. Each affected inbox simply serves a
  // stale (missing-the-new-item) view for up to MY_LIST_CACHE_TTL_SECONDS, a deliberate,
  // documented trade — see README "Caching" section.

  return { ...shapeNotification(notification), recipientCount };
}

/**
 * Admin-facing platform-wide notifications table (GET /notifications/broadcast). Lists rows
 * already created by broadcastNotification — no new writes. recipientCount/readCount are
 * aggregates computed via `_count` and a grouped count query, not stored columns.
 * @param {{page?:number, pageSize?:number}} query
 */
async function listBroadcasts({ page, pageSize }) {
  // Admin-only, platform-wide, role-invariant -> key by query params only.
  const cacheKey = `cache:notifications:broadcasts:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, BROADCASTS_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          title: true,
          body: true,
          type: true,
          audience: true,
          targetUserId: true,
          createdAt: true,
          _count: { select: { recipients: true } },
        },
      }),
      prisma.notification.count(),
    ]);

    const notificationIds = rows.map((r) => r.id);
    const readCounts = notificationIds.length
      ? await prisma.notificationRecipient.groupBy({
          by: ['notificationId'],
          where: { notificationId: { in: notificationIds }, readAt: { not: null } },
          _count: { _all: true },
        })
      : [];
    const readCountByNotificationId = new Map(readCounts.map((rc) => [rc.notificationId, rc._count._all]));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        type: r.type,
        audience: r.audience,
        targetUserId: r.targetUserId,
        createdAt: r.createdAt,
        recipientCount: r._count.recipients,
        readCount: readCountByNotificationId.get(r.id) || 0,
      })),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

/**
 * GET /notifications — the caller's own inbox, always hard-scoped to requester.id (rule 3: the
 * literal fix for "every role's inbox reads one shared global array"). Rows are keyed by the
 * NotificationRecipient row's own id — that's the addressable "my notification" id the mark-read
 * endpoints operate on, not the underlying Notification's id.
 *
 * unreadOnly filter removed (backend-cleanup audit — user request: "website frontend me nahi hai
 * but backend bna hua hai to backend se hata do"): no web/mobile inbox screen ever sends it —
 * every one lists the full paginated inbox, showing read-state inline per row via `readAt`.
 * @param {{page?:number, pageSize?:number}} query
 * @param {{id:string, role:string}} requester
 */
async function listMyNotifications({ page, pageSize }, requester) {
  // Strictly per-user — key MUST include requester.id (rule: cache-key scoping must match
  // response scoping).
  const cacheKey = `cache:notifications:mylist:${requester.id}:${page || ''}:${pageSize || ''}`;

  return cacheService.getOrSet(cacheKey, MY_LIST_CACHE_TTL_SECONDS, async () => {
    const { skip, take, page: p, pageSize: ps } = parsePagination({ page, pageSize });

    const where = { userId: requester.id };

    const [rows, total] = await Promise.all([
      prisma.notificationRecipient.findMany({
        where,
        select: {
          id: true,
          notificationId: true,
          readAt: true,
          notification: { select: { title: true, body: true, type: true, createdAt: true } },
        },
        orderBy: { notification: { createdAt: 'desc' } },
        skip,
        take,
      }),
      prisma.notificationRecipient.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        notificationId: r.notificationId,
        title: r.notification.title,
        body: r.notification.body,
        type: r.notification.type,
        createdAt: r.notification.createdAt,
        readAt: r.readAt,
      })),
      pagination: buildPaginationMeta({ page: p, pageSize: ps, total }),
    };
  });
}

/**
 * PATCH /notifications/:id/read. `id` is a NotificationRecipient id. Ownership: userId !==
 * requester.id -> 404 (never 403 — enumeration avoidance, matching the pattern used throughout
 * this codebase). Idempotent: already-read is a no-op, still 200.
 * @param {string} id
 * @param {{id:string, role:string}} requester
 */
async function markNotificationRead(id, requester) {
  const row = await prisma.notificationRecipient.findUnique({
    where: { id },
    select: { id: true, userId: true, readAt: true },
  });

  if (!row || row.userId !== requester.id) {
    throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
  }

  if (row.readAt) {
    return { id: row.id, readAt: row.readAt };
  }

  const updated = await prisma.notificationRecipient.update({
    where: { id },
    data: { readAt: new Date() },
    select: { id: true, readAt: true },
  });

  await cacheService.invalidate(`cache:notifications:mylist:${requester.id}:*`);

  return updated;
}

/**
 * PATCH /notifications/read-all. Bulk update scoped HARD to the caller (rule 3 — the literal fix
 * for "marks the entire global list read for everyone").
 * @param {{id:string, role:string}} requester
 */
async function markAllNotificationsRead(requester) {
  const result = await prisma.notificationRecipient.updateMany({
    where: { userId: requester.id, readAt: null },
    data: { readAt: new Date() },
  });

  await cacheService.invalidate(`cache:notifications:mylist:${requester.id}:*`);

  return { updatedCount: result.count };
}

module.exports = {
  notifySystemEvent,
  notifySystemEventSafe,
  broadcastNotification,
  listBroadcasts,
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
