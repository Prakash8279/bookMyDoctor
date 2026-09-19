/**
 * Unit tests for services/emailService.js — a placeholder ("don't pick a vendor yet") delivery
 * abstraction whose only real logic is: never throw, skip silently with no address on file, log
 * via the 'log' provider by default, and let EMAIL_PROVIDER select a provider (falling back to
 * 'log' for an unknown value). config/logger is mocked per this fix group's brief.
 */
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const logger = require('../../../src/config/logger');
const { sendEmail } = require('../../../src/services/emailService');

const ORIGINAL_EMAIL_PROVIDER = process.env.EMAIL_PROVIDER;

afterEach(() => {
  if (ORIGINAL_EMAIL_PROVIDER === undefined) delete process.env.EMAIL_PROVIDER;
  else process.env.EMAIL_PROVIDER = ORIGINAL_EMAIL_PROVIDER;
});

describe('emailService.sendEmail', () => {
  test('silently no-ops (never logs, never throws) when there is no `to` address', async () => {
    await expect(sendEmail({ to: null, subject: 'S', text: 'T' })).resolves.toBeUndefined();
    await expect(sendEmail({ subject: 'S', text: 'T' })).resolves.toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();
  });

  test('the default "log" provider writes a structured info log line with to/subject/body', async () => {
    await sendEmail({ to: 'user@example.com', subject: 'Hello', text: 'Body text' });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('to=user@example.com subject="Hello" body="Body text"')
    );
  });

  test('an unrecognized EMAIL_PROVIDER value falls back to the log provider rather than throwing', async () => {
    process.env.EMAIL_PROVIDER = 'some-vendor-not-registered';

    await expect(sendEmail({ to: 'user@example.com', subject: 'S', text: 'T' })).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalled();
  });

  test('EMAIL_PROVIDER is matched case-insensitively and with surrounding whitespace trimmed', async () => {
    process.env.EMAIL_PROVIDER = '  LOG  ';

    await sendEmail({ to: 'user@example.com', subject: 'S', text: 'T' });

    expect(logger.info).toHaveBeenCalled();
  });

  test('never throws even if the resolved provider itself fails — logs a warning instead', async () => {
    jest.resetModules();
    jest.doMock('../../../src/config/logger', () => ({ info: jest.fn(() => { throw new Error('logger exploded'); }), warn: jest.fn(), error: jest.fn() }));
    const isolatedLogger = require('../../../src/config/logger');
    const { sendEmail: isolatedSendEmail } = require('../../../src/services/emailService');

    await expect(isolatedSendEmail({ to: 'user@example.com', subject: 'S', text: 'T' })).resolves.toBeUndefined();
    expect(isolatedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('logger exploded'));

    jest.dontMock('../../../src/config/logger');
  });
});
