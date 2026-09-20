/**
 * Unit tests for utils/webClientAuth.js — the web-only httpOnly refresh-token cookie helpers
 * (risky-item #2, docs/risky-fixes-plan-2026-09-20.md). See that file's header comment for the
 * full flow this supports.
 *
 * config/db is mocked because tokenService.js (required transitively for parseDurationToMs)
 * touches Prisma at module load time — same reasoning as tokenService.test.js's own mock.
 */
jest.mock('../../../src/config/db', () => ({
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  user: { findUnique: jest.fn() },
}));

const env = require('../../../src/config/env');
const webClientAuth = require('../../../src/utils/webClientAuth');

function fakeReq({ header, body, cookies } = {}) {
  return {
    headers: header !== undefined ? { 'x-client-platform': header } : {},
    body: body || {},
    cookies: cookies || {},
  };
}

function fakeRes() {
  return { cookie: jest.fn(), clearCookie: jest.fn() };
}

describe('webClientAuth.isWebClient', () => {
  test('true only when X-Client-Platform is exactly "web"', () => {
    expect(webClientAuth.isWebClient(fakeReq({ header: 'web' }))).toBe(true);
    expect(webClientAuth.isWebClient(fakeReq({ header: 'mobile' }))).toBe(false);
    expect(webClientAuth.isWebClient(fakeReq())).toBe(false); // no header at all — mobile/curl/etc.
  });
});

describe('webClientAuth.applyAuthCookies', () => {
  test('a web caller gets the cookie set and refreshToken stripped from the body', () => {
    const req = fakeReq({ header: 'web' });
    const res = fakeRes();

    const shaped = webClientAuth.applyAuthCookies(req, res, {
      user: { id: 'u1' },
      accessToken: 'access-abc',
      refreshToken: 'refresh-xyz',
    });

    expect(shaped).toEqual({ user: { id: 'u1' }, accessToken: 'access-abc' });
    expect(shaped.refreshToken).toBeUndefined();
    expect(res.cookie).toHaveBeenCalledTimes(1);
    const [cookieName, cookieValue, options] = res.cookie.mock.calls[0];
    expect(cookieName).toBe('refreshToken');
    expect(cookieValue).toBe('refresh-xyz');
    expect(options).toMatchObject({ httpOnly: true, path: '/auth', sameSite: 'lax' });
    expect(options.maxAge).toBeGreaterThan(0);
  });

  test('a non-web caller (mobile, curl, tests) gets the result back completely unchanged, no cookie set', () => {
    const req = fakeReq(); // no X-Client-Platform header
    const res = fakeRes();
    const result = { user: { id: 'u1' }, accessToken: 'access-abc', refreshToken: 'refresh-xyz' };

    const shaped = webClientAuth.applyAuthCookies(req, res, result);

    expect(shaped).toBe(result); // same reference, not even a shallow clone
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('webClientAuth.resolveIncomingRefreshToken', () => {
  test('prefers a body-supplied token (mobile flow) even if a cookie is also present', () => {
    const req = fakeReq({ body: { refreshToken: 'from-body' }, cookies: { refreshToken: 'from-cookie' } });
    expect(webClientAuth.resolveIncomingRefreshToken(req)).toBe('from-body');
  });

  test('falls back to the cookie when the body has none (web flow)', () => {
    const req = fakeReq({ cookies: { refreshToken: 'from-cookie' } });
    expect(webClientAuth.resolveIncomingRefreshToken(req)).toBe('from-cookie');
  });

  test('returns undefined when neither is present', () => {
    const req = fakeReq();
    expect(webClientAuth.resolveIncomingRefreshToken(req)).toBeUndefined();
  });
});

describe('webClientAuth.clearAuthCookie', () => {
  test('clears the cookie with matching path/sameSite attributes (no maxAge)', () => {
    const req = fakeReq({ header: 'web' });
    const res = fakeRes();

    webClientAuth.clearAuthCookie(req, res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.objectContaining({ httpOnly: true, path: '/auth', sameSite: 'lax' })
    );
    const [, options] = res.clearCookie.mock.calls[0];
    expect(options.maxAge).toBeUndefined();
  });
});

describe('webClientAuth.refreshCookieOptions — SameSite=None forces Secure regardless of environment', () => {
  const originalSameSite = env.refreshCookieSameSite;
  const originalIsProduction = env.isProduction;
  afterEach(() => {
    env.refreshCookieSameSite = originalSameSite;
    env.isProduction = originalIsProduction;
  });

  test('secure is true when sameSite is "none", even outside production', () => {
    env.refreshCookieSameSite = 'none';
    env.isProduction = false;
    expect(webClientAuth.refreshCookieOptions().secure).toBe(true);
  });

  test('secure is false for "lax" outside production (plain-http local dev)', () => {
    env.refreshCookieSameSite = 'lax';
    env.isProduction = false;
    expect(webClientAuth.refreshCookieOptions().secure).toBe(false);
  });

  test('secure is true for "lax" in production', () => {
    env.refreshCookieSameSite = 'lax';
    env.isProduction = true;
    expect(webClientAuth.refreshCookieOptions().secure).toBe(true);
  });
});
