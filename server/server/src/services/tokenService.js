/**
 * JWT access + refresh token issuing/verification, and refresh-token rotation/revocation
 * against the refresh_tokens table. Responsibility: the ONLY place that signs/verifies tokens
 * or touches refresh_tokens — auth.service.js calls into this, never jsonwebtoken directly.
 *
 * Refresh tokens deliberately do NOT embed role — a refresh token only proves identity.
 * Role is re-derived from the DB on every rotation so a stale/escalated role claim baked
 * into a long-lived token can never survive past the next refresh.
 *
 * Refresh tokens are stored as a SHA-256 hash (not bcrypt): the token itself is high-entropy
 * random-ish data signed by us, not a human-chosen password, so an adaptive slow hash buys no
 * meaningful resistance to guessing and only costs latency on every refresh call.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/db');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verifies a JWT against an ordered list of candidate secrets, current secret first, so a
 * rotated secret (env.jwt.accessVerifySecrets / refreshVerifySecrets — see config/env.js) can
 * still verify tokens signed under the previous one for one deploy cycle instead of forcing an
 * instant mass-logout. jsonwebtoken's verify() throws synchronously on a mismatched secret, so
 * each candidate is tried in turn; if every candidate fails, a TokenExpiredError from any one of
 * them wins (see inline comment below) and otherwise the first failure is propagated.
 * @param {string} token
 * @param {string[]} secrets - non-empty, current secret first
 * @returns {object} decoded payload from whichever secret matched
 * @throws the error from jwt.verify() against the final candidate if none matched
 */
function verifyWithSecrets(token, secrets) {
  let fallbackError;
  for (const secret of secrets) {
    try {
      // Explicit algorithm allowlist (defense-in-depth): every secret here is a plain string
      // used with HS256 at sign time (see jwt.sign calls below), so this doesn't change today's
      // behavior — it just guarantees that if a secret is ever swapped for an RSA/EC key without
      // updating this call, jsonwebtoken can't be tricked into accepting a token signed with a
      // different algorithm (the classic HS256-vs-RS256 confusion attack).
      return jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch (err) {
      // A TokenExpiredError means THIS secret's signature actually matched and only expiry
      // failed — strictly more informative than a signature mismatch against some other
      // candidate secret, so it always wins as the error we ultimately report (callers like
      // authenticate.js branch on `instanceof jwt.TokenExpiredError` to return a distinct
      // TOKEN_EXPIRED vs TOKEN_INVALID response, and that distinction would be lost if a later
      // candidate's plain signature-mismatch error clobbered it).
      if (err instanceof jwt.TokenExpiredError) {
        fallbackError = err;
      } else if (!fallbackError) {
        fallbackError = err;
      }
    }
  }
  throw fallbackError;
}

// Minimal duration-string parser for values like "15m", "30d", "3600" (seconds), "1h".
// Avoids pulling in the separate `ms` npm package for one call site; only the units
// this codebase's env vars actually use (s/m/h/d) need to be supported.
const DURATION_UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
function parseDurationToMs(value) {
  if (typeof value === 'number') return value * 1000;
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(String(value).trim());
  if (!match) {
    throw new Error(`Unrecognized duration string: "${value}"`);
  }
  const amount = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  return amount * DURATION_UNIT_MS[unit];
}

/**
 * @param {{id:string, role:string}} user
 * @returns {string} short-lived access token JWT
 */
function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn,
  });
}

/**
 * @param {string} token
 * @returns {{sub:string, role:string, iat:number, exp:number}} decoded payload
 * @throws {jwt.TokenExpiredError|jwt.JsonWebTokenError} on invalid/expired tokens
 */
function verifyAccessToken(token) {
  const payload = verifyWithSecrets(token, env.jwt.accessVerifySecrets);

  // Password-reset tokens (see signResetToken below) are deliberately signed with this SAME
  // secret, so they ride the existing secret-rotation machinery in verifyWithSecrets for free —
  // but they carry a `purpose` claim a real access token never has. authenticate.js calls
  // verifyAccessToken() and, on success, trusts payload.sub alone (it re-derives role/status
  // from the DB rather than reading payload.role), so without this check a leaked/short-lived
  // reset token would double as a fully-valid 30-minute access token. Reject it here instead —
  // the one place both token kinds' verification already funnels through — so that can't happen.
  if (payload.purpose) {
    throw new jwt.JsonWebTokenError('Token is not a valid access token.');
  }

  return payload;
}

// Distinct claim value stamped onto password-reset tokens so verifyAccessToken (above) can
// refuse to treat one as a login session, and verifyResetToken (below) can refuse to treat a
// real access/refresh token as a reset token.
const RESET_TOKEN_PURPOSE = 'password-reset';

// SECURITY FIX (audit finding: "uploaded documents served without authentication" —
// /uploads/documents/* used to be plain express.static, so anyone with a leaked URL — browser
// history, a server/analytics log, a pasted support-ticket link — could fetch a doctor's
// verification document forever, with no login required). A doctor verification document is
// opened via a plain `<a href target="_blank">` in AdminPages.jsx (see doctors.service.js's
// shapeDoctor, which appends this token to the URL only when the CALLER is already the owning
// doctor or an admin/superadmin — see the includeContact gate there), so a real Bearer-header
// check isn't reachable here the way it is for a normal API call: the browser's own navigation
// never attaches one. A short-lived, filename-scoped signed token in the URL's query string
// (the same shape S3/GCS "pre-signed URLs" use) fixes the actual reported problem — a leaked
// link stops working within minutes — without needing any frontend rework.
const FILE_ACCESS_TOKEN_PURPOSE = 'file-access';
const FILE_ACCESS_TOKEN_EXPIRES_IN = '10m';
// Deliberately short — long enough for someone to receive and act on a reset link, short enough
// that a link sitting unused (in an inbox, or a server log — see auth.service.js#forgotPassword)
// stops being useful quickly.
const RESET_TOKEN_EXPIRES_IN = '30m';

/**
 * Signs a short-lived, single-purpose password-reset token. Reuses env.jwt.accessSecret rather
 * than a dedicated secret — this app has no separate reset-token secret configured — but is
 * never accepted as a real access token; see the `purpose` check in verifyAccessToken above.
 * @param {string} userId
 * @returns {string} signed JWT
 */
function signResetToken(userId) {
  return jwt.sign({ sub: userId, purpose: RESET_TOKEN_PURPOSE }, env.jwt.accessSecret, {
    expiresIn: RESET_TOKEN_EXPIRES_IN,
  });
}

/**
 * Verifies a password-reset token minted by signResetToken.
 * @param {string} token
 * @returns {string} the userId (payload.sub) the token was issued for
 * @throws {ApiError} 400 INVALID_RESET_TOKEN on any failure — missing, expired, forged, or a
 *   well-formed token of the wrong purpose (e.g. someone passing in a real access token) all
 *   collapse to the same generic error, so a caller probing tokens can't distinguish them.
 */
function verifyResetToken(token) {
  let payload;
  try {
    payload = verifyWithSecrets(token, env.jwt.accessVerifySecrets);
  } catch (err) {
    throw new ApiError(400, 'INVALID_RESET_TOKEN', 'This password reset link is invalid or has expired.');
  }

  if (payload.purpose !== RESET_TOKEN_PURPOSE) {
    throw new ApiError(400, 'INVALID_RESET_TOKEN', 'This password reset link is invalid or has expired.');
  }

  return payload.sub;
}

/**
 * Signs a short-lived token scoped to exactly one uploaded filename — see the
 * FILE_ACCESS_TOKEN_PURPOSE comment above for why this exists instead of a normal auth check.
 * @param {string} filename - the exact server-generated filename (e.g. a crypto.randomUUID()
 *   + extension from fileUploadService.js) this token authorizes fetching. Binding the filename
 *   into the token itself (not just "this caller may fetch *some* document") means one leaked
 *   link can never be reused to guess/fetch a different doctor's document.
 * @returns {string} signed JWT, meant to be appended as a `?token=` query param
 */
function signFileAccessToken(filename) {
  return jwt.sign({ purpose: FILE_ACCESS_TOKEN_PURPOSE, filename }, env.jwt.accessSecret, {
    expiresIn: FILE_ACCESS_TOKEN_EXPIRES_IN,
  });
}

/**
 * Verifies a token minted by signFileAccessToken for THIS specific filename.
 * @param {string} token
 * @param {string} filename - the filename being requested; must match the one the token was
 *   signed for, or verification fails (prevents reusing one document's link to fetch another).
 * @returns {boolean} true only if the token is well-formed, unexpired, the right purpose, and
 *   scoped to this exact filename — every other case (including any thrown error) returns
 *   false rather than throwing, since the caller treats "no valid token" as a plain 403/404,
 *   not a distinguishable error state (same anti-enumeration reasoning as verifyResetToken).
 */
function verifyFileAccessToken(token, filename) {
  if (!token) return false;
  try {
    const payload = verifyWithSecrets(token, env.jwt.accessVerifySecrets);
    return payload.purpose === FILE_ACCESS_TOKEN_PURPOSE && payload.filename === filename;
  } catch (err) {
    return false;
  }
}

/**
 * Signs a new refresh token JWT and persists its hash in refresh_tokens.
 * @param {{id:string}} user
 * @returns {Promise<string>} the raw refresh token (only ever returned once, to the client)
 */
async function issueRefreshToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: user.id, jti }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
  });

  const expiresAt = new Date(Date.now() + parseDurationToMs(env.jwt.refreshExpiresIn));

  await prisma.refreshToken.create({
    data: {
      id: jti,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });

  return token;
}

/**
 * Issues a fresh {accessToken, refreshToken} pair for a user (used at login/register).
 * @param {{id:string, role:string}} user
 */
async function issueTokenPair(user) {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user),
    issueRefreshToken(user),
  ]);
  return { accessToken, refreshToken };
}

/**
 * Verifies + rotates a refresh token: revokes the presented token and issues a new
 * access+refresh pair. Detects replay of an already-revoked token (a strong signal the
 * token was stolen) and, on detection, revokes every active refresh token the user has.
 * @param {string} oldToken
 * @returns {Promise<{accessToken:string, refreshToken:string, user:{id:string,role:string,status:string}}>}
 */
async function rotateRefreshToken(oldToken) {
  let payload;
  try {
    payload = verifyWithSecrets(oldToken, env.jwt.refreshVerifySecrets);
  } catch (err) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }

  const tokenHash = hashToken(oldToken);
  const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });

  if (!stored || stored.tokenHash !== tokenHash || stored.userId !== payload.sub) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }

  if (stored.expiresAt.getTime() < Date.now()) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }

  // Atomically revoke iff still unrevoked. This single conditional UPDATE — not the earlier
  // read above, which is only a cheap pre-check for hash/ownership/expiry — is what actually
  // closes the TOCTOU race: if the same token is presented twice concurrently (a network retry,
  // or an attacker replaying a stolen token in parallel), Postgres serializes the two UPDATEs
  // and only one of them can match `revokedAt: null`. Exactly one racer gets count === 1 and is
  // allowed to proceed to issueTokenPair(); every other racer — including a genuine replay of a
  // token that was already revoked before this call ever started — gets count === 0 and is
  // treated as reuse below, even if its own read above happened to observe revokedAt: null.
  const revocation = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (revocation.count === 0) {
    // Lost the race, or a plain replay of an already-revoked token — both are treated as
    // reuse/theft. Nuke every active session for this user so the legitimate owner is forced
    // to re-authenticate.
    await revokeAllForUser(stored.userId);
    throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'This session has been revoked for security reasons. Please log in again.');
  }

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: { id: true, role: true, status: true },
  });

  if (!user) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }

  if (user.status === 'disabled') {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
  }

  const tokens = await issueTokenPair(user);
  return { ...tokens, user };
}

/**
 * Revokes a single refresh token, but only if it belongs to ownerUserId — idempotent
 * (no error if the token is missing/already revoked/belongs to someone else) so logout
 * is always a clean 200 from the client's point of view.
 * @param {string} token
 * @param {string} ownerUserId
 */
async function revokeRefreshToken(token, ownerUserId) {
  let payload;
  try {
    payload = verifyWithSecrets(token, env.jwt.refreshVerifySecrets);
  } catch (err) {
    return; // already invalid/expired — nothing to revoke
  }

  const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
  if (!stored || stored.userId !== ownerUserId || stored.revokedAt) return;

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes every active (non-revoked) refresh token for a user — used on password change
 * and on refresh-token-reuse detection to force re-login everywhere.
 * @param {string} userId
 */
async function revokeAllForUser(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signResetToken,
  verifyResetToken,
  signFileAccessToken,
  verifyFileAccessToken,
  issueRefreshToken,
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
