/**
 * Provider-agnostic email delivery abstraction.
 *
 * COMPLETENESS FIX (audit Priority 4 — "no email/SMS/push provider anywhere ... needs your
 * decision on a provider (SES/SendGrid/Twilio) before either can be fully closed"). Explicit
 * product decision this round: do NOT pick a vendor yet ("Abhi decide nahi karna — code
 * placeholder-ready rakho"). So this deliberately does NOT wire up SES/SendGrid/Postmark/etc.,
 * and never asks for API keys. Instead it gives every caller (auth.service.js#forgotPassword,
 * notifications.service.js's system-event dispatch, ...) one stable `sendEmail()` call that
 * already works today — it logs, so nothing about the send is silently lost — and can be pointed
 * at a real provider later without touching any call site.
 *
 * To wire a real provider later (once one is chosen):
 *   1. Add a new provider object below implementing the same shape as `logProvider`:
 *        const sesProvider = { name: 'ses', async send({ to, subject, text, html }) { ... } }
 *   2. Register it in PROVIDERS: PROVIDERS.ses = sesProvider.
 *   3. Set EMAIL_PROVIDER=ses in the environment (config/env.js has no entry for this on
 *      purpose — reading process.env directly here keeps this file the single place that knows
 *      about "email provider selection" until a real one is chosen).
 * No other file in this codebase needs to change — every call site already calls sendEmail()
 * with the same {to, subject, text, html} shape regardless of which provider answers it.
 */
const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const env = require('../config/env');

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

    const senderEmail = process.env.EMAIL_USER || 'bookmydoctor24@gmail.com';
    const fromAddress = process.env.EMAIL_FROM || `"BookMyDoctor" <${senderEmail}>`;

    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      replyTo: fromAddress,
      subject,
      text,
      html: html || text,
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

/**
 * Best-effort, never throws — email delivery (real or placeholder) is always a side effect.
 * @param {{to?:string|null, subject:string, text:string, html?:string}} message
 */
async function sendEmail({ to, subject, text, html }) {
  if (!to) return; // no address on file — silently skip
  try {
    return await resolveProvider().send({ to, subject, text, html });
  } catch (err) {
    logger.warn(`[email] sendEmail failed for ${to}: ${err.message}`);
  }
}

module.exports = { sendEmail };
