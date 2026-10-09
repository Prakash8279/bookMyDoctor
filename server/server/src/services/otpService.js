/**
 * Redis-backed OTP generation, rate limiting, and verification service.
 * Supports Email OTP and SMS OTP for Login, Registration, and Forgot Password flows.
 */
const crypto = require('crypto');
const redis = require('../config/redis');
const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const emailService = require('./emailService');
const smsService = require('./smsService');

const OTP_TTL_SECONDS = 300; // 5 minutes
const COOLDOWN_SECONDS = env.isProduction ? 30 : 10;
const MAX_ATTEMPTS = 5;

/**
 * Normalizes an identifier (email or phone).
 */
function normalizeIdentifier(rawIdentifier) {
  if (!rawIdentifier || typeof rawIdentifier !== 'string') return '';
  const trimmed = rawIdentifier.trim();
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }
  // Strip all non-digit characters for phone numbers
  const digits = trimmed.replace(/\D/g, '');
  // If Indian number with 10 digits or 12 digits (+91)
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Autodetects whether the identifier is an email or phone number.
 */
function detectChannel(identifier) {
  return identifier.includes('@') ? 'email' : 'sms';
}

/**
 * Generates a cryptographically random 6-digit numeric OTP.
 */
function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Dispatches an OTP to the user via their chosen or auto-detected channel.
 *
 * @param {{ identifier: string, purpose: 'login'|'register'|'forgot_password', channel?: 'email'|'sms' }} param0
 */
async function sendOtp({ identifier, purpose, channel }) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) {
    throw new ApiError(400, 'INVALID_IDENTIFIER', 'Valid email address or 10-digit phone number is required.');
  }

  const selectedChannel = channel || detectChannel(normalized);
  const otpKey = `otp:${purpose}:${normalized}`;
  const cooldownKey = `otp:cooldown:${purpose}:${normalized}`;
  const attemptsKey = `otp:attempts:${purpose}:${normalized}`;

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

  logger.info(`[otpService] Dispatched OTP for purpose=${purpose} channel=${selectedChannel} to=${normalized}`);

  const purposeLabels = {
    login: 'Login',
    register: 'Registration',
    forgot_password: 'Password Reset',
  };
  const label = purposeLabels[purpose] || 'Verification';

  if (selectedChannel === 'email') {
    await emailService.sendEmail({
      to: normalized,
      subject: `BookMyDoctor verification code: ${otp}`,
      text: `Hello,\n\nYour BookMyDoctor verification code for ${label} is: ${otp}\n\nThis code is valid for 5 minutes.\n\nSecurity Notice: For your security, never share this code with anyone. BookMyDoctor staff will never ask for your verification code.\n\nIf you did not request this verification, no further action is required and you can safely disregard this email.\n\nThis message was sent to ${normalized}.\n© 2026 BookMyDoctor. All rights reserved.`,
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
      Hello, here is your one-time verification code for <strong>${label}</strong>:
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
  } else {
    // SMS
    await smsService.sendSms({
      to: normalized,
      message: `Your BookMyDoctor OTP for ${label} is ${otp}. Valid for 5 minutes. Do not share this code.`,
      otp,
    });
  }

  return {
    success: true,
    message: `Verification OTP sent to ${normalized} via ${selectedChannel.toUpperCase()}`,
    channel: selectedChannel,
    identifier: normalized,
    cooldownSeconds: COOLDOWN_SECONDS,
    // Provide devOtp in non-production for instant visibility
    ...(!env.isProduction ? { devOtp: otp } : {}),
  };
}

/**
 * Verifies the OTP entered by the user.
 *
 * @param {{ identifier: string, purpose: 'login'|'register'|'forgot_password', otp: string }} param0
 */
async function verifyOtp({ identifier, purpose, otp }) {
  const normalized = normalizeIdentifier(identifier);
  // Strip non-digits and spaces from the OTP input
  const cleanOtp = String(otp || '').trim().replace(/\D/g, '');

  if (!normalized || !cleanOtp) {
    throw new ApiError(400, 'INVALID_INPUT', 'Identifier and a valid numeric OTP are required.');
  }

  const otpKey = `otp:${purpose}:${normalized}`;
  const attemptsKey = `otp:attempts:${purpose}:${normalized}`;

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
  normalizeIdentifier,
  detectChannel,
  generateOtp,
  sendOtp,
  verifyOtp,
};
