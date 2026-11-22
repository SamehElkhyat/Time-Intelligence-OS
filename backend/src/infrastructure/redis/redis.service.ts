import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '@/config/config.module';
import { Env } from '@/config/env';

/**
 * Owns the Redis connections. Redis is optional in development and tests:
 * when REDIS_URL is empty, `client` is null and dependants use in-process fallbacks.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis | null;
  private readonly extra: Redis[] = [];

  constructor(@Inject(ENV) private readonly env: Env) {
    this.client = this.enabled ? this.create('main') : null;
    if (!this.enabled) this.logger.warn('REDIS_URL not set — using in-process cache and inline jobs');
  }

  get enabled(): boolean {
    return Boolean(this.env.REDIS_URL) && this.env.NODE_ENV !== 'test' && process.env.TIMEFLOW_SKIP_DB_CONNECT !== '1';
  }

  /** New dedicated connection (BullMQ workers and pub/sub need their own). */
  create(label: string, forBullmq = false): Redis {
    const conn = new Redis(this.env.REDIS_URL as string, {
      maxRetriesPerRequest: forBullmq ? null : 3,
      enableReadyCheck: !forBullmq,
      lazyConnect: false,
    });
    conn.on('error', (err) => this.logger.error(`Redis(${label}) ${err.message}`));
    if (label !== 'main') this.extra.push(conn);
    return conn;
  }

  async isHealthy(): Promise<boolean | null> {
    if (!this.client) return null;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.extra, ...(this.client ? [this.client] : [])].map((c) => c.quit()));
  }
}
