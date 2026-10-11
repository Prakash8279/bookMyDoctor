/**
 * Unit tests for the email-only registration verification flow.
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
  $transaction: jest.fn(),
}));

jest.mock('../../../src/services/tokenService', () => ({
  issueTokenPair: jest.fn(),
  revokeAllForUser: jest.fn(),
}));

jest.mock('../../../src/services/activityLogService', () => ({ log: jest.fn() }));
jest.mock('../../../src/utils/idGenerators', () => ({ nextPatientNumber: jest.fn() }));
jest.mock('../../../src/services/otpService', () => ({
  sendOtp: jest.fn().mockResolvedValue({ success: true, message: 'Verification code sent to email.' }),
  verifyOtp: jest.fn().mockResolvedValue({ valid: true }),
}));

const prisma = require('../../../src/config/db');
const otpService = require('../../../src/services/otpService');
const authService = require('../../../src/modules/auth/auth.service');

beforeEach(() => jest.clearAllMocks());

describe('Email registration verification', () => {
  test('sends a code only when the email is not already registered', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await authService.sendRegistrationEmailOtp({ email: ' New.Patient@Example.com ' });

    expect(result.success).toBe(true);
    expect(otpService.sendOtp).toHaveBeenCalledWith({ email: 'new.patient@example.com' });
  });

  test('does not send a registration code for an existing account', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(authService.sendRegistrationEmailOtp({ email: 'existing@example.com' }))
      .rejects.toThrow('An account with this email already exists.');
    expect(otpService.sendOtp).not.toHaveBeenCalled();
  });

  test('verifies the submitted code against the normalized email address', async () => {
    await authService.verifyRegistrationEmailOtp({ email: ' New.Patient@Example.com ', otp: '123456' });

    expect(otpService.verifyOtp).toHaveBeenCalledWith({ email: 'new.patient@example.com', otp: '123456' });
  });
});
