/**
 * Unit tests for services/googleIdTokenVerifier.js — the hand-written Google ID token verifier
 * written in place of google-auth-library (see that file's header comment for why: no npm
 * registry access in this sandbox to install a new dependency). Builds a REAL RSA key pair and a
 * REAL signed JWT with the project's own `jsonwebtoken` dependency, so these tests exercise the
 * actual signature-verification code path rather than a reimplementation of it — global `fetch`
 * is the only thing mocked, standing in for Google's JWKS endpoint.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const AUDIENCE = 'test-client-id.apps.googleusercontent.com';
const KID = 'test-key-1';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_JWK = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };

function signToken(claimOverrides = {}, { kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: AUDIENCE,
    sub: 'google-sub-abc',
    email: 'asha@example.com',
    email_verified: true,
    name: 'Asha Rao',
    picture: 'https://example.com/photo.jpg',
    iat: now,
    exp: now + 3600,
    ...claimOverrides,
  };
  return jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: kid, noTimestamp: true });
}

function mockJwksResponse(keys = [PUBLIC_JWK]) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ keys }) });
}

// The module keeps its fetched-JWKS cache in a module-level variable (by design — see the
// module's own header comment on why that's a deliberate, not accidental, TTL cache). Re-requiring
// it fresh before every test (rather than just clearing mocks) keeps that cache from leaking
// between tests — otherwise a later test could silently pass by reusing an earlier test's
// already-cached keys instead of exercising its own mocked fetch response.
let verifyGoogleIdToken;
beforeEach(() => {
  jest.resetModules();
  ({ verifyGoogleIdToken } = require('../../../src/services/googleIdTokenVerifier'));
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

test('verifies a genuine token and returns the expected profile fields', async () => {
  mockJwksResponse();

  const profile = await verifyGoogleIdToken(signToken(), AUDIENCE);

  expect(profile).toEqual({
    sub: 'google-sub-abc',
    email: 'asha@example.com',
    emailVerified: true,
    name: 'Asha Rao',
    picture: 'https://example.com/photo.jpg',
  });
});

test('caches the JWKS across calls — a second verification within the TTL makes no further fetch', async () => {
  mockJwksResponse();

  await verifyGoogleIdToken(signToken(), AUDIENCE);
  await verifyGoogleIdToken(signToken(), AUDIENCE);

  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('rejects a token signed for a different audience (INVALID_GOOGLE_TOKEN)', async () => {
  mockJwksResponse();

  await expect(verifyGoogleIdToken(signToken({ aud: 'someone-elses-client-id' }), AUDIENCE)).rejects.toMatchObject({
    statusCode: 401,
    code: 'INVALID_GOOGLE_TOKEN',
  });
});

test('rejects a token from an unexpected issuer (INVALID_GOOGLE_TOKEN)', async () => {
  mockJwksResponse();

  await expect(verifyGoogleIdToken(signToken({ iss: 'https://evil.example.com' }), AUDIENCE)).rejects.toMatchObject({
    statusCode: 401,
    code: 'INVALID_GOOGLE_TOKEN',
  });
});

test('rejects an expired token (INVALID_GOOGLE_TOKEN)', async () => {
  mockJwksResponse();
  const now = Math.floor(Date.now() / 1000);

  await expect(
    verifyGoogleIdToken(signToken({ iat: now - 7200, exp: now - 3600 }), AUDIENCE)
  ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_GOOGLE_TOKEN' });
});

test('rejects a token whose email is not verified (GOOGLE_EMAIL_NOT_VERIFIED)', async () => {
  mockJwksResponse();

  await expect(
    verifyGoogleIdToken(signToken({ email_verified: false }), AUDIENCE)
  ).rejects.toMatchObject({ statusCode: 401, code: 'GOOGLE_EMAIL_NOT_VERIFIED' });
});

test('rejects a token without a stable Google subject (INVALID_GOOGLE_TOKEN)', async () => {
  mockJwksResponse();

  await expect(
    verifyGoogleIdToken(signToken({ sub: '' }), AUDIENCE)
  ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_GOOGLE_TOKEN' });
});

test('force-refetches the JWKS once when the token\'s kid is unknown, and succeeds if the fresh set has it', async () => {
  // First fetch returns an unrelated key; the token's real key only shows up on the SECOND
  // fetch — simulates Google having rotated keys since our last cache fill.
  const otherKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherJwk = { ...otherKeyPair.publicKey.export({ format: 'jwk' }), kid: 'some-other-kid', use: 'sig', alg: 'RS256' };
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [otherJwk] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [PUBLIC_JWK] }) });

  const profile = await verifyGoogleIdToken(signToken(), AUDIENCE);

  expect(profile.sub).toBe('google-sub-abc');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('rejects with INVALID_GOOGLE_TOKEN when the kid is unknown even after a refetch', async () => {
  mockJwksResponse(); // never contains KID

  await expect(verifyGoogleIdToken(signToken({}, { kid: 'totally-unknown-kid' }), AUDIENCE)).rejects.toMatchObject({
    statusCode: 401,
    code: 'INVALID_GOOGLE_TOKEN',
  });
  expect(global.fetch).toHaveBeenCalledTimes(2); // one normal fetch + one forced refetch
});

test('surfaces GOOGLE_SIGNIN_UNAVAILABLE (503) when Google\'s JWKS endpoint cannot be reached', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

  await expect(verifyGoogleIdToken(signToken(), AUDIENCE)).rejects.toMatchObject({
    statusCode: 503,
    code: 'GOOGLE_SIGNIN_UNAVAILABLE',
  });
});

test('surfaces GOOGLE_SIGNIN_UNAVAILABLE (503) when the JWKS endpoint responds with a non-2xx status', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

  await expect(verifyGoogleIdToken(signToken(), AUDIENCE)).rejects.toMatchObject({
    statusCode: 503,
    code: 'GOOGLE_SIGNIN_UNAVAILABLE',
  });
});

test('rejects a malformed token (no kid header) without ever calling fetch', async () => {
  const bareToken = jwt.sign({ foo: 'bar' }, 'plain-secret-not-rsa', { algorithm: 'HS256' });
  global.fetch = jest.fn();

  await expect(verifyGoogleIdToken(bareToken, AUDIENCE)).rejects.toMatchObject({
    statusCode: 401,
    code: 'INVALID_GOOGLE_TOKEN',
  });
  expect(global.fetch).not.toHaveBeenCalled();
});
