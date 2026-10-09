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
/**
 * Real SMS provider via Fast2SMS (India Quick SMS / OTP route — free testing bonus on signup).
 */
const fast2smsProvider = {
  name: 'fast2sms',
  async send({ to, message, otp }) {
    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) {
      logger.warn('[sms:fast2sms] FAST2SMS_API_KEY missing — falling back to log provider');
      return logProvider.send({ to, message });
    }

    // Clean phone number: Indian numbers are 10 digits; strip any leading +91 or 0
    const cleanNumber = String(to).replace(/\D/g, '').slice(-10);

    // Extract OTP if present in message or passed directly
    const extractedOtp = otp || (typeof message === 'string' && message.match(/\b\d{4,8}\b/) ? message.match(/\b\d{4,8}\b/)[0] : null);

    const payload = extractedOtp
      ? {
          route: 'otp',
          variables_values: extractedOtp,
          numbers: cleanNumber,
        }
      : {
          route: 'q',
          message,
          language: 'english',
          flash: 0,
          numbers: cleanNumber,
        };

    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.return === false) {
      throw new Error(`Fast2SMS failed: ${Array.isArray(data.message) ? data.message.join(', ') : data.message || res.statusText}`);
    }
    logger.info(`[sms:fast2sms] SMS sent successfully to=${cleanNumber}`);
    return data;
  },
};

/**
 * Real SMS provider via Twilio (free $15 trial credits on signup).
 */
const twilioProvider = {
  name: 'twilio',
  async send({ to, message }) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      logger.warn('[sms:twilio] Twilio credentials missing — falling back to log provider');
      return logProvider.send({ to, message });
    }

    const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    // Ensure E.164 format (+91...)
    let formattedTo = String(to).trim();
    if (!formattedTo.startsWith('+')) {
      const digits = formattedTo.replace(/\D/g, '');
      formattedTo = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    }

    const params = new URLSearchParams();
    params.append('To', formattedTo);
    params.append('From', fromNumber);
    params.append('Body', message);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Twilio failed: ${data.message || res.statusText}`);
    }
    logger.info(`[sms:twilio] SMS sent to=${formattedTo} sid=${data.sid}`);
    return data;
  },
};

/**
 * The default provider for dev/testing when no external SMS gateway is configured.
 * Writes a structured log line.
 */
const logProvider = {
  name: 'log',
  async send({ to, message }) {
    const body = env.isProduction ? '[redacted in production — see SMS_PROVIDER setup]' : message;
    logger.info(`[sms:log] to=${to} message="${body}"`);
  },
};

const PROVIDERS = {
  log: logProvider,
  fast2sms: fast2smsProvider,
  twilio: twilioProvider,
};

function resolveProvider() {
  const key = (process.env.SMS_PROVIDER || 'log').trim().toLowerCase();
  return PROVIDERS[key] || logProvider;
}

/**
 * Best-effort, never throws — returns error object if failed instead of unhandled exception.
 * @param {{to?:string|null, message:string, otp?:string}} content
 */
async function sendSms({ to, message, otp }) {
  if (!to) return; // no phone number on file — silently skip
  try {
    return await resolveProvider().send({ to, message, otp });
  } catch (err) {
    logger.warn(`[sms] sendSms failed for ${to}: ${err.message}`);
  }
}

module.exports = { sendSms };
