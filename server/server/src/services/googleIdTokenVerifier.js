/**
 * Verifies a Google "ID token" (the signed JWT Google Identity Services hands the frontend as
 * `credential` once a user completes "Continue with Google") without any third-party OAuth
 * library.
 *
 * Why hand-written: this sandbox has no npm registry access to install `google-auth-library`
 * (same class of constraint as prisma/manual_sql's hand-written migrations — work around the
 * missing tool, don't skip the feature). It turns out no library is actually needed: Google
 * publishes its current signing keys as a JWKS (JSON Web Key Set) at a well-known URL, Node's own
 * `crypto.createPublicKey({key, format: 'jwk'})` (built in since Node 15.12, no dependency) turns
 * one of those keys straight into a public key object, and `jsonwebtoken` — already a dependency
 * of this project, used everywhere else here for our OWN access/refresh tokens — verifies the
 * RS256 signature against it directly. This is the same "fetch the issuer's JWKS, match by `kid`,
 * verify signature + audience + issuer" flow every OIDC client library performs internally.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const GOOGLE_JWKS_TIMEOUT_MS = 10_000;
// Google rotates its signing keys periodically but publishes the old + new key together for a
// transition window (standard JWKS rotation practice) — a short in-process cache is enough to
// avoid re-fetching the JWKS on every single sign-in, while still picking up a rotated key well
// within its transition window. Also re-fetched immediately (see verifyGoogleIdToken below) the
// first time an incoming token's `kid` isn't found in the cached set, so a rotation is never
// stuck waiting out the full TTL.
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let jwksCache = null; // { fetchedAt: number, keysByKid: Map<string, crypto.KeyObject> }

async function fetchGoogleJwks() {
  // A blocked DNS lookup or upstream connection must not leave a login request hanging until
  // the hosting platform's much longer default timeout. The auth service turns this into its
  // existing safe, retryable GOOGLE_SIGNIN_UNAVAILABLE response.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_JWKS_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(GOOGLE_JWKS_URL, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch Google's signing keys (HTTP ${res.status}).`);
  }
  const body = await res.json();
  const keysByKid = new Map();
  for (const jwk of body.keys || []) {
    try {
      keysByKid.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    } catch (err) {
      logger.warn(`[googleIdTokenVerifier] skipped an unparseable JWKS entry (kid=${jwk.kid}): ${err.message}`);
    }
  }
  jwksCache = { fetchedAt: Date.now(), keysByKid };
  return keysByKid;
}

async function getGoogleJwks({ forceRefresh = false } = {}) {
  if (!forceRefresh && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keysByKid;
  }
  return fetchGoogleJwks();
}

/**
 * @param {string} idToken - the `credential` a Google Identity Services sign-in hands the client.
 * @param {string} audience - our own GOOGLE_CLIENT_ID (config/env.js) — MUST match the token's
 *   `aud` claim, or a Google Sign-In button configured for a completely different application
 *   could mint a token our backend would otherwise accept.
 * @returns {Promise<{sub:string, email:string, emailVerified:boolean, name:string, picture:string|null}>}
 */
async function verifyGoogleIdToken(idToken, audience) {
  if (!idToken || typeof idToken !== 'string') {
    throw new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed: malformed token.');
  }

  const unverified = jwt.decode(idToken, { complete: true });
  if (!unverified || !unverified.header || !unverified.header.kid) {
    throw new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed: malformed token.');
  }

  let keysByKid;
  try {
    keysByKid = await getGoogleJwks();
  } catch (err) {
    logger.error(`[googleIdTokenVerifier] could not fetch Google's signing keys: ${err.message}`);
    throw new ApiError(
      503,
      'GOOGLE_SIGNIN_UNAVAILABLE',
      'Google sign-in is temporarily unavailable. Please try again or use your email and password.'
    );
  }

  let publicKey = keysByKid.get(unverified.header.kid);
  if (!publicKey) {
    // Unknown kid — either Google rotated keys since our last fetch, or the token is bogus.
    // Force exactly one refetch before giving up, same as any OIDC client's rotation handling.
    try {
      keysByKid = await getGoogleJwks({ forceRefresh: true });
    } catch (err) {
      logger.error(`[googleIdTokenVerifier] could not refresh Google's signing keys: ${err.message}`);
      throw new ApiError(
        503,
        'GOOGLE_SIGNIN_UNAVAILABLE',
        'Google sign-in is temporarily unavailable. Please try again or use your email and password.'
      );
    }
    publicKey = keysByKid.get(unverified.header.kid);
  }
  if (!publicKey) {
    throw new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed: unrecognized signing key.');
  }

  let payload;
  try {
    payload = jwt.verify(idToken, publicKey, { algorithms: ['RS256'], audience, issuer: GOOGLE_ISSUERS });
  } catch (err) {
    throw new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed: the token could not be verified.');
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed: the token subject is missing.');
  }

  if (!payload.email || typeof payload.email !== 'string' || !payload.email_verified) {
    throw new ApiError(401, 'GOOGLE_EMAIL_NOT_VERIFIED', "Your Google account's email is not verified.");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: Boolean(payload.email_verified),
    name: payload.name || String(payload.email).split('@')[0],
    picture: payload.picture || null,
  };
}

module.exports = { verifyGoogleIdToken };
