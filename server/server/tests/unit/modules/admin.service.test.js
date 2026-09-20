/**
 * Unit tests for modules/admin/admin.service.js — the activity log, system_settings/booking_rules
 * singleton upserts, the dashboard-stats and revenue-trend aggregates, the patients directory, and
 * (see bottom of file) the read-only BullMQ booking-queue failed-jobs view.
 *
 * ROLE GATING NOTE: this file has NO role check anywhere in it — every function trusts the
 * `actor`/`requester` it's handed and does no `ADMIN_ROLES.includes(...)` branching of its own
 * (contrast with clinics.service.js's `isAdmin()` helper). admin.routes.js wires
 * `authorize('admin', 'superadmin')` at the router level (`router.use(adminIpAllowlist,
 * authenticate, authorize(...))`, applied to every route in this module) BEFORE any controller/
 * service code runs, so "reject a non-admin caller" is enforced entirely at the route layer, not
 * here. There is deliberately no test asserting the service itself rejects a non-admin actor —
 * doing so would test behavior that doesn't exist in this file and would misdescribe where the
 * real guard lives.
 *
 * Three kinds of bug this guards against instead:
 *
 *   - getDashboardStats/getRevenueTrend's date-window math: both derive UTC month boundaries from
 *     `todayUTCDateOnly()` (a moving target), so these tests recompute the same boundaries the
 *     same way rather than hardcoding a date, and separately verify the exact `status: { notIn:
 *     [...] }` / `status: 'paid'` filters that make these numbers the FIXED replacements for the
 *     frontend's old mislabeled stand-ins (FRONTEND_SCREENS_REPORT.md: "Verified doctors" was
 *     actually every doctor row; "Monthly revenue" was the sum of ALL payments ever).
 *   - getRevenueTrend's defensive re-clamp of `months` (belt-and-suspenders behind the validator)
 *     and its gap-filling of months with zero paid revenue into a complete, contiguous series.
 *   - updatePatientStatus's 404 guard (only an actual patient row can have its login toggled here)
 *     and that it fires the real-time account-status notification with the right title/body pair.
 *
 * config/db is mocked (no real Postgres in this sandbox — see tests/setupEnv.js's header
 * comment); activityLogService/cacheService/notifications.service/jobs/bookingQueue are mocked to
 * isolate this module's own branching from their internals (no real Redis in this sandbox either).
 * cacheService.getOrSet always runs the fetcher (simulated cache miss), matching
 * doctors.service.test.js's convention. pagination and dateOnly are used for real, per this
 * suite's scope.
 */
jest.mock('../../../src/config/db', () => ({
  activityLog: { findMany: jest.fn(), count: jest.fn() },
  systemSettings: { findUnique: jest.fn(), upsert: jest.fn() },
  bookingRules: { findUnique: jest.fn(), upsert: jest.fn() },
  doctorProfile: { count: jest.fn() },
  user: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  appointment: { count: jest.fn() },
  payment: { aggregate: jest.fn() },
  $queryRaw: jest.fn(),
}));
jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttlSeconds, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));
jest.mock('../../../src/modules/notifications/notifications.service', () => ({
  notifySystemEventSafe: jest.fn(),
}));
jest.mock('../../../src/jobs/bookingQueue', () => ({
  bookingQueue: { getFailed: jest.fn(), getFailedCount: jest.fn() },
}));

const prisma = require('../../../src/config/db');
const activityLogService = require('../../../src/services/activityLogService');
const cacheService = require('../../../src/services/cacheService');
const notificationsService = require('../../../src/modules/notifications/notifications.service');
const { bookingQueue } = require('../../../src/jobs/bookingQueue');
const { todayUTCDateOnly } = require('../../../src/utils/dateOnly');
const adminService = require('../../../src/modules/admin/admin.service');

const ADMIN = { id: 'admin-1', role: 'admin' };

describe('adminService.getActivityLog', () => {
  test('builds the where clause only from filters actually provided', async () => {
    prisma.activityLog.findMany.mockResolvedValue([]);
    prisma.activityLog.count.mockResolvedValue(0);

    await adminService.getActivityLog({ actorUserId: 'user-1', actionType: 'clinic.create' });

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { actorUserId: 'user-1', actionType: 'clinic.create' } })
    );
  });

  test('an empty query omits both filters from the where clause', async () => {
    prisma.activityLog.findMany.mockResolvedValue([]);
    prisma.activityLog.count.mockResolvedValue(0);

    await adminService.getActivityLog({});

    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  test('shapes a row WITH a joined actor into {id, name, email}', async () => {
    prisma.activityLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        actorUserId: 'user-1',
        actorRole: 'doctor',
        ipAddress: '1.2.3.4',
        actionType: 'clinic.create',
        targetEntityType: 'clinic',
        targetEntityId: 'clinic-1',
        description: 'Created clinic',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        actor: { id: 'user-1', name: 'Dr A', email: 'a@example.com' },
      },
    ]);
    prisma.activityLog.count.mockResolvedValue(1);

    const result = await adminService.getActivityLog({});

    expect(result.rows[0].actor).toEqual({ id: 'user-1', name: 'Dr A', email: 'a@example.com' });
  });

  // The join can miss (actor account since deleted) while the FK id itself is still recorded —
  // this must still surface an actor object with the id, not silently drop it to null.
  test('a row whose joined actor is null but actorUserId is set falls back to {id, name:null, email:null}', async () => {
    prisma.activityLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        actorUserId: 'deleted-user-1',
        actorRole: 'doctor',
        ipAddress: null,
        actionType: 'clinic.create',
        targetEntityType: 'clinic',
        targetEntityId: 'clinic-1',
        description: 'Created clinic',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        actor: null,
      },
    ]);
    prisma.activityLog.count.mockResolvedValue(1);

    const result = await adminService.getActivityLog({});

    expect(result.rows[0].actor).toEqual({ id: 'deleted-user-1', name: null, email: null });
  });

  test('a system-initiated row with no actorUserId at all shapes actor as null', async () => {
    prisma.activityLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        actorUserId: null,
        actorRole: null,
        ipAddress: null,
        actionType: 'system.cron',
        targetEntityType: null,
        targetEntityId: null,
        description: 'Scheduled job ran',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        actor: null,
      },
    ]);
    prisma.activityLog.count.mockResolvedValue(1);

    const result = await adminService.getActivityLog({});

    expect(result.rows[0].actor).toBeNull();
  });
});

describe('adminService.getSystemSettings / updateSystemSettings', () => {
  test('getSystemSettings throws 500 SYSTEM_SETTINGS_NOT_CONFIGURED when the singleton row is missing', async () => {
    prisma.systemSettings.findUnique.mockResolvedValue(null);

    await expect(adminService.getSystemSettings()).rejects.toMatchObject({
      statusCode: 500,
      code: 'SYSTEM_SETTINGS_NOT_CONFIGURED',
    });
  });

  test('getSystemSettings returns the row as-is when present', async () => {
    const row = { id: 1, platformName: 'BookMyDoctor24' };
    prisma.systemSettings.findUnique.mockResolvedValue(row);

    await expect(adminService.getSystemSettings()).resolves.toBe(row);
  });

  test('updateSystemSettings always upserts id:1, trims strings, and never writes bookingFee', async () => {
    prisma.systemSettings.upsert.mockResolvedValue({ id: 1 });

    await adminService.updateSystemSettings(
      { platformName: '  BookMyDoctor24  ', supportEmail: '  help@example.com  ', supportPhone: ' 123 ', maintenanceMode: true, bookingFee: 999 },
      ADMIN
    );

    const call = prisma.systemSettings.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: 1 });
    expect(call.update).toEqual({
      platformName: 'BookMyDoctor24',
      supportEmail: 'help@example.com',
      supportPhone: '123',
      maintenanceMode: true,
    });
    expect(call.update).not.toHaveProperty('bookingFee');
    expect(call.create).toEqual({ id: 1, ...call.update });
  });

  test('an empty supportEmail/supportPhone is stored as null, not an empty string', async () => {
    prisma.systemSettings.upsert.mockResolvedValue({ id: 1 });

    await adminService.updateSystemSettings({ platformName: 'X', supportEmail: '', supportPhone: '', maintenanceMode: false }, ADMIN);

    expect(prisma.systemSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ supportEmail: null, supportPhone: null }) })
    );
  });

  // maintenanceMode is coerced with a strict `=== true` check, not a generic truthiness cast —
  // a stray truthy-but-not-boolean value (e.g. a string, which express-validator's own
  // sanitizer/validator chain is expected to already reject before this point) must never flip
  // maintenance mode on by accident.
  test('maintenanceMode is normalized to a strict boolean via === true, not general truthiness', async () => {
    prisma.systemSettings.upsert.mockResolvedValue({ id: 1 });

    await adminService.updateSystemSettings({ platformName: 'X', maintenanceMode: 'yes' }, ADMIN);

    expect(prisma.systemSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ maintenanceMode: false }) })
    );
  });

  test('logs the activity after a successful update', async () => {
    prisma.systemSettings.upsert.mockResolvedValue({ id: 1 });

    await adminService.updateSystemSettings({ platformName: 'X' }, ADMIN);

    expect(activityLogService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'systemSettings.update', targetEntityType: 'systemSettings', targetEntityId: '1' })
    );
  });
});

describe('adminService.getBookingRules / updateBookingRules', () => {
  test('getBookingRules throws 500 BOOKING_RULES_NOT_CONFIGURED when the singleton row is missing', async () => {
    prisma.bookingRules.findUnique.mockResolvedValue(null);

    await expect(adminService.getBookingRules()).rejects.toMatchObject({
      statusCode: 500,
      code: 'BOOKING_RULES_NOT_CONFIGURED',
    });
  });

  test('updateBookingRules full-replaces the singleton, defaulting the three optional window fields to null when omitted', async () => {
    prisma.bookingRules.upsert.mockResolvedValue({ id: 1 });

    await adminService.updateBookingRules(
      { cancellationWindowHours: 24, maxBookingsPerPatient: 5, defaultSlotMinutes: 15 },
      ADMIN
    );

    expect(prisma.bookingRules.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: {
        cancellationWindowHours: 24,
        maxBookingsPerPatient: 5,
        defaultSlotMinutes: 15,
        onlineBookingWindowStart: null,
        onlineBookingWindowEnd: null,
        onlineBookingMaxAdvanceDays: null,
      },
      create: expect.objectContaining({ id: 1 }),
    });
  });

  test('an explicit onlineBookingMaxAdvanceDays is passed through untouched, not clobbered to null', async () => {
    prisma.bookingRules.upsert.mockResolvedValue({ id: 1 });

    await adminService.updateBookingRules(
      { cancellationWindowHours: 24, maxBookingsPerPatient: 5, defaultSlotMinutes: 15, onlineBookingMaxAdvanceDays: 30 },
      ADMIN
    );

    expect(prisma.bookingRules.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ onlineBookingMaxAdvanceDays: 30 }) })
    );
  });
});

describe('adminService.getDashboardStats', () => {
  function monthBoundsFor(todayUTC) {
    const firstOfMonthUTC = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), 1));
    const firstOfNextMonthUTC = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() + 1, 1));
    return { firstOfMonthUTC, firstOfNextMonthUTC };
  }

  test('queries verified doctors, patients, today\'s non-cancelled/non-pending-payment appointments, and this month\'s paid revenue', async () => {
    const todayUTC = todayUTCDateOnly();
    const { firstOfMonthUTC, firstOfNextMonthUTC } = monthBoundsFor(todayUTC);
    prisma.doctorProfile.count.mockResolvedValue(12);
    prisma.user.count.mockResolvedValue(340);
    prisma.appointment.count.mockResolvedValue(7);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 15000 } });

    const result = await adminService.getDashboardStats();

    expect(prisma.doctorProfile.count).toHaveBeenCalledWith({ where: { status: 'verified' } });
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { role: 'patient' } });
    expect(prisma.appointment.count).toHaveBeenCalledWith({
      where: { appointmentDate: todayUTC, status: { notIn: ['cancelled', 'pending_payment'] } },
    });
    expect(prisma.payment.aggregate).toHaveBeenCalledWith({
      _sum: { amount: true },
      where: { status: 'paid', createdAt: { gte: firstOfMonthUTC, lt: firstOfNextMonthUTC } },
    });
    expect(result).toEqual({
      verifiedDoctorsCount: 12,
      registeredPatientsCount: 340,
      todaysBookingsCount: 7,
      monthlyRevenue: 15000,
    });
  });

  test('monthlyRevenue falls back to 0 when there is no paid revenue this month (aggregate sum is null)', async () => {
    prisma.doctorProfile.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);
    prisma.appointment.count.mockResolvedValue(0);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });

    const result = await adminService.getDashboardStats();

    expect(result.monthlyRevenue).toBe(0);
  });
});

describe('adminService.getRevenueTrend', () => {
  test('defaults to 6 months when called with no argument', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const trend = await adminService.getRevenueTrend(undefined);

    expect(trend).toHaveLength(6);
  });

  test('defaults to 6 months for a non-positive or non-integer value (defensive re-clamp)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(adminService.getRevenueTrend(0)).resolves.toHaveLength(6);
    await expect(adminService.getRevenueTrend(-5)).resolves.toHaveLength(6);
    await expect(adminService.getRevenueTrend(3.5)).resolves.toHaveLength(6);
  });

  test('clamps a value above the 24-month cap down to 24', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const trend = await adminService.getRevenueTrend(500);

    expect(trend).toHaveLength(24);
  });

  test('an in-range integer is honored exactly', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const trend = await adminService.getRevenueTrend(3);

    expect(trend).toHaveLength(3);
  });

  test('fills months with no paid payments as zero-revenue/zero-count entries, keeping the series gap-free', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const trend = await adminService.getRevenueTrend(3);

    expect(trend.every((m) => m.revenue === 0 && m.appointmentCount === 0)).toBe(true);
    // Oldest-first, current in-progress month last.
    const todayUTC = todayUTCDateOnly();
    const currentMonthKey = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), 1)).toISOString().slice(0, 7);
    expect(trend[trend.length - 1].month).toBe(currentMonthKey);
  });

  test('converts the raw SQL row\'s bigint/decimal-like fields into plain numbers, keyed into the right month bucket', async () => {
    const todayUTC = todayUTCDateOnly();
    const currentMonthDate = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), 1));
    prisma.$queryRaw.mockResolvedValue([{ month: currentMonthDate, revenue: '4200', appointment_count: 3n }]);

    const trend = await adminService.getRevenueTrend(1);

    expect(trend).toEqual([{ month: currentMonthDate.toISOString().slice(0, 7), revenue: 4200, appointmentCount: 3 }]);
  });

  test('caches under a key that includes the resolved (clamped) months count', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await adminService.getRevenueTrend(500); // clamps to 24

    expect(cacheService.getOrSet).toHaveBeenCalledWith('cache:admin:revenue-trend:24', expect.any(Number), expect.any(Function));
  });
});

describe('adminService.listPatients', () => {
  test('scopes to role:patient and applies a name/email/phone OR search filter', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await adminService.listPatients({ search: 'ravi' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: 'patient',
          OR: [
            { name: { contains: 'ravi', mode: 'insensitive' } },
            { email: { contains: 'ravi', mode: 'insensitive' } },
            { phone: { contains: 'ravi', mode: 'insensitive' } },
          ],
        },
      })
    );
  });

  test('with no search term, the where clause is just role:patient (no OR filter)', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await adminService.listPatients({});

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: 'patient' } }));
  });

  test('shapes patientProfile fields to null (not undefined) when the profile is absent', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'p1', name: 'Ravi', email: 'ravi@example.com', phone: '999', city: 'Pune', status: 'active', createdAt: new Date('2026-01-01'), patientProfile: null },
    ]);
    prisma.user.count.mockResolvedValue(1);

    const result = await adminService.listPatients({});

    expect(result.rows[0]).toMatchObject({ gender: null, dateOfBirth: null, bloodGroup: null, registeredAt: new Date('2026-01-01') });
    // A legacy row not yet backfilled by prisma/migrations/
    // 20260919130000_add_patient_doctor_clinic_numbers must surface null, never undefined/NaN.
    expect(result.rows[0].patientNumber).toBeNull();
  });

  // Stable "DCP<N>" display number — never derived from list position, unlike the pre-existing
  // sequenceId() index-based numbering it replaces on the admin Patients table.
  test('surfaces patientNumber from the stored column', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'p1', name: 'Ravi', email: 'ravi@example.com', phone: '999', city: 'Pune', status: 'active', createdAt: new Date('2026-01-01'), patientNumber: 3, patientProfile: null },
    ]);
    prisma.user.count.mockResolvedValue(1);

    const result = await adminService.listPatients({});

    expect(result.rows[0].patientNumber).toBe(3);
  });
});

describe('adminService.updatePatientStatus', () => {
  test('404s PATIENT_NOT_FOUND when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(adminService.updatePatientStatus('p1', 'disabled', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PATIENT_NOT_FOUND',
    });
  });

  test('404s PATIENT_NOT_FOUND when the user exists but is not a patient (e.g. a doctor id was passed)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'doc-1', role: 'doctor' });

    await expect(adminService.updatePatientStatus('doc-1', 'disabled', ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PATIENT_NOT_FOUND',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('disabling a patient updates status, logs, busts the patients cache, and sends a "disabled" notification', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'p1', role: 'patient' });
    prisma.user.update.mockResolvedValue({ id: 'p1', status: 'disabled' });

    const result = await adminService.updatePatientStatus('p1', 'disabled', ADMIN);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'disabled' } });
    expect(cacheService.invalidate).toHaveBeenCalledWith('cache:admin:patients:*');
    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ title: 'Account login disabled', type: 'account' })
    );
    expect(result).toEqual({ id: 'p1', status: 'disabled' });
  });

  test('re-enabling a patient sends the "re-enabled" notification variant', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'p1', role: 'patient' });
    prisma.user.update.mockResolvedValue({ id: 'p1', status: 'active' });

    await adminService.updatePatientStatus('p1', 'active', ADMIN);

    expect(notificationsService.notifySystemEventSafe).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ title: 'Account login re-enabled', type: 'account' })
    );
  });
});

describe('adminService.getFailedBookingJobs', () => {
  function fakeJob({ id, name = 'create', failedReason = 'Something broke', finishedOn, timestamp }) {
    return { id, name, failedReason, finishedOn, timestamp };
  }

  // Default: an empty failed set, so `truncated` is false unless a test overrides this to
  // exercise the LOAD-REVIEW FIX below.
  beforeEach(() => {
    bookingQueue.getFailedCount.mockResolvedValue(0);
  });

  test('defaults to a limit of 20, calling getFailed with an inclusive 0..19 range', async () => {
    bookingQueue.getFailed.mockResolvedValue([]);

    await adminService.getFailedBookingJobs({});

    expect(bookingQueue.getFailed).toHaveBeenCalledWith(0, 19);
  });

  test('no argument at all also falls back to the default limit', async () => {
    bookingQueue.getFailed.mockResolvedValue([]);

    await adminService.getFailedBookingJobs();

    expect(bookingQueue.getFailed).toHaveBeenCalledWith(0, 19);
  });

  test('an explicit in-range limit is honored (end = limit - 1)', async () => {
    bookingQueue.getFailed.mockResolvedValue([]);

    await adminService.getFailedBookingJobs({ limit: 5 });

    expect(bookingQueue.getFailed).toHaveBeenCalledWith(0, 4);
  });

  test('a limit above the 100 cap is clamped down to 100 (defensive clamp — no validation chain wired for this route)', async () => {
    bookingQueue.getFailed.mockResolvedValue([]);

    await adminService.getFailedBookingJobs({ limit: 9999 });

    expect(bookingQueue.getFailed).toHaveBeenCalledWith(0, 99);
  });

  test('a non-positive, non-integer, or non-numeric limit falls back to the default', async () => {
    bookingQueue.getFailed.mockResolvedValue([]);

    await adminService.getFailedBookingJobs({ limit: 0 });
    expect(bookingQueue.getFailed).toHaveBeenLastCalledWith(0, 19);

    await adminService.getFailedBookingJobs({ limit: -3 });
    expect(bookingQueue.getFailed).toHaveBeenLastCalledWith(0, 19);

    await adminService.getFailedBookingJobs({ limit: 'not-a-number' });
    expect(bookingQueue.getFailed).toHaveBeenLastCalledWith(0, 19);

    await adminService.getFailedBookingJobs({ limit: 3.5 });
    expect(bookingQueue.getFailed).toHaveBeenLastCalledWith(0, 19);
  });

  // A route query-string value arrives as a string ("5"), not a number — this must still resolve
  // to a real, non-default limit, not silently fall back to the default via a strict typeof check.
  test('a numeric string limit (as it arrives from req.query) is honored, not treated as invalid', async () => {
    bookingQueue.getFailed.mockResolvedValue([]);

    await adminService.getFailedBookingJobs({ limit: '5' });

    expect(bookingQueue.getFailed).toHaveBeenCalledWith(0, 4);
  });

  test('shapes each job to {id, name, failedReason, timestamp}, preferring finishedOn over timestamp', async () => {
    bookingQueue.getFailed.mockResolvedValue([
      fakeJob({ id: 'job-1', name: 'create', failedReason: '{"code":"SLOT_ALREADY_BOOKED","message":"Slot already booked."}', finishedOn: 1700000002000, timestamp: 1700000000000 }),
    ]);
    bookingQueue.getFailedCount.mockResolvedValue(1);

    const { jobs } = await adminService.getFailedBookingJobs({ limit: 10 });

    expect(jobs).toEqual([
      {
        id: 'job-1',
        name: 'create',
        failedReason: '{"code":"SLOT_ALREADY_BOOKED","message":"Slot already booked."}',
        timestamp: 1700000002000,
      },
    ]);
  });

  test('falls back to the job\'s enqueue timestamp when finishedOn is not set', async () => {
    bookingQueue.getFailed.mockResolvedValue([
      fakeJob({ id: 'job-2', finishedOn: undefined, timestamp: 1700000000000 }),
    ]);
    bookingQueue.getFailedCount.mockResolvedValue(1);

    const { jobs } = await adminService.getFailedBookingJobs({});

    expect(jobs[0].timestamp).toBe(1700000000000);
  });

  test('a missing failedReason surfaces as null, not undefined', async () => {
    bookingQueue.getFailed.mockResolvedValue([{ id: 'job-3', name: 'create', timestamp: 1700000000000 }]);
    bookingQueue.getFailedCount.mockResolvedValue(1);

    const { jobs } = await adminService.getFailedBookingJobs({});

    expect(jobs[0].failedReason).toBeNull();
  });

  test('an empty failed set returns an empty array and truncated: false', async () => {
    bookingQueue.getFailed.mockResolvedValue([]);
    bookingQueue.getFailedCount.mockResolvedValue(0);

    await expect(adminService.getFailedBookingJobs({})).resolves.toEqual({ jobs: [], truncated: false });
  });

  // LOAD-REVIEW FIX: `truncated` must reflect the TRUE size of the failed set (via
  // getFailedCount()), not just "was the caller-supplied limit above the max" — even a caller
  // asking for exactly the cap needs to know if that cap actually cut anything off.
  describe('truncated', () => {
    test('false when the failed set is no larger than what was returned', async () => {
      bookingQueue.getFailed.mockResolvedValue([fakeJob({ id: 'job-1' }), fakeJob({ id: 'job-2' })]);
      bookingQueue.getFailedCount.mockResolvedValue(2);

      const { truncated } = await adminService.getFailedBookingJobs({ limit: 10 });

      expect(truncated).toBe(false);
    });

    test('true when the failed set is larger than what was returned (limit within range)', async () => {
      bookingQueue.getFailed.mockResolvedValue([fakeJob({ id: 'job-1' }), fakeJob({ id: 'job-2' })]);
      bookingQueue.getFailedCount.mockResolvedValue(50);

      const { truncated } = await adminService.getFailedBookingJobs({ limit: 2 });

      expect(truncated).toBe(true);
    });

    // The concrete incident scenario the LOAD-REVIEW FIX addresses: an admin asks for far more
    // than the 100-row cap, gets 100 jobs back, and previously had no way to tell more existed.
    test('true when a caller-requested limit above the 100 cap silently clamps the result', async () => {
      const hundredJobs = Array.from({ length: 100 }, (_, i) => fakeJob({ id: `job-${i}` }));
      bookingQueue.getFailed.mockResolvedValue(hundredJobs);
      bookingQueue.getFailedCount.mockResolvedValue(150);

      const { jobs, truncated } = await adminService.getFailedBookingJobs({ limit: 500 });

      expect(jobs).toHaveLength(100);
      expect(truncated).toBe(true);
    });
  });

  // This is a live diagnostic view, not a cached aggregate — cacheService.getOrSet must never be
  // consulted for it (contrast with getDashboardStats/getRevenueTrend/getActivityLog above).
  test('does not go through cacheService (always a live read of the failed set)', async () => {
    bookingQueue.getFailed.mockResolvedValue([]);
    cacheService.getOrSet.mockClear();

    await adminService.getFailedBookingJobs({});

    expect(cacheService.getOrSet).not.toHaveBeenCalled();
  });
});
