import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { DomainError } from '@/common/http/errors';
import { addDays, isLocalDate, LocalDate, startOfWeek } from '@/common/time/time';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AvailabilityService } from '../availability/availability.service';
import { DayContextService } from '../availability/day-context.service';
import { ProductivityService } from '../productivity/productivity.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { TasksService } from '../tasks/tasks.service';
import { TaskQueryDto } from '../tasks/tasks.dto';
import { UsersService } from '../users/users.service';
import { ToolCallDto } from './ai-coach.dto';

/**
 * The ONLY way the coach can read or influence user data.
 *
 *  - Every tool runs for the authenticated user. The model never supplies a user id, and no
 *    tool accepts SQL, table names or free-form queries.
 *  - Inputs are validated with strict zod schemas before anything executes.
 *  - Read tools return compact, size-capped JSON. Results are data, never instructions.
 *  - The single write-capable tool only records a PROPOSAL. A schedule change happens only
 *    after the user confirms it through a separate, authenticated endpoint.
 *  - Every call is written to the audit log.
 */
export interface ToolContext {
  userId: string;
  conversationId: string;
  timezone: string;
  now: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
}

const MAX_RESULT_CHARS = 12_000;
const MAX_LIST = 15;

const localDate = z.string().refine(isLocalDate, 'must be a calendar date in YYYY-MM-DD format');
const isoWithOffset = z.string().datetime({ offset: true });

const SCHEMAS = {
  get_day_overview: z.object({ date: localDate.optional() }).strict(),
  get_free_windows: z.object({ date: localDate.optional() }).strict(),
  find_free_slots: z
    .object({ duration_minutes: z.number().int().min(5).max(720), from_date: localDate.optional(), days: z.number().int().min(1).max(7).optional() })
    .strict(),
  recommend_tasks: z.object({ available_minutes: z.number().int().min(5).max(720).optional() }).strict(),
  list_tasks: z
    .object({ status: z.enum(['open', 'backlog', 'completed']).optional(), due: z.enum(['overdue', 'today', 'week']).optional(), search: z.string().max(100).optional() })
    .strict(),
  get_time_summary: z.object({ from_date: localDate, to_date: localDate }).strict(),
  get_leakage_insights: z.object({ from_date: localDate.optional(), to_date: localDate.optional() }).strict(),
  get_productivity_patterns: z.object({}).strict(),
  propose_schedule_task: z
    .object({ task_id: z.string().uuid(), start: isoWithOffset, end: isoWithOffset.optional() })
    .strict(),
} as const;

export type ToolName = keyof typeof SCHEMAS;
export const TOOL_NAMES = Object.keys(SCHEMAS) as ToolName[];

const dateProp = { type: 'string', description: 'Local calendar date, YYYY-MM-DD, in the user\'s timezone.' };

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_day_overview',
    description:
      'Overview of one day: planned vs tracked time, bookable free time, productivity score, focus and break time, current timer, upcoming blocks, pending and overdue tasks. Defaults to today.',
    input_schema: { type: 'object', properties: { date: dateProp }, additionalProperties: false },
  },
  {
    name: 'get_free_windows',
    description:
      'Free time windows on a day with a confidence level and the reasons it is not certain. Past time without tracking data is "unknown", never free. Defaults to today.',
    input_schema: { type: 'object', properties: { date: dateProp }, additionalProperties: false },
  },
  {
    name: 'find_free_slots',
    description: 'Find free slots long enough for a given duration (for example a deep-work session) over the next few days, earliest first.',
    input_schema: {
      type: 'object',
      properties: {
        duration_minutes: { type: 'integer', minimum: 5, maximum: 720 },
        from_date: dateProp,
        days: { type: 'integer', minimum: 1, maximum: 7, description: 'Days to search, default 3.' },
      },
      required: ['duration_minutes'],
      additionalProperties: false,
    },
  },
  {
    name: 'recommend_tasks',
    description:
      'Rank the user\'s open tasks against real free time, current energy and history. Each result has a score, confidence, reasons and the window it fits. Optionally limit to the minutes the user says they have.',
    input_schema: {
      type: 'object',
      properties: { available_minutes: { type: 'integer', minimum: 5, maximum: 720, description: 'Minutes the user has right now.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks, optionally filtered by status group (open, backlog, completed), due window, or a search term.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'backlog', 'completed'] },
        due: { type: 'string', enum: ['overdue', 'today', 'week'] },
        search: { type: 'string', maxLength: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_time_summary',
    description:
      'Measured time totals for a date range (max 31 days): tracked, productive, focus, planned, leakage, per-category breakdown and per-day figures. Use for questions like "how much time did I spend on X this week".',
    input_schema: {
      type: 'object',
      properties: { from_date: dateProp, to_date: dateProp },
      required: ['from_date', 'to_date'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_leakage_insights',
    description: 'Explainable findings about where time leaked (unplanned gaps, switching, interruptions, overload, estimate overruns, untracked time). Defaults to the last 7 days.',
    input_schema: { type: 'object', properties: { from_date: dateProp, to_date: dateProp }, additionalProperties: false },
  },
  {
    name: 'get_productivity_patterns',
    description: 'Personal patterns from the last 8 weeks (productive hours, consistent days, estimate accuracy, rhythm) with sample size and confidence, plus a forecast for today.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_schedule_task',
    description:
      'Propose scheduling a task into the calendar. This does NOT change anything: it creates a proposal the user must confirm. Use only after checking free windows. start/end are ISO-8601 with a UTC offset; end defaults to start + the task estimate.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id returned by list_tasks or recommend_tasks.' },
        start: { type: 'string', description: 'ISO-8601 with offset, e.g. 2026-03-14T09:00:00+02:00' },
        end: { type: 'string', description: 'Optional ISO-8601 with offset.' },
      },
      required: ['task_id', 'start'],
      additionalProperties: false,
    },
  },
];

const mins = (sec: number): number => Math.round(sec / 60);

@Injectable()
export class CoachToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly availability: AvailabilityService,
    private readonly dayContext: DayContextService,
    private readonly recommendations: RecommendationsService,
    private readonly tasks: TasksService,
    private readonly productivity: ProductivityService,
  ) {}

  names(): string[] {
    return [...TOOL_NAMES];
  }

  async context(userId: string, conversationId: string): Promise<ToolContext> {
    const pref = await this.users.preference(userId);
    return { userId, conversationId, timezone: pref.timezone, now: Date.now() };
  }

  /** Execute a tool by name. Never throws: failures become an error result the model can read. */
  async execute(ctx: ToolContext, name: string, rawInput: unknown): Promise<{ content: string; log: ToolCallDto; isError: boolean }> {
    const started = Date.now();
    const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>;
    let ok = true;
    let error: string | null = null;
    let payload: unknown;
    try {
      if (!(name in SCHEMAS)) throw new Error(`Unknown tool "${name}".`);
      const parsed = SCHEMAS[name as ToolName].safeParse(input);
      if (!parsed.success) {
        throw new Error('Invalid arguments: ' + parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
      }
      payload = await this.run(ctx, name as ToolName, parsed.data as Record<string, unknown>);
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : 'Tool failed.';
      // Business-rule messages are safe to show the model; anything else is generic.
      if (!(err instanceof DomainError) && !(err instanceof Error && /Invalid arguments|Unknown tool/.test(err.message))) {
        error = 'The tool could not complete.';
      }
      payload = { error };
    }
    const durationMs = Date.now() - started;
    await this.audit
      .record({
        userId: ctx.userId,
        actor: 'ai-coach',
        action: `ai.tool.${name}`,
        entityType: 'AIConversation',
        entityId: ctx.conversationId,
        metadata: { input, ok, durationMs, ...(error ? { error } : {}) },
      })
      .catch(() => undefined);

    let content = JSON.stringify(payload);
    if (content.length > MAX_RESULT_CHARS) {
      content = JSON.stringify({ truncated: true, note: 'Result was too large and was cut; ask for a narrower range.', partial: content.slice(0, MAX_RESULT_CHARS - 200) });
    }
    return { content, isError: !ok, log: { name, input, ok, durationMs, error } };
  }

  private local(ms: number, tz: string): string {
    return DateTime.fromMillis(ms, { zone: tz }).toFormat('yyyy-LL-dd HH:mm');
  }

  private async run(ctx: ToolContext, name: ToolName, input: Record<string, unknown>): Promise<unknown> {
    const { userId, timezone: tz } = ctx;
    const today = await this.dayContext.today(userId, ctx.now);

    switch (name) {
      case 'get_day_overview': {
        const date = (input.date as LocalDate | undefined) ?? today;
        const d = await this.analytics.dashboard(userId, date);
        const m = d.metrics;
        return {
          date: d.date,
          timezone: d.timezone,
          nowLocal: this.local(ctx.now, tz),
          isToday: d.isToday,
          plannedMin: mins(m.plannedSec),
          trackedMin: mins(m.trackedSec),
          bookableFreeMin: mins(m.availableSec),
          highConfidenceFreeMin: mins(m.highConfidenceAvailableSec),
          productivityScore: m.productivityScore,
          scoreNote: m.productivityScore === null ? 'Nothing tracked yet, so no score can be computed.' : undefined,
          productiveMin: mins(m.productiveSec),
          focusMin: mins(m.focusSec),
          focusGoalMin: mins(m.focusGoalSec),
          breakMin: mins(m.breakSec),
          unplannedGapMin: mins(m.leakageSec),
          unknownMin: mins(m.unknownSec),
          unknownNote: 'Unknown time has neither a plan nor tracking. It is not free time and not wasted time.',
          plannedButUntrackedMin: mins(m.plannedUntrackedSec),
          plannedActivities: m.plannedActivities,
          completedActivities: m.completedActivities,
          completedTasks: m.completedTasksToday,
          pendingTasks: m.pendingTasks,
          overdueTasks: m.overdueTasks,
          scheduleConflicts: m.conflictCount,
          currentTimer: d.timer.session
            ? { activity: d.timer.session.activityTitle, status: d.timer.session.status, elapsedMin: mins(d.timer.elapsedSec) }
            : null,
          upcoming: d.upcoming.map((b) => ({ title: b.title, category: b.categoryName, start: this.local(b.start.getTime(), tz), end: this.local(b.end.getTime(), tz), fixed: b.isFixed })),
          freeWindows: d.windows.slice(0, MAX_LIST).map((w) => ({ start: this.local(w.start.getTime(), tz), end: this.local(w.end.getTime(), tz), minutes: mins(w.durationSec), confidence: w.confidence })),
        };
      }

      case 'get_free_windows': {
        const date = (input.date as LocalDate | undefined) ?? today;
        const day = await this.availability.day(userId, date);
        return {
          date,
          timezone: tz,
          windows: day.windows.slice(0, MAX_LIST).map((w) => ({
            start: this.local(w.start.getTime(), tz),
            end: this.local(w.end.getTime(), tz),
            startIso: DateTime.fromMillis(w.start.getTime(), { zone: tz }).toISO(),
            minutes: mins(w.durationSec),
            confidence: w.confidence,
            confidenceScore: w.confidenceScore,
            caveats: w.factors.map((f) => f.message),
          })),
          conflicts: day.conflicts.map((c) => ({ a: c.aTitle, b: c.bTitle, overlapMin: mins(c.overlapSec), severity: c.severity })),
          pastUnknownMin: mins(day.summary.unknownSec),
        };
      }

      case 'find_free_slots': {
        const slots = await this.availability.slots(userId, input.duration_minutes as number, input.from_date as LocalDate | undefined, (input.days as number | undefined) ?? 3);
        return {
          timezone: tz,
          slots: slots.slice(0, 8).map((s) => ({
            date: s.date,
            start: this.local(s.start.getTime(), tz),
            end: this.local(s.end.getTime(), tz),
            startIso: DateTime.fromMillis(s.start.getTime(), { zone: tz }).toISO(),
            confidence: s.confidence,
          })),
          found: slots.length,
        };
      }

      case 'recommend_tasks': {
        const batch = await this.recommendations.generate(userId, { availableMinutes: input.available_minutes as number | undefined, limit: 3 });
        return {
          userState: { energy: batch.userState.energy, focus: batch.userState.focus, basis: batch.userState.source },
          usedDeclaredTime: batch.usedDeclaredTime,
          recommendations: batch.recommendations.map((r) => ({
            taskId: r.taskId,
            title: r.title,
            score: r.score,
            confidence: r.confidence,
            estimatedMin: mins(r.estimatedDurationSec),
            window: { start: this.local(r.suitableWindow.start.getTime(), tz), end: this.local(r.suitableWindow.end.getTime(), tz), startIso: DateTime.fromMillis(r.suitableWindow.start.getTime(), { zone: tz }).toISO() },
            reasons: r.reasons,
            summary: r.summary,
          })),
          notRecommended: batch.excluded.slice(0, 8).map((e) => ({ title: e.title, why: e.reason })),
        };
      }

      case 'list_tasks': {
        const status = input.status as 'open' | 'backlog' | 'completed' | undefined;
        const query = {
          page: 1,
          pageSize: MAX_LIST,
          sort: 'deadline',
          status: status === 'completed' ? ['COMPLETED'] : status === 'backlog' ? ['BACKLOG'] : ['TODO', 'IN_PROGRESS'],
          due: input.due as TaskQueryDto['due'],
          q: input.search as string | undefined,
        } as TaskQueryDto;
        const res = await this.tasks.list(userId, query);
        return {
          total: res.meta.total,
          tasks: res.items.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            estimatedMin: mins(t.estimatedDurationSec),
            deadline: t.deadline ? this.local(t.deadline.getTime(), tz) : null,
            blocked: t.isBlocked,
            scheduled: t.scheduledBlocks.some((b) => b.plannedStart && b.plannedStart.getTime() > ctx.now),
          })),
        };
      }

      case 'get_time_summary': {
        const s = await this.analytics.summary(userId, input.from_date as LocalDate, input.to_date as LocalDate);
        const t = s.totals;
        return {
          from: s.from,
          to: s.to,
          trackedMin: mins(t.trackedSec),
          productiveMin: mins(t.productiveSec),
          focusMin: mins(t.focusSec),
          plannedMin: mins(t.plannedSec),
          restMin: mins(t.restSec),
          unplannedGapMin: mins(t.leakageSec),
          unknownMin: mins(t.unknownSec),
          daysWithTracking: t.activeDays,
          completedTasks: t.completedTasks,
          completedActivities: t.completedActivities,
          deepWorkSessions: t.deepWorkSessions,
          avgProductivityScore: t.avgProductivityScore,
          avgAdherencePct: t.avgAdherencePct,
          estimationAccuracyPct: t.avgEstimationAccuracyPct,
          categories: s.categories.filter((c) => c.trackedSec > 0 || c.plannedSec > 0).map((c) => ({ name: c.name, trackedMin: mins(c.trackedSec), plannedMin: mins(c.plannedSec) })),
          days: s.days.map((d) => ({ date: d.date, trackedMin: mins(d.trackedSec), productiveMin: mins(d.productiveSec), score: d.productivityScore, completedActivities: d.completedActivities })),
        };
      }

      case 'get_leakage_insights': {
        const r = await this.productivity.leakage(userId, input.from_date as LocalDate | undefined, input.to_date as LocalDate | undefined);
        return {
          from: r.from,
          to: r.to,
          daysWithData: r.daysWithData,
          unplannedGapMin: mins(r.totals.unplannedGapSec),
          unknownMin: mins(r.totals.unknownSec),
          note: 'Rest and leisure are not waste. Unknown time is not free time.',
          insights: r.insights.map((i) => ({ type: i.type, severity: i.severity, title: i.title, explanation: i.explanation, suggestion: i.suggestion, evidence: i.evidence })),
        };
      }

      case 'get_productivity_patterns': {
        const p = await this.productivity.patterns(userId);
        return {
          provider: p.provider,
          daysWithData: p.daysWithData,
          sufficiency: p.sufficiency,
          insights: p.insights.map((i) => ({ title: i.title, statement: i.statement, sufficiency: i.sufficiency, confidence: i.confidence, sampleSize: i.sampleSize, sampleUnit: i.sampleUnit })),
          forecast: {
            expectedProductiveMin: p.forecast.expectedProductiveSec === null ? null : mins(p.forecast.expectedProductiveSec),
            rangeMin: p.forecast.lowSec === null || p.forecast.highSec === null ? null : [mins(p.forecast.lowSec), mins(p.forecast.highSec)],
            basis: p.forecast.basis,
            confidence: p.forecast.confidence,
          },
        };
      }

      case 'propose_schedule_task': {
        const task = await this.tasks.get(userId, input.task_id as string);
        if (task.status === 'COMPLETED' || task.status === 'CANCELLED') throw DomainError.conflict('TASK_NOT_SCHEDULABLE', 'That task is already completed or cancelled.');
        if (task.isBlocked) throw DomainError.conflict('TASK_BLOCKED', 'That task is waiting on other tasks and cannot be scheduled yet.');
        const start = new Date(input.start as string);
        const end = input.end ? new Date(input.end as string) : new Date(start.getTime() + task.estimatedDurationSec * 1000);
        if (start.getTime() < ctx.now - 60_000) throw DomainError.badRequest('INVALID_PLANNED_RANGE', 'The proposed start is in the past.');
        if (end.getTime() <= start.getTime()) throw DomainError.badRequest('INVALID_PLANNED_RANGE', 'The end must be after the start.');
        const summary = `Schedule "${task.title}" on ${this.local(start.getTime(), tz).replace(' ', ' at ')} – ${DateTime.fromMillis(end.getTime(), { zone: tz }).toFormat('HH:mm')}`;
        const action = await this.prisma.aIPendingAction.create({
          data: {
            userId,
            conversationId: ctx.conversationId,
            type: 'schedule_task',
            summary: summary.slice(0, 500),
            payload: { taskId: task.id, start: start.toISOString(), end: end.toISOString() },
            expiresAt: new Date(ctx.now + 30 * 60_000),
          },
        });
        return { proposalId: action.id, status: 'AWAITING_USER_CONFIRMATION', summary, note: 'Nothing has been scheduled. Tell the user to review and confirm the proposal.' };
      }
    }
  }

  /** Helpers shared with the demo engine. */
  thisWeek(today: LocalDate, weekStartsOn: number): { from: LocalDate; to: LocalDate } {
    return { from: startOfWeek(today, weekStartsOn), to: today };
  }

  yesterday(today: LocalDate): LocalDate {
    return addDays(today, -1);
  }
}
