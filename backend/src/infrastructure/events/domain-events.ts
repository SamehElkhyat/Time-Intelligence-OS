/**
 * Domain event catalogue. Events are facts about something that already happened and was
 * committed. They are written to the outbox inside the same transaction as the state change.
 */
export const DomainEventType = {
  ActivityCreated: 'activity.created',
  ActivityStarted: 'activity.started',
  ActivityPaused: 'activity.paused',
  ActivityCompleted: 'activity.completed',
  TaskCreated: 'task.created',
  TaskCompleted: 'task.completed',
  ScheduleChanged: 'schedule.changed',
  TimeEntryChanged: 'time-entry.changed',
  AvailabilityRecalculated: 'availability.recalculated',
  RecommendationGenerated: 'recommendation.generated',
  ProductivityReportGenerated: 'productivity.report.generated',
  NotificationCreated: 'notification.created',
} as const;

export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

export interface DomainEventPayload {
  /** Local dates (user timezone) whose derived data may have changed. */
  dates?: string[];
  [key: string]: unknown;
}

export interface NewDomainEvent {
  type: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  userId: string;
  payload?: DomainEventPayload;
}

export interface DomainEvent extends NewDomainEvent {
  id: string;
  payload: DomainEventPayload;
  createdAt: string;
}
