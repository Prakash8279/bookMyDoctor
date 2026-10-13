jest.mock('../../../src/config/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  unlink: jest.fn(),
  scan: jest.fn(),
}));

jest.mock('../../../src/config/logger', () => ({
  error: jest.fn(),
}));

const redis = require('../../../src/config/redis');
const cacheService = require('../../../src/services/cacheService');

beforeEach(() => {
  jest.clearAllMocks();
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue('OK');
  redis.unlink.mockResolvedValue(1);
});

describe('cacheService single-flight reads', () => {
  test('concurrent misses for the same key execute the source query once', async () => {
    let resolveSource;
    const fetchFn = jest.fn(() => new Promise((resolve) => { resolveSource = resolve; }));

    const first = cacheService.getOrSet('cache:test:same', 60, fetchFn);
    await Promise.resolve();
    const second = cacheService.getOrSet('cache:test:same', 60, fetchFn);
    await Promise.resolve();

    resolveSource({ rows: [{ id: 'one' }] });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  test('an invalidation during a source read prevents stale data being written back', async () => {
    let resolveSource;
    const pending = cacheService.getOrSet(
      'cache:test:stale',
      60,
      () => new Promise((resolve) => { resolveSource = resolve; })
    );
    await Promise.resolve();

    await cacheService.invalidate('cache:test:stale');
    resolveSource({ version: 'before-mutation' });
    await pending;

    expect(redis.set).not.toHaveBeenCalled();
  });
});
