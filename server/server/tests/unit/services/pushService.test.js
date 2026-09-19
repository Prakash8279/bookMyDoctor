/**
 * Unit tests for services/pushService.js — same placeholder-provider contract as emailService.js
 * (see that file's test header for the shared reasoning), with one push-specific guard: `userId`
 * (not an address string) gates the no-op skip. config/logger is mocked per this fix group's brief.
 */
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const logger = require('../../../src/config/logger');
const { sendPush } = require('../../../src/services/pushService');

const ORIGINAL_PUSH_PROVIDER = process.env.PUSH_PROVIDER;

afterEach(() => {
  if (ORIGINAL_PUSH_PROVIDER === undefined) delete process.env.PUSH_PROVIDER;
  else process.env.PUSH_PROVIDER = ORIGINAL_PUSH_PROVIDER;
});

describe('pushService.sendPush', () => {
  test('silently no-ops when there is no userId', async () => {
    await expect(sendPush(null, { title: 'T', body: 'B' })).resolves.toBeUndefined();
    await expect(sendPush(undefined, { title: 'T', body: 'B' })).resolves.toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();
  });

  test('the default "log" provider writes a structured info log line with userId/title/body', async () => {
    await sendPush('user-1', { title: 'Reminder', body: 'Appointment soon' });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('userId=user-1 title="Reminder" body="Appointment soon"')
    );
  });

  test('an unrecognized PUSH_PROVIDER falls back to the log provider', async () => {
    process.env.PUSH_PROVIDER = 'fcm-not-wired-yet';

    await sendPush('user-1', { title: 'T', body: 'B' });

    expect(logger.info).toHaveBeenCalled();
  });

  test('never throws even if the resolved provider itself fails — logs a warning instead', async () => {
    jest.resetModules();
    jest.doMock('../../../src/config/logger', () => ({ info: jest.fn(() => { throw new Error('logger exploded'); }), warn: jest.fn(), error: jest.fn() }));
    const isolatedLogger = require('../../../src/config/logger');
    const { sendPush: isolatedSendPush } = require('../../../src/services/pushService');

    await expect(isolatedSendPush('user-1', { title: 'T', body: 'B' })).resolves.toBeUndefined();
    expect(isolatedLogger.warn).toHaveBeenCalledWith(expect.stringContaining('logger exploded'));

    jest.dontMock('../../../src/config/logger');
  });
});
