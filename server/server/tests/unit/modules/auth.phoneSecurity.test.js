/**
 * Security unit tests for Phone Normalization, Duplicate Phone Prevention,
 * and Account Takeover Guards in Auth.
 */
jest.mock('../../../src/config/db', () => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  patientProfile: { create: jest.fn() },
  $transaction: jest.fn(),
}));

jest.mock('../../../src/services/tokenService', () => ({
  issueTokenPair: jest.fn().mockResolvedValue({ accessToken: 'acc_tok', refreshToken: 'ref_tok' }),
  revokeAllForUser: jest.fn(),
}));

jest.mock('../../../src/services/activityLogService', () => ({
  log: jest.fn(),
}));

jest.mock('../../../src/utils/idGenerators', () => ({
  nextPatientNumber: jest.fn().mockResolvedValue(101),
}));

jest.mock('../../../src/services/otpService', () => ({
  normalizeIdentifier: jest.fn((id) => (id.includes('@') ? id.toLowerCase().trim() : id.replace(/\D/g, '').slice(-10))),
  sendOtp: jest.fn().mockResolvedValue({ success: true, message: 'OTP sent' }),
  verifyOtp: jest.fn().mockResolvedValue({ valid: true }),
}));

const prisma = require('../../../src/config/db');
const authService = require('../../../src/modules/auth/auth.service');
const ApiError = require('../../../src/utils/ApiError');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findFirst.mockResolvedValue(null);
  prisma.user.findMany.mockResolvedValue([]);
  prisma.user.findUnique.mockResolvedValue(null);
});

describe('Phone Normalization & Security Suite', () => {
  describe('normalizePhone helper', () => {
    test('normalizes 10-digit Indian phone numbers', () => {
      expect(authService.normalizePhone('9876543210')).toBe('9876543210');
    });

    test('normalizes phone numbers with +91 country code and spaces', () => {
      expect(authService.normalizePhone('+91 98765 43210')).toBe('9876543210');
    });

    test('normalizes phone numbers with leading zero', () => {
      expect(authService.normalizePhone('09876543210')).toBe('9876543210');
    });

    test('normalizes phone numbers with 91 prefix without plus', () => {
      expect(authService.normalizePhone('919876543210')).toBe('9876543210');
    });

    test('returns null for empty or invalid inputs', () => {
      expect(authService.normalizePhone(null)).toBeNull();
      expect(authService.normalizePhone('')).toBeNull();
      expect(authService.normalizePhone(undefined)).toBeNull();
    });
  });

  describe('Duplicate Phone Registration Prevention (Phase 1)', () => {
    test('rejects registration with same phone but different email', async () => {
      // User A exists with phone 9876543210
      prisma.user.findUnique.mockResolvedValue(null); // email is different
      prisma.user.findFirst.mockResolvedValue({ id: 'user-a-id', phone: '9876543210' }); // phone already taken

      await expect(
        authService.register({
          name: 'User B',
          email: 'userb@example.com',
          password: 'Password123',
          phone: '+91 98765 43210',
          city: 'Mumbai',
        })
      ).rejects.toThrow('An account with this mobile number already exists.');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('rejects registration with same phone formatted with leading 0', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue({ id: 'user-a-id', phone: '09876543210' });

      await expect(
        authService.register({
          name: 'User B',
          email: 'userb@example.com',
          password: 'Password123',
          phone: '9876543210',
          city: 'Mumbai',
        })
      ).rejects.toThrow('An account with this mobile number already exists.');
    });

    test('rejects registration during concurrency race via advisory lock check', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      // Pre-check passed (simulate race)
      prisma.user.findFirst.mockResolvedValueOnce(null);

      // In-transaction check catches the concurrent insert
      prisma.$transaction.mockImplementation(async (fn) => {
        const tx = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          user: {
            findFirst: jest.fn().mockResolvedValue({ id: 'concurrent-user-id' }),
            create: jest.fn(),
          },
          patientProfile: { create: jest.fn() },
        };
        return fn(tx);
      });

      await expect(
        authService.register({
          name: 'User B',
          email: 'userb@example.com',
          password: 'Password123',
          phone: '9876543210',
          city: 'Mumbai',
        })
      ).rejects.toThrow('An account with this mobile number already exists.');
    });

    test('catches DB P2002 unique constraint violation on phone', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);

      const p2002Error = new Error('Unique constraint failed on the fields: (`phone`)');
      p2002Error.code = 'P2002';
      p2002Error.meta = { target: ['phone'] };

      prisma.$transaction.mockRejectedValue(p2002Error);

      await expect(
        authService.register({
          name: 'User B',
          email: 'userb@example.com',
          password: 'Password123',
          phone: '9876543210',
          city: 'Mumbai',
        })
      ).rejects.toThrow('An account with this mobile number already exists.');
    });
  });

  describe('Account Takeover / Ambiguous Phone Login Protection (Phase 1)', () => {
    test('refuses OTP login if multiple accounts exist for the same phone (account hijacking attempt)', async () => {
      // Legacy duplicate accounts exist for this phone number
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', name: 'User 1', email: 'u1@example.com', phone: '09876543210', role: 'patient', status: 'active' },
        { id: 'user-2', name: 'User 2', email: 'u2@example.com', phone: '9876543210', role: 'patient', status: 'active' },
      ]);

      await expect(
        authService.verifyOtpLogin({
          identifier: '9876543210',
          otp: '123456',
        })
      ).rejects.toThrow('Multiple accounts are associated with this mobile number. Please log in with your email address or contact support.');
    });

    test('logs in correctly when exactly one account matches the phone', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', name: 'User 1', email: 'u1@example.com', phone: '9876543210', role: 'patient', status: 'active' },
      ]);

      const res = await authService.verifyOtpLogin({
        identifier: '9876543210',
        otp: '123456',
      });

      expect(res.user.id).toBe('user-1');
      expect(res.accessToken).toBe('acc_tok');
    });

    test('sendAuthOtp for registration rejects when multiple duplicate accounts already exist for the phone', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'u1@example.com', phone: '9876543210' },
        { id: 'u2', email: 'u2@example.com', phone: '09876543210' },
      ]);

      await expect(
        authService.sendAuthOtp({
          identifier: '9876543210',
          purpose: 'register',
        })
      ).rejects.toThrow('An account with this email/phone already exists.');
    });
  });
});
