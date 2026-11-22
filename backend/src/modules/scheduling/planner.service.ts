import { Injectable } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { DomainError } from '@/common/http/errors';
import { LocalDate, MS_PER_MINUTE } from '@/common/time/time';
import { ActivityDto } from '../activities/activities.dto';
import { AvailabilityService } from '../availability/availability.service';
import { DayContextService } from '../availability/day-context.service';
import { HistoryService } from '../availability/history.service';
import { predictDurationSec } from '../recommendations/domain/scoring';
import { TasksService } from '../tasks/tasks.service';
import { planDay } from './domain/planner';
import { EnergyService } from './energy.service';
import { ApplyBlockDto, ApplyFailureDto, ApplyPlanResultDto, PlanDto, PlanRequestDto } from './scheduling.dto';

const BREAK_MS = 10 * MS_PER_MINUTE;

@Injectable()
export class PlannerService {
  constructor(
    private readonly dayContext: DayContextService,
    private readonly availability: AvailabilityService,
    private readonly history: HistoryService,
    private readonly energy: EnergyService,
    private readonly tasks: TasksService,
  ) {}

  /** Build an energy-aware proposal for a day. Read-only. */
  async plan(userId: string, dto: PlanRequestDto): Promise<PlanDto> {
    const date: LocalDate = dto.date ?? (await this.dayContext.today(userId));
    const ctx = await this.dayContext.load(userId, date);
    if (date < ctx.today) throw DomainError.badRequest('DATE_IN_PAST', 'A past day cannot be planned.');

    const [availability, history, forecast, candidates] = await Promise.all([
      this.availability.compute(ctx),
      this.history.get(userId),
      this.energy.forecast(userId),
      this.tasks.candidates(userId, ctx.now),
    ]);

    const wanted = dto.taskIds ? new Set(dto.taskIds) : null;
    const eligible = candidates.filter(
      (t) =>
        (wanted ? wanted.has(t.id) : t.status !== 'BACKLOG') &&
        t.blockedBy.length === 0 &&
        !t.alreadyScheduled,
    );

    const result = planDay({
      now: ctx.now,
      timezone: ctx.timezone,
      windows: availability.windows,
      busy: this.dayContext.plannedBlocks(ctx).filter((b) => !b.done),
      tasks: eligible.map((t) => ({
        id: t.id,
        title: t.title,
        durationSec: predictDurationSec(t, history).sec,
        priority: t.priority,
        deadline: t.deadline,
        energyRequired: t.energyRequired,
        focusRequired: t.focusRequired,
        preferredTimeOfDay: t.preferredTimeOfDay,
      })),
      energyByHour: forecast.hours,
      breakAfterMs: ctx.pref.breakAfterMinutes * MS_PER_MINUTE,
      breakMs: BREAK_MS,
    });

    return {
      date,
      timezone: ctx.timezone,
      blocks: result.blocks.map((b) => ({ ...b, start: new Date(b.start), end: new Date(b.end) })),
      breaks: result.breaks.map((b) => ({ ...b, start: new Date(b.start), end: new Date(b.end) })),
      unscheduled: result.unscheduled,
      scheduledSec: result.scheduledSec,
      freeSec: availability.summary.freeSec,
      energyUnknown: result.energyUnknown,
      energyConfidence: forecast.confidence,
      consideredTasks: eligible.length,
    };
  }

  /**
   * Persist blocks chosen from a proposal. Every block is re-validated by the task service
   * (the plan may be stale by the time the user applies it); failures are reported per block.
   */
  async apply(userId: string, blocks: ApplyBlockDto[]): Promise<ApplyPlanResultDto> {
    const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.start.getTime() < sorted[i - 1]!.end.getTime()) {
        throw DomainError.badRequest('PLAN_BLOCKS_OVERLAP', 'Two blocks in the plan overlap each other.');
      }
    }
    if (new Set(blocks.map((b) => b.taskId)).size !== blocks.length) {
      throw DomainError.badRequest('PLAN_DUPLICATE_TASK', 'A task appears more than once in the plan.');
    }
    const created: ActivityDto[] = [];
    const failed: ApplyFailureDto[] = [];
    for (const block of sorted) {
      try {
        created.push(await this.tasks.schedule(userId, block.taskId, { start: block.start, end: block.end }));
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        const body = err.getResponse() as { code?: string; message?: string };
        failed.push({ taskId: block.taskId, code: body.code ?? 'ERROR', message: typeof body.message === 'string' ? body.message : err.message });
      }
    }
    return { created, failed };
  }
}
