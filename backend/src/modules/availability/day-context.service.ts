import { Injectable } from '@nestjs/common';
import { Activity, ActivityCategory, RecurrenceRule, ScheduleEvent, UserPreference } from '@prisma/client';
import { Interval, mergeIntervals } from '@/common/time/intervals';
import {
  addDays,
  dateColumnToLocalDate,
  diffDays,
  isoWeekday,
  LocalDate,
  localDayRange,
  localMinuteToInstant,
  MS_PER_MINUTE,
  toLocalDate,
} from '@/common/time/time';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { UsersService } from '../users/users.service';
import { ActiveTimerInfo, AvailabilityInput, PlannedBlock, TimeClassKey } from './domain/availability-engine';
import { expandOccurrences, RecurrenceSpec } from './domain/recurrence';

export type ActivityRow = Activity & { category: ActivityCategory };
export type ScheduleEventRow = ScheduleEvent & { category: ActivityCategory; recurrenceRule: RecurrenceRule };

export interface OccurrenceView extends Interval {
  /** `${eventId}:${date}` */
  id: string;
  eventId: string;
  date: LocalDate;
  event: ScheduleEventRow;
}

export interface SegmentView extends Interval {
  id: string;
  sessionId: string;
  activityId: string;
  open: boolean;
}

export interface DayContext {
  userId: string;
  date: LocalDate;
  today: LocalDate;
  timezone: string;
  range: Interval;
  now: number;
  pref: UserPreference;
  activeHours: Interval[];
  blocked: Interval[];
  hasExplicitAvailability: boolean;
  categories: ActivityCategory[];
  /** Planned in the range, or tracked in the range. Soft-deleted rows only appear when tracked. */
  activities: ActivityRow[];
  /** Recurring occurrences that are not materialised as activities. */
  occurrences: OccurrenceView[];
  segments: SegmentView[];
  pauseCountBySession: Record<string, number>;
  activeTimer: ActiveTimerInfo | null;
}

export function toRecurrenceSpec(rule: RecurrenceRule): RecurrenceSpec {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    byWeekday: rule.byWeekday,
    byMonthDay: rule.byMonthDay,
    startDate: dateColumnToLocalDate(rule.startDate),
    untilDate: rule.untilDate ? dateColumnToLocalDate(rule.untilDate) : null,
    count: rule.count,
    exDates: rule.exDates.map(dateColumnToLocalDate),
  };
}

/**
 * Loads everything the engines need for one or more local days with a fixed number of
 * queries (independent of the number of days) and slices it per day in memory.
 */
@Injectable()
export class DayContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly timers: TimeTrackingService,
  ) {}

  async load(userId: string, date: LocalDate, now = Date.now()): Promise<DayContext> {
    const map = await this.loadDays(userId, [date], now);
    return map.get(date)!;
  }

  async today(userId: string, now = Date.now()): Promise<LocalDate> {
    const pref = await this.users.preference(userId);
    return toLocalDate(now, pref.timezone);
  }

  async loadDays(userId: string, dates: LocalDate[], now = Date.now(), prefOverride?: UserPreference): Promise<Map<LocalDate, DayContext>> {
    const out = new Map<LocalDate, DayContext>();
    if (dates.length === 0) return out;
    const pref = prefOverride ?? (await this.users.preference(userId));
    const tz = pref.timezone;
    const sorted = [...new Set(dates)].sort();
    const ranges = new Map(sorted.map((d) => [d, localDayRange(d, tz)]));
    const overall: Interval = { start: ranges.get(sorted[0]!)!.start, end: ranges.get(sorted[sorted.length - 1]!)!.end };
    const from = new Date(overall.start);
    const to = new Date(overall.end);
    const today = toLocalDate(now, tz);

    const [categories, availability, planned, segmentRows, events, activeTimer] = await Promise.all([
      this.prisma.activityCategory.findMany({ where: { userId }, orderBy: { position: 'asc' } }),
      this.prisma.userAvailability.findMany({ where: { userId } }),
      this.prisma.activity.findMany({
        where: { userId, deletedAt: null, status: { not: 'CANCELLED' }, plannedStart: { lt: to }, plannedEnd: { gt: from } },
        include: { category: true },
      }),
      this.prisma.sessionSegment.findMany({
        where: { userId, startedAt: { lt: to }, OR: [{ endedAt: { gt: from } }, { endedAt: null }] },
        include: { session: { select: { id: true, activityId: true, pauseCount: true } } },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.scheduleEvent.findMany({
        where: { userId, isActive: true, schedule: { isActive: true } },
        include: { category: true, recurrenceRule: true },
      }),
      sorted.includes(today) ? this.timers.activeTimerInfo(userId, now) : Promise.resolve(null),
    ]);

    // Activities that were tracked in the range but are not in the planned set (ad-hoc, moved, deleted).
    const plannedIds = new Set(planned.map((a) => a.id));
    const missingIds = [...new Set(segmentRows.map((s) => s.session.activityId))].filter((id) => !plannedIds.has(id));
    const extra = missingIds.length
      ? await this.prisma.activity.findMany({ where: { id: { in: missingIds }, userId }, include: { category: true } })
      : [];
    const activities: ActivityRow[] = [...planned, ...extra];

    // Recurring occurrences, minus the ones that already exist as real activities.
    const allOccurrences: OccurrenceView[] = [];
    for (const event of events) {
      for (const occ of expandOccurrences(
        { id: event.id, startMinute: event.startMinute, durationMin: event.durationMin, rule: toRecurrenceSpec(event.recurrenceRule) },
        overall,
        tz,
      )) {
        allOccurrences.push({ id: `${event.id}:${occ.date}`, eventId: event.id, date: occ.date, start: occ.start, end: occ.end, event });
      }
    }
    let occurrences = allOccurrences;
    if (allOccurrences.length) {
      const materialised = await this.prisma.activity.findMany({
        where: { userId, scheduleEventId: { in: [...new Set(allOccurrences.map((o) => o.eventId))] }, occurrenceDate: { not: null } },
        select: { scheduleEventId: true, occurrenceDate: true },
      });
      const taken = new Set(materialised.map((m) => `${m.scheduleEventId}:${dateColumnToLocalDate(m.occurrenceDate as Date)}`));
      occurrences = allOccurrences.filter((o) => !taken.has(o.id));
    }

    const segments: SegmentView[] = segmentRows.map((s) => ({
      id: s.id,
      sessionId: s.session.id,
      activityId: s.session.activityId,
      start: s.startedAt.getTime(),
      end: s.endedAt ? s.endedAt.getTime() : Math.max(now, s.startedAt.getTime()),
      open: s.endedAt === null,
    }));
    const pauseCountBySession: Record<string, number> = {};
    for (const s of segmentRows) pauseCountBySession[s.session.id] = s.session.pauseCount;

    const hasExplicit = availability.some((a) => a.kind === 'AVAILABLE');

    for (const date of sorted) {
      const range = ranges.get(date)!;
      const weekday = isoWeekday(date);
      const toInstants = (rows: typeof availability): Interval[] =>
        rows
          .filter((r) => r.weekday === weekday)
          .map((r) => ({ start: localMinuteToInstant(date, r.startMinute, tz), end: localMinuteToInstant(date, r.endMinute, tz) }))
          .filter((i) => i.end > i.start);
      const activeHours = hasExplicit
        ? mergeIntervals(toInstants(availability.filter((a) => a.kind === 'AVAILABLE')))
        : [{ start: localMinuteToInstant(date, pref.dayStartMinute, tz), end: localMinuteToInstant(date, pref.dayEndMinute, tz) }];
      const overlapsDay = (i: Interval) => i.start < range.end && i.end > range.start;
      const daySegments = segments.filter(overlapsDay);
      const trackedIds = new Set(daySegments.map((s) => s.activityId));

      out.set(date, {
        userId,
        date,
        today,
        timezone: tz,
        range,
        now,
        pref,
        activeHours,
        blocked: mergeIntervals(toInstants(availability.filter((a) => a.kind === 'BLOCKED'))),
        hasExplicitAvailability: hasExplicit,
        categories,
        activities: activities.filter(
          (a) =>
            trackedIds.has(a.id) ||
            (a.deletedAt === null && a.plannedStart !== null && a.plannedEnd !== null && overlapsDay({ start: a.plannedStart.getTime(), end: a.plannedEnd.getTime() })),
        ),
        occurrences: occurrences.filter(overlapsDay),
        segments: daySegments,
        pauseCountBySession,
        activeTimer: date === today ? activeTimer : null,
      });
    }
    return out;
  }

  /** Planned blocks (activities + recurring occurrences) in the shape the engine expects. */
  plannedBlocks(ctx: DayContext): PlannedBlock[] {
    const blocks: PlannedBlock[] = [];
    for (const a of ctx.activities) {
      if (a.deletedAt || !a.plannedStart || !a.plannedEnd || a.status === 'CANCELLED') continue;
      blocks.push({
        id: a.id,
        kind: 'ACTIVITY',
        title: a.title,
        start: a.plannedStart.getTime(),
        end: a.plannedEnd.getTime(),
        categoryKey: a.category.key,
        timeClass: a.category.timeClass as TimeClassKey,
        isFixed: a.isFixed,
        isCommitment: a.category.isCommitment,
        done: a.status === 'COMPLETED' || a.status === 'SKIPPED',
      });
    }
    for (const o of ctx.occurrences) {
      blocks.push({
        id: o.id,
        kind: 'RECURRING',
        title: o.event.title,
        start: o.start,
        end: o.end,
        categoryKey: o.event.category.key,
        timeClass: o.event.category.timeClass as TimeClassKey,
        isFixed: o.event.isFixed,
        isCommitment: o.event.category.isCommitment,
        done: false,
      });
    }
    return blocks;
  }

  toAvailabilityInput(ctx: DayContext, overrunRatioByCategory: Record<string, number>): AvailabilityInput {
    return {
      range: ctx.range,
      now: ctx.now,
      activeHours: ctx.activeHours,
      hasExplicitAvailability: ctx.hasExplicitAvailability,
      blocked: ctx.blocked,
      planned: this.plannedBlocks(ctx),
      tracked: ctx.segments.map((s) => ({ start: s.start, end: s.end, activityId: s.activityId })),
      activeTimer: ctx.activeTimer,
      bufferMs: ctx.pref.bufferMinutes * MS_PER_MINUTE,
      minSlotMs: ctx.pref.minSlotMinutes * MS_PER_MINUTE,
      daysAhead: Math.max(0, diffDays(ctx.today, ctx.date)),
      overrunRatioByCategory,
    };
  }

  /** Convenience for callers that need N consecutive days starting at `from`. */
  consecutive(from: LocalDate, days: number): LocalDate[] {
    return Array.from({ length: days }, (_, i) => addDays(from, i));
  }
}
