import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma, UserPreference } from '@prisma/client';
import { DateTime } from 'luxon';
import { DomainError } from '@/common/http/errors';
import {
  addDays,
  diffDays,
  eachLocalDate,
  formatDuration,
  isoWeekday,
  LocalDate,
  localDateToDateColumn,
  localDayRange,
  MS_PER_MINUTE,
  startOfWeek,
  toLocalDate,
} from '@/common/time/time';
import { ENV } from '@/config/config.module';
import { Env } from '@/config/env';
import { DomainEvent, DomainEventType } from '@/infrastructure/events/domain-events';
import { OutboxService } from '@/infrastructure/events/outbox.service';
import { isUniqueViolation, PrismaService } from '@/infrastructure/prisma/prisma.service';
import { QueueService } from '@/infrastructure/queue/queue.service';
import { CacheService } from '@/infrastructure/redis/cache.service';
import { AvailabilityService } from '../availability/availability.service';
import { DayContext, DayContextService } from '../availability/day-context.service';
import { NotificationsService } from '../notifications/notifications.service';
import { computeDayMetrics, DayMetrics, MetricActivity, TimeClassKey } from '../productivity/domain/day-metrics';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { UsersService } from '../users/users.service';
import {
  AnalyticsSummaryDto,
  CategoryBreakdownDto,
  ChangeDto,
  DailyAnalyticsDto,
  DashboardDto,
  HeatmapCellDto,
  ReportDto,
  TotalsDto,
} from './analytics.dto';

const MAX_RANGE_DAYS = 370;
const JOB_WEEKLY_SWEEP = 'reports.weekly-sweep';
const HOUR_MS = 3_600_000;

const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
const avg = (values: number[]): number | null => (values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null);

function toRow(date: LocalDate, m: DayMetrics): DailyAnalyticsDto {
  return {
    date,
    plannedSec: m.plannedSec,
    trackedSec: m.trackedSec,
    productiveSec: m.productiveSec,
    focusSec: m.focusSec,
    restSec: m.restSec,
    leisureSec: m.leisureSec,
    neutralSec: m.neutralSec,
    deepWorkSessions: m.deepWorkSessions,
    leakageSec: m.leakageSec,
    unknownSec: m.unknownSec,
    plannedActivities: m.plannedActivities,
    completedActivities: m.completedActivities,
    completedTasks: m.completedTasks,
    contextSwitches: m.contextSwitches,
    adherencePct: m.adherencePct,
    estimationAccuracyPct: m.estimationAccuracyPct,
    productivityScore: m.productivityScore,
    scoreBreakdown: m.scoreBreakdown,
    categoryBreakdown: m.categoryBreakdown,
    hourly: m.hourly,
  };
}

@Injectable()
export class AnalyticsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly dayContext: DayContextService,
    private readonly availability: AvailabilityService,
    private readonly timers: TimeTrackingService,
    private readonly cache: CacheService,
    private readonly outbox: OutboxService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.outbox.on(
      [
        DomainEventType.ActivityCreated,
        DomainEventType.ActivityStarted,
        DomainEventType.ActivityPaused,
        DomainEventType.ActivityCompleted,
        DomainEventType.ScheduleChanged,
        DomainEventType.TimeEntryChanged,
        DomainEventType.TaskCompleted,
      ],
      'analytics.recompute-days',
      (e) => this.onDataChanged(e),
    );
    this.queue.register<{ hourKey: string }>(JOB_WEEKLY_SWEEP, () => this.weeklySweep());
  }

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test' || process.env.TIMEFLOW_SKIP_DB_CONNECT === '1') return;
    // Hourly tick. The job id is the hour, so several API instances enqueue it only once.
    const tick = () => {
      const hourKey = new Date().toISOString().slice(0, 13);
      void this.queue.enqueue(JOB_WEEKLY_SWEEP, { hourKey }, { jobId: `weekly-sweep-${hourKey}` });
    };
    this.sweepTimer = setInterval(tick, HOUR_MS);
    this.sweepTimer.unref();
    setTimeout(tick, 15_000).unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── live computation ───────────────────────────────────────────────────────

  private metricsFromContext(ctx: DayContext, completedTasks: number): DayMetrics {
    const activities: MetricActivity[] = ctx.activities.map((a) => ({
      id: a.id,
      title: a.title,
      categoryId: a.categoryId,
      // A soft-deleted activity keeps its tracked time but is no longer part of the plan.
      plannedStart: a.deletedAt ? null : (a.plannedStart?.getTime() ?? null),
      plannedEnd: a.deletedAt ? null : (a.plannedEnd?.getTime() ?? null),
      estimatedDurationSec: a.estimatedDurationSec,
      actualDurationSec: a.actualDurationSec,
      status: a.status,
      completedAt: a.completedAt?.getTime() ?? null,
      rescheduleCount: a.rescheduleCount,
    }));
    // Recurring occurrences are part of the plan even though they are not stored as activities.
    for (const o of ctx.occurrences) {
      activities.push({
        id: o.id,
        title: o.event.title,
        categoryId: o.event.categoryId,
        plannedStart: o.start,
        plannedEnd: o.end,
        estimatedDurationSec: null,
        actualDurationSec: 0,
        status: 'PLANNED',
        completedAt: null,
        rescheduleCount: 0,
      });
    }
    return computeDayMetrics({
      range: ctx.range,
      now: ctx.now,
      timezone: ctx.timezone,
      activeHours: ctx.activeHours,
      categories: ctx.categories.map((c) => ({ id: c.id, key: c.key, name: c.name, color: c.color, timeClass: c.timeClass as TimeClassKey })),
      activities,
      segments: ctx.segments.map((s) => ({ start: s.start, end: s.end, activityId: s.activityId, sessionId: s.sessionId })),
      pauseCountBySession: ctx.pauseCountBySession,
      completedTasks,
      settings: {
        deepWorkMinMs: ctx.pref.deepWorkMinMinutes * MS_PER_MINUTE,
        dailyFocusGoalSec: ctx.pref.dailyFocusGoalMinutes * 60,
      },
    });
  }

  private async completedTasksByDate(userId: string, tz: string, from: LocalDate, to: LocalDate): Promise<Map<LocalDate, number>> {
    const start = new Date(localDayRange(from, tz).start);
    const end = new Date(localDayRange(to, tz).end);
    const rows = await this.prisma.task.findMany({
      where: { userId, deletedAt: null, status: 'COMPLETED', completedAt: { gte: start, lt: end } },
      select: { completedAt: true },
    });
    const out = new Map<LocalDate, number>();
    for (const r of rows) {
      const d = toLocalDate(r.completedAt as Date, tz);
      out.set(d, (out.get(d) ?? 0) + 1);
    }
    return out;
  }

  /** Metrics computed from source data right now (no snapshot). Fixed number of queries for any range. */
  async liveMetrics(userId: string, dates: LocalDate[], now = Date.now()): Promise<{ metrics: Map<LocalDate, DayMetrics>; contexts: Map<LocalDate, DayContext> }> {
    const metrics = new Map<LocalDate, DayMetrics>();
    if (dates.length === 0) return { metrics, contexts: new Map() };
    const pref = await this.users.preference(userId);
    const sorted = [...dates].sort();
    const [contexts, completed] = await Promise.all([
      this.dayContext.loadDays(userId, sorted, now, pref),
      this.completedTasksByDate(userId, pref.timezone, sorted[0]!, sorted[sorted.length - 1]!),
    ]);
    for (const date of sorted) metrics.set(date, this.metricsFromContext(contexts.get(date)!, completed.get(date) ?? 0));
    return { metrics, contexts };
  }

  /**
   * Store derived daily snapshots (a background materialisation; reads never depend on them).
   *
   * Writes are monotonic by the time the computation STARTED: a handler that read older data and
   * finishes last cannot overwrite a snapshot computed from newer data, so concurrent event
   * handlers cannot lose an update.
   */
  private async persist(userId: string, tz: string, rows: DailyAnalyticsDto[], startedAt: Date): Promise<void> {
    for (const r of rows) {
      const data = {
        timezone: tz,
        plannedSec: r.plannedSec,
        trackedSec: r.trackedSec,
        productiveSec: r.productiveSec,
        focusSec: r.focusSec,
        restSec: r.restSec,
        leisureSec: r.leisureSec,
        neutralSec: r.neutralSec,
        deepWorkSessions: r.deepWorkSessions,
        leakageSec: r.leakageSec,
        unknownSec: r.unknownSec,
        plannedActivities: r.plannedActivities,
        completedActivities: r.completedActivities,
        completedTasks: r.completedTasks,
        contextSwitches: r.contextSwitches,
        adherencePct: r.adherencePct,
        estimationAccuracyPct: r.estimationAccuracyPct,
        productivityScore: r.productivityScore,
        scoreBreakdown: json(r.scoreBreakdown),
        categoryBreakdown: json(r.categoryBreakdown),
        hourly: json(r.hourly),
        computedAt: startedAt,
      };
      const date = localDateToDateColumn(r.date);
      const updated = await this.prisma.dailyAnalytics.updateMany({ where: { userId, date, computedAt: { lte: startedAt } }, data });
      if (updated.count === 0) {
        try {
          await this.prisma.dailyAnalytics.create({ data: { userId, date, ...data } });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err; // a snapshot computed from newer data already exists
        }
      }
    }
  }

  /**
   * Daily rows for an inclusive range, always computed from source data.
   *
   * Reads never trust stored snapshots: an edit is visible on the very next request (read-your-
   * writes). Cost stays low because the data for the whole range is loaded with a fixed number of
   * queries and the result is cached under the user's data version, which every write invalidates.
   */
  async dailyRows(userId: string, from: LocalDate, to: LocalDate, _pref?: UserPreference): Promise<DailyAnalyticsDto[]> {
    const n = diffDays(from, to);
    if (n < 0) throw DomainError.badRequest('INVALID_RANGE', '"to" must not be before "from".');
    if (n >= MAX_RANGE_DAYS) throw DomainError.badRequest('INVALID_RANGE', `A range can cover at most ${MAX_RANGE_DAYS} days.`);
    const dates = eachLocalDate(from, to);
    const { metrics } = await this.liveMetrics(userId, dates);
    return dates.map((d) => toRow(d, metrics.get(d)!));
  }

  // ── event-driven snapshot refresh ──────────────────────────────────────────

  private async onDataChanged(event: DomainEvent): Promise<void> {
    const pref = await this.users.preference(event.userId).catch(() => null);
    if (!pref) return;
    const today = toLocalDate(Date.now(), pref.timezone);
    const dates = [...new Set(event.payload.dates ?? [])].filter((d) => d <= today).slice(0, 31);
    if (dates.length === 0) return;
    const startedAt = new Date();
    const { metrics } = await this.liveMetrics(event.userId, dates);
    await this.persist(event.userId, pref.timezone, dates.map((d) => toRow(d, metrics.get(d)!)), startedAt);
    // A change inside an already-summarised week invalidates that week's stored report.
    const weeks = [...new Set(dates.map((d) => startOfWeek(d, pref.weekStartsOn)))];
    await this.prisma.weeklyAnalytics.deleteMany({ where: { userId: event.userId, weekStart: { in: weeks.map(localDateToDateColumn) } } });
  }

  // ── dashboard ──────────────────────────────────────────────────────────────

  async dashboard(userId: string, dateIn?: LocalDate): Promise<DashboardDto> {
    const pref = await this.users.preference(userId);
    const now = Date.now();
    const today = toLocalDate(now, pref.timezone);
    const date = dateIn ?? today;
    const { metrics, contexts } = await this.liveMetrics(userId, [date], now);
    const ctx = contexts.get(date)!;
    const m = metrics.get(date)!;
    const nowDate = new Date(now);

    const [availability, timer, pendingTasks, overdueTasks, anyActivity, anyTask] = await Promise.all([
      this.availability.compute(ctx),
      this.timers.getActive(userId),
      this.prisma.task.count({ where: { userId, deletedAt: null, status: { in: ['TODO', 'IN_PROGRESS'] } } }),
      this.prisma.task.count({ where: { userId, deletedAt: null, status: { in: ['TODO', 'IN_PROGRESS', 'BACKLOG'] }, deadline: { lt: nowDate } } }),
      this.prisma.activity.findFirst({ where: { userId }, select: { id: true } }),
      this.prisma.task.findFirst({ where: { userId }, select: { id: true } }),
    ]);
    const dto = this.availability.toDto(ctx, availability);

    return {
      date,
      timezone: pref.timezone,
      now: nowDate,
      isToday: date === today,
      isEmptyAccount: !anyActivity && !anyTask,
      metrics: {
        plannedSec: m.plannedSec,
        trackedSec: m.trackedSec,
        availableSec: availability.summary.freeSec,
        highConfidenceAvailableSec: availability.summary.highConfidenceFreeSec,
        plannedActivities: m.plannedActivities,
        completedActivities: m.completedActivities,
        pendingTasks,
        overdueTasks,
        completedTasksToday: m.completedTasks,
        productivityScore: m.productivityScore,
        scoreBreakdown: m.scoreBreakdown,
        productiveSec: m.productiveSec,
        focusSec: m.focusSec,
        focusGoalSec: pref.dailyFocusGoalMinutes * 60,
        breakSec: m.restSec,
        leakageSec: m.leakageSec,
        unknownSec: m.unknownSec,
        plannedUntrackedSec: m.plannedUntrackedSec,
        deepWorkSessions: m.deepWorkSessions,
        conflictCount: availability.summary.conflictCount,
      },
      timer,
      upcoming: dto.blocks.filter((b) => !b.done && b.end.getTime() > now && b.status !== 'IN_PROGRESS' && b.status !== 'PAUSED').slice(0, 6),
      windows: dto.windows,
      categoryBreakdown: m.categoryBreakdown,
      hourly: m.hourly,
    };
  }

  // ── summaries & reports ────────────────────────────────────────────────────

  private async totals(userId: string, pref: UserPreference, from: LocalDate, to: LocalDate, days: DailyAnalyticsDto[]): Promise<TotalsDto> {
    const start = new Date(localDayRange(from, pref.timezone).start);
    const end = new Date(localDayRange(to, pref.timezone).end);
    const now = new Date();
    const [dueOpen, sessionAgg] = await Promise.all([
      this.prisma.task.count({
        where: { userId, deletedAt: null, status: { in: ['TODO', 'IN_PROGRESS', 'BACKLOG'] }, deadline: { gte: start, lt: end < now ? end : now } },
      }),
      this.prisma.activitySession.aggregate({
        where: { userId, status: 'STOPPED', startedAt: { gte: start, lt: end } },
        _avg: { durationSec: true },
      }),
    ]);
    const sum = (pick: (d: DailyAnalyticsDto) => number) => days.reduce((s, d) => s + pick(d), 0);
    const completedTasks = sum((d) => d.completedTasks);
    const nums = (pick: (d: DailyAnalyticsDto) => number | null) => days.map(pick).filter((v): v is number => v !== null);
    return {
      plannedSec: sum((d) => d.plannedSec),
      trackedSec: sum((d) => d.trackedSec),
      productiveSec: sum((d) => d.productiveSec),
      focusSec: sum((d) => d.focusSec),
      restSec: sum((d) => d.restSec),
      leisureSec: sum((d) => d.leisureSec),
      leakageSec: sum((d) => d.leakageSec),
      unknownSec: sum((d) => d.unknownSec),
      deepWorkSessions: sum((d) => d.deepWorkSessions),
      completedActivities: sum((d) => d.completedActivities),
      completedTasks,
      activeDays: days.filter((d) => d.trackedSec > 0).length,
      avgProductivityScore: avg(nums((d) => d.productivityScore)),
      avgAdherencePct: avg(nums((d) => d.adherencePct)),
      avgEstimationAccuracyPct: avg(nums((d) => d.estimationAccuracyPct)),
      taskCompletionRatePct: completedTasks + dueOpen > 0 ? Math.round((completedTasks / (completedTasks + dueOpen)) * 100) : null,
      avgSessionSec: sessionAgg._avg.durationSec === null ? null : Math.round(sessionAgg._avg.durationSec),
    };
  }

  private categories(days: DailyAnalyticsDto[]): CategoryBreakdownDto[] {
    const map = new Map<string, CategoryBreakdownDto>();
    for (const d of days) {
      for (const c of d.categoryBreakdown) {
        const cur = map.get(c.categoryId);
        if (cur) {
          cur.plannedSec += c.plannedSec;
          cur.trackedSec += c.trackedSec;
        } else {
          map.set(c.categoryId, { ...c });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.trackedSec - a.trackedSec || b.plannedSec - a.plannedSec);
  }

  private heatmap(days: DailyAnalyticsDto[]): HeatmapCellDto[] {
    const cells = new Map<string, { tracked: number; productive: number }>();
    const dayCount = new Map<number, number>();
    for (const d of days) {
      const wd = isoWeekday(d.date);
      dayCount.set(wd, (dayCount.get(wd) ?? 0) + 1);
      for (const h of d.hourly) {
        if (h.trackedSec === 0) continue;
        const key = `${wd}:${h.hour}`;
        const cur = cells.get(key) ?? { tracked: 0, productive: 0 };
        cur.tracked += h.trackedSec;
        cur.productive += h.productiveSec;
        cells.set(key, cur);
      }
    }
    const out: HeatmapCellDto[] = [];
    for (let weekday = 1; weekday <= 7; weekday++) {
      const n = dayCount.get(weekday) ?? 0;
      for (let hour = 0; hour < 24; hour++) {
        const c = cells.get(`${weekday}:${hour}`);
        out.push({ weekday, hour, avgTrackedSec: c && n ? Math.round(c.tracked / n) : 0, avgProductiveSec: c && n ? Math.round(c.productive / n) : 0 });
      }
    }
    return out;
  }

  async summary(userId: string, from: LocalDate, to: LocalDate): Promise<AnalyticsSummaryDto> {
    // The cache key lives under the user's data version, so any write invalidates it immediately.
    return this.cache.wrap(userId, `summary:${from}:${to}`, 120, async () => {
      const pref = await this.users.preference(userId);
      const days = await this.dailyRows(userId, from, to, pref);
      return {
        from,
        to,
        timezone: pref.timezone,
        totals: await this.totals(userId, pref, from, to, days),
        days,
        categories: this.categories(days),
        heatmap: this.heatmap(days),
      };
    });
  }

  private highlights(s: AnalyticsSummaryDto, changes: ChangeDto[]): string[] {
    const out: string[] = [];
    const t = s.totals;
    if (t.activeDays === 0) return ['No time was tracked in this period, so there is nothing to report yet.'];
    out.push(`You tracked ${formatDuration(t.trackedSec)} across ${t.activeDays} day${t.activeDays === 1 ? '' : 's'}, ${formatDuration(t.productiveSec)} of it productive.`);
    const best = [...s.days].filter((d) => d.productiveSec > 0).sort((a, b) => b.productiveSec - a.productiveSec)[0];
    if (best) out.push(`Your most productive day was ${DateTime.fromISO(best.date).toFormat('cccc d LLL')} with ${formatDuration(best.productiveSec)}.`);
    const topCat = s.categories.find((c) => c.trackedSec > 0);
    if (topCat && t.trackedSec > 0) out.push(`${topCat.name} took the largest share of tracked time (${Math.round((topCat.trackedSec / t.trackedSec) * 100)}%).`);
    if (t.deepWorkSessions > 0) out.push(`You completed ${t.deepWorkSessions} deep-work session${t.deepWorkSessions === 1 ? '' : 's'}.`);
    const productive = changes.find((c) => c.metric === 'productiveSec');
    if (productive && productive.changePct !== null && Math.abs(productive.changePct) >= 5) {
      out.push(`Productive time is ${productive.changePct > 0 ? 'up' : 'down'} ${Math.abs(productive.changePct)}% compared with the previous period.`);
    }
    if (t.leakageSec >= 30 * 60) out.push(`${formatDuration(t.leakageSec)} slipped away in unplanned gaps between activities.`);
    if (t.avgEstimationAccuracyPct !== null) out.push(`Your estimates were ${t.avgEstimationAccuracyPct}% accurate on average.`);
    if (t.taskCompletionRatePct !== null) out.push(`You completed ${t.completedTasks} task${t.completedTasks === 1 ? '' : 's'} (${t.taskCompletionRatePct}% of what was due or done).`);
    return out;
  }

  private async report(userId: string, kind: 'weekly' | 'monthly', from: LocalDate, to: LocalDate, prevFrom: LocalDate, prevTo: LocalDate): Promise<ReportDto> {
    const pref = await this.users.preference(userId);
    const today = toLocalDate(Date.now(), pref.timezone);
    const [summary, previous] = await Promise.all([this.summary(userId, from, to), this.summary(userId, prevFrom, prevTo)]);
    const metrics: (keyof TotalsDto)[] = ['trackedSec', 'productiveSec', 'focusSec', 'leakageSec', 'deepWorkSessions', 'completedActivities', 'completedTasks'];
    const changes: ChangeDto[] = metrics.map((metric) => {
      const current = (summary.totals[metric] as number) ?? 0;
      const prev = (previous.totals[metric] as number) ?? 0;
      return { metric, current, previous: prev, changePct: prev > 0 ? Math.round(((current - prev) / prev) * 100) : null };
    });
    return {
      kind,
      from,
      to,
      previousFrom: prevFrom,
      previousTo: prevTo,
      isComplete: to < today,
      summary,
      previousTotals: previous.totals,
      changes,
      highlights: this.highlights(summary, changes),
    };
  }

  async weeklyReport(userId: string, dateIn?: LocalDate): Promise<ReportDto> {
    const pref = await this.users.preference(userId);
    const anchor = dateIn ?? toLocalDate(Date.now(), pref.timezone);
    const from = startOfWeek(anchor, pref.weekStartsOn);
    const report = await this.report(userId, 'weekly', from, addDays(from, 6), addDays(from, -7), addDays(from, -1));
    if (report.isComplete) await this.storeWeekly(userId, report);
    return report;
  }

  async monthlyReport(userId: string, month?: string): Promise<ReportDto> {
    const pref = await this.users.preference(userId);
    const first = month ? DateTime.fromISO(`${month}-01`, { zone: 'utc' }) : DateTime.fromISO(toLocalDate(Date.now(), pref.timezone), { zone: 'utc' }).startOf('month');
    if (!first.isValid) throw DomainError.badRequest('INVALID_MONTH', 'month must be in YYYY-MM format.');
    const prev = first.minus({ months: 1 });
    return this.report(
      userId,
      'monthly',
      first.toISODate() as LocalDate,
      first.endOf('month').toISODate() as LocalDate,
      prev.toISODate() as LocalDate,
      prev.endOf('month').toISODate() as LocalDate,
    );
  }

  private async storeWeekly(userId: string, report: ReportDto): Promise<void> {
    const t = report.summary.totals;
    const data = {
      plannedSec: t.plannedSec,
      trackedSec: t.trackedSec,
      productiveSec: t.productiveSec,
      focusSec: t.focusSec,
      restSec: t.restSec,
      leakageSec: t.leakageSec,
      deepWorkSessions: t.deepWorkSessions,
      completedActivities: t.completedActivities,
      completedTasks: t.completedTasks,
      activeDays: t.activeDays,
      avgProductivityScore: t.avgProductivityScore,
      summary: json({ highlights: report.highlights, changes: report.changes, categories: report.summary.categories }),
      computedAt: new Date(),
    };
    const weekStart = localDateToDateColumn(report.from);
    await this.prisma.weeklyAnalytics.upsert({ where: { userId_weekStart: { userId, weekStart } }, create: { userId, weekStart, ...data }, update: data });
  }

  /**
   * Hourly background job: for users whose local time is the first morning of a new week,
   * build last week's report and notify them once (idempotent via the notification dedupe key).
   */
  private async weeklySweep(): Promise<void> {
    const prefs = await this.prisma.userPreference.findMany({
      where: { notifyWeeklyReport: true },
      select: { userId: true, timezone: true, weekStartsOn: true },
    });
    for (const p of prefs) {
      const local = DateTime.now().setZone(p.timezone);
      if (!local.isValid || local.weekday !== p.weekStartsOn || local.hour !== 8) continue;
      const lastWeekDay = addDays(local.toISODate() as LocalDate, -1);
      try {
        const report = await this.weeklyReport(p.userId, lastWeekDay);
        if (report.summary.totals.activeDays === 0) continue; // nothing to report
        await this.prisma.outboxEvent.create({
          data: {
            type: DomainEventType.ProductivityReportGenerated,
            aggregateType: 'WeeklyAnalytics',
            aggregateId: report.from,
            userId: p.userId,
            payload: { kind: 'weekly', from: report.from, to: report.to },
          },
        });
        await this.notifications.notify(p.userId, {
          type: 'REPORT_READY',
          title: 'Your weekly report is ready',
          body: report.highlights[0] ?? 'See how last week went.',
          href: `/reports/weekly?date=${report.from}`,
          dedupeKey: `weekly-report:${report.from}`,
        });
      } catch (err) {
        this.logger.warn(`Weekly report failed for ${p.userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    void this.outbox.kick();
  }
}
