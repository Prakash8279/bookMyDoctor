/**
 * Business logic for the auth module.
 * Responsibility: THIS is where validation-beyond-shape, ownership checks, business rules
 * (e.g. double-booking prevention, fee computation, payment masking by role), and all
 * Prisma/DB calls for this module live. Controllers call these functions; these functions
 * never touch req/res directly.
 */
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../../config/db');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const tokenService = require('../../services/tokenService');
const activityLogService = require('../../services/activityLogService');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');
const logger = require('../../config/logger');

// Base columns returned for "who am I" responses across this module — never includes passwordHash.
const USER_SUMMARY_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  city: true,
  photoUrl: true,
  status: true,
  createdAt: true,
};

// Precomputed once at boot and reused as the bcrypt.compare() target whenever an email lookup
// finds no matching user. This guarantees a real bcrypt comparison always runs on login,
// whether or not the account exists, so response timing can't be used to distinguish
// "no such email" from "wrong password" (see D9 in the phase plan).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), env.bcryptSaltRounds);

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/**
 * Creates a bare-bones in-app notification for a single user. Writes the Notification +
 * NotificationRecipient rows directly (same shape notifications.service.js#broadcastNotification
 * uses for its 'single_user' audience) rather than calling into that module: broadcastNotification
 * requires an admin/superadmin `actor` and is wired for admin-initiated broadcasts, whereas this
 * is a system-generated notification with no human sender (senderUserId stays null). Kept local
 * to this module rather than added as a new exported helper on notifications.service.js, which is
 * outside this fix's scope.
 * @param {string} userId
 * @param {{title:string, body:string, type?:string}} content
 */
async function notifyUserInApp(userId, { title, body, type = 'security' }) {
  const notification = await prisma.notification.create({
    data: { title, body, type, audience: 'single_user', targetUserId: userId, senderUserId: null },
  });
  await prisma.notificationRecipient.create({ data: { notificationId: notification.id, userId } });
}

/**
 * Registers a new PATIENT account (self-registration is never allowed to create any other
 * role, regardless of what the request body contains — role is hard-coded here even though
 * validation already rejects a non-"patient" value, as belt-and-suspenders against a client
 * that bypasses the validation layer entirely).
 * @param {{name:string, email:string, password:string, phone?:string, city?:string}} input
 */
async function register({ name, email, password, phone, city }) {
  const normalizedEmail = normalizeEmail(email);

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
  if (existing) {
    throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);

  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'patient',
          phone: phone ? phone.trim() : null,
          city: city ? city.trim() : null,
          status: 'active',
        },
        select: USER_SUMMARY_SELECT,
      });

      // Created eagerly (empty row) so GET /me never has to special-case a missing
      // patient profile.
      await tx.patientProfile.create({ data: { userId: created.id } });

      return created;
    });
  } catch (err) {
    // Race with a concurrent registration of the same email: the pre-check above is not
    // atomic with the insert, so the DB's unique constraint is the real backstop.
    if (err.code === 'P2002') {
      throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    throw err;
  }

  const tokens = await tokenService.issueTokenPair(user);

  await activityLogService.log({
    actorUserId: user.id,
    actorRole: 'patient',
    actionType: 'auth.register',
    targetEntityType: 'user',
    targetEntityId: user.id,
    description: 'Patient self-registered',
  });

  return { user, ...tokens };
}

/**
 * @param {{email:string, password:string}} input
 */
async function login({ email, password }) {
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { ...USER_SUMMARY_SELECT, passwordHash: true },
  });

  // Always compare against SOME bcrypt hash, even when no user was found, so a missing
  // account and a wrong password take the same amount of time to reject.
  const passwordMatches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  // Checked only after the password has been verified, so a disabled account doesn't
  // reveal its existence/status to someone who doesn't know the password.
  if (user.status === 'disabled') {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
  }

  const tokens = await tokenService.issueTokenPair(user);

  await activityLogService.log({
    actorUserId: user.id,
    actorRole: user.role,
    actionType: 'auth.login',
    targetEntityType: 'user',
    targetEntityId: user.id,
    description: 'User logged in',
  });

  const { passwordHash, createdAt, ...safeUser } = user;
  return { user: safeUser, ...tokens };
}

/**
 * Idempotent logout: revokes the given refresh token only if it belongs to the
 * authenticated caller. Never errors on an already-revoked/unknown token.
 * @param {{userId:string, role:string, refreshToken:string}} input
 */
async function logout({ userId, role, refreshToken }) {
  await tokenService.revokeRefreshToken(refreshToken, userId);

  await activityLogService.log({
    actorUserId: userId,
    actorRole: role,
    actionType: 'auth.logout',
    targetEntityType: 'user',
    targetEntityId: userId,
    description: 'User logged out',
  });
}

/**
 * Rotates a refresh token. All the interesting logic (reuse detection, revocation,
 * re-deriving role from the DB) lives in tokenService — this is a thin pass-through
 * so the module boundary (auth owns the HTTP contract, tokenService owns token mechanics)
 * stays clean. Deliberately not audit-logged: refresh calls are too high-frequency to be
 * useful audit signal and would drown out real events.
 * @param {{refreshToken:string}} input
 */
async function refresh({ refreshToken }) {
  const { accessToken, refreshToken: newRefreshToken } = await tokenService.rotateRefreshToken(refreshToken);
  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * Cheap identity/session check — base User columns only, no role-profile join
 * (GET /me in the me module returns the full profile).
 * @param {string} userId
 */
async function getMe(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_SUMMARY_SELECT });
  if (!user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required to access this resource.');
  }
  return user;
}

/**
 * Handles a forgot-password request. ALWAYS resolves (never throws for "no such account") and
 * the controller ALWAYS responds 200 with the same generic message regardless of the outcome
 * here — revealing "no account with that email" (or, below, an account's disabled status) to an
 * unauthenticated caller would let them enumerate registered emails one guess at a time, the
 * same class of leak login() avoids via constant-time password comparison (see DUMMY_PASSWORD_HASH
 * above), just via response content instead of timing.
 *
 * Delivery: COMPLETENESS FIX (audit Priority 4 — "no email/SMS provider anywhere ... needs your
 * decision on a provider before this can be fully closed"). This codebase never had a real
 * SES/SendGrid/Twilio client, and per this round's explicit product decision it still doesn't —
 * a vendor is deliberately not being picked yet ("decide nahi karna abhi"). What changed: the
 * reset link now goes through emailService.js's provider-agnostic sendEmail() (and smsService.js
 * if a phone is on file) instead of a raw logger.info call — those already-existing abstractions
 * log today (visible in server logs for local/dev/staging use, same practical behavior as
 * before) but can be pointed at a real provider later with zero changes to this function. The
 * raw token itself still never enters the in-app notification below (a notification row is far
 * less protected than a one-time email/SMS) — only the emailed/texted link carries it.
 * @param {{email:string}} input
 */
async function forgotPassword({ email }) {
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, role: true, status: true, phone: true },
  });

  // Skip token issuance entirely for a disabled account too — same enumeration-avoidance logic
  // login() applies (see the status check there): don't do anything that would let a caller
  // infer "this email belongs to a disabled account" from a side effect (an emailed/texted link,
  // a notification) even though the outward HTTP response is identical either way.
  if (user && user.status !== 'disabled') {
    const resetToken = tokenService.signResetToken(user.id);
    const resetLink = `${env.clientOrigin}/reset-password?token=${resetToken}`;

    await Promise.all([
      emailService.sendEmail({
        to: normalizedEmail,
        subject: 'Reset your BookMyDoctor24 password',
        text: `We received a request to reset your password. Use this link to choose a new one: ${resetLink}\n\nIf you didn't request this, you can safely ignore this message.`,
      }),
      smsService.sendSms({
        to: user.phone,
        message: `BookMyDoctor24: reset your password using this link: ${resetLink}`,
      }),
    ]);

    try {
      await notifyUserInApp(user.id, {
        title: 'Password reset requested',
        body: "A password reset was requested for your account. If this wasn't you, no changes have been made — you can ignore this.",
        type: 'security',
      });
    } catch (err) {
      // Best-effort only: the emailed/texted link above is the actual delivery mechanism right
      // now, so a failure to write the in-app notification must never turn a password-reset
      // *request* into a 500 for the caller.
      logger.warn(`[auth] failed to create in-app password-reset notification for user ${user.id}: ${err.message}`);
    }

    await activityLogService.log({
      actorUserId: user.id,
      actorRole: user.role,
      actionType: 'auth.password_reset_requested',
      targetEntityType: 'user',
      targetEntityId: user.id,
      description: 'Password reset requested',
    });
  }
}

/**
 * Completes a password reset: verifies the token (tokenService throws its own generic
 * ApiError for any invalid/expired/wrong-purpose token), hashes+stores the new password with
 * the same bcrypt helper/salt-rounds convention as register()/login(), and revokes every
 * existing refresh token for the user — mirroring me.service.js#changePassword, since a
 * password reset is exactly the situation (forgotten/compromised credential) where an attacker
 * might already be holding a live session that must not survive the reset.
 * @param {{token:string, newPassword:string}} input
 */
async function resetPassword({ token, newPassword }) {
  const userId = tokenService.verifyResetToken(token);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true } });
  // Same generic error as an invalid token itself — the account could have been deleted since
  // the link was issued; that's not information a caller holding a mere token should get either.
  if (!user) {
    throw new ApiError(400, 'INVALID_RESET_TOKEN', 'This password reset link is invalid or has expired.');
  }
  if (user.status === 'disabled') {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
  }

  const passwordHash = await bcrypt.hash(newPassword, env.bcryptSaltRounds);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  await tokenService.revokeAllForUser(user.id);

  await activityLogService.log({
    actorUserId: user.id,
    actorRole: user.role,
    actionType: 'auth.password_reset',
    targetEntityType: 'user',
    targetEntityId: user.id,
    description: 'Password reset via forgot-password flow',
  });
}

module.exports = { register, login, logout, refresh, getMe, forgotPassword, resetPassword };
