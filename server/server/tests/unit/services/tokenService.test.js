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
 *   - a password-reset token can never be used as a login/access token, and vice versa;
 *   - refresh-token ROTATION issues a fresh pair and revokes the presented token, re-deriving
 *     role/status from the DB rather than trusting the old token's own claims;
 *   - refresh-token REUSE DETECTION: presenting a token whose row is already revoked (a replay,
 *     or the losing side of a concurrent double-refresh race) is rejected as REFRESH_TOKEN_REUSED
 *     and revokes every active session the user has, not just the replayed token.
 *
 * config/db is mocked below because tokenService.js requires it at module load time (the
 * refresh-token-rotation functions touch Prisma). For the access/reset-token describe blocks the
 * mock is never actually exercised; for the refresh-token describe blocks below it stands in for
 * Postgres (this sandbox has no test DB — see tests/setupEnv.js's header comment for the general
 * policy this suite follows), with prisma.refreshToken.create/findUnique/updateMany given
 * per-test return values/implementations that mimic the exact conditional-UPDATE semantics
 * rotateRefreshToken relies on (see that function's own header comment on the TOCTOU-closing
 * `updateMany({ where: { revokedAt: null } })` call).
 */
jest.mock('../../../src/config/db', () => ({
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  user: { findUnique: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../../../src/config/env');
const prisma = require('../../../src/config/db');
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

describe('tokenService — refresh token rotation + reuse detection', () => {
  // Real crypto.randomUUID() jti values, real JWT signing/verification (env.jwt.refreshSecret
  // from tests/setupEnv.js) — only the DB layer (prisma.refreshToken / prisma.user) is a mock,
  // matching this suite's existing "mock config/db, exercise the real service code" policy.
  const SAMPLE_ROTATE_USER = { id: 'user-rotate-1', role: 'patient' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Issues a real refresh token via tokenService.issueRefreshToken and returns both the raw
   * token and the exact row shape prisma.refreshToken.create was called with, so a test can
   * feed that row straight back out of a findUnique mock — i.e. simulates "this token really
   * is the one on file" without hand-assembling a JWT + hash pair itself.
   */
  async function issueAndCaptureStoredRow(user = SAMPLE_ROTATE_USER) {
    let createdData;
    prisma.refreshToken.create.mockImplementationOnce(async ({ data }) => {
      createdData = data;
      return data;
    });
    const token = await tokenService.issueRefreshToken(user);
    return { token, stored: { ...createdData, revokedAt: null } };
  }

  describe('issueRefreshToken', () => {
    test('persists a SHA-256 hash of the token (never the raw token) keyed by its jti, with expiresAt matching env.jwt.refreshExpiresIn', async () => {
      prisma.refreshToken.create.mockResolvedValue({});

      const before = Date.now();
      const token = await tokenService.issueRefreshToken(SAMPLE_ROTATE_USER);
      const after = Date.now();

      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.refreshToken.create.mock.calls[0][0];

      expect(data.userId).toBe(SAMPLE_ROTATE_USER.id);
      expect(data.tokenHash).not.toBe(token);
      expect(data.tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));

      // id is the JWT's own `jti` claim — rotateRefreshToken looks the row up BY jti later.
      const decoded = jwt.decode(token);
      expect(data.id).toBe(decoded.jti);
      expect(decoded.sub).toBe(SAMPLE_ROTATE_USER.id);
      // Refresh tokens deliberately never embed role (see tokenService.js's header comment).
      expect(decoded.role).toBeUndefined();

      const expectedMs = tokenService.parseDurationToMs(env.jwt.refreshExpiresIn);
      expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
      expect(data.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
    });
  });

  describe('rotateRefreshToken — happy path', () => {
    test('revokes the presented token and returns a fresh access+refresh pair for the same user', async () => {
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue(stored);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.create.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue({ id: SAMPLE_ROTATE_USER.id, role: 'patient', status: 'active' });

      const result = await tokenService.rotateRefreshToken(token);

      // The OLD token's row is the one atomically revoked — conditional on still being
      // unrevoked (revokedAt: null), which is the TOCTOU-closing update described in
      // tokenService.js's rotateRefreshToken comment.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });

      // A brand-new refresh token was issued (different from the one just presented) and a new
      // access token was signed for the same user.
      expect(result.refreshToken).not.toBe(token);
      expect(typeof result.accessToken).toBe('string');
      expect(result.user).toMatchObject({ id: SAMPLE_ROTATE_USER.id, role: 'patient', status: 'active' });

      const newPayload = tokenService.verifyAccessToken(result.accessToken);
      expect(newPayload.sub).toBe(SAMPLE_ROTATE_USER.id);

      // Role is re-derived from the DB user row fetched AFTER rotation, not carried over from
      // the old token's payload (refresh tokens never embed role in the first place) — pinning
      // the header comment's "role is re-derived on every rotation" guarantee.
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: stored.userId } })
      );
    });

    test('the newly-issued refresh token is itself a distinct row (new jti), not a reuse of the old one', async () => {
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue(stored);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      let secondCreateData;
      prisma.refreshToken.create.mockImplementationOnce(async ({ data }) => {
        secondCreateData = data;
        return data;
      });
      prisma.user.findUnique.mockResolvedValue({ id: SAMPLE_ROTATE_USER.id, role: 'patient', status: 'active' });

      await tokenService.rotateRefreshToken(token);

      expect(secondCreateData.id).not.toBe(stored.id);
      expect(secondCreateData.userId).toBe(stored.userId);
    });
  });

  describe('rotateRefreshToken — rejection cases (not reuse)', () => {
    test('rejects a token that fails JWT verification (garbage/foreign-secret) as INVALID_REFRESH_TOKEN, without ever touching the DB', async () => {
      await expect(tokenService.rotateRefreshToken('not-a-real-jwt')).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    test('rejects when no row exists for the token\'s jti (never issued, or already deleted)', async () => {
      const { token } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    test('rejects when the stored hash does not match the presented token (same jti, different secret material)', async () => {
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue({ ...stored, tokenHash: 'deliberately-wrong-hash' });

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    test('rejects when the stored row belongs to a different user than the token claims', async () => {
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue({ ...stored, userId: 'someone-else' });

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    test('rejects when the stored row says the token already expired, even though this check runs before the reuse check', async () => {
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue({ ...stored, expiresAt: new Date(Date.now() - 1000) });

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
      // Rejected on the expiry check, before ever reaching the atomic revoke/reuse-detection step.
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    test('rejects with INVALID_REFRESH_TOKEN if the user row no longer exists (account deleted since the token was issued)', async () => {
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue(stored);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
    });

    test('rejects with ACCOUNT_DISABLED for a disabled account — but only AFTER the old token has already been revoked', async () => {
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue(stored);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUnique.mockResolvedValue({ id: stored.userId, role: 'patient', status: 'disabled' });

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({
        statusCode: 403,
        code: 'ACCOUNT_DISABLED',
      });
      // The old token was consumed regardless of the account being disabled — it can never be
      // presented again after this call, disabled account or not.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('rotateRefreshToken — REUSE DETECTION (presenting an already-rotated-out token)', () => {
    test('a token whose row is already revoked is rejected as REFRESH_TOKEN_REUSED, not the generic INVALID_REFRESH_TOKEN', async () => {
      const { token, stored } = await issueAndCaptureStoredRow();
      // Simulate: this token was already rotated out by an earlier, successful refresh call —
      // its row is still present (same hash/user/not-yet-expired) but revokedAt is set.
      prisma.refreshToken.findUnique.mockResolvedValue({ ...stored, revokedAt: new Date() });
      // The atomic conditional UPDATE (`WHERE revokedAt IS NULL`) is exactly what must fail to
      // match here — a real Postgres client would return count: 0 for this row, so the mock
      // mirrors that instead of ever succeeding.
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({
        statusCode: 401,
        code: 'REFRESH_TOKEN_REUSED',
      });
    });

    test('reuse detection revokes EVERY active refresh token for that user, not just the replayed one (whole-session nuke)', async () => {
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue({ ...stored, revokedAt: new Date() });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });

      // revokeAllForUser's own DB shape: a blanket updateMany keyed on userId + revokedAt: null,
      // called a SECOND time (the first updateMany call was the per-token conditional revoke
      // attempt that lost/found the row already revoked).
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.refreshToken.updateMany).toHaveBeenLastCalledWith({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      // Reuse must never reward the attacker/replay with a fresh token pair.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    test('a losing racer in a concurrent double-refresh (both requests see revokedAt: null, only one UPDATE matches) is treated as reuse too', async () => {
      // This pins the TOCTOU-closing comment in tokenService.js: the pre-check read
      // (findUnique) can observe revokedAt: null for BOTH concurrent callers, but only one
      // caller's conditional UPDATE can actually match `revokedAt: null` in Postgres — the
      // loser must be treated exactly like a plain replay of an already-revoked token, even
      // though its own read never saw a revoked row.
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue(stored); // still looks unrevoked to this racer
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 }); // lost the race
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 }); // revokeAllForUser's own call

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    });

    test('after reuse is detected, presenting the ORIGINAL valid-looking token again is refused because it is now revoked (not just re-flagged as reuse forever)', async () => {
      // First presentation: legitimate rotation.
      const { token, stored } = await issueAndCaptureStoredRow();
      prisma.refreshToken.findUnique.mockResolvedValue(stored);
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
      let newRow;
      prisma.refreshToken.create.mockImplementationOnce(async ({ data }) => {
        newRow = { ...data, revokedAt: null };
        return data;
      });
      prisma.user.findUnique.mockResolvedValue({ id: stored.userId, role: 'patient', status: 'active' });

      const firstRotation = await tokenService.rotateRefreshToken(token);
      expect(typeof firstRotation.refreshToken).toBe('string');

      // Second presentation of the SAME old token: its row is now revoked, so this must be
      // detected as reuse, and the fact that a valid successor row (newRow) now exists for this
      // user must not change that outcome.
      prisma.refreshToken.findUnique.mockResolvedValue({ ...stored, revokedAt: new Date() });
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 }); // revokeAllForUser

      await expect(tokenService.rotateRefreshToken(token)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
      expect(newRow.userId).toBe(stored.userId);
    });
  });
});

describe('tokenService — revokeRefreshToken / revokeAllForUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('revokeRefreshToken revokes the row only when it belongs to the given owner', async () => {
    const jti = 'jti-owned-1';
    const token = jwt.sign({ sub: 'owner-1', jti }, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshExpiresIn });
    prisma.refreshToken.findUnique.mockResolvedValue({ id: jti, userId: 'owner-1', revokedAt: null });

    await tokenService.revokeRefreshToken(token, 'owner-1');

    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: jti },
      data: { revokedAt: expect.any(Date) },
    });
  });

  test('revokeRefreshToken is a silent no-op for a token owned by someone else (never revokes another user\'s session)', async () => {
    const jti = 'jti-owned-2';
    const token = jwt.sign({ sub: 'owner-2', jti }, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshExpiresIn });
    prisma.refreshToken.findUnique.mockResolvedValue({ id: jti, userId: 'owner-2', revokedAt: null });

    await expect(tokenService.revokeRefreshToken(token, 'attacker-or-mismatched-caller')).resolves.toBeUndefined();
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();
  });

  test('revokeRefreshToken is a silent no-op for garbage/expired input (idempotent logout)', async () => {
    await expect(tokenService.revokeRefreshToken('not-a-real-token', 'owner-1')).resolves.toBeUndefined();
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  test('revokeAllForUser revokes every currently-active token for that user in one call', async () => {
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    await tokenService.revokeAllForUser('user-with-many-sessions');

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-with-many-sessions', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
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
