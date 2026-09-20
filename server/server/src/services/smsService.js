/**
 * Provider-agnostic SMS delivery abstraction.
 *
 * COMPLETENESS FIX (audit Priority 4 — "no email/SMS/push provider anywhere ... needs your
 * decision on a provider (SES/SendGrid/Twilio) before either can be fully closed"). Same explicit
 * decision as emailService.js: do NOT pick a vendor yet, never ask for API keys — see that
 * file's header comment for the full reasoning, which applies identically here (Twilio/MSG91/etc.
 * swapped in later by adding one provider object + an env var, no call site changes).
 */
const logger = require('../config/logger');
const env = require('../config/env');

/**
 * The only provider wired up today — see emailService.js#logProvider for why a log line (not a
 * thrown error, not a silent black hole) is the right placeholder behavior, and for why the
 * body is redacted in production (SECURITY FIX — same OTP/reset-link-in-plaintext-logs finding
 * applies here identically, e.g. auth.service.js#forgotPassword's SMS variant).
 */
const logProvider = {
  name: 'log',
  async send({ to, message }) {
    const body = env.isProduction ? '[redacted in production — see SMS_PROVIDER setup]' : message;
    logger.info(`[sms:log] to=${to} message="${body}"`);
  },
};

// A real provider gets added here once one is chosen (see file header) — only 'log' exists
// today, by design.
const PROVIDERS = { log: logProvider };

function resolveProvider() {
  const key = (process.env.SMS_PROVIDER || 'log').trim().toLowerCase();
  return PROVIDERS[key] || logProvider;
}

/**
 * Best-effort, never throws — same non-fatal posture as emailService.js#sendEmail and
 * notifications.service.js#notifySystemEventSafe.
 * @param {{to?:string|null, message:string}} content
 */
async function sendSms({ to, message }) {
  if (!to) return; // no phone number on file — silently skip
  try {
    await resolveProvider().send({ to, message });
  } catch (err) {
    logger.warn(`[sms] sendSms failed for ${to}: ${err.message}`);
  }
}

module.exports = { sendSms };
