import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '@/common/http/errors';
import { LEVEL_VALUE } from '@/common/levels';
import { addDays, diffDays, eachLocalDate, LocalDate, localDateToDateColumn, localDayRange, localHour, toLocalDate, wholeSeconds } from '@/common/time/time';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CacheService } from '@/infrastructure/redis/cache.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { DayContextService } from '../availability/day-context.service';
import { detectConflicts } from '../availability/domain/availability-engine';
import { UsersService } from '../users/users.service';
import { detectLeakage, LeakageDay } from './domain/leakage';
import { PatternDay, PatternReport, PredictionProvider, StatisticalPredictionProvider } from './domain/patterns';
import { LeakageReportDto, PatternReportDto } from './productivity.dto';

const PATTERN_WINDOW_DAYS = 56;
const MAX_LEAKAGE_DAYS = 31;

@Injectable()
export class ProductivityService {
  /** Swap for a remote implementation (e.g. a Python analytics service) without touching callers. */
  private readonly predictor: PredictionProvider = new StatisticalPredictionProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly analytics: AnalyticsService,
    private readonly dayContext: DayContextService,
    private readonly cache: CacheService,
  ) {}

  async leakage(userId: string, fromIn?: LocalDate, toIn?: LocalDate): Promise<LeakageReportDto> {
    const pref = await this.users.preference(userId);
    const today = toLocalDate(Date.now(), pref.timezone);
    const to = toIn ?? today;
    const from = fromIn ?? addDays(to, -6);
    const n = diffDays(from, to);
    if (n < 0) throw DomainError.badRequest('INVALID_RANGE', '"to" must not be before "from".');
    if (n >= MAX_LEAKAGE_DAYS) throw DomainError.badRequest('INVALID_RANGE', `Leakage analysis covers at most ${MAX_LEAKAGE_DAYS} days.`);

    return this.cache.wrap(userId, `leakage:${from}:${to}`, 120, async () => {
      // Only days that have started can leak time.
      const dates = eachLocalDate(from, to).filter((d) => d <= today);
      const { metrics, contexts } = await this.analytics.liveMetrics(userId, dates);
      const start = new Date(localDayRange(from, pref.timezone).start);
      const end = new Date(localDayRange(to, pref.timezone).end);

      const [completed, moved] = await Promise.all([
        this.prisma.activity.findMany({
          where: { userId, status: 'COMPLETED', completedAt: { gte: start, lt: end }, actualDurationSec: { gt: 0 } },
          select: { estimatedDurationSec: true, plannedStart: true, plannedEnd: true, actualDurationSec: true, category: { select: { key: true, name: true } } },
        }),
        this.prisma.activity.findMany({
          where: { userId, deletedAt: null, rescheduleCount: { gte: 3 }, updatedAt: { gte: start, lt: end } },
          select: { title: true, rescheduleCount: true },
          orderBy: { rescheduleCount: 'desc' },
          take: 10,
        }),
      ]);

      const days: LeakageDay[] = dates.map((date) => {
        const m = metrics.get(date)!;
        const ctx = contexts.get(date)!;
        return {
          date,
          trackedSec: m.trackedSec,
          productiveSec: m.productiveSec,
          restSec: m.restSec,
          leisureSec: m.leisureSec,
          plannedSec: m.plannedSec,
          plannedDowntimeSec: m.categoryBreakdown
            .filter((c) => c.timeClass === 'REST' || c.timeClass === 'LEISURE')
            .reduce((s, c) => s + c.plannedSec, 0),
          leakageSec: m.leakageSec,
          unknownSec: m.unknownSec,
          plannedUntrackedSec: m.plannedUntrackedSec,
          activeSec: m.activeSec,
          activePastSec: m.activePastSec,
          transitions: m.transitions,
          contextSwitches: m.contextSwitches,
          fragmentedSec: m.fragmentedSec,
          conflictCount: detectConflicts(this.dayContext.plannedBlocks(ctx)).length,
          gaps: m.gaps,
          sessions: m.sessions,
        };
      });

      const report = detectLeakage({
        timezone: pref.timezone,
        days,
        estimates: completed.flatMap((a) => {
          const estimateSec =
            a.estimatedDurationSec ?? (a.plannedStart && a.plannedEnd ? wholeSeconds(a.plannedEnd.getTime() - a.plannedStart.getTime()) : 0);
          return estimateSec > 0
            ? [{ categoryKey: a.category.key, categoryName: a.category.name, estimateSec, actualSec: a.actualDurationSec }]
            : [];
        }),
        rescheduled: moved.map((a) => ({ title: a.title, count: a.rescheduleCount })),
      });
      return { from, to, daysWithData: report.daysWithData, totals: report.totals, insights: report.insights };
    });
  }

  async patterns(userId: string): Promise<PatternReportDto> {
    return this.cache.wrap(userId, 'patterns:v1', 600, async () => {
      const pref = await this.users.preference(userId);
      const today = toLocalDate(Date.now(), pref.timezone);
      const from = addDays(today, -PATTERN_WINDOW_DAYS);
      const to = addDays(today, -1); // finished days only
      const start = new Date(localDayRange(from, pref.timezone).start);
      const end = new Date(localDayRange(to, pref.timezone).end);

      const [rows, segments, completed, planned, energy] = await Promise.all([
        this.analytics.dailyRows(userId, from, to, pref),
        this.prisma.sessionSegment.findMany({
          where: { userId, startedAt: { gte: start, lt: end }, endedAt: { not: null }, session: { activity: { category: { timeClass: 'PRODUCTIVE' } } } },
          select: { startedAt: true, endedAt: true },
        }),
        this.prisma.activity.findMany({
          where: { userId, status: 'COMPLETED', completedAt: { gte: start, lt: end }, actualDurationSec: { gt: 0 } },
          select: { estimatedDurationSec: true, plannedStart: true, plannedEnd: true, actualDurationSec: true, category: { select: { name: true } } },
        }),
        this.prisma.activity.findMany({
          where: { userId, deletedAt: null, plannedStart: { gte: start, lt: end }, sessions: { some: {} } },
          select: { title: true, plannedStart: true, category: { select: { name: true } }, sessions: { select: { startedAt: true }, orderBy: { startedAt: 'asc' }, take: 1 } },
        }),
        this.prisma.energyLog.findMany({ where: { userId, recordedAt: { gte: start, lt: end } }, select: { recordedAt: true, energy: true, focus: true } }),
      ]);

      const days: PatternDay[] = rows.map((r) => ({
        date: r.date,
        trackedSec: r.trackedSec,
        productiveSec: r.productiveSec,
        focusSec: r.focusSec,
        deepWorkSessions: r.deepWorkSessions,
        hourlyProductiveSec: Array.from({ length: 24 }, (_, h) => r.hourly.find((b) => b.hour === h)?.productiveSec ?? 0),
      }));

      const report: PatternReport = await this.predictor.analyse({
        today,
        days,
        productiveSegmentSecs: segments.map((s) => wholeSeconds((s.endedAt as Date).getTime() - s.startedAt.getTime())),
        estimates: completed.flatMap((a) => {
          const estimateSec =
            a.estimatedDurationSec ?? (a.plannedStart && a.plannedEnd ? wholeSeconds(a.plannedEnd.getTime() - a.plannedStart.getTime()) : 0);
          return estimateSec > 0 ? [{ categoryName: a.category.name, estimateSec, actualSec: a.actualDurationSec }] : [];
        }),
        startDelays: planned.flatMap((a) =>
          a.sessions[0] && a.plannedStart
            ? [{ categoryName: a.category.name, title: a.title, delaySec: wholeSeconds(a.sessions[0].startedAt.getTime() - a.plannedStart.getTime()) }]
            : [],
        ),
        energyLogs: energy.map((l) => ({ hour: localHour(l.recordedAt.getTime(), pref.timezone), energy: LEVEL_VALUE[l.energy], focus: LEVEL_VALUE[l.focus] })),
      });

      await this.storeMetrics(userId, from, to, report);
      return { provider: this.predictor.name, ...report };
    });
  }

  /** Keep the latest value of every derived metric (one row per key and period). */
  private async storeMetrics(userId: string, from: LocalDate, to: LocalDate, report: PatternReport): Promise<void> {
    const periodStart = localDateToDateColumn(from);
    const periodEnd = localDateToDateColumn(to);
    const sufficient = report.insights.filter((i) => i.sufficiency !== 'INSUFFICIENT');
    if (sufficient.length === 0) return;
    await this.prisma.$transaction(
      sufficient.map((i) => {
        const data = {
          value: i.sampleSize,
          unit: i.sampleUnit.slice(0, 20),
          confidence: i.confidence,
          sampleSize: i.sampleSize,
          payload: { statement: i.statement, data: i.data } as unknown as Prisma.InputJsonValue,
          computedAt: new Date(),
        };
        return this.prisma.productivityMetric.upsert({
          where: { userId_key_periodStart_periodEnd: { userId, key: i.key, periodStart, periodEnd } },
          create: { userId, key: i.key, periodStart, periodEnd, ...data },
          update: data,
        });
      }),
    );
  }
}
