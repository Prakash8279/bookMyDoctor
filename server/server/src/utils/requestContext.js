/**
 * Thin wrapper around Node's built-in AsyncLocalStorage so any code running "inside" a request
 * (any service, any number of calls deep) can read that request's client IP without it being
 * threaded through every function signature as an extra parameter.
 *
 * Why this exists: activityLogService.log() is called from ~18 different service files across
 * the app (appointments, doctors, payments, auth, admin, ...), none of which currently receive
 * `req` — they only get plain data + the authenticated user. Adding an `ipAddress` param to every
 * one of those ~18 call sites (and threading `req.ip` down to each from its controller) would be
 * a wide, error-prone change for what is really one cross-cutting concern. Instead,
 * middleware/requestContext.js wraps each request in `run()` once, and activityLogService.js
 * reads it back via `get()` — every existing call site picks up IP logging for free.
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Runs `callback` with `store` available to every function it calls (sync or async, any depth)
 * via `get()`, for as long as any of those calls are still in flight.
 * @param {object} store
 * @param {Function} callback
 */
function run(store, callback) {
  return storage.run(store, callback);
}

/**
 * @returns {object|undefined} the store passed to the enclosing `run()` call, or undefined if
 *   called outside any (e.g. from the BullMQ worker process, which never mounts the middleware).
 */
function get() {
  return storage.getStore();
}

module.exports = { run, get };
