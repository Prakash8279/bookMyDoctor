/**
 * Shared role-group constants used across modules for role-based branching (response shaping,
 * access checks). Extracted from ~9 modules that each independently declared an identical
 * `const ADMIN_ROLES = ['admin', 'superadmin']` (and 2 that also declared an identical
 * `const STAFF_ROLES = ['doctor', 'receptionist']`) — pure duplication with no per-module
 * variation, found during the duplication audit (2026-09-05). Consolidated here so a future role
 * added to either group only needs updating in one place.
 *
 * Not a substitute for the authorization middleware (`middleware/authorize.js`), which is what
 * actually enforces role checks at the route layer — these constants are used by services purely
 * for response-shaping/branching decisions (e.g. "does this role see the masked or full fee
 * breakdown").
 */
const ADMIN_ROLES = ['admin', 'superadmin'];
const STAFF_ROLES = ['doctor', 'receptionist'];

module.exports = { ADMIN_ROLES, STAFF_ROLES };
