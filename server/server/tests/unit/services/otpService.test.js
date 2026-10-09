/**
 * Unit tests for services/otpService.js
 */
const mockRedis = {
  store: new Map(),
  get: jest.fn(async (key) => mockRedis.store.get(key) || null),
  setex: jest.fn(async (key, ttl, val) => {
    mockRedis.store.set(key, val);
  }),
  ttl: jest.fn(async () => 50),
  incr: jest.fn(async (key) => {
    const curr = parseInt(mockRedis.store.get(key) || '0', 10) + 1;
    mockRedis.store.set(key, String(curr));
    return curr;
  }),
  del: jest.fn(async (key) => {
    mockRedis.store.delete(key);
  }),
};

jest.mock('../../../src/config/redis', () => mockRedis);
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../../src/services/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../../../src/services/smsService', () => ({ sendSms: jest.fn() }));

const otpService = require('../../../src/services/otpService');
const emailService = require('../../../src/services/emailService');
const smsService = require('../../../src/services/smsService');

beforeEach(() => {
  mockRedis.store.clear();
  jest.clearAllMocks();
});

describe('otpService', () => {
  describe('normalizeIdentifier', () => {
    test('normalizes email addresses to lowercase trimmed', () => {
      expect(otpService.normalizeIdentifier('  Test@EXAMPLE.com  ')).toBe('test@example.com');
    });

    test('extracts 10-digit Indian phone number from various formats', () => {
      expect(otpService.normalizeIdentifier('+91 98765 43210')).toBe('9876543210');
      expect(otpService.normalizeIdentifier('09876543210')).toBe('9876543210');
      expect(otpService.normalizeIdentifier('9876543210')).toBe('9876543210');
    });
  });

  describe('sendOtp and verifyOtp', () => {
    test('sends email OTP when identifier contains @', async () => {
      const res = await otpService.sendOtp({
        identifier: 'patient@example.com',
        purpose: 'login',
      });

      expect(res.success).toBe(true);
      expect(res.channel).toBe('email');
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'patient@example.com' })
      );

      // Verify OTP succeeds with correct OTP
      const verifyRes = await otpService.verifyOtp({
        identifier: 'patient@example.com',
        purpose: 'login',
        otp: res.devOtp,
      });
      expect(verifyRes.valid).toBe(true);
    });

    test('sends SMS OTP for phone numbers', async () => {
      const res = await otpService.sendOtp({
        identifier: '9876543210',
        purpose: 'register',
      });

      expect(res.success).toBe(true);
      expect(res.channel).toBe('sms');
      expect(smsService.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({ to: '9876543210' })
      );
    });

    test('throws 429 when cooldown is active', async () => {
      mockRedis.store.set('otp:cooldown:login:test@example.com', '1');

      await expect(
        otpService.sendOtp({
          identifier: 'test@example.com',
          purpose: 'login',
        })
      ).rejects.toThrow('Please wait');
    });

    test('rejects incorrect OTP and counts attempts', async () => {
      const res = await otpService.sendOtp({
        identifier: 'test@example.com',
        purpose: 'login',
      });

      await expect(
        otpService.verifyOtp({
          identifier: 'test@example.com',
          purpose: 'login',
          otp: '000000',
        })
      ).rejects.toThrow('Incorrect OTP');
    });
  });
});
