import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Observable, Subject, filter, map } from 'rxjs';
import { RedisService } from '../redis/redis.service';

export interface RealtimeMessage {
  /** e.g. "timer", "schedule", "tasks", "notifications", "analytics" */
  topic: string;
  /** Event name that caused the push, e.g. "activity.started". */
  event: string;
  data?: Record<string, unknown>;
}

interface Envelope {
  userId: string;
  message: RealtimeMessage;
}

const CHANNEL = 'tf:realtime';

/**
 * Fan-out of small "something changed" messages to a user's open browser sessions
 * (Server-Sent Events). Messages carry no sensitive payload: clients react by
 * re-fetching through the normal authenticated API.
 *
 * With Redis, messages go through pub/sub so every API instance can reach its own
 * connected clients. Without Redis the in-process subject is used directly.
 */
@Injectable()
export class RealtimeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly subject = new Subject<Envelope>();

  constructor(private readonly redis: RedisService) {}

  onApplicationBootstrap(): void {
    if (!this.redis.enabled) return;
    const sub = this.redis.create('realtime-sub');
    void sub.subscribe(CHANNEL).catch((err) => this.logger.error(`Realtime subscribe failed: ${err.message}`));
    sub.on('message', (_channel, raw) => {
      try {
        this.subject.next(JSON.parse(raw) as Envelope);
      } catch {
        /* ignore malformed message */
      }
    });
  }

  publish(userId: string, message: RealtimeMessage): void {
    const envelope: Envelope = { userId, message };
    if (this.redis.client) {
      void this.redis.client.publish(CHANNEL, JSON.stringify(envelope)).catch(() => this.subject.next(envelope));
    } else {
      this.subject.next(envelope);
    }
  }

  streamFor(userId: string): Observable<RealtimeMessage> {
    return this.subject.pipe(
      filter((e) => e.userId === userId),
      map((e) => e.message),
    );
  }
}
