/**
 * Controllers for the notifications module.
 * Responsibility: parse req -> call the matching notifications.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const notificationsService = require('./notifications.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const broadcastNotification = asyncHandler(async (req, res) => {
  const result = await notificationsService.broadcastNotification(req.body, req.user);
  return success(res, result, { statusCode: 201, message: 'Notification broadcast.' });
});

const listBroadcasts = asyncHandler(async (req, res) => {
  const { page, pageSize } = req.query;
  const { rows, pagination } = await notificationsService.listBroadcasts({ page, pageSize });
  return success(res, rows, { pagination });
});

const listMyNotifications = asyncHandler(async (req, res) => {
  const { unreadOnly, page, pageSize } = req.query;
  const { rows, pagination } = await notificationsService.listMyNotifications({ unreadOnly, page, pageSize }, req.user);
  return success(res, rows, { pagination });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const result = await notificationsService.markNotificationRead(req.params.id, req.user);
  return success(res, result, { message: 'Notification marked read.' });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const result = await notificationsService.markAllNotificationsRead(req.user);
  return success(res, result, { message: 'All notifications marked read.' });
});

module.exports = {
  broadcastNotification,
  listBroadcasts,
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
