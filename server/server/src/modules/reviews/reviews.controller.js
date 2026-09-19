/**
 * Controllers for the reviews module.
 * Responsibility: parse req -> call the matching reviews.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const reviewsService = require('./reviews.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const createReview = asyncHandler(async (req, res) => {
  const review = await reviewsService.createReview(req.body, req.user);
  return success(res, review, { statusCode: 201, message: 'Review submitted and pending moderation.' });
});

const updateReviewStatus = asyncHandler(async (req, res) => {
  const review = await reviewsService.updateReviewStatus(req.params.id, req.body.status, req.user);
  return success(res, review, { message: 'Review status updated.' });
});

const listReviews = asyncHandler(async (req, res) => {
  const { doctorId, status, page, pageSize } = req.query;
  const { rows, pagination } = await reviewsService.listReviews({ doctorId, status, page, pageSize }, req.user);
  return success(res, rows, { pagination });
});

module.exports = { createReview, updateReviewStatus, listReviews };
