import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '@/common/http/errors';
import { LEVEL_VALUE } from '@/common/levels';
import { subtractIntervals } from '@/common/time/intervals';
import { addDays, LocalDate, MS_PER_MINUTE } from '@/common/time/time';
import { DomainEventType } from '@/infrastructure/events/domain-events';
import { OutboxService } from '@/infrastructure/events/outbox.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { DayContextService } from '../availability/day-context.service';
import { HistoryService } from '../availability/history.service';
import { EnergyService } from '../scheduling/energy.service';
import { TasksService } from '../tasks/tasks.service';
import { CandidateWindow, ExcludedTask, FactorScore, recommendTasks, UserState } from './domain/scoring';
import {
  AcceptResultDto,
  GenerateRecommendationsDto,
  NextActionDto,
  RecommendationBatchDto,
  RecommendationDto,
} from './recommendations.dto';

const REC_INCLUDE = { task: { include: { category: true } } } satisfies Prisma.RecommendationInclude;
type RecRow = Prisma.RecommendationGetPayload<{ include: typeof REC_INCLUDE }>;

/** A batch younger than this is reused by "next action" instead of recomputing. */
const FRESH_MS = 5 * MS_PER_MINUTE;

interface StoredBreakdown {
  factors: FactorScore[];
  summary: string;
}

function toDto(r: RecRow): RecommendationDto {
  const stored = r.breakdown as unknown as StoredBreakdown;
  return {
    id: r.id,
    taskId: r.taskId,
    title: r.task.title,
    score: r.score,
    confidence: r.confidence,
    reasons: r.reasons,
    summary: stored.summary,
    estimatedDurationSec: r.estimatedDurationSec,
    suitableWindow: { start: r.windowStart, end: r.windowEnd },
    breakdown: stored.factors,
    status: r.status,
    generatedAt: r.generatedAt,
    priority: r.task.priority,
    deadline: r.task.deadline,
    categoryName: r.task.category?.name ?? null,
    categoryColor: r.task.category?.color ?? null,
  };
}

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dayContext: DayContextService,
    private readonly availability: AvailabilityService,
    private readonly history: HistoryService,
    private readonly energy: EnergyService,
    private readonly tasks: TasksService,
    private readonly outbox: OutboxService,
  ) {}

  async generate(userId: string, dto: GenerateRecommendationsDto): Promise<RecommendationBatchDto> {
    const date: LocalDate = dto.date ?? (await this.dayContext.today(userId));
    const ctx = await this.dayContext.load(userId, date);
    if (date < ctx.today) throw DomainError.badRequest('DATE_IN_PAST', 'Recommendations can only be generated for today or later.');
    const now = ctx.now;

    const [availability, history, measured, forecast, candidates] = await Promise.all([
      this.availability.compute(ctx),
      this.history.get(userId),
      this.energy.stateNow(userId, now),
      this.energy.forecast(userId),
      this.tasks.candidates(userId, now),
    ]);

    // An explicit level in the request wins over anything measured or forecast.
    const user: UserState =
      dto.energy || dto.focus
        ? {
            energy: dto.energy ? LEVEL_VALUE[dto.energy] : measured.energy,
            focus: dto.focus ? LEVEL_VALUE[dto.focus] : measured.focus,
            source: 'LOGGED',
          }
        : { energy: measured.energy, focus: measured.focus, source: measured.source };

    let windows: CandidateWindow[] = availability.windows.map((w) => ({ start: w.start, end: w.end, confidenceScore: w.confidenceScore }));
    let usedDeclaredTime = false;
    if (dto.availableMinutes && date === ctx.today) {
      // "I have N minutes" is the strongest signal there is, so it overrides the configured active
      // hours — but never a real commitment: planned blocks, an active timer, buffers and time the
      // user marked as blocked still cut the window.
      const offered = windows;
      const declared = { start: now, end: now + dto.availableMinutes * MS_PER_MINUTE };
      const occupied = availability.strip.filter((s) => s.state === 'BUSY' || s.state === 'BUFFER' || s.state === 'BLOCKED');
      const minSlotMs = ctx.pref.minSlotMinutes * MS_PER_MINUTE;
      windows = subtractIntervals([declared], occupied)
        .filter((w) => w.end - w.start >= minSlotMs)
        .map((w) => {
          // Inside an offered window we know how sure the calendar is; outside it, only the user's word.
          const inside = offered.find((o) => o.start <= w.start && o.end > w.start);
          if (!inside) usedDeclaredTime = true;
          return { start: w.start, end: w.end, confidenceScore: inside ? inside.confidenceScore : 60 };
        });
    }

    const result = recommendTasks(candidates, {
      now,
      timezone: ctx.timezone,
      windows,
      user,
      energyAtHour: (hour) => forecast.hours[hour]?.energy ?? null,
      history,
      maxDurationSec: dto.availableMinutes ? dto.availableMinutes * 60 : undefined,
      limit: dto.limit ?? 5,
    });

    const generatedAt = new Date(now);
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.recommendation.updateMany({ where: { userId, status: 'GENERATED' }, data: { status: 'EXPIRED', resolvedAt: generatedAt } });
      const created: RecRow[] = [];
      for (const rec of result.recommendations) {
        created.push(
          await tx.recommendation.create({
            data: {
              userId,
              taskId: rec.taskId,
              score: rec.score,
              confidence: rec.confidence,
              reasons: rec.reasons,
              breakdown: { factors: rec.breakdown, summary: rec.summary } as unknown as Prisma.InputJsonValue,
              estimatedDurationSec: rec.estimatedDurationSec,
              windowStart: new Date(rec.suitableWindow.start),
              windowEnd: new Date(rec.suitableWindow.end),
              generatedAt,
            },
            include: REC_INCLUDE,
          }),
        );
      }
      await this.outbox.add(tx, {
        type: DomainEventType.RecommendationGenerated,
        aggregateType: 'Recommendation',
        aggregateId: userId,
        userId,
        payload: { count: created.length, top: created[0]?.taskId ?? null },
      });
      return created;
    });
    void this.outbox.kick();

    return {
      generatedAt,
      recommendations: rows.map(toDto),
      excluded: result.excluded,
      userState: { energy: user.energy, focus: user.focus, source: user.source, recordedAt: measured.recordedAt },
      windowCount: windows.length,
      usedDeclaredTime,
    };
  }

  /** The most recently generated batch that is still open. */
  async latest(userId: string): Promise<RecommendationBatchDto> {
    const newest = await this.prisma.recommendation.findFirst({
      where: { userId, status: 'GENERATED' },
      orderBy: { generatedAt: 'desc' },
      select: { generatedAt: true },
    });
    const measured = await this.energy.stateNow(userId);
    const rows = newest
      ? await this.prisma.recommendation.findMany({
          where: { userId, status: 'GENERATED', generatedAt: newest.generatedAt },
          include: REC_INCLUDE,
          orderBy: [{ score: 'desc' }, { id: 'asc' }],
        })
      : [];
    return {
      generatedAt: newest?.generatedAt ?? null,
      recommendations: rows.map(toDto),
      excluded: [] as ExcludedTask[],
      userState: measured,
      windowCount: 0,
      usedDeclaredTime: false,
    };
  }

  /** Single best next action for the dashboard. Reuses a fresh batch, otherwise regenerates. */
  async next(userId: string): Promise<NextActionDto> {
    const now = Date.now();
    const fresh = await this.prisma.recommendation.findFirst({
      where: {
        userId,
        status: 'GENERATED',
        generatedAt: { gte: new Date(now - FRESH_MS) },
        windowEnd: { gt: new Date(now) },
        task: { deletedAt: null, status: { in: ['TODO', 'IN_PROGRESS'] } },
      },
      include: REC_INCLUDE,
      orderBy: [{ generatedAt: 'desc' }, { score: 'desc' }],
    });
    if (fresh) return { recommendation: toDto(fresh), emptyReason: null };

    let batch = await this.generate(userId, { limit: 3 });
    if (batch.recommendations[0]) return { recommendation: batch.recommendations[0], emptyReason: null };

    // Nothing fits today because no free time is left: look ahead instead of returning an empty card.
    // The recommendation carries its own window, so the client shows which day it is for.
    let searchedAhead = false;
    if (batch.windowCount === 0 && batch.excluded.length > 0) {
      const today = await this.dayContext.today(userId);
      for (const offset of [1, 2]) {
        searchedAhead = true;
        batch = await this.generate(userId, { limit: 3, date: addDays(today, offset) });
        if (batch.recommendations[0]) return { recommendation: batch.recommendations[0], emptyReason: null };
      }
    }

    let emptyReason: string;
    if (batch.excluded.length === 0) emptyReason = 'You have no open tasks. Add a task to get a recommendation.';
    else if (batch.windowCount === 0) emptyReason = searchedAhead ? 'There is no free window today or in the next two days.' : 'There is no free window left today, so nothing can be recommended right now.';
    else if (batch.excluded.every((e) => e.code === 'NO_WINDOW')) emptyReason = 'None of your open tasks fits into the free time that is left today.';
    else if (batch.excluded.every((e) => e.code === 'ALREADY_SCHEDULED')) emptyReason = 'Every open task already has a scheduled work block.';
    else emptyReason = 'No open task is actionable right now (blocked, in the backlog or already scheduled).';
    return { recommendation: null, emptyReason };
  }

  private async findOpen(userId: string, id: string): Promise<RecRow> {
    const rec = await this.prisma.recommendation.findFirst({ where: { id, userId }, include: REC_INCLUDE });
    if (!rec) throw DomainError.notFound('Recommendation');
    if (rec.status !== 'GENERATED') {
      throw DomainError.conflict('RECOMMENDATION_RESOLVED', `This recommendation was already ${rec.status.toLowerCase()}.`);
    }
    return rec;
  }

  /** Accepting schedules the task into its suggested window. */
  async accept(userId: string, id: string): Promise<AcceptResultDto> {
    const rec = await this.findOpen(userId, id);
    const now = Date.now();
    const durationMs = rec.estimatedDurationSec * 1000;
    const start = Math.max(now, rec.windowStart.getTime());
    // The slot was computed for windowStart; if time has passed, it must still be plausible.
    if (start - rec.windowStart.getTime() > 30 * MS_PER_MINUTE) {
      await this.prisma.recommendation.update({ where: { id }, data: { status: 'EXPIRED', resolvedAt: new Date(now) } });
      throw DomainError.conflict('RECOMMENDATION_EXPIRED', 'This suggestion is out of date. Generate fresh recommendations.');
    }
    // Round the start up to the next whole minute so the block has clean edges.
    const cleanStart = Math.ceil(start / MS_PER_MINUTE) * MS_PER_MINUTE;
    const activity = await this.tasks.schedule(userId, rec.taskId, { start: new Date(cleanStart), end: new Date(cleanStart + durationMs) });
    const updated = await this.prisma.recommendation.update({
      where: { id },
      data: { status: 'ACCEPTED', resolvedAt: new Date() },
      include: REC_INCLUDE,
    });
    return { recommendation: toDto(updated), activity };
  }

  async dismiss(userId: string, id: string): Promise<RecommendationDto> {
    await this.findOpen(userId, id);
    const updated = await this.prisma.recommendation.update({
      where: { id },
      data: { status: 'DISMISSED', resolvedAt: new Date() },
      include: REC_INCLUDE,
    });
    return toDto(updated);
  }
}
