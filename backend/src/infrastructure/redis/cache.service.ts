import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/**
 * Small JSON cache with per-user versioned invalidation.
 *
 * Expensive read models (analytics summaries, pattern insights) are cached under a key
 * that embeds the user's "data version". Any write that changes the user's time data bumps
 * that version, which makes every previously cached entry unreachable at once — no key scans.
 */
@Injectable()
export class CacheService {
  private readonly memory = new Map<string, MemoryEntry>();
  private static readonly MAX_MEMORY_ENTRIES = 5000;

  constructor(private readonly redis: RedisService) {}

  private async rawGet(key: string): Promise<string | null> {
    if (this.redis.client) return this.redis.client.get(key);
    const hit = this.memory.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return hit.value;
  }

  private async rawSet(key: string, value: string, ttlSec: number): Promise<void> {
    if (this.redis.client) {
      await this.redis.client.set(key, value, 'EX', ttlSec);
      return;
    }
    if (this.memory.size >= CacheService.MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
    this.memory.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }

  private versionKey(userId: string): string {
    return `tf:v:${userId}`;
  }

  async userVersion(userId: string): Promise<number> {
    const raw = await this.rawGet(this.versionKey(userId));
    return raw ? Number(raw) : 0;
  }

  /** Invalidate every cached read model of a user. */
  async invalidateUser(userId: string): Promise<void> {
    if (this.redis.client) {
      await this.redis.client.incr(this.versionKey(userId));
      return;
    }
    const next = (await this.userVersion(userId)) + 1;
    this.memory.set(this.versionKey(userId), { value: String(next), expiresAt: Number.MAX_SAFE_INTEGER });
  }

  /** Computations currently running in this process, so identical concurrent requests share one. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Read-through cache scoped to a user. Cache failures never fail the request.
   *
   * Single-flight: when several identical requests arrive while the value is being computed (for
   * example a dashboard opening in three tabs at once), only the first computes; the others await
   * the same promise instead of repeating expensive work (a "cache stampede").
   */
  async wrap<T>(userId: string, key: string, ttlSec: number, compute: () => Promise<T>): Promise<T> {
    let fullKey: string | null = null;
    try {
      const version = await this.userVersion(userId);
      fullKey = `tf:c:${userId}:${version}:${key}`;
      const hit = await this.rawGet(fullKey);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch {
      fullKey = null;
    }
    if (!fullKey) return compute();

    const pending = this.inflight.get(fullKey);
    if (pending) return pending as Promise<T>;

    const run = (async () => {
      const value = await compute();
      try {
        await this.rawSet(fullKey!, JSON.stringify(value), ttlSec);
      } catch {
        /* cache is best-effort */
      }
      return value;
    })().finally(() => this.inflight.delete(fullKey!));
    this.inflight.set(fullKey, run);
    return run;
  }
}
