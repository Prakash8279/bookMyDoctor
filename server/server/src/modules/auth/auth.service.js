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
const idGenerators = require('../../utils/idGenerators');
const { verifyGoogleIdToken } = require('../../services/googleIdTokenVerifier');
const otpService = require('../../services/otpService');

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
  // Stable "DCP<N>" display number — see prisma/migrations/
  // 20260919130000_add_patient_doctor_clinic_numbers. Always null for a non-patient role; harmless
  // to select unconditionally here since every caller of USER_SUMMARY_SELECT already returns this
  // same shape for every role (login, register, GET /me).
  patientNumber: true,
};

// Precomputed once at boot and reused as the bcrypt.compare() target whenever an email lookup
// finds no matching user. This guarantees a real bcrypt comparison always runs on login,
// whether or not the account exists, so response timing can't be used to distinguish
// "no such email" from "wrong password" (see D9 in the phase plan).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), env.bcryptSaltRounds);

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function getPhoneSearchVariants(phone) {
  const norm = normalizePhone(phone);
  if (!norm) return [];
  return [
    { phone: norm },
    { phone: `+91${norm}` },
    { phone: `+91 ${norm}` },
    { phone: `0${norm}` },
    { phone: `91${norm}` },
  ];
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
  const normalizedPhone = normalizePhone(phone);

  const existingEmail = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
  if (existingEmail) {
    throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
  }

  if (normalizedPhone) {
    const existingPhone = await prisma.user.findFirst({
      where: {
        OR: getPhoneSearchVariants(normalizedPhone),
      },
      select: { id: true },
    });
    if (existingPhone) {
      throw new ApiError(409, 'PHONE_ALREADY_EXISTS', 'An account with this mobile number already exists.');
    }
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);

  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      if (normalizedPhone) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'user-phone:' + normalizedPhone}))`;
        const racePhone = await tx.user.findFirst({
          where: {
            OR: getPhoneSearchVariants(normalizedPhone),
          },
          select: { id: true },
        });
        if (racePhone) {
          throw new ApiError(409, 'PHONE_ALREADY_EXISTS', 'An account with this mobile number already exists.');
        }
      }

      // Drawn once, right before the insert that stores it — same "only burn a number once
      // everything else is confirmed" posture as payments.service.js's nextReceiptNumber calls.
      // Sequences are non-transactional in Postgres (a nextval() is never rolled back even if
      // this transaction later fails), so a rare failed registration can leave a small gap in
      // the sequence — exactly as accepted for payment_receipt_seq already; it never causes a
      // duplicate or reused patient_number.
      const patientNumber = await idGenerators.nextPatientNumber();

      const created = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          role: 'patient',
          phone: normalizedPhone,
          city: city ? city.trim() : null,
          status: 'active',
          patientNumber,
        },
        select: USER_SUMMARY_SELECT,
      });

      // Created eagerly (empty row) so GET /me never has to special-case a missing
      // patient profile.
      await tx.patientProfile.create({ data: { userId: created.id } });

      return created;
    });
  } catch (err) {
    // Race with a concurrent registration of the same email or phone:
    // the pre-check above is not atomic with the insert, so the DB's unique constraint is the real backstop.
    if (err.code === 'P2002') {
      const target = err.meta && Array.isArray(err.meta.target) ? err.meta.target : [];
      if (target.includes('phone') || (err.message && err.message.toLowerCase().includes('phone'))) {
        throw new ApiError(409, 'PHONE_ALREADY_EXISTS', 'An account with this mobile number already exists.');
      }
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
  // account and a wrong password take the same amount of time to reject. Also falls back to the
  // dummy hash for a real user with passwordHash === null — a GOOGLE-SIGN-IN-ONLY account (see
  // googleAuth below) that has never set a password — so "email exists but was created via
  // Google" rejects with the exact same INVALID_CREDENTIALS as a wrong password, never a crash
  // from bcrypt.compare(password, null) and never a hint that Google-only accounts exist.
  const passwordMatches = await bcrypt.compare(password, user && user.passwordHash ? user.passwordHash : DUMMY_PASSWORD_HASH);

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
 * GOOGLE SIGN-IN (user request: "google work nahi kar rah hai fix kro" — the "Continue with
 * Google" button on the login/register pages used to be a non-functional stub that only showed
 * an error message; this is the real implementation).
 *
 * Handles all three cases a Google sign-in attempt can land in, in priority order:
 *   1. This Google account has signed in before (googleId already on file) -> ordinary login.
 *   2. No Google link yet, but an account already exists for this email (they originally signed
 *      up with a password) -> link this Google account to it, then log in. Never creates a
 *      second, duplicate account for the same person just because they happened to use Google
 *      this time.
 *   3. Neither exists -> brand-new self-registration. Always creates a `patient` account, same
 *      hard-coded rule as register() above (self sign-up can never mint any other role) — even
 *      though nothing about a Google profile could imply doctor/receptionist/admin anyway.
 *
 * @param {{idToken:string}} input - the `credential` Google Identity Services hands the frontend.
 */
async function googleAuth({ idToken }) {
  if (!env.google.clientId) {
    throw new ApiError(503, 'GOOGLE_SIGNIN_UNAVAILABLE', 'Google sign-in is not configured on this server yet.');
  }

  const profile = await verifyGoogleIdToken(idToken, env.google.clientId);
  const normalizedEmail = normalizeEmail(profile.email);
  const SELECT_WITH_GOOGLE_ID = { ...USER_SUMMARY_SELECT, passwordHash: true, googleId: true };

  let user = await prisma.user.findUnique({ where: { googleId: profile.sub }, select: SELECT_WITH_GOOGLE_ID });
  let isNewAccount = false;

  if (!user) {
    const existingByEmail = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: SELECT_WITH_GOOGLE_ID });

    if (existingByEmail) {
      // Belt-and-suspenders: googleId is unique in the DB, so this could only happen if Google
      // ever reissued the same `sub` to a second account, which it doesn't — but if it somehow
      // did, silently re-pointing an existing link to a different Google account would be a
      // worse failure mode than a clear error.
      if (existingByEmail.googleId && existingByEmail.googleId !== profile.sub) {
        throw new ApiError(409, 'GOOGLE_ACCOUNT_MISMATCH', 'This email is already linked to a different Google account.');
      }
      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { googleId: profile.sub },
        select: SELECT_WITH_GOOGLE_ID,
      });
    } else {
      isNewAccount = true;
      try {
        user = await prisma.$transaction(async (tx) => {
          // Same "only burn a number once everything else is confirmed" posture as register()
          // above.
          const patientNumber = await idGenerators.nextPatientNumber();

          const created = await tx.user.create({
            data: {
              name: (profile.name || '').trim().slice(0, 150) || 'Google user',
              email: normalizedEmail,
              passwordHash: null,
              googleId: profile.sub,
              role: 'patient',
              photoUrl: profile.picture || null,
              status: 'active',
              patientNumber,
            },
            select: SELECT_WITH_GOOGLE_ID,
          });

          // Created eagerly, same as register() — GET /me never has to special-case a missing
          // patient profile.
          await tx.patientProfile.create({ data: { userId: created.id } });

          return created;
        });
      } catch (err) {
        // Race with a concurrent Google sign-in/registration for the same email — the pre-check
        // above is not atomic with the insert, so the DB's unique constraint is the real
        // backstop, same as register()'s own P2002 handling.
        if (err.code === 'P2002') {
          throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
        }
        throw err;
      }
    }
  }

  // Checked after identity is resolved, same placement/reasoning as login()'s own status check.
  if (user.status === 'disabled') {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
  }

  const tokens = await tokenService.issueTokenPair(user);

  await activityLogService.log({
    actorUserId: user.id,
    actorRole: user.role,
    actionType: isNewAccount ? 'auth.google_register' : 'auth.google_login',
    targetEntityType: 'user',
    targetEntityId: user.id,
    description: isNewAccount ? 'Patient self-registered via Google sign-in' : 'User logged in via Google',
  });

  const { passwordHash, googleId, createdAt, ...safeUser } = user;
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
    select: { id: true, role: true, status: true, phone: true, passwordHash: true },
  });

  // Skip token issuance entirely for a disabled account too — same enumeration-avoidance logic
  // login() applies (see the status check there): don't do anything that would let a caller
  // infer "this email belongs to a disabled account" from a side effect (an emailed/texted link,
  // a notification) even though the outward HTTP response is identical either way.
  if (user && user.status !== 'disabled') {
    const resetToken = tokenService.signResetToken(user.id, user.passwordHash || '');
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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, passwordHash: true },
  });
  // Same generic error as an invalid token itself — the account could have been deleted since
  // the link was issued; that's not information a caller holding a mere token should get either.
  if (!user) {
    throw new ApiError(400, 'INVALID_RESET_TOKEN', 'This password reset link is invalid or has expired.');
  }
  if (user.status === 'disabled') {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
  }

  // Bind the reset link to the credential version that existed when it was issued. Once any
  // reset succeeds, the password hash changes and every copy/replay of that link becomes invalid.
  tokenService.verifyResetToken(token, user.passwordHash || '');

  const passwordHash = await bcrypt.hash(newPassword, env.bcryptSaltRounds);
  const updated = await prisma.user.updateMany({
    where: { id: user.id, passwordHash: user.passwordHash },
    data: { passwordHash },
  });
  if (updated.count !== 1) {
    throw new ApiError(400, 'INVALID_RESET_TOKEN', 'This password reset link is invalid or has expired.');
  }

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

/**
 * Finds an active user by email or 10-digit phone number.
 * Uses safe lookup: if multiple accounts exist with the same phone, refuses ambiguous login to prevent account takeover.
 */
async function findUserByIdentifier(rawIdentifier) {
  const norm = otpService.normalizeIdentifier(rawIdentifier);
  if (!norm) return null;

  if (norm.includes('@')) {
    return prisma.user.findUnique({
      where: { email: norm },
      select: { ...USER_SUMMARY_SELECT, passwordHash: true },
    });
  }

  // Look up by phone formats
  const variants = [
    { phone: norm },
    { phone: `+91${norm}` },
    { phone: `+91 ${norm}` },
    { phone: `0${norm}` },
    { phone: `91${norm}` },
    { phone: norm.slice(-10) },
  ];

  const users = await prisma.user.findMany({
    where: { OR: variants },
    select: { ...USER_SUMMARY_SELECT, passwordHash: true },
  });

  if (users.length === 0) return null;
  if (users.length > 1) {
    logger.warn(`[authService] Multiple accounts (${users.length}) found for phone ${norm}: ${users.map((u) => u.id).join(', ')}`);
    throw new ApiError(409, 'AMBIGUOUS_PHONE_ACCOUNT', 'Multiple accounts are associated with this mobile number. Please log in with your email address or contact support.');
  }

  return users[0];
}

/**
 * Sends an OTP for Login, Registration, or Forgot Password.
 */
async function sendAuthOtp({ identifier, purpose, channel }) {
  const norm = otpService.normalizeIdentifier(identifier);
  if (!norm) {
    throw new ApiError(400, 'INVALID_IDENTIFIER', 'Valid email or 10-digit phone number is required.');
  }

  if (purpose === 'register') {
    let existing;
    try {
      existing = await findUserByIdentifier(norm);
    } catch (err) {
      if (err.statusCode === 409) {
        throw new ApiError(409, 'ACCOUNT_ALREADY_EXISTS', 'An account with this email/phone already exists. Please login instead.');
      }
      throw err;
    }
    if (existing) {
      throw new ApiError(409, 'ACCOUNT_ALREADY_EXISTS', 'An account with this email/phone already exists. Please login instead.');
    }
  } else if (purpose === 'forgot_password') {
    const existing = await findUserByIdentifier(norm);
    if (!existing) {
      throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'No account found with this email or phone number.');
    }
    if (existing.status === 'disabled') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
    }
  }

  return otpService.sendOtp({ identifier: norm, purpose, channel });
}

/**
 * Verifies OTP for passwordless login (auto-registers if first-time user).
 */
async function verifyOtpLogin({ identifier, otp }) {
  const norm = otpService.normalizeIdentifier(identifier);
  await otpService.verifyOtp({ identifier: norm, purpose: 'login', otp });

  let user = await findUserByIdentifier(norm);
  let isNewAccount = false;

  if (!user) {
    // Modern UX: Auto-register patient account on first-time OTP verification
    isNewAccount = true;
    user = await prisma.$transaction(async (tx) => {
      const patientNumber = await idGenerators.nextPatientNumber();
      const isEmail = norm.includes('@');
      const fallbackName = isEmail ? norm.split('@')[0] : `User ${norm.slice(-4)}`;

      const created = await tx.user.create({
        data: {
          name: fallbackName,
          email: isEmail ? norm : `user_${norm}@bookmydoctor.local`,
          phone: isEmail ? null : norm,
          passwordHash: null,
          role: 'patient',
          status: 'active',
          patientNumber,
        },
        select: USER_SUMMARY_SELECT,
      });

      await tx.patientProfile.create({ data: { userId: created.id } });
      return created;
    });
  } else {
    if (user.status === 'disabled') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
    }
  }

  const tokens = await tokenService.issueTokenPair(user);

  await activityLogService.log({
    actorUserId: user.id,
    actorRole: user.role,
    actionType: isNewAccount ? 'auth.register_otp' : 'auth.login_otp',
    targetEntityType: 'user',
    targetEntityId: user.id,
    description: isNewAccount ? 'Patient registered via OTP' : 'User logged in via OTP',
  });

  const { passwordHash, ...safeUser } = user;
  return { user: safeUser, ...tokens, isNewAccount };
}

/**
 * Verifies OTP and registers a new patient account.
 */
async function verifyOtpRegister({ name, email, password, phone, city, otp, verifyTarget }) {
  const target = otpService.normalizeIdentifier(verifyTarget || phone || email);
  const normalizedEmail = otpService.normalizeIdentifier(email);
  const normalizedPhone = otpService.normalizeIdentifier(phone);
  if (!target || (target !== normalizedEmail && target !== normalizedPhone)) {
    throw new ApiError(
      400,
      'OTP_TARGET_MISMATCH',
      'The OTP must be verified against the email address or phone number being registered.'
    );
  }
  await otpService.verifyOtp({ identifier: target, purpose: 'register', otp });

  // Complete normal registration
  return register({ name, email, password, phone, city });
}

/**
 * Resets user password using verified OTP.
 */
async function resetPasswordWithOtp({ identifier, otp, newPassword }) {
  const norm = otpService.normalizeIdentifier(identifier);
  await otpService.verifyOtp({ identifier: norm, purpose: 'forgot_password', otp });

  const user = await findUserByIdentifier(norm);
  if (!user) {
    throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'No account found with this email or phone.');
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
    actionType: 'auth.password_reset_otp',
    targetEntityType: 'user',
    targetEntityId: user.id,
    description: 'Password reset via OTP verification',
  });

  return { success: true, message: 'Password has been reset successfully. Please log in with your new password.' };
}

module.exports = {
  register,
  login,
  googleAuth,
  logout,
  refresh,
  getMe,
  forgotPassword,
  resetPassword,
  findUserByIdentifier,
  normalizePhone,
  sendAuthOtp,
  verifyOtpLogin,
  verifyOtpRegister,
  resetPasswordWithOtp,
};
