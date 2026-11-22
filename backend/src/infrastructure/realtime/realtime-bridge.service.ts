import { Injectable } from '@nestjs/common';
import { DomainEvent, DomainEventType } from '../events/domain-events';
import { OutboxService } from '../events/outbox.service';
import { RealtimeService } from './realtime.service';

const TOPIC: Record<string, string> = {
  [DomainEventType.ActivityCreated]: 'schedule',
  [DomainEventType.ActivityStarted]: 'timer',
  [DomainEventType.ActivityPaused]: 'timer',
  [DomainEventType.ActivityCompleted]: 'timer',
  [DomainEventType.TimeEntryChanged]: 'timer',
  [DomainEventType.ScheduleChanged]: 'schedule',
  [DomainEventType.TaskCreated]: 'tasks',
  [DomainEventType.TaskCompleted]: 'tasks',
  [DomainEventType.AvailabilityRecalculated]: 'availability',
  [DomainEventType.RecommendationGenerated]: 'recommendations',
  [DomainEventType.ProductivityReportGenerated]: 'analytics',
};

/**
 * Forwards committed domain events to the user's open browser sessions as tiny "something changed"
 * hints (Server-Sent Events). Because it consumes the outbox, a hint is only ever sent for a change
 * that is really in the database, and a second tab or device sees the change without polling.
 */
@Injectable()
export class RealtimeBridge {
  constructor(outbox: OutboxService, private readonly realtime: RealtimeService) {
    outbox.on(Object.keys(TOPIC), 'realtime.fanout', async (e: DomainEvent) => {
      this.realtime.publish(e.userId, { topic: TOPIC[e.type] ?? 'data', event: e.type });
    });
  }
}
