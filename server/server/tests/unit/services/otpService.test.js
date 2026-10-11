/** Unit tests for registration email verification codes. */
const mockRedis = {
  store: new Map(),
  get: jest.fn(async (key) => mockRedis.store.get(key) || null),
  setex: jest.fn(async (key, _ttl, value) => { mockRedis.store.set(key, value); }),
  ttl: jest.fn(async () => 50),
  incr: jest.fn(async (key) => {
    const next = Number(mockRedis.store.get(key) || 0) + 1;
    mockRedis.store.set(key, String(next));
    return next;
  }),
  del: jest.fn(async (key) => { mockRedis.store.delete(key); }),
};

jest.mock('../../../src/config/redis', () => mockRedis);
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/services/emailService', () => ({ sendVerificationEmail: jest.fn() }));

const otpService = require('../../../src/services/otpService');
const emailService = require('../../../src/services/emailService');

beforeEach(() => {
  mockRedis.store.clear();
  jest.clearAllMocks();
});

describe('otpService', () => {
  test('normalizes an email address', () => {
    expect(otpService.normalizeEmail('  Test@EXAMPLE.com  ')).toBe('test@example.com');
  });

  test('sends and verifies an email-only registration OTP', async () => {
    const result = await otpService.sendOtp({ email: 'patient@example.com' });

    expect(result.success).toBe(true);
    expect(result.email).toBe('patient@example.com');
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'patient@example.com' }));

    await expect(otpService.verifyOtp({ email: 'patient@example.com', otp: result.devOtp }))
      .resolves.toMatchObject({ valid: true });
  });

  test('rejects a phone number because authentication codes are never sent by SMS', async () => {
    await expect(otpService.sendOtp({ email: '9876543210' }))
      .rejects.toThrow('A valid email address is required.');
  });

  test('applies a cooldown per registration email', async () => {
    mockRedis.store.set('otp:cooldown:register:test@example.com', '1');

    await expect(otpService.sendOtp({ email: 'test@example.com' })).rejects.toThrow('Please wait');
  });

  test('counts incorrect OTP attempts', async () => {
    await otpService.sendOtp({ email: 'test@example.com' });

    await expect(otpService.verifyOtp({ email: 'test@example.com', otp: '000000' }))
      .rejects.toThrow('Incorrect OTP');
  });

  test('does not claim an OTP was sent when verification email delivery fails', async () => {
    emailService.sendVerificationEmail.mockRejectedValueOnce(new Error('SMTP unavailable'));

    await expect(otpService.sendOtp({ email: 'patient@example.com' }))
      .rejects.toThrow('Email verification is temporarily unavailable.');
  });
});
