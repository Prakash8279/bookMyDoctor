/**
 * Controllers for the queue module.
 * Responsibility: parse req -> call the matching queue.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const queueService = require('./queue.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const listQueue = asyncHandler(async (req, res) => {
  const { date, status, page, pageSize } = req.query;
  const { rows, pagination, truncated } = await queueService.listQueue({ date, status, page, pageSize }, req.user);
  // LOAD-REVIEW FIX: surface the defensive-cap signal to the caller instead of only a server log
  // line — see queue.service.js's MAX_QUEUE_FETCH comment.
  return success(res, rows, { pagination, truncated });
});

const updateQueueStatus = asyncHandler(async (req, res) => {
  const token = await queueService.updateQueueStatus(req.params.id, req.body.status, req.user);
  return success(res, token, { message: 'Queue status updated' });
});

const getMyQueueStatus = asyncHandler(async (req, res) => {
  const result = await queueService.getMyQueueStatus(req.params.appointmentId, req.user);
  return success(res, result);
});

module.exports = { listQueue, updateQueueStatus, getMyQueueStatus };
