/**
 * Unit tests for modules/notifications/notifications.service.js — the per-user targeting rules
 * that are the entire point of this module (the historical bug: every role's inbox read one
 * shared global array):
 *
 *   - notifySystemEvent always writes to notification_recipients scoped to the ONE given userId,
 *     and best-effort fans out to email/push (both of which must never be allowed to throw here).
 *   - notifySystemEventSafe swallows any failure from notifySystemEvent (a side-effect must never
 *     roll back the already-successful action that triggered it) and only logs a warning.
 *   - broadcastNotification's audience resolution: 'all' means every active user regardless of
 *     role; 'patients'/'doctors'/'receptionists' filter by role AND require status:'active';
 *     'single_user' targets exactly targetUserId and is NOT filtered by active status (an admin
 *     explicitly targeting one named user should still land even if disabled) and 404s up front
 *     if that user doesn't exist.
 *   - markNotificationRead/markAllNotificationsRead: hard-scoped to requester.id (userId
 *     mismatch -> 404, never 403 — enumeration avoidance), and marking an already-read
 *     notification is an idempotent no-op (no redundant update/cache-bust).
 *
 * config/db is mocked (no real Postgres in this sandbox); activityLogService/cacheService/
 * emailService/pushService are mocked to isolate this module's own branching; config/logger is
 * mocked per this fix group's brief.
 */
jest.mock('../../../src/config/db', () => ({
  notification: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  notificationRecipient: {
    create: jest.fn(),
    createMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttl, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/services/emailService', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../src/services/pushService', () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }));

const prisma = require('../../../src/config/db');
const logger = require('../../../src/config/logger');
const emailService = require('../../../src/services/emailService');
const pushService = require('../../../src/services/pushService');
const cacheService = require('../../../src/services/cacheService');
const notificationsService = require('../../../src/modules/notifications/notifications.service');

const ADMIN = { id: 'admin-1', role: 'admin' };

describe('notificationsService.notifySystemEvent', () => {
  test('writes the in-app notification+recipient scoped to exactly the given userId, then fans out email+push', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'notif-1' });
    prisma.notificationRecipient.create.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ email: 'user@example.com' });

    await notificationsService.notifySystemEvent('user-1', { title: 'Hi', body: 'Body' });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: { title: 'Hi', body: 'Body', type: 'system', audience: 'single_user', targetUserId: 'user-1', senderUserId: null },
    });
    expect(prisma.notificationRecipient.create).toHaveBeenCalledWith({ data: { notificationId: 'notif-1', userId: 'user-1' } });
    expect(emailService.sendEmail).toHaveBeenCalledWith({ to: 'user@example.com', subject: 'Hi', text: 'Body' });
    expect(pushService.sendPush).toHaveBeenCalledWith('user-1', { title: 'Hi', body: 'Body' });
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:notifications:mylist:user-1:*');
  });

  test('a failure looking up the recipient\'s email does not prevent the push fan-out or throw', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'notif-1' });
    prisma.notificationRecipient.create.mockResolvedValue({});
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));

    await expect(notificationsService.notifySystemEvent('user-1', { title: 'Hi', body: 'Body' })).resolves.toBeUndefined();
    expect(emailService.sendEmail).toHaveBeenCalledWith({ to: undefined, subject: 'Hi', text: 'Body' });
    expect(pushService.sendPush).toHaveBeenCalled();
  });
});

describe('notificationsService.notifySystemEventSafe', () => {
  test('swallows a throw from notifySystemEvent and logs a warning instead of propagating', async () => {
    prisma.notification.create.mockRejectedValue(new Error('insert failed'));

    await expect(notificationsService.notifySystemEventSafe('user-1', { title: 'T', body: 'B' })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('insert failed'));
  });
});

describe('notificationsService.broadcastNotification — audience resolution', () => {
  function mockTransaction(userRows) {
    prisma.$transaction.mockImplementation(async (cb) => {
      const tx = {
        notification: { create: jest.fn().mockResolvedValue({ id: 'notif-broadcast', title: 't', body: 'b', type: 'broadcast', audience: 'all', targetUserId: null }) },
        user: { findMany: jest.fn().mockResolvedValue(userRows) },
        notificationRecipient: { createMany: jest.fn().mockResolvedValue({}) },
      };
      const result = await cb(tx);
      return { ...result, __tx: tx };
    });
  }

  test('"all" audience: every active user regardless of role, no role filter applied', async () => {
    mockTransaction([{ id: 'u1' }, { id: 'u2' }]);

    const result = await notificationsService.broadcastNotification({ audience: 'all', title: 'T', body: 'B' }, ADMIN);

    const txCall = await prisma.$transaction.mock.results[0].value;
    expect(txCall.__tx.user.findMany).toHaveBeenCalledWith({ where: { status: 'active' }, select: { id: true } });
    expect(result.recipientCount).toBe(2);
  });

  test('"patients" audience: filters by role:patient AND status:active', async () => {
    mockTransaction([{ id: 'p1' }]);

    await notificationsService.broadcastNotification({ audience: 'patients', title: 'T', body: 'B' }, ADMIN);

    const txCall = await prisma.$transaction.mock.results[0].value;
    expect(txCall.__tx.user.findMany).toHaveBeenCalledWith({ where: { status: 'active', role: 'patient' }, select: { id: true } });
  });

  test('"single_user" audience 404s up front when the target user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      notificationsService.broadcastNotification({ audience: 'single_user', targetUserId: 'ghost', title: 'T', body: 'B' }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 404, code: 'TARGET_USER_NOT_FOUND' });
  });

  test('"single_user" audience targets exactly targetUserId, bypassing the active-status filter (no user.findMany call)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1' });
    mockTransaction([]); // user.findMany should never be reached for single_user

    const result = await notificationsService.broadcastNotification(
      { audience: 'single_user', targetUserId: 'target-1', title: 'T', body: 'B' },
      ADMIN
    );

    const txCall = await prisma.$transaction.mock.results[0].value;
    expect(txCall.__tx.user.findMany).not.toHaveBeenCalled();
    expect(txCall.__tx.notificationRecipient.createMany).toHaveBeenCalledWith({
      data: [{ notificationId: 'notif-broadcast', userId: 'target-1' }],
      skipDuplicates: true,
    });
    expect(result.recipientCount).toBe(1);
  });

  test('an empty resolved audience skips the createMany call entirely (no zero-row insert)', async () => {
    mockTransaction([]);

    const result = await notificationsService.broadcastNotification({ audience: 'doctors', title: 'T', body: 'B' }, ADMIN);

    const txCall = await prisma.$transaction.mock.results[0].value;
    expect(txCall.__tx.notificationRecipient.createMany).not.toHaveBeenCalled();
    expect(result.recipientCount).toBe(0);
  });
});

describe('notificationsService.markNotificationRead — ownership + idempotency', () => {
  test('404 when the recipient row does not belong to requester.id (never 403)', async () => {
    prisma.notificationRecipient.findUnique.mockResolvedValue({ id: 'nr-1', userId: 'someone-else', readAt: null });

    await expect(notificationsService.markNotificationRead('nr-1', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOTIFICATION_NOT_FOUND',
    });
  });

  test('re-marking an already-read notification is a no-op (no update call, no cache bust)', async () => {
    const readAt = new Date('2026-01-01');
    prisma.notificationRecipient.findUnique.mockResolvedValue({ id: 'nr-1', userId: ADMIN.id, readAt });

    const result = await notificationsService.markNotificationRead('nr-1', ADMIN);

    expect(result).toEqual({ id: 'nr-1', readAt });
    expect(prisma.notificationRecipient.update).not.toHaveBeenCalled();
    expect(cacheService.invalidate).not.toHaveBeenCalled();
  });

  test('marking an unread notification updates readAt and busts the cache', async () => {
    prisma.notificationRecipient.findUnique.mockResolvedValue({ id: 'nr-1', userId: ADMIN.id, readAt: null });
    prisma.notificationRecipient.update.mockResolvedValue({ id: 'nr-1', readAt: new Date() });

    await notificationsService.markNotificationRead('nr-1', ADMIN);

    expect(prisma.notificationRecipient.update).toHaveBeenCalledWith({
      where: { id: 'nr-1' },
      data: { readAt: expect.any(Date) },
      select: { id: true, readAt: true },
    });
    expect(cacheService.invalidate).toHaveBeenCalledWith(`cache:notifications:mylist:${ADMIN.id}:*`);
  });
});

describe('notificationsService.markAllNotificationsRead', () => {
  test('scopes updateMany hard to requester.id and only unread rows', async () => {
    prisma.notificationRecipient.updateMany.mockResolvedValue({ count: 3 });

    const result = await notificationsService.markAllNotificationsRead(ADMIN);

    expect(prisma.notificationRecipient.updateMany).toHaveBeenCalledWith({
      where: { userId: ADMIN.id, readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(result).toEqual({ updatedCount: 3 });
  });
});
