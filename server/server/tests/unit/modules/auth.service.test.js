/**
 * Unit tests for modules/auth/auth.service.js — specifically the password hashing/comparison
 * round-trip register()/login() perform. This codebase has no separate bcrypt-helper module
 * (bcrypt.hash/bcrypt.compare are called directly in auth.service.js — see its imports), so
 * these tests exercise that logic through the REAL exported register()/login() functions rather
 * than a reimplementation, plus the account-enumeration and disabled-account guards built
 * directly on top of it. Only the DB and downstream token/audit-log services are mocked out — no
 * test Postgres exists in this sandbox (see tests/setupEnv.js's header comment for the general
 * policy this suite follows).
 */
jest.mock('../../../src/config/db', () => ({
  user: { findUnique: jest.fn(), update: jest.fn() },
  patientProfile: { create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../../../src/services/tokenService', () => ({
  issueTokenPair: jest.fn(),
}));
jest.mock('../../../src/services/activityLogService', () => ({
  log: jest.fn(),
}));
// register() now draws a stable patientNumber (prisma/migrations/
// 20260919130000_add_patient_doctor_clinic_numbers) via idGenerators.nextPatientNumber(), which
// itself calls the real prisma.$queryRaw('SELECT nextval(...)') — not worth teaching the plain
// object mock above to fake a Postgres sequence's return shape, so the generator itself is
// mocked directly, same as tokenService/activityLogService above.
jest.mock('../../../src/utils/idGenerators', () => ({
  nextPatientNumber: jest.fn(),
}));

const bcrypt = require('bcrypt');
const prisma = require('../../../src/config/db');
const tokenService = require('../../../src/services/tokenService');
const activityLogService = require('../../../src/services/activityLogService');
const idGenerators = require('../../../src/utils/idGenerators');
const ApiError = require('../../../src/utils/ApiError');
const authService = require('../../../src/modules/auth/auth.service');

const FAKE_TOKENS = { accessToken: 'fake.access.token', refreshToken: 'fake.refresh.token' };

beforeEach(() => {
  jest.clearAllMocks();
  tokenService.issueTokenPair.mockResolvedValue(FAKE_TOKENS);
  idGenerators.nextPatientNumber.mockResolvedValue(42);
});

describe('auth.service.register — password hashing', () => {
  test('hashes the plaintext password with bcrypt before it ever reaches the DB layer', async () => {
    prisma.user.findUnique.mockResolvedValue(null); // no existing account with this email

    let capturedCreateData;
    prisma.$transaction.mockImplementation(async (fn) => {
      // Mimics Prisma's interactive-transaction callback API ($transaction(async (tx) => ...)),
      // which is the form register() actually calls (see auth.service.js#register).
      const tx = {
        user: {
          create: jest.fn((args) => {
            capturedCreateData = args.data;
            return Promise.resolve({
              id: 'new-user-1',
              name: args.data.name,
              email: args.data.email,
              role: args.data.role,
              phone: args.data.phone,
              city: args.data.city,
              photoUrl: null,
              status: args.data.status,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
            });
          }),
        },
        patientProfile: { create: jest.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const result = await authService.register({
      name: '  Asha Rao  ',
      email: 'Asha@Example.com',
      password: 'correct horse battery staple',
      phone: '9876543210',
      city: 'Pune',
    });

    // The stored hash must be a real bcrypt hash of the plaintext — never the plaintext itself —
    // and must verify against it via bcrypt.compare(), exactly the way login() will later check
    // it (see the login describe block below).
    expect(capturedCreateData.passwordHash).not.toBe('correct horse battery staple');
    expect(capturedCreateData.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hash format marker
    await expect(bcrypt.compare('correct horse battery staple', capturedCreateData.passwordHash)).resolves.toBe(true);
    await expect(bcrypt.compare('wrong password entirely', capturedCreateData.passwordHash)).resolves.toBe(false);

    // Role is hard-coded server-side regardless of input (belt-and-suspenders, see the
    // function's header comment), and the email is trimmed/lowercased before storage.
    expect(capturedCreateData.role).toBe('patient');
    expect(capturedCreateData.email).toBe('asha@example.com');
    expect(capturedCreateData.name).toBe('Asha Rao');
    // Stable "DCP<N>" display number — drawn from idGenerators.nextPatientNumber() (mocked above
    // to return 42) and stored directly on the new user row, never recomputed later.
    expect(capturedCreateData.patientNumber).toBe(42);
    expect(idGenerators.nextPatientNumber).toHaveBeenCalledTimes(1);

    expect(result.user.id).toBe('new-user-1');
    expect(result.accessToken).toBe(FAKE_TOKENS.accessToken);
    expect(activityLogService.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'auth.register' }));
  });

  test('rejects registration with a duplicate email before ever opening the transaction', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      authService.register({ name: 'X', email: 'dup@example.com', password: 'password123' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_ALREADY_EXISTS' });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    // A rejected duplicate-email attempt must never burn a number from patient_number_seq —
    // mirrors the sequence-preserving intent already documented on nextReceiptNumber's callers.
    expect(idGenerators.nextPatientNumber).not.toHaveBeenCalled();
  });
});

describe('auth.service.login — password comparison', () => {
  const PLAIN_PASSWORD = 'S3cure-Passw0rd!';
  // Fixed low cost factor for a fast, deterministic fixture hash — bcrypt's cost factor only
  // affects how slow hashing/verifying is, never whether compare() correctly matches, so this
  // fixture hash is representative of a real stored hash without paying the production cost (12
  // rounds by default) on every test run.
  const REAL_HASH = bcrypt.hashSync(PLAIN_PASSWORD, 4);

  function activeUserFixture(overrides = {}) {
    return {
      id: 'user-1',
      name: 'Test Patient',
      email: 'patient@example.com',
      role: 'patient',
      phone: null,
      city: null,
      photoUrl: null,
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordHash: REAL_HASH,
      ...overrides,
    };
  }

  test('resolves with fresh tokens when the password matches the stored hash', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUserFixture());

    const result = await authService.login({ email: 'patient@example.com', password: PLAIN_PASSWORD });

    expect(result.accessToken).toBe(FAKE_TOKENS.accessToken);
    expect(result.user.id).toBe('user-1');
    // passwordHash and createdAt must never leak into the returned user object (see
    // auth.service.js#login's destructuring into `safeUser`).
    expect(result.user.passwordHash).toBeUndefined();
    expect(result.user.createdAt).toBeUndefined();
  });

  test('rejects a wrong password with the generic INVALID_CREDENTIALS error', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUserFixture());

    const attempt = authService.login({ email: 'patient@example.com', password: 'totally-wrong-password' });

    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(
      authService.login({ email: 'patient@example.com', password: 'totally-wrong-password' })
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
  });

  test('rejects an unknown email with the SAME generic error (no account-enumeration oracle)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      authService.login({ email: 'nobody@example.com', password: 'whatever-they-guessed' })
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });

  test('rejects login for a disabled account only AFTER the password has been verified', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUserFixture({ status: 'disabled' }));

    await expect(
      authService.login({ email: 'patient@example.com', password: PLAIN_PASSWORD })
    ).rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_DISABLED' });

    // A WRONG password against that same disabled account must still surface as
    // INVALID_CREDENTIALS, not ACCOUNT_DISABLED — status is only checked once the password has
    // already matched (see auth.service.js#login's ordering comment: revealing "this account is
    // disabled" before the password is verified would itself be an enumeration leak).
    await expect(
      authService.login({ email: 'patient@example.com', password: 'wrong-password' })
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });
});
