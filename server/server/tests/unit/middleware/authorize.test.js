/**
 * Unit tests for middleware/authorize.js — the role-based access control middleware factory
 * (see that file's own header comment: MUST run after authenticate.js on every protected route,
 * only checks req.user.role, ownership checks belong in the service layer).
 *
 * No mocking needed — authorize.js has a single real dependency, utils/ApiError.js, which is a
 * plain Error subclass with no side effects, so it's exercised for real here (same approach as
 * this suite would take for any other zero-dependency pure-logic unit, e.g.
 * tests/unit/utils/pickPresentFields.test.js).
 */
const authorize = require('../../../src/middleware/authorize');
const ApiError = require('../../../src/utils/ApiError');

function fakeReqResNext({ user } = {}) {
  const req = { user };
  const res = {};
  const next = jest.fn();
  return { req, res, next };
}

describe('middleware/authorize', () => {
  test('is a factory: calling it with allowed roles returns an Express middleware function (req, res, next)', () => {
    const middleware = authorize('doctor', 'admin');

    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3);
  });

  test('an allowed role calls next() with no error, letting the request through', () => {
    const middleware = authorize('doctor', 'admin');
    const { req, res, next } = fakeReqResNext({ user: { id: 'user-1', role: 'doctor' } });

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  test('a disallowed role is rejected via next(err) with a 403 FORBIDDEN ApiError, never thrown directly', () => {
    const middleware = authorize('doctor', 'admin');
    const { req, res, next } = fakeReqResNext({ user: { id: 'user-2', role: 'patient' } });

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  test('a missing req.user (authenticate.js not run, or an anonymous request) is rejected with 401 UNAUTHORIZED, not 403', () => {
    const middleware = authorize('doctor', 'admin');
    const { req, res, next } = fakeReqResNext();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  test('an empty allowed-roles list (authorize() called with no args) rejects every authenticated role with 403', () => {
    const middleware = authorize();
    const { req, res, next } = fakeReqResNext({ user: { id: 'user-3', role: 'admin' } });

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  test('checks req.user.role against ALL allowed roles, not just the first one passed', () => {
    const middleware = authorize('doctor', 'admin', 'superadmin');

    const forSecondRole = fakeReqResNext({ user: { id: 'user-4', role: 'admin' } });
    middleware(forSecondRole.req, forSecondRole.res, forSecondRole.next);
    expect(forSecondRole.next).toHaveBeenCalledWith();

    const forThirdRole = fakeReqResNext({ user: { id: 'user-5', role: 'superadmin' } });
    middleware(forThirdRole.req, forThirdRole.res, forThirdRole.next);
    expect(forThirdRole.next).toHaveBeenCalledWith();
  });

  test('two calls to authorize(...) with different role lists produce independent middleware', () => {
    const doctorOnly = authorize('doctor');
    const adminOnly = authorize('admin');
    const { req, res, next } = fakeReqResNext({ user: { id: 'user-6', role: 'doctor' } });

    doctorOnly(req, res, next);
    expect(next).toHaveBeenLastCalledWith();

    adminOnly(req, res, next);
    const err = next.mock.calls[1][0];
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(403);
  });
});
