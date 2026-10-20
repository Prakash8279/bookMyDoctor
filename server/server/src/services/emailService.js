/**
 * Provider-agnostic email delivery abstraction.
 *
 * Production uses the existing bookadoctors.com mailbox over SMTP, so registration and password
 * recovery codes do not require a separate transactional-email API subscription. Development can
 * use the log provider; production verification deliberately fails closed if SMTP is absent.
 */
const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const env = require('../config/env');
const { notificationTemplate } = require('./emailTemplates');
const { EMAIL_LOGO_CID, emailLogoAttachment } = require('./emailBrandAsset');

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const emailService = process.env.EMAIL_SERVICE;
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS || process.env.EMAIL_APP_PASSWORD;

  if (emailService === 'gmail' || (emailUser && emailUser.endsWith('@gmail.com'))) {
    cachedTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });
  } else if (process.env.SMTP_HOST) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: emailUser ? { user: emailUser, pass: emailPass } : undefined,
    });
  }

  return cachedTransporter;
}

/**
 * Real SMTP email provider via nodemailer (supports free Gmail SMTP or any custom SMTP server).
 */
const smtpProvider = {
  name: 'smtp',
  async send({ to, subject, text, html }) {
    const transporter = getTransporter();
    if (!transporter) {
      logger.warn('[email:smtp] SMTP is selected as EMAIL_PROVIDER but EMAIL_USER or SMTP_HOST is not configured — falling back to log');
      return logProvider.send({ to, subject, text });
    }

    // EMAIL_USER is the authenticated mailbox. EMAIL_FROM may be an approved same-domain alias;
    // the mailbox provider decides whether that alias is accepted, rejected, or rewritten.
    const senderEmail = process.env.EMAIL_USER || 'noreply@bookadoctors.com';
    const fromAddress = process.env.EMAIL_FROM || `"BookADoctors" <${senderEmail}>`;
    const replyTo = process.env.EMAIL_REPLY_TO || 'support@bookadoctors.com';

    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      replyTo,
      subject,
      text,
      html: html || text,
      ...(html?.includes(`cid:${EMAIL_LOGO_CID}`) ? { attachments: [emailLogoAttachment()] } : {}),
    });
    logger.info(`[email:smtp] message sent to=${to} messageId=${info.messageId}`);
    return info;
  },
};

/**
 * The default provider for dev/testing when no external SMTP is configured.
 * Writes a structured log line.
 */
const logProvider = {
  name: 'log',
  async send({ to, subject, text }) {
    const body = env.isProduction ? '[redacted in production — see EMAIL_PROVIDER setup]' : text;
    logger.info(`[email:log] to=${to} subject="${subject}" body="${body}"`);
  },
};

const PROVIDERS = {
  log: logProvider,
  smtp: smtpProvider,
  gmail: smtpProvider,
};

function resolveProvider() {
  const key = (process.env.EMAIL_PROVIDER || 'log').trim().toLowerCase();
  return PROVIDERS[key] || logProvider;
}

function hasLiveEmailTransport() {
  const provider = (process.env.EMAIL_PROVIDER || 'log').trim().toLowerCase();
  return (provider === 'smtp' || provider === 'gmail') && Boolean(getTransporter());
}

/**
 * Best-effort, never throws — email delivery (real or placeholder) is always a side effect.
 * @param {{to?:string|null, subject:string, text:string, html?:string}} message
 */
async function sendEmail({ to, subject, text, html, type, details, actionPath, amount }) {
  if (!to) return; // no address on file — silently skip
  try {
    const formatted = html ? { subject, text, html } : notificationTemplate({ email: to, subject, text, type, details, actionPath, amount });
    return await resolveProvider().send({ to, ...formatted });
  } catch (err) {
    logger.warn(`[email] sendEmail failed for ${to}: ${err.message}`);
  }
}

/**
 * Strict delivery for authentication codes. Unlike general notification email, an OTP cannot
 * claim success when production is still using the console-only provider: that would make a
 * new account impossible to verify. Development may use the log provider intentionally.
 */
async function sendVerificationEmail({ to, subject, text, html }) {
  if (!to) throw new Error('A recipient email address is required.');
  if (env.isProduction && !hasLiveEmailTransport()) {
    logger.error('[email:verification] Production email delivery is not configured. Set EMAIL_PROVIDER=smtp or gmail with valid SMTP credentials.');
    throw new Error('Production email delivery is not configured.');
  }

  try {
    const formatted = html ? { subject, text, html } : notificationTemplate({ email: to, subject, text, type: 'system' });
    return await resolveProvider().send({ to, ...formatted });
  } catch (err) {
    logger.warn(`[email:verification] delivery failed: ${err.message}`);
    throw err;
  }
}

module.exports = { sendEmail, sendVerificationEmail };
