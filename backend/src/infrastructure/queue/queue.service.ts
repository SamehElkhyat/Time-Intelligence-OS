import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { RedisService } from '../redis/redis.service';

export type JobHandler<T = unknown> = (data: T, meta: { jobId: string; attempt: number }) => Promise<void>;

export interface EnqueueOptions {
  /** Deterministic id: enqueuing the same id twice while the first is pending is a no-op. */
  jobId?: string;
  delayMs?: number;
  attempts?: number;
}

export interface QueueStats {
  mode: 'bullmq' | 'inline';
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

const QUEUE_NAME = 'timeflow';

/**
 * Background job port.
 *
 * - With Redis: a BullMQ queue + worker (retries with exponential backoff, delayed jobs,
 *   job-id de-duplication, counters for monitoring).
 * - Without Redis (local dev without Docker, automated tests): jobs run in-process right
 *   after the current tick, with the same retry semantics. Handlers must therefore be
 *   idempotent in both modes.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  // Handlers are registered per job name with their own payload type; the map stores them type-erased.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<string, JobHandler<any>>();
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  // inline mode bookkeeping
  private readonly inlinePending = new Set<Promise<void>>();
  private readonly inlineTimers = new Map<string, NodeJS.Timeout>();
  private readonly inlineIds = new Set<string>();
  private inlineStats = { completed: 0, failed: 0, active: 0 };

  constructor(private readonly redis: RedisService) {}

  register<T>(name: string, handler: JobHandler<T>): void {
    if (this.handlers.has(name)) throw new Error(`Job handler "${name}" registered twice`);
    this.handlers.set(name, handler);
  }

  onApplicationBootstrap(): void {
    if (!this.redis.enabled) return;
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.redis.create('bullmq-queue', true),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`No handler for job "${job.name}"`);
        await handler(job.data, { jobId: job.id ?? job.name, attempt: job.attemptsMade + 1 });
      },
      { connection: this.redis.create('bullmq-worker', true), concurrency: 8 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`Job ${job?.name}#${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
    this.logger.log('BullMQ queue and worker started');
  }

  async enqueue<T>(name: string, data: T, opts: EnqueueOptions = {}): Promise<void> {
    if (this.queue) {
      await this.queue.add(name, data, {
        jobId: opts.jobId,
        delay: opts.delayMs,
        ...(opts.attempts ? { attempts: opts.attempts } : {}),
      });
      return;
    }
    this.enqueueInline(name, data, opts);
  }

  /** Cancel a delayed job by id (used when a reminder becomes obsolete). */
  async cancel(jobId: string): Promise<void> {
    if (this.queue) {
      const job = await this.queue.getJob(jobId);
      if (job && (await job.isDelayed())) await job.remove();
      return;
    }
    const timer = this.inlineTimers.get(jobId);
    if (timer) clearTimeout(timer);
    this.inlineTimers.delete(jobId);
    this.inlineIds.delete(jobId);
  }

  private enqueueInline<T>(name: string, data: T, opts: EnqueueOptions): void {
    const id = opts.jobId ?? `${name}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    if (opts.jobId && this.inlineIds.has(id)) return;
    this.inlineIds.add(id);
    const run = () => {
      this.inlineTimers.delete(id);
      const p = this.runInline(name, data, id, opts.attempts ?? 3).finally(() => {
        this.inlinePending.delete(p);
        this.inlineIds.delete(id);
      });
      this.inlinePending.add(p);
    };
    if (opts.delayMs && opts.delayMs > 0) {
      // setTimeout caps at ~24.8 days; longer reminders are simply re-scheduled by callers.
      const timer = setTimeout(run, Math.min(opts.delayMs, 2_000_000_000));
      timer.unref();
      this.inlineTimers.set(id, timer);
    } else {
      setImmediate(run);
    }
  }

  private async runInline<T>(name: string, data: T, jobId: string, attempts: number): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) {
      this.logger.error(`No handler for job "${name}"`);
      return;
    }
    this.inlineStats.active++;
    try {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          await handler(data, { jobId, attempt });
          this.inlineStats.completed++;
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Inline job ${name}#${jobId} failed (attempt ${attempt}/${attempts}): ${message}`);
          if (attempt === attempts) this.inlineStats.failed++;
        }
      }
    } finally {
      this.inlineStats.active--;
    }
  }

  /** Wait until all immediately-runnable inline jobs (and the jobs they enqueue) are done. Tests only. */
  async drain(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setImmediate(r));
      if (this.inlinePending.size === 0) return;
      await Promise.allSettled([...this.inlinePending]);
    }
  }

  async stats(): Promise<QueueStats> {
    if (this.queue) {
      const c = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
      return {
        mode: 'bullmq',
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        delayed: c.delayed ?? 0,
        failed: c.failed ?? 0,
        completed: c.completed ?? 0,
      };
    }
    return {
      mode: 'inline',
      waiting: 0,
      active: this.inlineStats.active,
      delayed: this.inlineTimers.size,
      failed: this.inlineStats.failed,
      completed: this.inlineStats.completed,
    };
  }

  async onModuleDestroy(): Promise<void> {
    for (const t of this.inlineTimers.values()) clearTimeout(t);
    await this.worker?.close();
    await this.queue?.close();
  }
}
