/**
 * Unit tests for modules/queue/queue.service.js — the queue position/ETA math and the strictly
 * sequential status-transition state machine, since those are the two places a subtle bug here
 * would be invisible in normal manual testing but wrong for every patient in line:
 *
 *   - getMyQueueStatus: a patient's own "where do I stand" computation. patientsAhead must only
 *     count OTHER 'waiting' tokens with a strictly smaller tokenNumber than the caller's own —
 *     get the comparison operator wrong (<=) and a patient always sees one extra person ahead of
 *     them (including sometimes themselves).
 *   - listQueue: patientsAhead/estimatedWaitMinutes must be computed per-doctor (a receptionist's
 *     clinic can have several doctors' queues running the same day, so the running "waiting"
 *     count must reset at each doctor boundary). The `status` query filter this used to also
 *     guard against was removed (backend-cleanup audit — neither web nor mobile ever sent it).
 *   - updateQueueStatus: QUEUE_ORDER only allows moving exactly one step forward
 *     (waiting -> called -> in_consultation -> completed) — no skips, no going backward — and the
 *     'completed' cascade into the linked appointment must fire only when that appointment isn't
 *     already terminal, guarding against double-processing a queue token whose appointment was
 *     already cancelled/completed/no-show through some other path.
 *
 * config/db, cacheService, config/logger, activityLogService, notifications.service, and
 * appointments.service (the lazy require inside updateQueueStatus's cascade branch) are all
 * mocked — this module transitively requires config/redis (via the real cacheService) which
 * would otherwise try to open a real ioredis connection, and config/db which would otherwise
 * try to open a real Postgres connection; neither exists in this sandbox (see
 * tests/setupEnv.js's header comment for the general policy this suite follows).
 */
jest.mock('../../../src/config/db', () => ({
  queueToken: { findUnique: jest.fn(), findMany: jest.fn() },
  appointment: { findUnique: jest.fn() },
  receptionistProfile: { findUnique: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../../../src/services/cacheService', () => ({
  // Real getOrSet is cache-aside over Redis; for these tests we only care about the computation
  // inside the fetchFn, so always treat every call as a cache miss.
  getOrSet: jest.fn((key, ttlSeconds, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));
jest.mock('../../../src/config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/modules/notifications/notifications.service', () => ({
  notifySystemEventSafe: jest.fn(),
}));
jest.mock('../../../src/modules/appointments/appointments.service', () => ({
  invalidateAppointmentListCaches: jest.fn(),
}));

const prisma = require('../../../src/config/db');
const cacheService = require('../../../src/services/cacheService');
const logger = require('../../../src/config/logger');
const activityLogService = require('../../../src/services/activityLogService');
const notificationsService = require('../../../src/modules/notifications/notifications.service');
const appointmentsService = require('../../../src/modules/appointments/appointments.service');
const ApiError = require('../../../src/utils/ApiError');
const queueService = require('../../../src/modules/queue/queue.service');

const MINUTES_PER_WAITING_PATIENT = 9; // mirrors the module's own private constant

describe('queueService.getMyQueueStatus', () => {
  test('throws APPOINTMENT_NOT_FOUND (404) when the appointment does not exist', async () => {
    prisma.appointment.findUnique.mockResolvedValue(null);

    await expect(queueService.getMyQueueStatus('appt-1', { id: 'patient-1', role: 'patient' })).rejects.toMatchObject(
      { statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' }
    );
  });

  test('throws APPOINTMENT_NOT_FOUND (404), not 403, when the appointment belongs to someone else', async () => {
    // Enumeration-avoidance posture documented in this file's header comment: a mismatch must
    // never distinguish "doesn't exist" from "exists but isn't yours".
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', patientUserId: 'someone-else' });

    await expect(queueService.getMyQueueStatus('appt-1', { id: 'patient-1', role: 'patient' })).rejects.toMatchObject(
      { statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' }
    );
  });

  test('returns the all-null shape when the appointment exists but never reached the queue', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', patientUserId: 'patient-1' });
    prisma.queueToken.findUnique.mockResolvedValue(null);

    const result = await queueService.getMyQueueStatus('appt-1', { id: 'patient-1', role: 'patient' });

    expect(result).toEqual({ token: null, status: null, nowServing: null, patientsAhead: null, estimatedWaitMinutes: null });
    // Nothing to rank against yet, so the per-day queue must never even be fetched.
    expect(prisma.queueToken.findMany).not.toHaveBeenCalled();
  });

  test('while waiting, patientsAhead counts only OTHER waiting tokens with a strictly smaller tokenNumber', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', patientUserId: 'patient-1' });
    prisma.queueToken.findUnique.mockResolvedValue({
      tokenNumber: 5,
      status: 'waiting',
      queueDate: '2026-09-10',
      doctorUserId: 'doctor-1',
    });
    prisma.queueToken.findMany.mockResolvedValue([
      { tokenNumber: 1, status: 'completed' }, // already served — must not count as "ahead"
      { tokenNumber: 2, status: 'waiting' }, // ahead
      { tokenNumber: 4, status: 'waiting' }, // ahead
      { tokenNumber: 5, status: 'waiting' }, // the caller's own token — must not count itself
      { tokenNumber: 6, status: 'waiting' }, // behind — must not count
    ]);

    const result = await queueService.getMyQueueStatus('appt-1', { id: 'patient-1', role: 'patient' });

    expect(result.patientsAhead).toBe(2);
    expect(result.estimatedWaitMinutes).toBe(2 * MINUTES_PER_WAITING_PATIENT);
    expect(result.nowServing).toBeNull();
    expect(result.token).toBe(5);
    expect(result.status).toBe('waiting');
  });

  test('once called/in_consultation, patientsAhead is always 0 and nowServing reports the currently-serving token', async () => {
    prisma.appointment.findUnique.mockResolvedValue({ id: 'appt-1', patientUserId: 'patient-1' });
    prisma.queueToken.findUnique.mockResolvedValue({
      tokenNumber: 3,
      status: 'in_consultation',
      queueDate: '2026-09-10',
      doctorUserId: 'doctor-1',
    });
    prisma.queueToken.findMany.mockResolvedValue([
      { tokenNumber: 1, status: 'completed' },
      { tokenNumber: 2, status: 'completed' },
      { tokenNumber: 3, status: 'in_consultation' },
      { tokenNumber: 4, status: 'waiting' },
    ]);

    const result = await queueService.getMyQueueStatus('appt-1', { id: 'patient-1', role: 'patient' });

    // Not "waiting" any more, so patientsAhead/ETA collapse to 0 regardless of who else is queued.
    expect(result.patientsAhead).toBe(0);
    expect(result.estimatedWaitMinutes).toBe(0);
    expect(result.nowServing).toBe(3);
  });
});

describe('queueService.listQueue', () => {
  test('a receptionist with no clinic assignment gets an empty page without ever querying queue tokens', async () => {
    prisma.receptionistProfile.findUnique.mockResolvedValue(null);

    const result = await queueService.listQueue({}, { id: 'recep-1', role: 'receptionist' });

    expect(result).toEqual({
      rows: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      truncated: false,
    });
    expect(prisma.queueToken.findMany).not.toHaveBeenCalled();
  });

  test('running "waiting ahead" count resets per doctor, so one busy doctor cannot inflate another doctor\'s ETA', async () => {
    prisma.receptionistProfile.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });
    // Sorted [{doctorUserId asc}, {tokenNumber asc}] the same way the real Prisma orderBy would
    // return them.
    prisma.queueToken.findMany.mockResolvedValue([
      { id: 'q1', appointmentId: 'a1', doctorUserId: 'doc-A', clinicId: 'clinic-1', tokenNumber: 1, status: 'waiting', queueDate: '2026-09-10', appointment: null },
      { id: 'q2', appointmentId: 'a2', doctorUserId: 'doc-A', clinicId: 'clinic-1', tokenNumber: 2, status: 'waiting', queueDate: '2026-09-10', appointment: null },
      // A brand new doctor group starts here — must NOT inherit doc-A's running count of 2.
      { id: 'q3', appointmentId: 'a3', doctorUserId: 'doc-B', clinicId: 'clinic-1', tokenNumber: 1, status: 'waiting', queueDate: '2026-09-10', appointment: null },
    ]);

    const result = await queueService.listQueue({}, { id: 'recep-1', role: 'receptionist' });

    const byId = Object.fromEntries(result.rows.map((r) => [r.id, r]));
    expect(byId.q1.patientsAhead).toBe(0);
    expect(byId.q2.patientsAhead).toBe(1);
    expect(byId.q3.patientsAhead).toBe(0); // reset, not carried over from doc-A's queue
    expect(byId.q3.estimatedWaitMinutes).toBe(0);
    expect(result.truncated).toBe(false); // well under MAX_QUEUE_FETCH
  });

  // The `status` filter test that used to live here was removed along with the filter itself
  // (backend-cleanup audit — user request: "website frontend me nahi hai but backend bna hua hai
  // to backend se hata do"): neither web nor mobile ever sent a `status` query param — both
  // always fetch the day's full queue — so queue.service.js#listQueue no longer accepts one.

  test('logs a warning and sets truncated:true when the defensive MAX_QUEUE_FETCH cap is hit, since patientsAhead becomes understated beyond it', async () => {
    const rows = Array.from({ length: queueService.MAX_QUEUE_FETCH }, (_, i) => ({
      id: `q${i}`,
      appointmentId: `a${i}`,
      doctorUserId: 'doc-A',
      clinicId: 'clinic-1',
      tokenNumber: i + 1,
      status: 'waiting',
      queueDate: '2026-09-10',
      appointment: null,
    }));
    prisma.queueToken.findMany.mockResolvedValue(rows);

    const result = await queueService.listQueue({}, { id: 'doc-A', role: 'doctor' });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('MAX_QUEUE_FETCH'), expect.any(Object));
    expect(result.truncated).toBe(true);
  });

  test('truncated stays false when the row count is one short of the MAX_QUEUE_FETCH cap', async () => {
    const rows = Array.from({ length: queueService.MAX_QUEUE_FETCH - 1 }, (_, i) => ({
      id: `q${i}`,
      appointmentId: `a${i}`,
      doctorUserId: 'doc-A',
      clinicId: 'clinic-1',
      tokenNumber: i + 1,
      status: 'waiting',
      queueDate: '2026-09-10',
      appointment: null,
    }));
    prisma.queueToken.findMany.mockResolvedValue(rows);

    const result = await queueService.listQueue({}, { id: 'doc-A', role: 'doctor' });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(result.truncated).toBe(false);
  });
});

describe('queueService.updateQueueStatus — sequential transition rules', () => {
  const baseRow = (overrides = {}) => ({
    id: 'q1',
    appointmentId: 'appt-1',
    doctorUserId: 'doc-A',
    clinicId: 'clinic-1',
    tokenNumber: 7,
    status: 'waiting',
    queueDate: '2026-09-10',
    appointment: { id: 'appt-1', status: 'confirmed', source: 'online', patient: { id: 'patient-1', name: 'Pat' } },
    ...overrides,
  });

  let tx;
  beforeEach(() => {
    tx = { queueToken: { update: jest.fn() }, appointment: { update: jest.fn() } };
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
  });

  test('rejects a transition that skips a step (waiting -> completed) with 409 QUEUE_INVALID_TRANSITION', async () => {
    prisma.queueToken.findUnique.mockResolvedValue(baseRow({ status: 'waiting' }));

    await expect(queueService.updateQueueStatus('q1', 'completed', { id: 'doc-A', role: 'doctor' })).rejects.toMatchObject(
      { statusCode: 409, code: 'QUEUE_INVALID_TRANSITION' }
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects a backward transition (called -> waiting) with 409 QUEUE_INVALID_TRANSITION', async () => {
    prisma.queueToken.findUnique.mockResolvedValue(baseRow({ status: 'called' }));

    await expect(queueService.updateQueueStatus('q1', 'waiting', { id: 'doc-A', role: 'doctor' })).rejects.toMatchObject(
      { statusCode: 409, code: 'QUEUE_INVALID_TRANSITION' }
    );
  });

  test('a doctor cannot act on another doctor\'s token — 404, not 403 (enumeration-avoidance)', async () => {
    prisma.queueToken.findUnique.mockResolvedValue(baseRow({ doctorUserId: 'doc-OTHER' }));

    await expect(queueService.updateQueueStatus('q1', 'called', { id: 'doc-A', role: 'doctor' })).rejects.toMatchObject(
      { statusCode: 404, code: 'QUEUE_TOKEN_NOT_FOUND' }
    );
  });

  test('waiting -> called: updates status, notifies the patient, and does NOT cascade into the appointment', async () => {
    prisma.queueToken.findUnique
      .mockResolvedValueOnce(baseRow({ status: 'waiting' })) // getVisibleQueueTokenOrThrow
      .mockResolvedValueOnce(baseRow({ status: 'called' })); // re-fetch after the transaction

    const result = await queueService.updateQueueStatus('q1', 'called', { id: 'doc-A', role: 'doctor' });

    expect(tx.queueToken.update).toHaveBeenCalledWith({ where: { id: 'q1' }, data: { status: 'called' } });
    expect(tx.appointment.update).not.toHaveBeenCalled();
    expect(appointmentsService.invalidateAppointmentListCaches).not.toHaveBeenCalled();
    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledWith(
      'patient-1',
      expect.objectContaining({ type: 'queue', body: expect.stringContaining('#7') })
    );
    expect(activityLogService.log).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('called');
  });

  test('in_consultation -> completed cascades the linked (non-terminal) appointment to completed, with its own audit-log entry', async () => {
    prisma.queueToken.findUnique
      .mockResolvedValueOnce(baseRow({ status: 'in_consultation', appointment: { id: 'appt-1', status: 'confirmed', source: 'online', patient: { id: 'patient-1', name: 'Pat' } } }))
      .mockResolvedValueOnce(baseRow({ status: 'completed' }));

    await queueService.updateQueueStatus('q1', 'completed', { id: 'doc-A', role: 'doctor' });

    expect(tx.appointment.update).toHaveBeenCalledWith({ where: { id: 'appt-1' }, data: { status: 'completed' } });
    // One log entry for the queue transition, one more for the cascaded appointment change —
    // Rule 11 in this module's header/inline comments: a mutating cascade needs its own trail.
    expect(activityLogService.log).toHaveBeenCalledTimes(2);
    expect(activityLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'appointment.status_update', targetEntityId: 'appt-1' })
    );
    expect(appointmentsService.invalidateAppointmentListCaches).toHaveBeenCalledWith({
      patientUserId: 'patient-1',
      doctorUserId: 'doc-A',
      clinicId: 'clinic-1',
    });
    // 'completed' is not 'called', so no "your turn" notification fires for it.
    expect(notificationsService.notifySystemEventSafe).not.toHaveBeenCalled();
  });

  test('in_consultation -> completed does NOT re-cascade when the linked appointment is already terminal', async () => {
    prisma.queueToken.findUnique
      .mockResolvedValueOnce(baseRow({ status: 'in_consultation', appointment: { id: 'appt-1', status: 'cancelled', source: 'online', patient: { id: 'patient-1', name: 'Pat' } } }))
      .mockResolvedValueOnce(baseRow({ status: 'completed' }));

    await queueService.updateQueueStatus('q1', 'completed', { id: 'doc-A', role: 'doctor' });

    expect(tx.appointment.update).not.toHaveBeenCalled();
    expect(activityLogService.log).toHaveBeenCalledTimes(1); // only the queue-token log, no cascade log
    expect(appointmentsService.invalidateAppointmentListCaches).not.toHaveBeenCalled();
  });

  test('throws 400 APPOINTMENT_NOT_YET_DUE when trying to complete a token whose queueDate is still in the future', async () => {
    // BUG FIX (user report: "koi patient aaj book kiya 2 din bad ka doctor chah kar v aaj
    // complete nahi kar sakta" / "kahi se v conform na ho jab tak same date na ho") — this is the
    // Queue Monitor's OWN Complete button (in_consultation -> completed), a separate code path
    // from appointments.service.js#updateAppointmentStatus, so it needed its own copy of the
    // same guard. baseRow's default queueDate ('2026-09-10') is in the past — this test
    // overrides it to a future date to prove the new check actually fires.
    prisma.queueToken.findUnique.mockResolvedValueOnce(
      baseRow({ status: 'in_consultation', queueDate: '2099-01-01' })
    );

    await expect(
      queueService.updateQueueStatus('q1', 'completed', { id: 'doc-A', role: 'doctor' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'APPOINTMENT_NOT_YET_DUE' });
    expect(tx.queueToken.update).not.toHaveBeenCalled();
    expect(tx.appointment.update).not.toHaveBeenCalled();
  });
});
