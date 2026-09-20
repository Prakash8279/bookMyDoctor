/**
 * Unit tests for services/smsService.js — same placeholder-provider contract as emailService.js
 * (see that file's test header for the shared reasoning). config/logger is mocked per this fix
 * group's brief.
 */
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const logger = require('../../../src/config/logger');
const { sendSms } = require('../../../src/services/smsService');

const ORIGINAL_SMS_PROVIDER = process.env.SMS_PROVIDER;

afterEach(() => {
  if (ORIGINAL_SMS_PROVIDER === undefined) delete process.env.SMS_PROVIDER;
  else process.env.SMS_PROVIDER = ORIGINAL_SMS_PROVIDER;
});

describe('smsService.sendSms', () => {
  test('silently no-ops when there is no `to` phone number', async () => {
    await expect(sendSms({ to: null, message: 'M' })).resolves.toBeUndefined();
    await expect(sendSms({ message: 'M' })).resolves.toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();
  });

  test('the default "log" provider writes a structured info log line with to/message', async () => {
    await sendSms({ to: '9999999999', message: 'Your OTP is 1234' });

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('to=9999999999 message="Your OTP is 1234"'));
  });

  test('an unrecognized SMS_PROVIDER falls back to the log provider', async () => {
    process.env.SMS_PROVIDER = 'twilio-not-wired-yet';

    await sendSms({ to: '9999999999', message: 'M' });

    expect(logger.info).toHaveBeenCalled();
  });

  // SECURITY FIX (audit finding: "password-reset token/link written to logs in plaintext") —
  // an OTP/reset-code SMS body must not survive in production logs verbatim. See
  // smsService.js's logProvider comment / emailService.js's equivalent test for the rationale.
  test('redacts the body (but still logs to) when running in production', async () => {
    jest.resetModules();
    jest.doMock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    jest.doMock('../../../src/config/env', () => ({ ...jest.requireActual('../../../src/config/env'), isProduction: true }));
    const isolatedLogger = require('../../../src/config/logger');
    const { sendSms: isolatedSendSms } = require('../../../src/services/smsService');

    await isolatedSendSms({ to: '9999999999', message: 'Your OTP is 424242' });

    const loggedLine = isolatedLogger.info.mock.calls[0][0];
    expect(loggedLine).toContain('to=9999999999');
    expect(loggedLine).not.toContain('424242');

    jest.dontMock('../../../src/config/logger');
    jest.dontMock('../../../src/config/env');
  });

  test('never throws even if the resolved provider itself fails — logs a warning instead', async () => {
    jest.resetModules();
    jest.doMock('../../../src/config/logger', () => ({ info: jest.fn(() => { throw new Error('logger exploded'); }), warn: jest.fn(), error: jest.fn() }));
    const isolatedLogger = require('../../../src/config/logger');
    const { sendSms: isolatedSendSms } = require('../../../src/services/smsService');

    await expect(isolatedSendSms({ to: '9999999999', message: 'M' })).resolves.toBeUndefined();
    expect(isolatedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('logger exploded'));

    jest.dontMock('../../../src/config/logger');
  });
});
