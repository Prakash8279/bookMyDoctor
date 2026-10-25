const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../utils/apiResponse');
const { getPublicStats } = require('./publicStats.service');

router.get('/stats', asyncHandler(async (_req, res) => success(res, await getPublicStats())));

module.exports = router;
