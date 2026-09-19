/**
 * Controllers for the appointments module.
 * Responsibility: parse req -> call the matching appointments.service.js function -> shape the
 * response via utils/apiResponse.js. Stay THIN — no DB queries, no business rules here.
 *
 * POST /appointments is the "waiting room" entry point: it never touches Prisma or the Redis
 * lock on the HTTP request thread. enqueueBooking() only pushes a job onto bookingQueue and
 * returns a job id — the real logic runs inside the BullMQ worker (see appointments.service.js's
 * header comment and jobs/bookingWorker.js for the full concurrency writeup).
 */
const appointmentsService = require('./appointments.service');
const { success } = require('../../utils/apiResponse');
const asyncHandler = require('../../utils/asyncHandler');

const createAppointment = asyncHandler(async (req, res) => {
  const result = await appointmentsService.enqueueBooking(req.body, req.user);
  return success(res, result, { statusCode: 202, message: 'Booking is being processed.' });
});

const getBookingStatus = asyncHandler(async (req, res) => {
  const result = await appointmentsService.getBookingStatus(req.params.jobId, req.user);
  return success(res, result);
});

const listAppointments = asyncHandler(async (req, res) => {
  const { page, pageSize, status, date, dateFrom, dateTo, doctorId, clinicId, patientId } = req.query;
  const { rows, pagination } = await appointmentsService.listAppointments(
    { page, pageSize, status, date, dateFrom, dateTo, doctorId, clinicId, patientId },
    req.user
  );
  return success(res, rows, { pagination });
});

const getAppointment = asyncHandler(async (req, res) => {
  const appointment = await appointmentsService.getAppointmentById(req.params.id, req.user);
  return success(res, appointment);
});

const updateAppointmentStatus = asyncHandler(async (req, res) => {
  const appointment = await appointmentsService.updateAppointmentStatus(req.params.id, req.body.status, req.user);
  return success(res, appointment, { message: 'Appointment status updated' });
});

module.exports = {
  createAppointment,
  getBookingStatus,
  listAppointments,
  getAppointment,
  updateAppointmentStatus,
};
