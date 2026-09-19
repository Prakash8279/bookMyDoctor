/**
 * Unit tests for modules/doctors/doctors.service.js — specifically getDoctorById, exercised as
 * the way to reach its two internal pure(-ish) shaping helpers, shapeDoctor and buildSchedule
 * (neither is exported directly; both are private to this module and only reachable through
 * listDoctors/getDoctorById).
 *
 * Two kinds of bug this guards against:
 *
 *   - shapeDoctor role-based field redaction: `includeDetail` (bio, booking-window overrides)
 *     and `includeContact` (email/phone/accountStatus) are two INDEPENDENT gates — getDoctorById
 *     always sets includeDetail:true (the public booking-date picker needs bio for everyone) but
 *     only sets includeContact:true for the doctor themself or an admin/superadmin. Collapsing
 *     these two into one flag, or getting the includeContact condition backwards, would leak a
 *     doctor's phone/email to any public caller, or hide a doctor's own bio from themselves.
 *     getDoctorById also has an enumeration-avoidance rule worth locking down: a not-yet-verified
 *     or disabled doctor 404s for everyone except themselves or an admin.
 *   - buildSchedule's "collapse into a day range" heuristic: it must only print "Mon–Fri" when
 *     the active days are BOTH identical-hours AND a genuinely contiguous run (checked by index
 *     gaps) — a non-contiguous day set (e.g. Mon+Wed only) sharing the same hours must NOT be
 *     misreported as "Mon–Wed" (which would wrongly imply Tuesday too).
 *
 * config/db is mocked (no real Postgres in this sandbox); cacheService is mocked to always treat
 * getDoctorById's call as a cache miss, since the real cacheService transitively requires
 * config/redis (no real Redis in this sandbox either) — see tests/setupEnv.js's header comment.
 */
jest.mock('../../../src/config/db', () => ({
  user: { findUnique: jest.fn() },
}));
jest.mock('../../../src/services/cacheService', () => ({
  getOrSet: jest.fn((key, ttlSeconds, fetchFn) => fetchFn()),
  invalidate: jest.fn(),
}));

const prisma = require('../../../src/config/db');
const doctorsService = require('../../../src/modules/doctors/doctors.service');

function buildDoctorRow(overrides = {}) {
  const { doctorProfile, doctorClinics, doctorClinicHours, ...userOverrides } = overrides;
  return {
    id: 'doc-1',
    name: 'Dr. Asha Rao',
    email: 'asha@example.com',
    phone: '9999999999',
    photoUrl: 'http://example.com/photo.jpg',
    city: 'Pune',
    status: 'active',
    // Spreading `...undefined` into an object literal is a silent no-op in JS, not a way to
    // blank the field out — so `doctorProfile: null` is the only override value that actually
    // suppresses the default profile below (used by the "no doctorProfile at all" test).
    doctorProfile: doctorProfile === null ? null : {
      status: 'verified',
      qualification: 'MBBS, MD',
      registrationNumber: 'REG-123',
      experienceYears: 8,
      consultationFee: '500',
      emergencyFee: '800',
      minBookingAdvanceAmount: '100',
      languages: ['English', 'Hindi'],
      rating: '4.6',
      reviewCount: 42,
      emergencyAvailable: true,
      onlineBooking: true,
      allowRebooking: true,
      maxDaysAdvance: 30,
      maxOnlineBookingsPerDay: null,
      onlineBookingWindowStart: null,
      onlineBookingWindowEnd: null,
      bio: 'Experienced cardiologist.',
      verificationDocuments: [{ name: 'MBBS certificate', url: 'http://example.com/docs/mbbs.pdf', uploadedAt: '2026-01-05T10:00:00.000Z' }],
      bankAccountHolderName: 'Asha Rao',
      bankAccountNumber: '123456789012',
      bankIfscCode: 'HDFC0001234',
      bankName: 'HDFC Bank',
      bankUpiId: 'asha@okhdfcbank',
      tokenNumberingMode: 'sequential',
      onlineTokenParity: 'odd',
      doctorNumber: 7,
      specialization: { id: 'spec-1', name: 'Cardiology', icon: 'heart' },
      ...doctorProfile,
    },
    doctorClinics: doctorClinics !== undefined ? doctorClinics : [
      { clinic: { id: 'clinic-1', name: 'City Clinic', approvalStatus: 'active', city: { name: 'Pune' }, area: { name: 'Kothrud' } } },
    ],
    doctorClinicHours: doctorClinicHours !== undefined ? doctorClinicHours : [],
    ...userOverrides,
  };
}

describe('doctorsService.getDoctorById — not-found / visibility', () => {
  test('throws DOCTOR_NOT_FOUND (404) when no such user exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(doctorsService.getDoctorById('doc-1', undefined)).rejects.toMatchObject({
      statusCode: 404,
      code: 'DOCTOR_NOT_FOUND',
    });
  });

  test('throws DOCTOR_NOT_FOUND (404) when the user exists but has no doctorProfile at all', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: null }));

    await expect(doctorsService.getDoctorById('doc-1', undefined)).rejects.toMatchObject({
      statusCode: 404,
      code: 'DOCTOR_NOT_FOUND',
    });
  });

  test('a pending (not-yet-verified) doctor 404s for a public/anonymous caller', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { status: 'pending' } }));

    await expect(doctorsService.getDoctorById('doc-1', undefined)).rejects.toMatchObject({
      statusCode: 404,
      code: 'DOCTOR_NOT_FOUND',
    });
  });

  test('a pending doctor 404s for an unrelated logged-in caller too, not just anonymous ones', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { status: 'pending' } }));

    await expect(
      doctorsService.getDoctorById('doc-1', { id: 'someone-else', role: 'patient' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'DOCTOR_NOT_FOUND' });
  });

  test('a pending doctor CAN see their own profile', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { status: 'pending' } }));

    const result = await doctorsService.getDoctorById('doc-1', { id: 'doc-1', role: 'doctor' });

    expect(result.id).toBe('doc-1');
  });

  test('an admin can see a pending doctor\'s profile', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { status: 'pending' } }));

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'admin' });

    expect(result.id).toBe('doc-1');
  });
});

describe('doctorsService.getDoctorById — shapeDoctor contact/detail field gating', () => {
  test('a public/anonymous caller gets bio (includeDetail) but never email/phone/accountStatus (includeContact)', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow());

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.bio).toBe('Experienced cardiologist.');
    expect(result.allowRebooking).toBe(true);
    expect(result.email).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.accountStatus).toBeUndefined();
    // COMPLETENESS FIX regression: verificationDocuments are direct links to a doctor's
    // uploaded ID/certificate files — gated behind includeContact exactly like email/phone,
    // never leaked to a public/unrelated caller alongside the otherwise-public bio.
    expect(result.verificationDocuments).toBeUndefined();
    // Same includeContact gate protects bank details and the token-numbering rule — a public
    // caller must never see either.
    expect(result.bankDetails).toBeUndefined();
    expect(result.tokenNumberingMode).toBeUndefined();
    expect(result.onlineTokenParity).toBeUndefined();
    // Stable "DCD<N>" display number (prisma/migrations/
    // 20260919130000_add_patient_doctor_clinic_numbers) is admin-only, same includeContact gate.
    expect(result.doctorNumber).toBeUndefined();
  });

  test('the doctor viewing their own profile gets email/phone/accountStatus/verificationDocuments too', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow());

    const result = await doctorsService.getDoctorById('doc-1', { id: 'doc-1', role: 'doctor' });

    expect(result.email).toBe('asha@example.com');
    expect(result.phone).toBe('9999999999');
    expect(result.accountStatus).toBe('active');
    expect(result.verificationDocuments).toEqual([
      { name: 'MBBS certificate', url: 'http://example.com/docs/mbbs.pdf', uploadedAt: '2026-01-05T10:00:00.000Z' },
    ]);
    // COMPLETENESS ADD (request: "doctor bank details v only admin and super admin dekh sakta
    // hai add kro") — a doctor sees their own bank details and token-numbering rule.
    expect(result.bankDetails).toEqual({
      accountHolderName: 'Asha Rao',
      accountNumber: '123456789012',
      ifscCode: 'HDFC0001234',
      bankName: 'HDFC Bank',
      upiId: 'asha@okhdfcbank',
    });
    expect(result.tokenNumberingMode).toBe('sequential');
    expect(result.onlineTokenParity).toBe('odd');
    expect(result.doctorNumber).toBe(7);
  });

  test('an admin caller also gets email/phone/accountStatus/verificationDocuments/bankDetails', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow());

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'superadmin' });

    expect(result.email).toBe('asha@example.com');
    expect(result.accountStatus).toBe('active');
    expect(result.verificationDocuments).toEqual([
      { name: 'MBBS certificate', url: 'http://example.com/docs/mbbs.pdf', uploadedAt: '2026-01-05T10:00:00.000Z' },
    ]);
    expect(result.bankDetails).toEqual({
      accountHolderName: 'Asha Rao',
      accountNumber: '123456789012',
      ifscCode: 'HDFC0001234',
      bankName: 'HDFC Bank',
      upiId: 'asha@okhdfcbank',
    });
    expect(result.doctorNumber).toBe(7);
  });

  // Same rationale as the tokenNumberingMode/onlineTokenParity fallback tests below: a legacy
  // doctor row not yet backfilled by the migration must surface null, never undefined/NaN.
  test('doctorNumber is null (not undefined) for a legacy doctor row not yet backfilled', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { doctorNumber: null } }));

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'admin' });

    expect(result.doctorNumber).toBeNull();
  });

  test('verificationDocuments defaults to an empty array (not undefined/null) when the doctor has never uploaded one', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { verificationDocuments: null } }));

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'admin' });

    expect(result.verificationDocuments).toEqual([]);
  });

  test('bankDetails is null (not an object of nulls) when the doctor has not entered any bank field yet', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({
        doctorProfile: {
          bankAccountHolderName: null,
          bankAccountNumber: null,
          bankIfscCode: null,
          bankName: null,
          bankUpiId: null,
        },
      })
    );

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'admin' });

    expect(result.bankDetails).toBeNull();
  });

  // COMPLETENESS ADD (request: "upiid dalne ka v option de do") — a UPI ID alone (no bank
  // fields filled in) must still surface bankDetails, not stay null.
  test('bankDetails is populated from JUST a UPI ID, with the 4 bank fields null', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({
        doctorProfile: {
          bankAccountHolderName: null,
          bankAccountNumber: null,
          bankIfscCode: null,
          bankName: null,
          bankUpiId: 'asha@okhdfcbank',
        },
      })
    );

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'admin' });

    expect(result.bankDetails).toEqual({
      accountHolderName: null,
      accountNumber: null,
      ifscCode: null,
      bankName: null,
      upiId: 'asha@okhdfcbank',
    });
  });

  test('tokenNumberingMode defaults to sequential for anything other than the literal "alternate"', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { tokenNumberingMode: null } }));

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'admin' });

    expect(result.tokenNumberingMode).toBe('sequential');
  });

  test('tokenNumberingMode surfaces "alternate" when the doctor has configured it', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { tokenNumberingMode: 'alternate' } }));

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'admin' });

    expect(result.tokenNumberingMode).toBe('alternate');
  });

  // COMPLETENESS ADD (request: "odd ya even select karne ka option do doctor jo select kar
  // online ke lie") — the doctor's own choice of which parity 'alternate' mode gives online.
  test('onlineTokenParity defaults to "odd" for anything other than the literal "even"', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { onlineTokenParity: null } }));

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'admin' });

    expect(result.onlineTokenParity).toBe('odd');
  });

  test('onlineTokenParity surfaces "even" when the doctor has configured it', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow({ doctorProfile: { onlineTokenParity: 'even' } }));

    const result = await doctorsService.getDoctorById('doc-1', { id: 'admin-1', role: 'admin' });

    expect(result.onlineTokenParity).toBe('even');
  });

  test('clinics are shaped down to {id, name, city, area} — never the raw nested Prisma row', async () => {
    prisma.user.findUnique.mockResolvedValue(buildDoctorRow());

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.clinics).toEqual([{ id: 'clinic-1', name: 'City Clinic', city: 'Pune', area: 'Kothrud' }]);
  });

  // BUG FIX regression test: consultationFee/emergencyFee used to be the only two fields in
  // shapeDoctor without a `?? null` fallback, so an absent value came back `undefined` (dropped
  // from the JSON response entirely) instead of an explicit `null` like every other optional
  // field in this same shape.
  test('consultationFee/emergencyFee fall back to null (not undefined) when absent from the doctor profile', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({ doctorProfile: { consultationFee: undefined, emergencyFee: undefined } })
    );

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.consultationFee).toBeNull();
    expect(result.emergencyFee).toBeNull();
  });
});

describe('doctorsService.getDoctorById — schedule/scheduleSummary (buildSchedule)', () => {
  const hours = (weekday, startTime, endTime) => ({ clinicId: 'clinic-1', weekday, startTime, endTime });

  test('no active clinic => empty schedule and null summary, even if hours rows exist', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({ doctorClinics: [], doctorClinicHours: [hours(1, '10:00', '18:00')] })
    );

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.schedule).toEqual([]);
    expect(result.scheduleSummary).toBeNull();
  });

  test('a contiguous run of identical-hours weekdays collapses to a "First–Last · hours" summary', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({
        doctorClinicHours: [1, 2, 3, 4, 5].map((d) => hours(d, '10:00', '18:00')), // Mon..Fri
      })
    );

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.scheduleSummary).toBe('Mon–Fri · 10:00–18:00');
    expect(result.schedule).toHaveLength(5);
  });

  test('a single active day summarizes as "Day · hours", not a range', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({ doctorClinicHours: [hours(3, '09:00', '12:00')] }) // Wed only
    );

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.scheduleSummary).toBe('Wed · 09:00–12:00');
  });

  test('all 7 days with identical hours summarizes as "Every day · hours"', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({
        doctorClinicHours: [0, 1, 2, 3, 4, 5, 6].map((d) => hours(d, '08:00', '20:00')),
      })
    );

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.scheduleSummary).toBe('Every day · 08:00–20:00');
  });

  test('identical hours on a NON-contiguous day set must NOT be reported as a day range', async () => {
    // Mon (1) and Wed (3) only — same hours, but Tuesday is missing, so "Mon–Wed" would be a lie.
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({ doctorClinicHours: [hours(1, '10:00', '18:00'), hours(3, '10:00', '18:00')] })
    );

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.scheduleSummary).toBe('2 days/week');
    expect(result.scheduleSummary).not.toMatch(/–/); // no en-dash range formatting
  });

  test('a contiguous day set with DIFFERENT hours per day also falls back to the plain day-count summary', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({ doctorClinicHours: [hours(1, '09:00', '12:00'), hours(2, '14:00', '18:00')] })
    );

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.scheduleSummary).toBe('2 days/week');
  });

  test('schedule rows for a different (non-primary) clinic are excluded entirely', async () => {
    prisma.user.findUnique.mockResolvedValue(
      buildDoctorRow({
        doctorClinicHours: [hours(1, '10:00', '18:00'), { clinicId: 'clinic-OTHER', weekday: 2, startTime: '09:00', endTime: '13:00' }],
      })
    );

    const result = await doctorsService.getDoctorById('doc-1', undefined);

    expect(result.schedule).toEqual([{ day: 'Mon', hours: '10:00–18:00' }]);
  });
});
