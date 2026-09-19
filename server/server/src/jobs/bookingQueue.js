/**
 * BullMQ Queue definition for the booking write path: appointments.controller.js pushes a job here
 * and returns 202 + a job/queue-token id immediately instead of blocking on the DB write.
 * Responsibility: queue producer only — the actual booking logic lives in bookingWorker.js
 * (via appointments.service.js#runBookingJob).
 */
const crypto = require('crypto');
const { Queue } = require('bullmq');
const connection = require('./queueConnection');
const cacheService = require('../services/cacheService');

const QUEUE_NAME = 'appointment-booking';

const bookingQueue = new Queue(QUEUE_NAME, { connection });

// Rough, unmeasured estimate (ms) of how long one serialized booking attempt takes end-to-end
// (Redis lock acquire + Postgres advisory lock + transaction) for the same doctor+date. This is
// used ONLY to compute a friendly ETA for the "X people ahead of you" poll response — it is not
// correctness-critical and safe to tune later once we have real timing data from production.
const ESTIMATED_MS_PER_BOOKING = 300;

// PERF FIX (scalability audit): see getQueuePosition below — a short-TTL cache of the pending-jobs
// snapshot used by every "X people ahead of you" poll, so concurrent pollers during a real booking
// burst share one Redis fetch instead of each doing their own.
const PENDING_JOBS_CACHE_KEY = 'cache:bookingQueue:pendingJobs:v1';
const PENDING_JOBS_CACHE_TTL_SECONDS = 2;

/**
 * Enqueues one booking job and returns immediately (does not wait for it to be processed).
 * Uses an explicit random UUID jobId rather than BullMQ's default incrementing counter id —
 * the public poll endpoint (GET /appointments/booking-status/:jobId) would otherwise leak total
 * booking volume via a guessable sequential id.
 * @param {object} payload - plain-data job payload, see appointments.service.js#enqueueBooking
 *   for the exact shape.
 * @returns {Promise<import('bullmq').Job>}
 */
async function enqueueBookingJob(payload) {
  const jobId = crypto.randomUUID();
  return bookingQueue.add('create', payload, {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 500 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
  });
}

/**
 * @param {string} jobId
 * @returns {Promise<import('bullmq').Job|undefined>}
 */
async function getJob(jobId) {
  return bookingQueue.getJob(jobId);
}

/**
 * Computes this job's live position within the same doctor+date queue, for the "X people ahead
 * of you" poll display (IRCTC-Tatkal-style live queue status) — purely informational, does not
 * affect and is never consulted by the actual serialization (advisory lock/Redis lock/unique
 * index) that guarantees correctness in bookingWorker.js/appointments.service.js#runBookingJob.
 * @param {import('bullmq').Job} job
 * @returns {Promise<{aheadOfYou: number, queuePosition: number, etaSeconds: number}>}
 */
async function getQueuePosition(job) {
  if (!job) {
    return { aheadOfYou: 0, queuePosition: 1, etaSeconds: 0 };
  }

  const { doctorUserId, appointmentDate } = job.data || {};

  // PERF FIX (scalability audit): this ran on EVERY GET /appointments/booking-status/:jobId poll
  // with no caching — during a real booking burst, many clients poll concurrently, so this fetch
  // (up to 2000 full BullMQ jobs from Redis) multiplied exactly at the moment Redis is under the
  // most load. We now cache a small, plain-object snapshot of pending jobs (not the raw BullMQ
  // Job instances, which hold internal queue references and are not safely JSON-serializable) for
  // a couple of seconds via cacheService — a poll landing inside that window is served from cache
  // instead of hitting Redis again. The defensive cap of 2000 on the range fetched is unchanged —
  // it only bounds worst-case work during an extreme burst; normal scale never gets close to it,
  // so pending jobs beyond this cap simply aren't counted (a harmless undercount for a
  // display-only number, same as the short cache TTL below being a couple of seconds stale).
  const pendingJobsSnapshot = await cacheService.getOrSet(
    PENDING_JOBS_CACHE_KEY,
    PENDING_JOBS_CACHE_TTL_SECONDS,
    async () => {
      const jobs = await bookingQueue.getJobs(['waiting', 'active', 'delayed'], 0, 2000);
      return jobs.map((j) => ({
        timestamp: j.timestamp,
        doctorUserId: j.data && j.data.doctorUserId,
        appointmentDate: j.data && j.data.appointmentDate,
      }));
    }
  );

  const aheadOfYou = pendingJobsSnapshot.filter((j) => {
    return (
      j.doctorUserId === doctorUserId &&
      j.appointmentDate === appointmentDate &&
      j.timestamp < job.timestamp
    );
  }).length;

  return {
    aheadOfYou,
    queuePosition: aheadOfYou + 1,
    etaSeconds: Math.round((aheadOfYou * ESTIMATED_MS_PER_BOOKING) / 1000),
  };
}

module.exports = { bookingQueue, enqueueBookingJob, getJob, getQueuePosition, QUEUE_NAME };
