import { CacheService } from '@/infrastructure/redis/cache.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

// No Redis client: the cache uses its in-process fallback, which is what these tests exercise.
const cache = () => new CacheService({ client: null } as unknown as RedisService);
const tick = () => new Promise((r) => setImmediate(r));

describe('CacheService', () => {
  it('computes once and serves later reads from the cache', async () => {
    const c = cache();
    const compute = jest.fn(async () => ({ n: 1 }));
    expect(await c.wrap('u1', 'k', 60, compute)).toEqual({ n: 1 });
    expect(await c.wrap('u1', 'k', 60, compute)).toEqual({ n: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('shares one computation between concurrent identical requests (no cache stampede)', async () => {
    const c = cache();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const compute = jest.fn(async () => {
      await gate;
      return 'expensive';
    });
    const calls = Promise.all(Array.from({ length: 8 }, () => c.wrap('u1', 'dashboard', 60, compute)));
    await tick();
    release();
    expect(await calls).toEqual(Array(8).fill('expensive'));
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('does not share work across users or keys', async () => {
    const c = cache();
    const compute = jest.fn(async () => Math.random());
    const [a, b, d] = await Promise.all([c.wrap('u1', 'k', 60, compute), c.wrap('u2', 'k', 60, compute), c.wrap('u1', 'other', 60, compute)]);
    expect(compute).toHaveBeenCalledTimes(3);
    expect(new Set([a, b, d]).size).toBe(3);
  });

  it('invalidating a user makes every cached value for that user (only) stale at once', async () => {
    const c = cache();
    let version = 0;
    const compute = jest.fn(async () => ++version);
    expect(await c.wrap('u1', 'a', 60, compute)).toBe(1);
    expect(await c.wrap('u2', 'a', 60, compute)).toBe(2);
    await c.invalidateUser('u1');
    expect(await c.wrap('u1', 'a', 60, compute)).toBe(3); // recomputed
    expect(await c.wrap('u2', 'a', 60, compute)).toBe(2); // untouched
  });

  it('does not cache failures and lets the next caller retry', async () => {
    const c = cache();
    const compute = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce('ok');
    await expect(c.wrap('u1', 'k', 60, compute)).rejects.toThrow('db down');
    expect(await c.wrap('u1', 'k', 60, compute)).toBe('ok');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('a write during a computation is not served stale afterwards', async () => {
    const c = cache();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = c.wrap('u1', 'k', 60, async () => {
      await gate;
      return 'computed-before-write';
    });
    await tick();
    await c.invalidateUser('u1'); // a write lands while the read model is being built
    release();
    await slow;
    // the value was stored under the OLD version, so the next read must recompute
    const fresh = jest.fn(async () => 'computed-after-write');
    expect(await c.wrap('u1', 'k', 60, fresh)).toBe('computed-after-write');
  });
});
