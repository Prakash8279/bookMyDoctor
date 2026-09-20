/**
 * Unit tests for jobs/bookingWorker.js — the BullMQ Worker that actually executes queued booking
 * jobs (see that file's own header comment for the full contention/retry story this backs).
 *
 * bullmq itself is mocked (Worker + UnrecoverableError) so requiring this module never opens a
 * real Redis connection or spins up a real Worker poll loop — same reasoning as
 * appointments.service.test.js mocking jobs/bookingQueue.js away for the same underlying
 * constructor-time-side-effect problem. ./queueConnection, config/env, config/logger and
 * jobs/bookingQueue are mocked too, so the only real code under test is bookingWorker.js's own
 * `processor` function and its `worker.on(...)` event wiring — appointments.service.js's
 * runBookingJob is mocked, exactly like it's exercised at its own call site in
 * appointments.service.test.js rather than re-tested here.
 */
jest.mock('bullmq', () => {
  class UnrecoverableError extends Error {}
  const mockWorkerInstance = {
    on: jest.fn(),
  };
  const Worker = jest.fn(() => mockWorkerInstance);
  return { Worker, UnrecoverableError, __mockWorkerInstance: mockWorkerInstance };
});

jest.mock('../../../src/jobs/queueConnection', () => ({ __fakeConnection: true }));

jest.mock('../../../src/config/env', () => ({
  booking: { workerConcurrency: 7 },
}));

jest.mock('../../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../src/jobs/bookingQueue', () => ({ QUEUE_NAME: 'appointment-booking' }));

jest.mock('../../../src/modules/appointments/appointments.service', () => ({
  runBookingJob: jest.fn(),
}));

const { Worker, UnrecoverableError } = require('bullmq');
const logger = require('../../../src/config/logger');
const ApiError = require('../../../src/utils/ApiError');
const appointmentsService = require('../../../src/modules/appointments/appointments.service');

// Requiring the module under test executes its top-level `new Worker(...)` + `worker.on(...)`
// wiring exactly once, synchronously, right here at module-evaluation time. jest.config.js's
// `clearMocks: true` wipes every jest.fn()'s recorded calls/results before EACH test runs
// (including before the first one) — so anything we want to assert about THIS one-time wiring
// has to be pulled off the mocks and stashed in plain variables now, at the top level, rather
// than re-read from Worker.mock.calls/.results inside a test.
require('../../../src/jobs/bookingWorker');

// bookingWorker.js calls `new Worker(QUEUE_NAME, processor, { connection, concurrency })`.
const [constructedQueueName, processor, workerOptions] = Worker.mock.calls[0];
const workerInstance = Worker.mock.results[0].value;

function findHandler(eventName) {
  const call = workerInstance.on.mock.calls.find(([name]) => name === eventName);
  return call && call[1];
}

const completedHandler = findHandler('completed');
const failedHandler = findHandler('failed');
const errorHandler = findHandler('error');

describe('jobs/bookingWorker', () => {
  test('constructs a BullMQ Worker on the booking queue with the configured concurrency', () => {
    expect(constructedQueueName).toBe('appointment-booking');
    expect(typeof processor).toBe('function');
    expect(workerOptions.connection).toEqual({ __fakeConnection: true });
    expect(workerOptions.concurrency).toBe(7);
  });

  describe('processor', () => {
    test('processes a job successfully by delegating to runBookingJob and returning its result', async () => {
      const jobResult = { appointmentId: 'appt-1', status: 'upcoming' };
      appointmentsService.runBookingJob.mockResolvedValueOnce(jobResult);

      const job = { id: 'job-1', data: { doctorUserId: 'doc-1' } };
      const result = await processor(job);

      expect(appointmentsService.runBookingJob).toHaveBeenCalledWith(job.data);
      expect(result).toBe(jobResult);
    });

    test('wraps a deterministic ApiError failure as an UnrecoverableError carrying {code,message} JSON, skipping retries', async () => {
      const apiError = new ApiError(409, 'SLOT_ALREADY_BOOKED', 'This slot has already been booked.');
      // mockRejectedValue (not "Once") — this test calls processor(job) twice below (once to
      // assert the rejection type, once more to capture and inspect the thrown error itself).
      appointmentsService.runBookingJob.mockRejectedValue(apiError);

      const job = { id: 'job-2', data: { doctorUserId: 'doc-2' } };

      await expect(processor(job)).rejects.toBeInstanceOf(UnrecoverableError);

      let caught;
      try {
        await processor(job);
      } catch (err) {
        caught = err;
      }
      expect(JSON.parse(caught.message)).toEqual({
        code: 'SLOT_ALREADY_BOOKED',
        message: 'This slot has already been booked.',
      });
    });

    test('rethrows a non-ApiError failure as-is so BullMQ applies its own attempts/backoff retry', async () => {
      const lockError = new Error('Could not acquire booking lock in time');
      lockError.name = 'LockAcquisitionError';
      // mockRejectedValue (not "Once") — this test calls processor(job) twice below.
      appointmentsService.runBookingJob.mockRejectedValue(lockError);

      const job = { id: 'job-3', data: { doctorUserId: 'doc-3' } };

      await expect(processor(job)).rejects.toBe(lockError);
      // Specifically NOT wrapped as UnrecoverableError — this is what lets BullMQ's
      // attempts/backoff (configured on the queue in bookingQueue.js) retry the job.
      await expect(processor(job)).rejects.not.toBeInstanceOf(UnrecoverableError);
    });
  });

  describe('event wiring (logging/metrics only — does not affect retry/backoff)', () => {
    test('logs on completed', () => {
      expect(typeof completedHandler).toBe('function');

      completedHandler({ id: 'job-4' });

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('job job-4 completed'));
    });

    test('logs on failed and keeps an incrementing in-process failedJobsCount', () => {
      expect(typeof failedHandler).toBe('function');

      failedHandler({ id: 'job-5' }, new Error('boom'));
      failedHandler({ id: 'job-6' }, new Error('boom again'));

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn.mock.calls[0][0]).toEqual(expect.stringContaining('failedJobsCount since process start: 1'));
      expect(logger.warn.mock.calls[1][0]).toEqual(expect.stringContaining('failedJobsCount since process start: 2'));
    });

    test('does not throw when the failed job itself is missing (job undefined)', () => {
      expect(() => failedHandler(undefined, new Error('boom'))).not.toThrow();
    });

    test('logs on worker-level error (e.g. a Redis connection problem)', () => {
      expect(typeof errorHandler).toBe('function');

      errorHandler(new Error('Redis connection refused'));

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Redis connection refused'));
    });
  });
});
