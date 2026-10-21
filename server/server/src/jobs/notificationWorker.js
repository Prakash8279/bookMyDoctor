const prisma = require('../config/db');
const emailService = require('../services/emailService');
const pushService = require('../services/pushService');
const logger = require('../config/logger');

async function deliverNotification(job) {
  const { notificationId, userId, message } = job.data;
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.targetUserId !== userId || notification.audience !== 'single_user') return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  await emailService.sendEmail({
    to: user?.email, subject: notification.title, text: notification.body, type: notification.type,
    ...(message.emailDetails ? { details: message.emailDetails } : {}),
    ...(message.emailAmount != null ? { amount: message.emailAmount } : {}),
    ...(message.emailActionPath ? { actionPath: message.emailActionPath } : {}),
    throwOnError: true,
  });
  await pushService.sendPush(userId, { title: notification.title, body: notification.body });
}

function createNotificationWorker() {
  const { Worker } = require('bullmq');
  const worker = new Worker('notification-delivery', deliverNotification, {
    connection: require('./queueConnection'), concurrency: 4,
  });
  worker.on('error', () => logger.error('[notificationWorker] Delivery worker connection error'));
  worker.on('failed', (job) => logger.warn(`[notificationWorker] Delivery attempt failed for job ${job?.id}; attempts=${job?.attemptsMade}`));
  return worker;
}
module.exports = { deliverNotification, createNotificationWorker };
