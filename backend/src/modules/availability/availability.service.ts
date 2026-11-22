import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@/common/http/errors';
import { diffDays, eachLocalDate, LocalDate, localDateToDateColumn, MS_PER_MINUTE } from '@/common/time/time';
import { DomainEvent, DomainEventType } from '@/infrastructure/events/domain-events';
import { OutboxService } from '@/infrastructure/events/outbox.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import {
  AvailabilityDayDto,
  AvailabilityRangeDayDto,
  ConflictDto,
  PlannedBlockDto,
  SlotDto,
} from './availability.dto';
import { DayContext, DayContextService } from './day-context.service';
import { AvailabilityResult, computeAvailability } from './domain/availability-engine';
import { HistoryService } from './history.service';

const d = (ms: number): Date => new Date(ms);
const MAX_RANGE_DAYS = 31;

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dayContext: DayContextService,
    private readonly history: HistoryService,
    private readonly outbox: OutboxService,
  ) {
    // Anything that changes the plan or the tracked reality refreshes the stored snapshot.
    this.outbox.on(
      [
        DomainEventType.ActivityCreated,
        DomainEventType.ActivityStarted,
        DomainEventType.ActivityPaused,
        DomainEventType.ActivityCompleted,
        DomainEventType.ScheduleChanged,
        DomainEventType.TimeEntryChanged,
      ],
      'availability.recalculate',
      (e) => this.onScheduleEvent(e),
    );
  }

  /** Engine result for an already-loaded day (shared by recommendations, scheduling, coach). */
  async compute(ctx: DayContext): Promise<AvailabilityResult> {
    const overrun = await this.history.reliableOverrunRatios(ctx.userId);
    return computeAvailability(this.dayContext.toAvailabilityInput(ctx, overrun));
  }

  private blocks(ctx: DayContext): PlannedBlockDto[] {
    const out: PlannedBlockDto[] = [];
    for (const a of ctx.activities) {
      if (a.deletedAt || !a.plannedStart || !a.plannedEnd) continue;
      out.push({
        id: a.id,
        kind: 'ACTIVITY',
        title: a.title,
        start: a.plannedStart,
        end: a.plannedEnd,
        categoryKey: a.category.key,
        categoryName: a.category.name,
        color: a.category.color,
        isFixed: a.isFixed,
        done: a.status === 'COMPLETED' || a.status === 'SKIPPED',
        status: a.status,
        actualDurationSec: a.actualDurationSec,
        scheduleEventId: a.scheduleEventId,
        taskId: a.taskId,
      });
    }
    for (const o of ctx.occurrences) {
      out.push({
        id: o.id,
        kind: 'RECURRING',
        title: o.event.title,
        start: d(o.start),
        end: d(o.end),
        categoryKey: o.event.category.key,
        categoryName: o.event.category.name,
        color: o.event.category.color,
        isFixed: o.event.isFixed,
        done: false,
        status: null,
        actualDurationSec: 0,
        scheduleEventId: o.eventId,
        taskId: null,
      });
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  toDto(ctx: DayContext, r: AvailabilityResult): AvailabilityDayDto {
    return {
      date: ctx.date,
      timezone: ctx.timezone,
      range: { start: d(r.range.start), end: d(r.range.end) },
      now: d(ctx.now),
      isToday: ctx.date === ctx.today,
      activeHours: ctx.activeHours.map((i) => ({ start: d(i.start), end: d(i.end) })),
      hasExplicitAvailability: ctx.hasExplicitAvailability,
      windows: r.windows.map((w) => ({ ...w, start: d(w.start), end: d(w.end) })),
      conflicts: r.conflicts.map((c) => ({ ...c, start: d(c.start), end: d(c.end) })),
      strip: r.strip.map((s) => ({ start: d(s.start), end: d(s.end), state: s.state })),
      blocks: this.blocks(ctx),
      summary: r.summary,
    };
  }

  async day(userId: string, date?: LocalDate): Promise<AvailabilityDayDto> {
    const target = date ?? (await this.dayContext.today(userId));
    const ctx = await this.dayContext.load(userId, target);
    return this.toDto(ctx, await this.compute(ctx));
  }

  private assertRange(from: LocalDate, to: LocalDate): LocalDate[] {
    const n = diffDays(from, to);
    if (n < 0) throw DomainError.badRequest('INVALID_RANGE', '"to" must not be before "from".');
    if (n >= MAX_RANGE_DAYS) throw DomainError.badRequest('INVALID_RANGE', `A range can cover at most ${MAX_RANGE_DAYS} days.`);
    return eachLocalDate(from, to);
  }

  async range(userId: string, from: LocalDate, to: LocalDate): Promise<AvailabilityRangeDayDto[]> {
    const dates = this.assertRange(from, to);
    const [contexts, overrun] = await Promise.all([this.dayContext.loadDays(userId, dates), this.history.reliableOverrunRatios(userId)]);
    return dates.map((date) => {
      const r = computeAvailability(this.dayContext.toAvailabilityInput(contexts.get(date)!, overrun));
      return {
        date,
        summary: r.summary,
        windowCount: r.windows.length,
        longestWindowSec: r.windows.reduce((m, w) => Math.max(m, w.durationSec), 0),
      };
    });
  }

  async conflicts(userId: string, from: LocalDate, to: LocalDate): Promise<ConflictDto[]> {
    const dates = this.assertRange(from, to);
    const contexts = await this.dayContext.loadDays(userId, dates);
    const seen = new Set<string>();
    const out: ConflictDto[] = [];
    for (const date of dates) {
      const r = computeAvailability(this.dayContext.toAvailabilityInput(contexts.get(date)!, {}));
      for (const c of r.conflicts) {
        // A conflict crossing midnight shows up on both days; report it once.
        const key = [c.aId, c.bId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...c, start: d(c.start), end: d(c.end) });
      }
    }
    return out;
  }

  /** Candidate slots for a duration over the next days — one per free window, earliest first. */
  async slots(userId: string, durationMin: number, from?: LocalDate, days = 3): Promise<SlotDto[]> {
    const start = from ?? (await this.dayContext.today(userId));
    const dates = this.dayContext.consecutive(start, days);
    const [contexts, overrun] = await Promise.all([this.dayContext.loadDays(userId, dates), this.history.reliableOverrunRatios(userId)]);
    const need = durationMin * MS_PER_MINUTE;
    const out: SlotDto[] = [];
    for (const date of dates) {
      const r = computeAvailability(this.dayContext.toAvailabilityInput(contexts.get(date)!, overrun));
      for (const w of r.windows) {
        if (w.end - w.start < need) continue;
        out.push({
          date,
          start: d(w.start),
          end: d(w.start + need),
          windowStart: d(w.start),
          windowEnd: d(w.end),
          confidenceScore: w.confidenceScore,
          confidence: w.confidence,
        });
      }
    }
    return out;
  }

  // ── snapshot maintenance (event driven) ────────────────────────────────────

  private async onScheduleEvent(event: DomainEvent): Promise<void> {
    const today = await this.dayContext.today(event.userId);
    const dates = (event.payload.dates ?? []).filter((x) => x >= today).slice(0, 14);
    if (dates.length === 0) return;
    // Everything read from here on is at least as new as this instant. If another handler stores a
    // snapshot computed after it, ours is stale and must not overwrite it.
    const startedAt = new Date();
    const [contexts, overrun] = await Promise.all([
      this.dayContext.loadDays(event.userId, dates),
      this.history.reliableOverrunRatios(event.userId),
    ]);
    const results = dates.map((date) => ({ date, r: computeAvailability(this.dayContext.toAvailabilityInput(contexts.get(date)!, overrun)) }));
    await this.prisma.$transaction(async (tx) => {
      for (const { date, r } of results) {
        const column = localDateToDateColumn(date);
        // Serialise concurrent rewrites of the same user/day (replace = delete + insert).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`availability:${event.userId}:${date}`}, 0))`;
        const newer = await tx.availabilityWindow.findFirst({ where: { userId: event.userId, date: column, computedAt: { gt: startedAt } }, select: { id: true } });
        if (newer) continue;
        await tx.availabilityWindow.deleteMany({ where: { userId: event.userId, date: column } });
        if (r.windows.length) {
          await tx.availabilityWindow.createMany({
            data: r.windows.map((w) => ({
              userId: event.userId,
              date: column,
              startsAt: d(w.start),
              endsAt: d(w.end),
              durationSec: w.durationSec,
              confidence: w.confidence,
              confidenceScore: w.confidenceScore,
              computedAt: startedAt,
            })),
          });
        }
      }
      await this.outbox.add(tx, {
        type: DomainEventType.AvailabilityRecalculated,
        aggregateType: 'AvailabilityWindow',
        aggregateId: event.userId,
        userId: event.userId,
        payload: { dates, causedBy: event.type },
      });
    });
    void this.outbox.kick();
  }
}
