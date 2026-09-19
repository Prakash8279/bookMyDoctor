/**
 * Provider-agnostic push-notification delivery abstraction.
 *
 * COMPLETENESS FIX (audit Priority 4 — "no email/SMS/push provider anywhere"). Same explicit
 * "don't pick a vendor yet" decision as emailService.js/smsService.js — see that file's header
 * comment for the full reasoning (FCM/APNs/OneSignal/etc. swapped in later by adding one
 * provider object + an env var, no call site changes).
 *
 * One honest difference from email/SMS: those two only need an address already on file
 * (users.email / users.phone, both present today) to have somewhere real to deliver to once a
 * provider is chosen. Push additionally needs a per-device push-token registry (FCM/APNs device
 * tokens, keyed by user, refreshed on login/app-open) — this schema has no such table yet. So
 * `sendPush` below is a placeholder in the same log-only spirit as the other two channels, but
 * wiring a REAL push provider later needs that registry added first, not just a provider swap.
 * Kept here anyway (rather than omitted) so every call site that wants to say "also try pushing
 * this" already has a stable function to call, the same as the other two channels.
 */
const logger = require('../config/logger');

const logProvider = {
  name: 'log',
  async send({ userId, title, body }) {
    logger.info(`[push:log] userId=${userId} title="${title}" body="${body}"`);
  },
};

// A real provider gets added here once one is chosen AND a device-token registry exists (see
// file header) — only 'log' exists today, by design.
const PROVIDERS = { log: logProvider };

function resolveProvider() {
  const key = (process.env.PUSH_PROVIDER || 'log').trim().toLowerCase();
  return PROVIDERS[key] || logProvider;
}

/**
 * Best-effort, never throws — same non-fatal posture as emailService.js#sendEmail.
 * @param {string} userId
 * @param {{title:string, body:string}} content
 */
async function sendPush(userId, { title, body }) {
  if (!userId) return;
  try {
    await resolveProvider().send({ userId, title, body });
  } catch (err) {
    logger.warn(`[push] sendPush failed for user ${userId}: ${err.message}`);
  }
}

module.exports = { sendPush };
