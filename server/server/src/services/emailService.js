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
const logger = require('../config/logger');

/**
 * The only provider wired up today. Writes a structured log line instead of actually sending
 * anything, so the intent ("this app would have emailed X about Y here") stays visible in
 * server logs for local/dev/staging use, and so no call site anywhere in the app has to
 * special-case "email isn't configured yet" — sendEmail() always succeeds.
 */
const logProvider = {
  name: 'log',
  async send({ to, subject, text }) {
    logger.info(`[email:log] to=${to} subject="${subject}" body="${text}"`);
  },
};

// A real provider gets added here once one is chosen (see file header) — only 'log' exists
// today, by design, per this round's explicit "don't pick a vendor yet" decision.
const PROVIDERS = { log: logProvider };

function resolveProvider() {
  const key = (process.env.EMAIL_PROVIDER || 'log').trim().toLowerCase();
  return PROVIDERS[key] || logProvider;
}

/**
 * Best-effort, never throws — email delivery (real or placeholder) is always a side effect of
 * an action that has already succeeded (a booking, a password-reset request, a status change);
 * a delivery failure must never fail or roll back that action. Matches
 * notifications.service.js#notifySystemEventSafe's same non-fatal posture for the in-app channel.
 * @param {{to?:string|null, subject:string, text:string, html?:string}} message
 */
async function sendEmail({ to, subject, text, html }) {
  if (!to) return; // no address on file — silently skip, same as every other best-effort notifier here
  try {
    await resolveProvider().send({ to, subject, text, html });
  } catch (err) {
    logger.warn(`[email] sendEmail failed for ${to}: ${err.message}`);
  }
}

module.exports = { sendEmail };
