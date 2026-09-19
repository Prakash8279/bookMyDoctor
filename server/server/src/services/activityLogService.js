/**
 * Writes structured audit-log entries (actor, action_type, target_entity_type/id) to activity_log.
 * Responsibility: called from OTHER services after a mutating action succeeds (create doctor,
 * approve clinic, update platform charges, etc.) — not a standalone module with its own routes
 * for writing, only for the admin-facing read endpoint (see modules/admin).
 */
const prisma = require('../config/db');
const logger = require('../config/logger');
const requestContext = require('../utils/requestContext');

/**
 * Writes one audit-log row. Deliberately swallows its own errors (logging failure must
 * never break the mutating action that triggered it) — callers should still `await` this
 * so the write is attempted before the request completes, but should not wrap it in a
 * try/catch of their own.
 * @param {object} entry
 * @param {string|null} [entry.actorUserId] - null for system/unauthenticated actions.
 * @param {string|null} [entry.actorRole]
 * @param {string} entry.actionType - e.g. 'auth.register', 'auth.login', 'me.profile_update'.
 * @param {string|null} [entry.targetEntityType] - e.g. 'user'.
 * @param {string|null} [entry.targetEntityId]
 * @param {string} entry.description - human-readable summary. Never include secrets/PII values
 *   (passwords, medical history content, etc.) — field NAMES only where that matters.
 * @param {string|null} [entry.ipAddress] - explicit override; normally omitted and picked up
 *   automatically from the in-flight request via requestContext.js (see middleware/
 *   requestContext.js) so none of this function's ~18 call sites need to pass it themselves. Ends
 *   up null for actions triggered outside any HTTP request (e.g. the BullMQ worker process).
 */
async function log(entry) {
  try {
    const ipAddress = entry.ipAddress ?? requestContext.get()?.ip ?? null;
    await prisma.activityLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        actorRole: entry.actorRole ?? null,
        ipAddress,
        actionType: entry.actionType,
        targetEntityType: entry.targetEntityType ?? null,
        targetEntityId: entry.targetEntityId ?? null,
        description: entry.description,
      },
    });
  } catch (err) {
    logger.error(`[activityLogService] failed to write audit log entry: ${err.message}`, {
      actionType: entry.actionType,
    });
  }
}

module.exports = { log };
