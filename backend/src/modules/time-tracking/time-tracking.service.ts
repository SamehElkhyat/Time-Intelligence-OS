import { Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityCategory, ActivitySession, Prisma, SessionSegment } from '@prisma/client';
import { DomainError } from '@/common/http/errors';
import { pageMeta } from '@/common/http/pagination.dto';
import { formatDuration, localDatesInRange, localDatesOf, wholeSeconds } from '@/common/time/time';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { DomainEventType, NewDomainEvent } from '@/infrastructure/events/domain-events';
import { OutboxService } from '@/infrastructure/events/outbox.service';
import { isUniqueViolation, PrismaService, Tx } from '@/infrastructure/prisma/prisma.service';
import { QueueService } from '@/infrastructure/queue/queue.service';
import { CacheService } from '@/infrastructure/redis/cache.service';
import { toCategoryRef } from '../activities/activity.mapper';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import {
  ABANDONED_AFTER_MS,
  abandonedCutoff,
  elapsedMs,
  elapsedSec,
  LONG_RUNNING_NOTICE_MS,
  nextStatus,
  TimerAction,
  TimerTransitionError,
  validateEntryRange,
} from './domain/timer';
import {
  ActiveTimerDto,
  CorrectionDto,
  CorrectSessionDto,
  ManualEntryDto,
  SessionListDto,
  SessionQueryDto,
  StartTimerDto,
  StartTimerResultDto,
  StopTimerDto,
  TimeSessionDto,
} from './time-tracking.dto';

const SESSION_INCLUDE = {
  activity: { include: { category: true } },
  segments: { orderBy: { startedAt: 'asc' } },
} satisfies Prisma.ActivitySessionInclude;

type FullSession = ActivitySession & {
  activity: Activity & { category: ActivityCategory };
  segments: SessionSegment[];
};

const JOB_LONG_RUNNING = 'timer.long-running';
const JOB_ABANDONED = 'timer.abandoned';

interface TimerJob {
  userId: string;
  sessionId: string;
  segmentId: string;
}

const toSegmentTimes = (segments: SessionSegment[]) =>
  segments.map((s) => ({ startedAt: s.startedAt.getTime(), endedAt: s.endedAt?.getTime() ?? null }));

export const toSessionDto = (s: FullSession, now: number): TimeSessionDto => ({
  id: s.id,
  activityId: s.activityId,
  activityTitle: s.activity.title,
  category: toCategoryRef(s.activity.category),
  status: s.status,
  source: s.source,
  startedAt: s.startedAt,
  endedAt: s.endedAt,
  durationSec: s.status === 'STOPPED' ? s.durationSec : elapsedSec(toSegmentTimes(s.segments), now),
  pauseCount: s.pauseCount,
  note: s.note,
  autoStopped: s.autoStopped,
  version: s.version,
  segments: s.segments.map((g) => ({ id: g.id, startedAt: g.startedAt, endedAt: g.endedAt })),
});

/**
 * Time-tracking engine.
 *
 * Concurrency model: every timer operation runs in a transaction that first takes a row lock
 * on the user (`SELECT … FOR UPDATE`). Two simultaneous requests for the same user are therefore
 * serialised, and the second one observes the state left by the first. A partial unique index
 * (one active session per user, one open segment per session) is the database-level backstop.
 */
@Injectable()
export class TimeTrackingService {
  private readonly logger = new Logger(TimeTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
  ) {
    this.queue.register<TimerJob>(JOB_LONG_RUNNING, (job) => this.handleLongRunning(job));
    this.queue.register<TimerJob>(JOB_ABANDONED, (job) => this.handleAbandoned(job));
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async lockUser(tx: Tx, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  }

  private findActive(tx: Tx | PrismaService, userId: string): Promise<FullSession | null> {
    return tx.activitySession.findFirst({
      where: { userId, status: { in: ['RUNNING', 'PAUSED'] } },
      include: SESSION_INCLUDE,
    });
  }

  /** Keep Activity.actualDurationSec equal to the sum of its sessions. */
  private async recalcActivityActual(tx: Tx, activityId: string): Promise<number> {
    const agg = await tx.activitySession.aggregate({ where: { activityId }, _sum: { durationSec: true } });
    const total = agg._sum.durationSec ?? 0;
    await tx.activity.update({ where: { id: activityId }, data: { actualDurationSec: total } });
    return total;
  }

  private async afterCommit(userId: string): Promise<void> {
    await this.cache.invalidateUser(userId);
    void this.outbox.kick();
  }

  private scheduleChecks(userId: string, sessionId: string, segmentId: string): void {
    const job: TimerJob = { userId, sessionId, segmentId };
    void this.queue.enqueue(JOB_LONG_RUNNING, job, { jobId: `timer-long-${segmentId}`, delayMs: LONG_RUNNING_NOTICE_MS });
    void this.queue.enqueue(JOB_ABANDONED, job, { jobId: `timer-abandoned-${segmentId}`, delayMs: ABANDONED_AFTER_MS });
  }

  private expectedTotalSec(a: Activity): number | null {
    if (a.estimatedDurationSec) return a.estimatedDurationSec;
    if (a.plannedStart && a.plannedEnd) return wholeSeconds(a.plannedEnd.getTime() - a.plannedStart.getTime());
    return null;
  }

  private toActiveDto(session: FullSession | null, now: Date): ActiveTimerDto {
    if (!session) return { session: null, serverTime: now, elapsedSec: 0, expectedTotalSec: null };
    return {
      session: toSessionDto(session, now.getTime()),
      serverTime: now,
      elapsedSec: elapsedSec(toSegmentTimes(session.segments), now.getTime()),
      expectedTotalSec: this.expectedTotalSec(session.activity),
    };
  }

  /**
   * Close a session inside an open transaction: end the running segment at `at`,
   * freeze the duration and update the activity. Returns the events to publish.
   */
  private async closeSession(
    tx: Tx,
    session: FullSession,
    at: Date,
    timezone: string,
    opts: { complete?: boolean; note?: string; autoStopped?: boolean } = {},
  ): Promise<NewDomainEvent[]> {
    const open = session.segments.find((s) => s.endedAt === null);
    if (open) {
      const end = at.getTime() >= open.startedAt.getTime() ? at : open.startedAt;
      await tx.sessionSegment.update({ where: { id: open.id }, data: { endedAt: end } });
      open.endedAt = end;
    }
    const last = session.segments[session.segments.length - 1];
    const endedAt = last?.endedAt ?? at;
    const durationSec = elapsedSec(toSegmentTimes(session.segments), at.getTime());
    await tx.activitySession.update({
      where: { id: session.id },
      data: {
        status: 'STOPPED',
        endedAt,
        durationSec,
        version: { increment: 1 },
        autoStopped: opts.autoStopped ?? false,
        ...(opts.note !== undefined ? { note: opts.note } : {}),
      },
    });
    await this.recalcActivityActual(tx, session.activityId);
    await tx.activity.update({
      where: { id: session.activityId },
      data: opts.complete
        ? { status: 'COMPLETED', completedAt: endedAt }
        : { status: session.activity.status === 'COMPLETED' ? 'COMPLETED' : 'PLANNED' },
    });
    const dates = localDatesInRange(timezone, session.startedAt, endedAt);
    const events: NewDomainEvent[] = [
      {
        type: DomainEventType.TimeEntryChanged,
        aggregateType: 'ActivitySession',
        aggregateId: session.id,
        userId: session.userId,
        payload: { activityId: session.activityId, sessionId: session.id, reason: 'timer.stopped', dates },
      },
    ];
    if (opts.complete) {
      events.push({
        type: DomainEventType.ActivityCompleted,
        aggregateType: 'Activity',
        aggregateId: session.activityId,
        userId: session.userId,
        payload: { activityId: session.activityId, taskId: session.activity.taskId, dates },
      });
    }
    return events;
  }

  /** Used by the activities module: stop any timer on an activity inside its own transaction. */
  async closeActiveForActivity(tx: Tx, userId: string, activityId: string, timezone: string, complete: boolean): Promise<NewDomainEvent[]> {
    await this.lockUser(tx, userId);
    const active = await this.findActive(tx, userId);
    if (!active || active.activityId !== activityId) return [];
    return this.closeSession(tx, active, new Date(), timezone, { complete });
  }

  // ── queries ────────────────────────────────────────────────────────────────

  async getActive(userId: string): Promise<ActiveTimerDto> {
    return this.toActiveDto(await this.findActive(this.prisma, userId), new Date());
  }

  /** Compact view for the availability engine. */
  async activeTimerInfo(userId: string, now: number) {
    const s = await this.findActive(this.prisma, userId);
    if (!s) return null;
    const expected = this.expectedTotalSec(s.activity);
    // Elapsed for the whole activity: earlier stopped sessions + this session up to now.
    const earlier = Math.max(0, s.activity.actualDurationSec - s.durationSec) * 1000;
    return {
      activityId: s.activityId,
      title: s.activity.title,
      paused: s.status === 'PAUSED',
      elapsedMs: earlier + elapsedMs(toSegmentTimes(s.segments), now),
      expectedTotalMs: expected === null ? null : expected * 1000,
    };
  }

  // ── commands ───────────────────────────────────────────────────────────────

  async start(userId: string, dto: StartTimerDto): Promise<StartTimerResultDto> {
    const pref = await this.users.preference(userId);
    const now = new Date();
    let scheduled: { sessionId: string; segmentId: string } | null = null;

    let result: { switchedFrom: string | null };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        const events: NewDomainEvent[] = [];

        let activity: Activity;
        if (dto.activityId) {
          const found = await tx.activity.findFirst({ where: { id: dto.activityId, userId, deletedAt: null } });
          if (!found) throw DomainError.notFound('Activity');
          if (found.status === 'CANCELLED') {
            throw DomainError.conflict('ACTIVITY_NOT_TRACKABLE', 'A cancelled activity cannot be tracked. Restore it first.');
          }
          activity = found;
        } else {
          const category = await tx.activityCategory.findFirst({ where: { id: dto.categoryId, userId } });
          if (!category) throw DomainError.badRequest('INVALID_CATEGORY', 'Unknown category.');
          activity = await tx.activity.create({
            data: { userId, categoryId: category.id, title: dto.title as string, status: 'IN_PROGRESS' },
          });
          events.push({
            type: DomainEventType.ActivityCreated,
            aggregateType: 'Activity',
            aggregateId: activity.id,
            userId,
            payload: { activityId: activity.id, adHoc: true, dates: localDatesOf(pref.timezone, now) },
          });
        }

        const active = await this.findActive(tx, userId);
        let switchedFrom: string | null = null;
        if (active) {
          if (active.activityId === activity.id) {
            if (active.status === 'PAUSED') {
              scheduled = await this.applyTransition(tx, active, 'RESUME', now, pref.timezone, events);
            }
            for (const e of events) await this.outbox.add(tx, e);
            return { switchedFrom: null }; // already tracking this activity: idempotent
          }
          // Activity switch: the previous timer is stopped at the same instant the new one starts.
          events.push(...(await this.closeSession(tx, active, now, pref.timezone)));
          switchedFrom = active.id;
        }

        const session = await tx.activitySession.create({
          data: { userId, activityId: activity.id, status: 'RUNNING', source: 'TIMER', startedAt: now },
        });
        const segment = await tx.sessionSegment.create({ data: { sessionId: session.id, userId, startedAt: now } });
        await tx.activity.update({ where: { id: activity.id }, data: { status: 'IN_PROGRESS', completedAt: null } });
        scheduled = { sessionId: session.id, segmentId: segment.id };
        events.push({
          type: DomainEventType.ActivityStarted,
          aggregateType: 'Activity',
          aggregateId: activity.id,
          userId,
          payload: { activityId: activity.id, sessionId: session.id, switchedFrom, dates: localDatesOf(pref.timezone, now) },
        });
        for (const e of events) await this.outbox.add(tx, e);
        return { switchedFrom };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw DomainError.conflict('TIMER_ALREADY_ACTIVE', 'Another timer was started at the same moment. Refresh and try again.');
      }
      throw err;
    }

    await this.afterCommit(userId);
    const s = scheduled as { sessionId: string; segmentId: string } | null;
    if (s) this.scheduleChecks(userId, s.sessionId, s.segmentId);
    return { timer: await this.getActive(userId), switchedFromSessionId: result.switchedFrom };
  }

  /** PAUSE / RESUME on an active session, inside a transaction. Returns the new open segment (on resume). */
  private async applyTransition(
    tx: Tx,
    session: FullSession,
    action: Exclude<TimerAction, 'STOP'>,
    now: Date,
    timezone: string,
    events: NewDomainEvent[],
  ): Promise<{ sessionId: string; segmentId: string } | null> {
    let status;
    try {
      status = nextStatus(session.status, action);
    } catch (err) {
      if (err instanceof TimerTransitionError) throw DomainError.conflict('INVALID_TIMER_TRANSITION', err.message + '.');
      throw err;
    }
    const dates = localDatesOf(timezone, now);
    if (action === 'PAUSE') {
      const open = session.segments.find((s) => s.endedAt === null);
      if (open) {
        await tx.sessionSegment.update({ where: { id: open.id }, data: { endedAt: now } });
        open.endedAt = now;
      }
      await tx.activitySession.update({
        where: { id: session.id },
        data: {
          status,
          durationSec: elapsedSec(toSegmentTimes(session.segments), now.getTime()),
          pauseCount: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await this.recalcActivityActual(tx, session.activityId);
      await tx.activity.update({ where: { id: session.activityId }, data: { status: 'PAUSED' } });
      events.push({
        type: DomainEventType.ActivityPaused,
        aggregateType: 'Activity',
        aggregateId: session.activityId,
        userId: session.userId,
        payload: { activityId: session.activityId, sessionId: session.id, dates },
      });
      return null;
    }
    const segment = await tx.sessionSegment.create({ data: { sessionId: session.id, userId: session.userId, startedAt: now } });
    await tx.activitySession.update({ where: { id: session.id }, data: { status, version: { increment: 1 } } });
    await tx.activity.update({ where: { id: session.activityId }, data: { status: 'IN_PROGRESS' } });
    events.push({
      type: DomainEventType.ActivityStarted,
      aggregateType: 'Activity',
      aggregateId: session.activityId,
      userId: session.userId,
      payload: { activityId: session.activityId, sessionId: session.id, resumed: true, dates },
    });
    return { sessionId: session.id, segmentId: segment.id };
  }

  private async act(userId: string, action: TimerAction, dto: StopTimerDto): Promise<ActiveTimerDto> {
    const pref = await this.users.preference(userId);
    const now = new Date();
    let scheduled: { sessionId: string; segmentId: string } | null = null;
    let stopped: FullSession | null = null;

    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const active = await this.findActive(tx, userId);
      if (!active) throw DomainError.conflict('NO_ACTIVE_TIMER', 'There is no active timer.');
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== active.version) {
        throw DomainError.conflict('TIMER_STATE_CHANGED', 'The timer was changed from another tab or device. It has been refreshed.');
      }
      const events: NewDomainEvent[] = [];
      if (action === 'STOP') {
        events.push(...(await this.closeSession(tx, active, now, pref.timezone, { complete: dto.complete, note: dto.note })));
        stopped = active;
      } else {
        scheduled = await this.applyTransition(tx, active, action, now, pref.timezone, events);
      }
      for (const e of events) await this.outbox.add(tx, e);
    });

    await this.afterCommit(userId);
    const s = scheduled as { sessionId: string; segmentId: string } | null;
    if (s) this.scheduleChecks(userId, s.sessionId, s.segmentId);
    if (stopped) {
      // After a stop there is no active session; return the final state of the one just closed.
      const final = await this.prisma.activitySession.findUniqueOrThrow({ where: { id: (stopped as FullSession).id }, include: SESSION_INCLUDE });
      return { session: toSessionDto(final, now.getTime()), serverTime: now, elapsedSec: final.durationSec, expectedTotalSec: this.expectedTotalSec(final.activity) };
    }
    return this.getActive(userId);
  }

  pause = (userId: string, dto: StopTimerDto) => this.act(userId, 'PAUSE', dto);
  resume = (userId: string, dto: StopTimerDto) => this.act(userId, 'RESUME', dto);
  stop = (userId: string, dto: StopTimerDto) => this.act(userId, 'STOP', dto);

  // ── manual entries & corrections ───────────────────────────────────────────

  private async assertNoOverlap(tx: Tx, userId: string, start: Date, end: Date, excludeSessionId?: string): Promise<void> {
    const hit = await tx.sessionSegment.findFirst({
      where: {
        userId,
        ...(excludeSessionId ? { sessionId: { not: excludeSessionId } } : {}),
        startedAt: { lt: end },
        OR: [{ endedAt: { gt: start } }, { endedAt: null }],
      },
      include: { session: { include: { activity: { select: { title: true } } } } },
    });
    if (hit) {
      throw DomainError.conflict(
        'TIME_ENTRY_OVERLAP',
        `This overlaps time already tracked for "${hit.session.activity.title}". Tracked time cannot overlap.`,
      );
    }
  }

  async manualEntry(userId: string, dto: ManualEntryDto): Promise<TimeSessionDto> {
    const pref = await this.users.preference(userId);
    const problem = validateEntryRange(dto.startedAt.getTime(), dto.endedAt.getTime(), Date.now());
    if (problem) throw DomainError.badRequest('INVALID_TIME_ENTRY', problem);

    const id = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const activity = await tx.activity.findFirst({ where: { id: dto.activityId, userId, deletedAt: null } });
      if (!activity) throw DomainError.notFound('Activity');
      await this.assertNoOverlap(tx, userId, dto.startedAt, dto.endedAt);
      const session = await tx.activitySession.create({
        data: {
          userId,
          activityId: activity.id,
          status: 'STOPPED',
          source: 'MANUAL',
          startedAt: dto.startedAt,
          endedAt: dto.endedAt,
          durationSec: wholeSeconds(dto.endedAt.getTime() - dto.startedAt.getTime()),
          note: dto.note ?? null,
          segments: { create: [{ userId, startedAt: dto.startedAt, endedAt: dto.endedAt }] },
        },
      });
      await this.recalcActivityActual(tx, activity.id);
      await this.audit.record(
        { userId, action: 'time-entry.manual-created', entityType: 'ActivitySession', entityId: session.id, after: { startedAt: dto.startedAt, endedAt: dto.endedAt, activityId: activity.id } },
        tx,
      );
      await this.outbox.add(tx, {
        type: DomainEventType.TimeEntryChanged,
        aggregateType: 'ActivitySession',
        aggregateId: session.id,
        userId,
        payload: { activityId: activity.id, sessionId: session.id, reason: 'manual.created', dates: localDatesInRange(pref.timezone, dto.startedAt, dto.endedAt) },
      });
      return session.id;
    });
    await this.afterCommit(userId);
    return this.getSession(userId, id);
  }

  async getSession(userId: string, id: string): Promise<TimeSessionDto> {
    const s = await this.prisma.activitySession.findFirst({ where: { id, userId }, include: SESSION_INCLUDE });
    if (!s) throw DomainError.notFound('Time entry');
    return toSessionDto(s, Date.now());
  }

  async listSessions(userId: string, q: SessionQueryDto): Promise<SessionListDto> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.ActivitySessionWhereInput = {
      userId,
      ...(q.activityId ? { activityId: q.activityId } : {}),
      ...(q.to ? { startedAt: { lt: q.to } } : {}),
      ...(q.from ? { OR: [{ endedAt: { gt: q.from } }, { endedAt: null }] } : {}),
    };
    const [rows, total, agg] = await Promise.all([
      this.prisma.activitySession.findMany({ where, include: SESSION_INCLUDE, orderBy: { startedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.activitySession.count({ where }),
      this.prisma.activitySession.aggregate({ where, _sum: { durationSec: true } }),
    ]);
    const now = Date.now();
    return { items: rows.map((r) => toSessionDto(r, now)), meta: pageMeta(page, pageSize, total), totalDurationSec: agg._sum.durationSec ?? 0 };
  }

  async correctSession(userId: string, id: string, dto: CorrectSessionDto): Promise<TimeSessionDto> {
    const pref = await this.users.preference(userId);
    const problem = validateEntryRange(dto.startedAt.getTime(), dto.endedAt.getTime(), Date.now());
    if (problem) throw DomainError.badRequest('INVALID_TIME_ENTRY', problem);

    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const session = await tx.activitySession.findFirst({ where: { id, userId }, include: SESSION_INCLUDE });
      if (!session) throw DomainError.notFound('Time entry');
      if (session.status !== 'STOPPED') {
        throw DomainError.conflict('TIMER_STILL_ACTIVE', 'Stop the timer before correcting this entry.');
      }
      await this.assertNoOverlap(tx, userId, dto.startedAt, dto.endedAt, session.id);
      const before = {
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSec: session.durationSec,
        note: session.note,
        segments: session.segments.map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt })),
      };
      const durationSec = wholeSeconds(dto.endedAt.getTime() - dto.startedAt.getTime());
      // The original segment structure is preserved in the audit entry; the entry itself
      // becomes one continuous corrected interval.
      await tx.sessionSegment.deleteMany({ where: { sessionId: session.id } });
      await tx.sessionSegment.create({ data: { sessionId: session.id, userId, startedAt: dto.startedAt, endedAt: dto.endedAt } });
      await tx.activitySession.update({
        where: { id: session.id },
        data: { startedAt: dto.startedAt, endedAt: dto.endedAt, durationSec, autoStopped: false, version: { increment: 1 }, ...(dto.note !== undefined ? { note: dto.note } : {}) },
      });
      await this.recalcActivityActual(tx, session.activityId);
      await this.audit.record(
        {
          userId,
          action: 'time-entry.corrected',
          entityType: 'ActivitySession',
          entityId: session.id,
          before,
          after: { startedAt: dto.startedAt, endedAt: dto.endedAt, durationSec, note: dto.note ?? session.note },
          metadata: { reason: dto.reason },
        },
        tx,
      );
      const dates = [
        ...new Set([
          ...localDatesInRange(pref.timezone, session.startedAt, session.endedAt ?? session.startedAt),
          ...localDatesInRange(pref.timezone, dto.startedAt, dto.endedAt),
        ]),
      ];
      await this.outbox.add(tx, {
        type: DomainEventType.TimeEntryChanged,
        aggregateType: 'ActivitySession',
        aggregateId: session.id,
        userId,
        payload: { activityId: session.activityId, sessionId: session.id, reason: 'corrected', dates },
      });
    });
    await this.afterCommit(userId);
    return this.getSession(userId, id);
  }

  async deleteSession(userId: string, id: string, reason: string): Promise<void> {
    const pref = await this.users.preference(userId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const session = await tx.activitySession.findFirst({ where: { id, userId }, include: SESSION_INCLUDE });
      if (!session) throw DomainError.notFound('Time entry');
      if (session.status !== 'STOPPED') {
        throw DomainError.conflict('TIMER_STILL_ACTIVE', 'Stop the timer before deleting this entry.');
      }
      // The row is removed, but its full content stays in the append-only audit trail.
      await this.audit.record(
        {
          userId,
          action: 'time-entry.deleted',
          entityType: 'ActivitySession',
          entityId: session.id,
          before: {
            activityId: session.activityId,
            activityTitle: session.activity.title,
            source: session.source,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            durationSec: session.durationSec,
            note: session.note,
            segments: session.segments.map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt })),
          },
          metadata: { reason },
        },
        tx,
      );
      await tx.activitySession.delete({ where: { id: session.id } });
      await this.recalcActivityActual(tx, session.activityId);
      await this.outbox.add(tx, {
        type: DomainEventType.TimeEntryChanged,
        aggregateType: 'ActivitySession',
        aggregateId: session.id,
        userId,
        payload: { activityId: session.activityId, reason: 'deleted', dates: localDatesInRange(pref.timezone, session.startedAt, session.endedAt ?? session.startedAt) },
      });
    });
    await this.afterCommit(userId);
  }

  async corrections(userId: string, sessionId: string): Promise<CorrectionDto[]> {
    const rows = await this.audit.list(userId, 'ActivitySession', sessionId);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      reason: ((r.metadata as { reason?: string } | null)?.reason ?? null) as string | null,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt,
    }));
  }

  // ── background checks for forgotten timers ─────────────────────────────────

  private async handleLongRunning(job: TimerJob): Promise<void> {
    const segment = await this.prisma.sessionSegment.findUnique({
      where: { id: job.segmentId },
      include: { session: { include: { activity: { select: { title: true } } } } },
    });
    if (!segment || segment.endedAt !== null) return; // paused or stopped in the meantime
    await this.notifications.notify(job.userId, {
      type: 'TIMER_LONG_RUNNING',
      title: 'Your timer is still running',
      body: `"${segment.session.activity.title}" has been running for ${formatDuration(LONG_RUNNING_NOTICE_MS / 1000)} without a pause. Still on it?`,
      href: '/time-tracking',
      dedupeKey: `timer-long:${segment.id}`,
    });
  }

  private async handleAbandoned(job: TimerJob): Promise<void> {
    const pref = await this.users.preference(job.userId).catch(() => null);
    if (!pref) return;
    const closedTitle = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, job.userId);
      const session = await tx.activitySession.findFirst({ where: { id: job.sessionId, userId: job.userId }, include: SESSION_INCLUDE });
      const open = session?.segments.find((s) => s.id === job.segmentId && s.endedAt === null);
      if (!session || !open || session.status !== 'RUNNING') return null;
      const cutoff = new Date(abandonedCutoff(open.startedAt.getTime()));
      const events = await this.closeSession(tx, session, cutoff, pref.timezone, { autoStopped: true });
      for (const e of events) await this.outbox.add(tx, e);
      await this.audit.record(
        { userId: job.userId, actor: 'system', action: 'time-entry.auto-stopped', entityType: 'ActivitySession', entityId: session.id, metadata: { reason: 'Timer left running for 12 hours', cutoff } },
        tx,
      );
      return session.activity.title;
    });
    if (!closedTitle) return;
    await this.afterCommit(job.userId);
    this.logger.log(`Auto-stopped abandoned timer session ${job.sessionId}`);
    await this.notifications.notify(job.userId, {
      type: 'TIMER_LONG_RUNNING',
      title: 'A forgotten timer was stopped',
      body: `"${closedTitle}" ran for 12 hours without a pause, so it was stopped automatically. Please correct its end time.`,
      href: '/time-tracking',
      dedupeKey: `timer-abandoned:${job.segmentId}`,
    });
  }
}
