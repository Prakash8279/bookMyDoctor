/**
 * Unit tests for OTP-based auth (sendAuthOtp, verifyOtpLogin, verifyOtpRegister, resetPasswordWithOtp)
 */
jest.mock('../../../src/config/db', () => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  patientProfile: { create: jest.fn() },
  $transaction: jest.fn((cb) => cb({
    user: { create: jest.fn().mockResolvedValue({ id: 'new-u1', role: 'patient', patientNumber: 101 }) },
    patientProfile: { create: jest.fn() },
  })),
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
  sendOtp: jest.fn().mockResolvedValue({ success: true, message: 'OTP sent', channel: 'email' }),
  verifyOtp: jest.fn().mockResolvedValue({ valid: true }),
}));

const prisma = require('../../../src/config/db');
const otpService = require('../../../src/services/otpService');
const tokenService = require('../../../src/services/tokenService');
const authService = require('../../../src/modules/auth/auth.service');

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findMany.mockResolvedValue([]);
});

describe('Auth Service OTP features', () => {
  describe('sendAuthOtp', () => {
    test('sends OTP for registration when account does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      const res = await authService.sendAuthOtp({
        identifier: 'newpatient@example.com',
        purpose: 'register',
      });

      expect(res.success).toBe(true);
      expect(otpService.sendOtp).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'newpatient@example.com', purpose: 'register' })
      );
    });

    test('rejects registration OTP if account already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'existing@example.com' });

      await expect(
        authService.sendAuthOtp({
          identifier: 'existing@example.com',
          purpose: 'register',
        })
      ).rejects.toThrow('An account with this email/phone already exists.');
    });

    test('rejects forgot_password OTP if account does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        authService.sendAuthOtp({
          identifier: 'nonexistent@example.com',
          purpose: 'forgot_password',
        })
      ).rejects.toThrow('No account found with this email or phone number.');
    });
  });

  describe('verifyOtpLogin', () => {
    test('logs in existing user upon correct OTP', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-123',
        name: 'Asha Rao',
        email: 'asha@example.com',
        role: 'patient',
        status: 'active',
      });

      const res = await authService.verifyOtpLogin({
        identifier: 'asha@example.com',
        otp: '123456',
      });

      expect(otpService.verifyOtp).toHaveBeenCalledWith({
        identifier: 'asha@example.com',
        purpose: 'login',
        otp: '123456',
      });
      expect(res.accessToken).toBe('acc_tok');
      expect(res.refreshToken).toBe('ref_tok');
      expect(res.user.id).toBe('u-123');
    });

    test('auto-registers patient when logging in for the first time via OTP', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const res = await authService.verifyOtpLogin({
        identifier: '9876543210',
        otp: '654321',
      });

      expect(res.isNewAccount).toBe(true);
      expect(res.accessToken).toBe('acc_tok');
      expect(tokenService.issueTokenPair).toHaveBeenCalled();
    });
  });

  describe('resetPasswordWithOtp', () => {
    test('updates password and revokes old sessions on verified OTP', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-reset',
        email: 'reset@example.com',
        role: 'patient',
        status: 'active',
      });

      const res = await authService.resetPasswordWithOtp({
        identifier: 'reset@example.com',
        otp: '112233',
        newPassword: 'newStrongPassword123',
      });

      expect(res.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u-reset' } })
      );
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('u-reset');
    });
  });
});
