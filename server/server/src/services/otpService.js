/**
 * Redis-backed OTP generation, rate limiting, and verification service.
 * Supports email OTP for account registration only. Login uses email/password or Google, and
 * password reset uses its emailed reset link.
 */
const crypto = require('crypto');
const redis = require('../config/redis');
const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const emailService = require('./emailService');

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
async function sendOtp({ email }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    throw new ApiError(400, 'INVALID_EMAIL', 'A valid email address is required.');
  }
  const otpKey = `otp:register:${normalized}`;
  const cooldownKey = `otp:cooldown:register:${normalized}`;
  const attemptsKey = `otp:attempts:register:${normalized}`;

  // Cooldown check (prevent spamming user / provider)
  const inCooldown = await redis.get(cooldownKey);
  if (inCooldown) {
    const ttl = await redis.ttl(cooldownKey);
    throw new ApiError(429, 'OTP_COOLDOWN', `Please wait ${ttl > 0 ? ttl : COOLDOWN_SECONDS} seconds before requesting another OTP.`);
  }

  // Idempotent OTP on resend: If an active OTP is already in Redis for this target and purpose,
  // reuse it so that in-flight emails or SMS don't become invalidated if the user clicks resend!
  let otp = await redis.get(otpKey);
  if (!otp) {
    otp = generateOtp();
    await redis.setex(otpKey, OTP_TTL_SECONDS, otp);
    await redis.setex(attemptsKey, OTP_TTL_SECONDS, '0');
  }

  // Set fresh cooldown
  await redis.setex(cooldownKey, COOLDOWN_SECONDS, '1');

  logger.info(`[otpService] Dispatched registration OTP to=${normalized}`);

  await emailService.sendEmail({
      to: normalized,
      subject: `BookMyDoctor verification code: ${otp}`,
      text: `Hello,\n\nYour BookMyDoctor email verification code is: ${otp}\n\nThis code is valid for 5 minutes.\n\nSecurity Notice: For your security, never share this code with anyone. BookMyDoctor staff will never ask for your verification code.\n\nIf you did not request this verification, no further action is required and you can safely disregard this email.\n\nThis message was sent to ${normalized}.\n© 2026 BookMyDoctor. All rights reserved.`,
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verification Code</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155;">
  <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 28px;">
    <div style="font-size: 20px; font-weight: bold; color: #0284c7; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
      BookMyDoctor
    </div>
    <h2 style="font-size: 18px; margin: 0 0 12px; color: #0f172a;">Verification Code</h2>
    <p style="font-size: 14px; margin: 0 0 16px; line-height: 1.5;">
      Hello, here is your one-time verification code to verify your email address:
    </p>
    <div style="text-align: center; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 20px 0;">
      <span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0284c7;">${otp}</span>
    </div>
    <p style="font-size: 13px; color: #64748b; margin: 0 0 8px;">
      Valid for 5 minutes.
    </p>
    <p style="font-size: 13px; color: #64748b; margin: 0 0 20px;">
      Security Notice: Do not share this code with anyone. BookMyDoctor staff will never ask for your code.
    </p>
    <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
    <p style="font-size: 11px; color: #94a3b8; margin: 0 0 4px; line-height: 1.4;">
      This email was sent to ${normalized} regarding your BookMyDoctor account.
    </p>
    <p style="font-size: 11px; color: #94a3b8; margin: 0;">
      © 2026 BookMyDoctor Healthcare Services. All rights reserved.
    </p>
  </div>
</body>
</html>`,
    });

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
async function verifyOtp({ email, otp }) {
  const normalized = normalizeEmail(email);
  // Strip non-digits and spaces from the OTP input
  const cleanOtp = String(otp || '').trim().replace(/\D/g, '');

  if (!normalized || !cleanOtp) {
    throw new ApiError(400, 'INVALID_INPUT', 'Email and a valid numeric verification code are required.');
  }

  const otpKey = `otp:register:${normalized}`;
  const attemptsKey = `otp:attempts:register:${normalized}`;

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
