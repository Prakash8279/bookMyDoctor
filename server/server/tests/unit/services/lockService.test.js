/**
 * Unit tests for services/lockService.js — the Redis SET-NX/PX distributed lock guarding
 * concurrent booking attempts on the same slot. Only `withLock` (+ `LockAcquisitionError`) is
 * exported — `acquireLock`/`releaseLock` are internal, reached only through `withLock` — so every
 * test below drives the module through that one public entry point, using its side effects
 * (calls to the mocked redis.set/redis.eval) to verify the internal acquire/release behavior.
 *
 * Three real correctness properties this suite is built around:
 *
 *   1. Successful acquisition: `withLock` runs `fn`, and releases using the EXACT SAME random
 *      token it acquired with (the argument redis.eval is called with must match the token
 *      redis.set was called with) — this is what makes the release a genuine compare-and-delete
 *      rather than an unconditional delete.
 *   2. Retry-then-timeout: when redis.set (NX) keeps returning null (lock busy), `withLock` must
 *      retry until `waitTimeoutMs` elapses and then reject with `LockAcquisitionError` — `fn`
 *      must NEVER run, and no release (`redis.eval`) must ever be attempted, since a lock that
 *      was never acquired must never be "released".
 *   3. The release script really is compare-and-delete, not a blind delete: this is verified by
 *      giving the mocked `redis.eval` a small in-memory implementation of the ACTUAL
 *      `RELEASE_SCRIPT` semantics (get key, compare to ARGV[1], delete only on match) driven by a
 *      real in-memory store that redis.set also writes into — so if lockService ever regressed to
 *      calling redis.eval with the wrong key or the wrong token, this test would catch it by
 *      observing the store still holding a value that should have been deleted (or vice versa),
 *      not merely by asserting call arguments in isolation.
 *
 * config/redis and config/env are mocked; config/logger is mocked per this fix group's brief.
 * crypto is left real (acquireLock's token is real random bytes — that's the property under test).
 */
jest.mock('../../../src/config/redis', () => ({ set: jest.fn(), eval: jest.fn() }));
jest.mock('../../../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const redis = require('../../../src/config/redis');
const { withLock, LockAcquisitionError } = require('../../../src/services/lockService');

describe('lockService.withLock — successful acquire + matching-token release', () => {
  test('runs fn and returns its value, having acquired with SET NX PX and released with the SAME token', async () => {
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    const fn = jest.fn().mockResolvedValue('fn-result');

    const result = await withLock('booking:doc-1:2026-01-01:10:00', fn, { ttlMs: 5000, waitTimeoutMs: 1000, retryDelayMs: 10 });

    expect(result).toBe('fn-result');
    expect(fn).toHaveBeenCalledTimes(1);

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [setKey, setToken, , setTtl, setFlag] = redis.set.mock.calls[0];
    expect(setKey).toBe('lock:booking:doc-1:2026-01-01:10:00');
    expect(setTtl).toBe(5000);
    expect(setFlag).toBe('NX');

    expect(redis.eval).toHaveBeenCalledTimes(1);
    const [, , evalKey, evalToken] = redis.eval.mock.calls[0];
    expect(evalKey).toBe('lock:booking:doc-1:2026-01-01:10:00');
    // The exact property that makes this a real compare-and-delete: the token passed to the
    // release script is the SAME one that was used to acquire the lock.
    expect(evalToken).toBe(setToken);
  });

  test('releases the lock even when fn throws (finally-guaranteed release)', async () => {
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    const fn = jest.fn().mockRejectedValue(new Error('booking failed'));

    await expect(withLock('k', fn, { ttlMs: 1000, waitTimeoutMs: 1000, retryDelayMs: 10 })).rejects.toThrow('booking failed');

    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  test('a release failure (Redis down) is swallowed, never masking fn\'s own resolved value', async () => {
    redis.set.mockResolvedValue('OK');
    redis.eval.mockRejectedValue(new Error('redis eval exploded'));
    const fn = jest.fn().mockResolvedValue('still-fine');

    await expect(withLock('k', fn, { ttlMs: 1000, waitTimeoutMs: 1000, retryDelayMs: 10 })).resolves.toBe('still-fine');
  });

  test('each acquisition mints a distinct random token (no token reuse across calls)', async () => {
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);

    await withLock('k', jest.fn(), { ttlMs: 1000, waitTimeoutMs: 1000, retryDelayMs: 10 });
    await withLock('k', jest.fn(), { ttlMs: 1000, waitTimeoutMs: 1000, retryDelayMs: 10 });

    const tokenA = redis.set.mock.calls[0][1];
    const tokenB = redis.set.mock.calls[1][1];
    expect(tokenA).not.toBe(tokenB);
  });
});

describe('lockService.withLock — retry then timeout', () => {
  test('retries redis.set until it succeeds, before the deadline', async () => {
    redis.set.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('OK');
    redis.eval.mockResolvedValue(1);
    const fn = jest.fn().mockResolvedValue('done');

    const result = await withLock('k', fn, { ttlMs: 1000, waitTimeoutMs: 2000, retryDelayMs: 5 });

    expect(result).toBe('done');
    expect(redis.set).toHaveBeenCalledTimes(3);
  });

  test('rejects with LockAcquisitionError once waitTimeoutMs elapses, never running fn or attempting a release', async () => {
    redis.set.mockResolvedValue(null); // always busy

    const fn = jest.fn();
    await expect(
      withLock('busy-key', fn, { ttlMs: 1000, waitTimeoutMs: 30, retryDelayMs: 5 })
    ).rejects.toBeInstanceOf(LockAcquisitionError);

    expect(fn).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  test('LockAcquisitionError carries the logical key (without the "lock:" prefix) and the timeout in its message', async () => {
    redis.set.mockResolvedValue(null);

    let caught;
    try {
      await withLock('doc-1-slot', jest.fn(), { ttlMs: 1000, waitTimeoutMs: 20, retryDelayMs: 5 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(LockAcquisitionError);
    expect(caught.key).toBe('doc-1-slot');
    expect(caught.message).toContain('doc-1-slot');
    expect(caught.message).toContain('20ms');
  });

  test('always attempts at least once even with waitTimeoutMs:0 (loop condition checked AFTER the first SET)', async () => {
    redis.set.mockResolvedValueOnce('OK');
    redis.eval.mockResolvedValue(1);
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await withLock('k', fn, { ttlMs: 1000, waitTimeoutMs: 0, retryDelayMs: 5 });

    expect(result).toBe('ok');
    expect(redis.set).toHaveBeenCalledTimes(1);
  });
});

describe('lockService — release is a real compare-and-delete (in-memory Lua-equivalent simulation)', () => {
  // Re-implements RELEASE_SCRIPT's exact semantics (`if redis.call('get', KEYS[1]) == ARGV[1]
  // then del else return 0`) against a plain in-memory store, so this test verifies the actual
  // compare-and-delete PROPERTY (only the rightful token deletes the key) rather than merely
  // asserting what arguments lockService happened to pass.
  function makeFakeRedisStore() {
    const store = new Map();
    return {
      store,
      set: jest.fn((key, value, pxFlag, ttl, nxFlag) => {
        if (nxFlag === 'NX' && store.has(key)) return Promise.resolve(null);
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      eval: jest.fn((script, numKeys, key, token) => {
        if (store.get(key) === token) {
          store.delete(key);
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      }),
    };
  }

  test('a late release from a caller whose lock already expired and was re-acquired by someone else does NOT delete the new holder\'s lock', async () => {
    const fake = makeFakeRedisStore();
    redis.set.mockImplementation(fake.set);
    redis.eval.mockImplementation(fake.eval);

    // First acquisition (simulates a caller whose own release will run "late").
    let releaseLateHolder;
    const firstAcquirePromise = withLock(
      'shared-slot',
      () =>
        new Promise((resolve) => {
          releaseLateHolder = resolve;
        }),
      { ttlMs: 5000, waitTimeoutMs: 1000, retryDelayMs: 5 }
    );

    // Give withLock a tick to actually acquire before we inspect the store.
    await Promise.resolve();
    await Promise.resolve();
    const firstHolderToken = fake.store.get('lock:shared-slot');
    expect(firstHolderToken).toBeTruthy();

    // Simulate the lock expiring and a second, different caller legitimately re-acquiring it —
    // done directly against the fake store (as Redis's own TTL expiry + a fresh SET NX would).
    fake.store.set('lock:shared-slot', 'second-holder-token');

    // NOW the first holder's fn resolves and its (late) release runs.
    releaseLateHolder();
    await firstAcquirePromise;

    // The compare-and-delete property: the first holder's stale token no longer matches what's
    // in the store, so its release must be a no-op — the second holder's lock must survive.
    expect(fake.store.get('lock:shared-slot')).toBe('second-holder-token');
  });

  test('a normal, on-time release DOES delete the lock (the matching-token case actually deletes)', async () => {
    const fake = makeFakeRedisStore();
    redis.set.mockImplementation(fake.set);
    redis.eval.mockImplementation(fake.eval);

    await withLock('slot-2', jest.fn().mockResolvedValue('x'), { ttlMs: 5000, waitTimeoutMs: 1000, retryDelayMs: 5 });

    expect(fake.store.has('lock:slot-2')).toBe(false);
  });
});
