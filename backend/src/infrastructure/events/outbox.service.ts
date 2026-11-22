import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ENV } from '@/config/config.module';
import { Env } from '@/config/env';
import { Db, PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { DomainEvent, NewDomainEvent } from './domain-events';

export const DOMAIN_EVENT_JOB = 'domain-event';

type Subscriber = { name: string; handle: (event: DomainEvent) => Promise<void> };

/**
 * Transactional outbox.
 *
 *   write side   : `add(tx, event)` inserts the event in the caller's transaction, so an event
 *                  exists if and only if the state change was committed.
 *   relay        : `kick()` (called after commit) and a slow poller claim unpublished rows with
 *                  FOR UPDATE SKIP LOCKED and hand them to the job queue using the event id as
 *                  job id (at-least-once delivery, de-duplicated while pending).
 *   consume side : each subscriber is recorded in ProcessedEvent once it succeeded, so retries
 *                  and redeliveries never run the same handler twice for the same event.
 */
@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private readonly subscribers = new Map<string, Subscriber[]>();
  private poller: NodeJS.Timeout | null = null;
  private relaying: Promise<number> | null = null;
  private rerun = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.queue.register<DomainEvent>(DOMAIN_EVENT_JOB, (event) => this.dispatch(event));
  }

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test' || process.env.TIMEFLOW_SKIP_DB_CONNECT === '1') return;
    this.poller = setInterval(() => void this.kick(), 5000);
    this.poller.unref();
  }

  onModuleDestroy(): void {
    if (this.poller) clearInterval(this.poller);
  }

  /** Subscribe a named, idempotent handler to one or more event types. */
  on(types: string | string[], name: string, handle: Subscriber['handle']): void {
    for (const type of Array.isArray(types) ? types : [types]) {
      const list = this.subscribers.get(type) ?? [];
      list.push({ name, handle });
      this.subscribers.set(type, list);
    }
  }

  /** Record an event inside the caller's transaction. */
  async add(db: Db, event: NewDomainEvent): Promise<void> {
    await db.outboxEvent.create({
      data: {
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        userId: event.userId,
        payload: (event.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /** Relay unpublished events now. Safe to call concurrently; never throws. */
  kick(): Promise<number> {
    if (this.relaying) {
      this.rerun = true;
      return this.relaying;
    }
    this.relaying = this.relayLoop().finally(() => {
      this.relaying = null;
    });
    return this.relaying;
  }

  private async relayLoop(): Promise<number> {
    let total = 0;
    try {
      do {
        this.rerun = false;
        let n: number;
        do {
          n = await this.relayBatch();
          total += n;
        } while (n === 100);
      } while (this.rerun);
    } catch (err) {
      this.logger.error(`Outbox relay failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return total;
  }

  private async relayBatch(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; type: string; aggregateType: string; aggregateId: string; userId: string; payload: unknown; createdAt: Date }[]
      >`SELECT "id", "type", "aggregateType", "aggregateId", "userId", "payload", "createdAt"
          FROM "OutboxEvent"
         WHERE "publishedAt" IS NULL
         ORDER BY "createdAt" ASC
         LIMIT 100
         FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return 0;
      for (const row of rows) {
        const event: DomainEvent = {
          id: row.id,
          type: row.type as DomainEvent['type'],
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          userId: row.userId,
          payload: (row.payload ?? {}) as DomainEvent['payload'],
          createdAt: row.createdAt.toISOString(),
        };
        await this.queue.enqueue(DOMAIN_EVENT_JOB, event, { jobId: `evt-${row.id}` });
      }
      await tx.outboxEvent.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { publishedAt: new Date(), attempts: { increment: 1 } },
      });
      return rows.length;
    });
  }

  /** Run every subscriber of an event exactly once (per subscriber). */
  private async dispatch(event: DomainEvent): Promise<void> {
    const subs = this.subscribers.get(event.type) ?? [];
    const failures: string[] = [];
    for (const sub of subs) {
      const done = await this.prisma.processedEvent.findUnique({
        where: { eventId_handler: { eventId: event.id, handler: sub.name } },
      });
      if (done) continue;
      try {
        await sub.handle(event);
        await this.prisma.processedEvent.createMany({
          data: [{ eventId: event.id, handler: sub.name }],
          skipDuplicates: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${sub.name}: ${message}`);
        this.logger.warn(`Subscriber ${sub.name} failed for ${event.type}#${event.id}: ${message}`);
      }
    }
    if (failures.length > 0) {
      await this.prisma.outboxEvent
        .update({ where: { id: event.id }, data: { lastError: failures.join(' | ').slice(0, 1000) } })
        .catch(() => undefined);
      // Throwing makes the queue retry; subscribers that already succeeded are skipped next time.
      throw new Error(`Event ${event.type}#${event.id} had failing subscribers`);
    }
  }

  /** Tests: relay and process everything that is pending. */
  async drain(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const relayed = await this.kick();
      await this.queue.drain();
      const pending = await this.prisma.outboxEvent.count({ where: { publishedAt: null } });
      if (relayed === 0 && pending === 0) return;
    }
  }
}
