/**
 * Unit tests for config/sentry.js — optional backend error tracking (production-readiness plan,
 * Phase 3). The whole point of this module is that the app must behave identically whether or
 * not Sentry is configured/installed, so every test here is really testing a "safe no-op" path:
 *   - SENTRY_DSN unset (the default) -> completely inert, never even tries to require the package.
 *   - SENTRY_DSN set but @sentry/node not installed -> warns once, stays inert, never crashes
 *     app startup (this is the sandbox's own real situation: the package was added to
 *     package.json but never `npm install`ed here).
 *   - SENTRY_DSN set AND @sentry/node available -> actually initializes and forwards exceptions.
 *   - captureException before init() (or when init() no-opped) -> always a safe no-op, so
 *     errorHandler.js never needs its own "is Sentry on" check.
 * `@sentry/node` genuinely is not installed in this repo's node_modules yet (it was added to
 * package.json as a text-only dependency — see that file's own note on why), so every test that
 * needs it "present" mocks it with jest.doMock's {virtual:true}, which does not require the real
 * package to be resolvable on disk.
 */
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const ORIGINAL_DSN = process.env.SENTRY_DSN;

afterEach(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = ORIGINAL_DSN;
  jest.resetModules();
  // NOT jest.dontMock('@sentry/node') here: the package genuinely is not installed in this repo
  // yet, so unmocking a virtual mock of it would itself try (and fail) to resolve the real
  // module. jest.resetModules() above already clears the require cache for the next test, and
  // only the "SENTRY_DSN set and @sentry/node available" tests below ever register the mock in
  // the first place — every earlier test in this file runs before that describe block does.
});

function loadFresh(setupMock) {
  jest.resetModules();
  let mockResult;
  if (setupMock) {
    mockResult = setupMock();
  }
  const logger = require('../../../src/config/logger');
  const sentry = require('../../../src/config/sentry');
  return { sentry, logger, ...mockResult };
}

describe('config/sentry — SENTRY_DSN unset (the default)', () => {
  test('init() is a no-op and never attempts to require @sentry/node', () => {
    delete process.env.SENTRY_DSN;
    const { sentry } = loadFresh();

    expect(() => sentry.init()).not.toThrow();
  });

  test('captureException() before init() (or with init() a no-op) never throws', () => {
    delete process.env.SENTRY_DSN;
    const { sentry } = loadFresh();
    sentry.init();

    expect(() => sentry.captureException(new Error('boom'))).not.toThrow();
  });
});

describe('config/sentry — SENTRY_DSN set but @sentry/node is not installed', () => {
  function mockMissingModule() {
    jest.doMock('@sentry/node', () => {
      const err = new Error("Cannot find module '@sentry/node'");
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    });
  }

  test('init() warns once and stays inert, never crashes app startup', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { sentry, logger } = loadFresh(mockMissingModule);

    expect(() => sentry.init()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('@sentry/node package is not installed'));
  });

  test('captureException() after a failed init() is still a safe no-op', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { sentry } = loadFresh(mockMissingModule);
    sentry.init();

    expect(() => sentry.captureException(new Error('boom'))).not.toThrow();
  });
});

describe('config/sentry — SENTRY_DSN set and @sentry/node available', () => {
  function mockSentryModule() {
    const mockInit = jest.fn();
    const mockCaptureException = jest.fn();
    jest.doMock('@sentry/node', () => ({ init: mockInit, captureException: mockCaptureException }));
    return { mockInit, mockCaptureException };
  }

  test('init() calls through to Sentry.init with the configured DSN', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { sentry, mockInit } = loadFresh(mockSentryModule);

    sentry.init();

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0' })
    );
  });

  test('captureException() after a successful init() forwards the error to Sentry', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { sentry, mockCaptureException } = loadFresh(mockSentryModule);
    sentry.init();

    const err = new Error('something broke');
    sentry.captureException(err, { requestId: 'req-1' });

    expect(mockCaptureException).toHaveBeenCalledWith(err, { extra: { requestId: 'req-1' } });
  });

  test('captureException() with no extra context omits the options argument entirely', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { sentry, mockCaptureException } = loadFresh(mockSentryModule);
    sentry.init();

    sentry.captureException(new Error('boom'));

    expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error), undefined);
  });

  test('a failure INSIDE Sentry.captureException itself is caught and logged, never rethrown', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { sentry, logger } = loadFresh(() => {
      jest.doMock('@sentry/node', () => ({
        init: jest.fn(),
        captureException: jest.fn(() => {
          throw new Error('sentry sdk network failure');
        }),
      }));
    });
    sentry.init();

    expect(() => sentry.captureException(new Error('original error'))).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sentry sdk network failure'));
  });
});
