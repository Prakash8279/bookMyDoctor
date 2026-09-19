/**
 * Unit tests for services/tokenService.js — the ONLY place in this codebase that signs/verifies
 * JWTs (see that file's header comment: "auth.service.js calls into this, never jsonwebtoken
 * directly"). Covers the properties a token-issuing service must get right or the whole auth
 * system is unsafe:
 *   - a validly-signed, unexpired access token round-trips to the payload it was signed with;
 *   - an EXPIRED token is rejected (jwt.TokenExpiredError), not silently accepted;
 *   - a TAMPERED token (bytes changed after signing) is rejected (invalid signature);
 *   - a token signed under a totally different secret is rejected;
 *   - a token signed under the documented "previous secret" rotation window still verifies;
 *   - a password-reset token can never be used as a login/access token, and vice versa.
 *
 * config/db is mocked below because tokenService.js requires it at module load time (the
 * refresh-token-rotation functions touch Prisma) even though every function actually exercised
 * here (sign/verify of access + reset tokens) never calls it — mocking keeps this a true unit
 * test needing no real Postgres connection, matching this sandbox's "no test DB" constraint (see
 * tests/setupEnv.js's header comment for the general policy this suite follows).
 */
jest.mock('../../../src/config/db', () => ({
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  user: { findUnique: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const env = require('../../../src/config/env');
const tokenService = require('../../../src/services/tokenService');

const SAMPLE_USER = { id: 'user-123', role: 'patient' };

describe('tokenService — access tokens', () => {
  test('signAccessToken/verifyAccessToken round-trip carries the signed user id + role, and no purpose claim', () => {
    const token = tokenService.signAccessToken(SAMPLE_USER);
    const payload = tokenService.verifyAccessToken(token);

    expect(payload.sub).toBe(SAMPLE_USER.id);
    expect(payload.role).toBe(SAMPLE_USER.role);
    // A real access token must never carry the `purpose` claim reset tokens use (see below).
    expect(payload.purpose).toBeUndefined();
  });

  test('verifyAccessToken rejects an expired token with jwt.TokenExpiredError', () => {
    // Signed with a negative expiresIn so `exp` lands in the past the instant it's minted —
    // jsonwebtoken supports this deliberately, exactly for constructing an already-expired
    // token in a test without waiting on a real clock.
    const expiredToken = jwt.sign({ sub: SAMPLE_USER.id, role: SAMPLE_USER.role }, env.jwt.accessSecret, {
      expiresIn: -10,
    });

    expect(() => tokenService.verifyAccessToken(expiredToken)).toThrow(jwt.TokenExpiredError);
  });

  test('verifyAccessToken rejects a tampered token (signature no longer matches the payload)', () => {
    const token = tokenService.signAccessToken(SAMPLE_USER);
    // Flip the last character of the signature segment — guarantees the signature no longer
    // matches the header+payload regardless of what that character originally was.
    const tamperedToken = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a');

    expect(() => tokenService.verifyAccessToken(tamperedToken)).toThrow(jwt.JsonWebTokenError);
  });

  test('verifyAccessToken rejects a well-formed token signed under an unrelated secret', () => {
    const foreignToken = jwt.sign({ sub: SAMPLE_USER.id, role: SAMPLE_USER.role }, 'some-attacker-controlled-secret', {
      expiresIn: '15m',
    });

    expect(() => tokenService.verifyAccessToken(foreignToken)).toThrow(jwt.JsonWebTokenError);
  });

  test('verifyAccessToken still accepts a token signed under the PREVIOUS secret (rotation window)', () => {
    // env.jwt.accessVerifySecrets[1] is JWT_ACCESS_SECRET_PREVIOUS (see tests/setupEnv.js) — a
    // token signed with it must still verify, matching the rotation contract documented in both
    // tokenService.js's verifyWithSecrets and config/env.js's accessVerifySecrets comments: an
    // operator rotates a secret without instantly logging out everyone already holding a token
    // signed under the old one.
    const previousSecret = env.jwt.accessVerifySecrets[1];
    expect(previousSecret).toBeTruthy(); // sanity check that setupEnv.js actually wired one up

    const tokenUnderPreviousSecret = jwt.sign({ sub: SAMPLE_USER.id, role: SAMPLE_USER.role }, previousSecret, {
      expiresIn: '15m',
    });

    const payload = tokenService.verifyAccessToken(tokenUnderPreviousSecret);
    expect(payload.sub).toBe(SAMPLE_USER.id);
  });

  test('verifyAccessToken rejects a password-reset token presented as an access token', () => {
    // Reset tokens are deliberately signed with the SAME secret as access tokens (see
    // signResetToken's header comment) but carry a `purpose` claim — verifyAccessToken must
    // refuse them, or a leaked 30-minute password-reset link would double as a full login
    // session for that user.
    const resetToken = tokenService.signResetToken(SAMPLE_USER.id);

    expect(() => tokenService.verifyAccessToken(resetToken)).toThrow(jwt.JsonWebTokenError);
    expect(() => tokenService.verifyAccessToken(resetToken)).toThrow('Token is not a valid access token.');
  });
});

describe('tokenService — password-reset tokens', () => {
  test('signResetToken/verifyResetToken round-trip returns the userId it was signed for', () => {
    const token = tokenService.signResetToken(SAMPLE_USER.id);

    expect(tokenService.verifyResetToken(token)).toBe(SAMPLE_USER.id);
  });

  test('verifyResetToken rejects a real access token (wrong purpose) with the generic error', () => {
    const accessToken = tokenService.signAccessToken(SAMPLE_USER);

    expect(() => tokenService.verifyResetToken(accessToken)).toThrow(/invalid or has expired/);
  });

  test('verifyResetToken rejects garbage input with the SAME generic error (no oracle for probing tokens)', () => {
    expect(() => tokenService.verifyResetToken('not-a-real-token-at-all')).toThrow(/invalid or has expired/);
  });
});
