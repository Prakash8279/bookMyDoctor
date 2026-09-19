/**
 * BullMQ Worker that processes queued booking jobs, serializing writes to the SAME doctor+slot
 * via lockService + the DB partial unique index, while letting jobs for DIFFERENT slots run in
 * parallel (up to `concurrency`). Responsibility: this is where the booking logic in
 * appointments.service.js#runBookingJob actually executes under load — run as a separate
 * process (`node src/jobs/worker.process.js` / `npm run worker`) so it scales independently of
 * the HTTP API instances.
 *
 * How this survives a burst of concurrent requests for the same doctor+slot:
 *  1. Every simultaneous POST /appointments for the identical (doctorId, date, time) returns
 *     202 immediately — the HTTP path (appointments.service.js#enqueueBooking) never touches
 *     Postgres or the Redis lock, only the queue, so API latency stays flat regardless of burst
 *     size.
 *  2. This worker pool (concurrency > 1) processes DIFFERENT slots in parallel, but jobs
 *     targeting the SAME slot serialize through lockService's `booking:{doctorId}:{date}:{time}`
 *     key: whoever acquires it first runs its transaction (token number, appointment row, queue
 *     token — all atomic) to completion; everyone else for that exact key blocks in
 *     lockService's own bounded retry loop.
 *  3. The winner commits and releases the lock. If a second job for the same slot ever reaches
 *     its own INSERT (e.g. after a lock timeout race, or the lock's TTL lapsing mid-transaction
 *     on a crashed holder), it collides with the appointments_doctor_slot_unique partial index —
 *     translated by runBookingJob to ApiError(409, 'SLOT_ALREADY_BOOKED', ...), which this
 *     processor wraps as UnrecoverableError so BullMQ never wastes a retry on a deterministically
 *     failing booking.
 *  4. A job that can't even acquire the lock within its own bounded wait (heavy contention)
 *     throws a plain LockAcquisitionError — NOT an ApiError — and falls through to BullMQ's own
 *     job-level exponential backoff (`attempts`/`backoff` on the queue). By the time it's
 *     retried, the slot has almost always already resolved one way or the other.
 *  5. The Postgres partial unique index is the ultimate backstop regardless of the application
 *     layer: even if Redis were down or a lock were lost to a mid-transaction crash (bounded by
 *     its own TTL, so it self-heals), at most one non-cancelled row for that
 *     (doctorId, date, time) can ever commit — full stop.
 *  6. Every original caller polls GET /appointments/booking-status/:jobId and gets back either
 *     the confirmed booking with its real token number, or a clean SLOT_ALREADY_BOOKED they can
 *     show the user — never a hung request, a silent double-booking, or a duplicate token number.
 */
const { Worker, UnrecoverableError } = require('bullmq');
const connection = require('./queueConnection');
const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { QUEUE_NAME } = require('./bookingQueue');
const appointmentsService = require('../modules/appointments/appointments.service');

async function processor(job) {
  try {
    return await appointmentsService.runBookingJob(job.data);
  } catch (err) {
    if (err instanceof ApiError) {
      // Deterministic business failure (slot taken, doctor not found, outside OPD hours, ...) —
      // never worth retrying. UnrecoverableError skips the remaining attempts/backoff entirely
      // and moves the job straight to 'failed', carrying a JSON-encoded {code,message} in the
      // error's own `message` so getBookingStatus() can parse it back out cleanly.
      throw new UnrecoverableError(JSON.stringify({ code: err.code, message: err.message }));
    }
    // Anything else — a LockAcquisitionError from heavy contention, a transient DB/connection
    // blip — is a candidate for BullMQ's own attempts/backoff, so it's rethrown as-is.
    throw err;
  }
}

const worker = new Worker(QUEUE_NAME, processor, {
  connection,
  concurrency: env.booking.workerConcurrency,
});

worker.on('completed', (job) => {
  logger.info(`[bookingWorker] job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.warn(`[bookingWorker] job ${job && job.id} failed: ${err.message}`);
});

worker.on('error', (err) => {
  // Worker-level (not job-level) errors — e.g. a Redis connection problem.
  logger.error(`[bookingWorker] worker error: ${err.message}`);
});

module.exports = worker;
