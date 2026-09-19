/**
 * Controllers for the contact module.
 * Responsibility: parse req -> call the matching contact.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 */
const contactService = require('./contact.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const createContactRequest = asyncHandler(async (req, res) => {
  const contactRequest = await contactService.createContactRequest(req.body);
  return success(res, contactRequest, { statusCode: 201, message: 'Thanks for reaching out — we will get back to you soon.' });
});

const updateContactRequest = asyncHandler(async (req, res) => {
  const contactRequest = await contactService.updateContactRequest(req.params.id, req.body, req.user);
  return success(res, contactRequest, { message: 'Contact request updated.' });
});

const listContactRequests = asyncHandler(async (req, res) => {
  const { status, page, pageSize } = req.query;
  const { rows, pagination } = await contactService.listContactRequests({ status, page, pageSize });
  return success(res, rows, { pagination });
});

module.exports = { createContactRequest, updateContactRequest, listContactRequests };
