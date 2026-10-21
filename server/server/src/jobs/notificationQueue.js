// Redis persists these jobs so SMTP latency/retries never block a successful payment response.
let queue;
function getQueue() {
  if (!queue) {
    const { Queue } = require('bullmq');
    queue = new Queue('notification-delivery', { connection: require('../config/redis') });
    queue.on('error', () => require('../config/logger').error('[notificationQueue] Delivery queue connection error'));
  }
  return queue;
}

async function enqueueNotification(notificationId, userId, message) {
  return getQueue().add('deliver', { notificationId, userId, message }, {
    jobId: `notification-${notificationId}`,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 7 * 86400, count: 1000 },
  });
}

async function closeNotificationQueue() { if (queue) await queue.close(); }
module.exports = { enqueueNotification, closeNotificationQueue };
