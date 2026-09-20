/**
 * Unit tests for middleware/inFlightGuard.js — the LOGIN RESILIENCE fix
 * (docs/api-load-test-issues-and-plan-2026-09-20.md, Phase 1 item 2). No Redis/DB involved: this
 * middleware is a plain in-memory counter, so these tests exercise it directly against
 * hand-built fake req/res objects, the same pattern tests/unit/middleware/rateLimiter.test.js
 * uses for the Redis-backed limiters.
 */
const { createInFlightGuard } = require('../../../src/middleware/inFlightGuard');

// jest.mock so a test run's warn-level log line (emitted every time the guard rejects a request
// — expected, see the guard's own header comment) doesn't clutter test output.
jest.mock('../../../src/config/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

function fakeReqRes() {
  const listeners = {};
  const req = {};
  const res = {
    set: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    on: jest.fn((event, cb) => {
      listeners[event] = cb;
    }),
  };
  return { req, res, next: jest.fn(), finish: () => listeners.finish && listeners.finish(), close: () => listeners.close && listeners.close() };
}

describe('inFlightGuard', () => {
  test('throws if constructed without a positive max', () => {
    expect(() => createInFlightGuard({ max: 0 })).toThrow();
    expect(() => createInFlightGuard({ max: -1 })).toThrow();
    expect(() => createInFlightGuard({})).toThrow();
  });

  test('allows requests through (calls next with no error) while under the limit', () => {
    const guard = createInFlightGuard({ max: 2 });
    const a = fakeReqRes();
    const b = fakeReqRes();

    guard(a.req, a.res, a.next);
    guard(b.req, b.res, b.next);

    expect(a.next).toHaveBeenCalledTimes(1);
    expect(a.next).toHaveBeenCalledWith();
    expect(b.next).toHaveBeenCalledTimes(1);
    expect(b.next).toHaveBeenCalledWith();
  });

  test('rejects the request beyond max with a 503 SERVICE_BUSY envelope and a Retry-After header', () => {
    const guard = createInFlightGuard({ max: 1, retryAfterSeconds: 7 });
    const a = fakeReqRes();
    const b = fakeReqRes();

    guard(a.req, a.res, a.next); // fills the only slot, stays "in flight" (never finishes)
    guard(b.req, b.res, b.next); // should be shed

    expect(a.next).toHaveBeenCalledTimes(1);
    expect(b.next).not.toHaveBeenCalled();
    expect(b.res.set).toHaveBeenCalledWith('Retry-After', '7');
    expect(b.res.status).toHaveBeenCalledWith(503);
    expect(b.res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'SERVICE_BUSY', message: expect.any(String) },
    });
  });

  test('frees its slot on finish, letting a later request back in', () => {
    const guard = createInFlightGuard({ max: 1 });
    const a = fakeReqRes();
    const b = fakeReqRes();
    const c = fakeReqRes();

    guard(a.req, a.res, a.next);
    guard(b.req, b.res, b.next); // shed — slot still held by a
    expect(b.next).not.toHaveBeenCalled();

    a.finish(); // a's request completes, releasing its slot

    guard(c.req, c.res, c.next); // should now get through
    expect(c.next).toHaveBeenCalledTimes(1);
  });

  test('also frees its slot on close (aborted connection), not just finish', () => {
    const guard = createInFlightGuard({ max: 1 });
    const a = fakeReqRes();
    const b = fakeReqRes();

    guard(a.req, a.res, a.next);
    a.close(); // client disconnected before 'finish' ever fired

    guard(b.req, b.res, b.next);
    expect(b.next).toHaveBeenCalledTimes(1);
  });

  test('never double-releases a slot if both finish and close fire for the same request', () => {
    const guard = createInFlightGuard({ max: 1 });
    const a = fakeReqRes();
    const b = fakeReqRes();
    const c = fakeReqRes();

    guard(a.req, a.res, a.next);
    a.finish();
    a.close(); // both fire — must not free the slot twice (which would let 2 requests through)

    guard(b.req, b.res, b.next);
    guard(c.req, c.res, c.next);

    // Exactly one of b/c gets through the single freed slot; the other is shed.
    const throughCount = [b.next, c.next].filter((fn) => fn.mock.calls.length > 0).length;
    expect(throughCount).toBe(1);
  });

  test('two independently-constructed guards track their own counters', () => {
    const guardA = createInFlightGuard({ max: 1 });
    const guardB = createInFlightGuard({ max: 1 });
    const a = fakeReqRes();
    const b = fakeReqRes();

    guardA(a.req, a.res, a.next);
    guardB(b.req, b.res, b.next);

    expect(a.next).toHaveBeenCalledTimes(1);
    expect(b.next).toHaveBeenCalledTimes(1);
  });
});
