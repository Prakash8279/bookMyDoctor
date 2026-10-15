/**
 * Redis-backed OTP generation, rate limiting, and verification service.
 * Supports email OTP for account registration and password reset. Login remains
 * email/password or Google; phone numbers are never an authentication channel.
 */
const crypto = require('crypto');
const redis = require('../config/redis');
const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const emailService = require('./emailService');
const { authOtpTemplate } = require('./emailTemplates');

const OTP_TTL_SECONDS = 300; // 5 minutes
const COOLDOWN_SECONDS = env.isProduction ? 30 : 10;
const MAX_ATTEMPTS = 5;

function normalizeEmail(rawEmail) {
  return typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
}

/**
 * Generates a cryptographically random 6-digit numeric OTP.
 */
function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Dispatches a registration OTP to an email address.
 * @param {{ email: string }} param0
 */
async function sendOtp({ email, purpose = 'registration' }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    throw new ApiError(400, 'INVALID_EMAIL', 'A valid email address is required.');
  }
  const purposeKey = purpose === 'password-reset' ? 'password-reset' : 'register';
  const otpKey = `otp:${purposeKey}:${normalized}`;
  const cooldownKey = `otp:cooldown:${purposeKey}:${normalized}`;
  const attemptsKey = `otp:attempts:${purposeKey}:${normalized}`;

  // Cooldown check (prevent spamming user / provider)
  const inCooldown = await redis.get(cooldownKey);
  if (inCooldown) {
    const ttl = await redis.ttl(cooldownKey);
    throw new ApiError(429, 'OTP_COOLDOWN', `Please wait ${ttl > 0 ? ttl : COOLDOWN_SECONDS} seconds before requesting another OTP.`);
  }

  // Idempotent OTP on resend: If an active OTP is already in Redis for this target and purpose,
  // reuse it so that an in-flight email does not become invalidated if the user clicks resend.
  let otp = await redis.get(otpKey);
  if (!otp) {
    otp = generateOtp();
    await redis.setex(otpKey, OTP_TTL_SECONDS, otp);
    await redis.setex(attemptsKey, OTP_TTL_SECONDS, '0');
  }

  // Set fresh cooldown
  await redis.setex(cooldownKey, COOLDOWN_SECONDS, '1');

  logger.info(`[otpService] Dispatched ${purposeKey} OTP to=${normalized}`);

  try {
    const template = authOtpTemplate({ email: normalized, otp, purpose });
    await emailService.sendVerificationEmail({
      to: normalized,
      ...template,
    });
  } catch (err) {
    logger.warn(`[otpService] ${purposeKey} email delivery failed: ${err.message}`);
    throw new ApiError(503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Email verification is temporarily unavailable. Please try again later.');
  }

  return {
    success: true,
    message: `Verification code sent to ${normalized}.`,
    email: normalized,
    cooldownSeconds: COOLDOWN_SECONDS,
    // Provide devOtp in non-production for instant visibility
    ...(!env.isProduction ? { devOtp: otp } : {}),
  };
}

/**
 * Verifies the OTP entered by the user.
 *
 * @param {{ email: string, otp: string }} param0
 */
async function verifyOtp({ email, otp, purpose = 'registration' }) {
  const normalized = normalizeEmail(email);
  // Strip non-digits and spaces from the OTP input
  const cleanOtp = String(otp || '').trim().replace(/\D/g, '');

  if (!normalized || !cleanOtp) {
    throw new ApiError(400, 'INVALID_INPUT', 'Email and a valid numeric verification code are required.');
  }

  const purposeKey = purpose === 'password-reset' ? 'password-reset' : 'register';
  const otpKey = `otp:${purposeKey}:${normalized}`;
  const attemptsKey = `otp:attempts:${purposeKey}:${normalized}`;

  const storedOtp = await redis.get(otpKey);
  if (!storedOtp) {
    throw new ApiError(400, 'INVALID_OTP', 'This OTP has expired or was not requested. Please request a new one.');
  }

  // Brute-force protection: track attempts
  const attempts = await redis.incr(attemptsKey);
  if (attempts > MAX_ATTEMPTS) {
    await redis.del(otpKey);
    await redis.del(attemptsKey);
    throw new ApiError(400, 'TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. This OTP is now expired. Please request a new one.');
  }

  if (storedOtp.trim() !== cleanOtp) {
    const remaining = Math.max(0, MAX_ATTEMPTS - attempts);
    throw new ApiError(400, 'INCORRECT_OTP', `Incorrect OTP. ${remaining} attempt(s) remaining.`);
  }

  // Success: consume the OTP so it can't be reused
  await redis.del(otpKey);
  await redis.del(attemptsKey);

  return { valid: true, identifier: normalized };
}

module.exports = {
  normalizeEmail,
  generateOtp,
  sendOtp,
  verifyOtp,
};
