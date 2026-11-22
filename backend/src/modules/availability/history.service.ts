import { Injectable } from '@nestjs/common';
import { localHour, MS_PER_HOUR, wholeSeconds } from '@/common/time/time';
import { timeOfDayForHour } from '@/common/levels';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CacheService } from '@/infrastructure/redis/cache.service';
import { median } from '../productivity/domain/leakage';
import { RecommendationHistory, TimeOfDayKey } from '../recommendations/domain/scoring';
import { UsersService } from '../users/users.service';

const WINDOW_DAYS = 90;
const MIN_SAMPLES = 3;

/**
 * Behavioural history derived from the user's own completed work:
 *  - how actual time compares with the estimate, per category
 *  - how often planned blocks get completed, per part of the day
 * Cached per user and invalidated whenever their time data changes.
 */
@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly cache: CacheService,
  ) {}

  get(userId: string): Promise<RecommendationHistory> {
    return this.cache.wrap(userId, 'history:v1', 600, () => this.compute(userId));
  }

  /** Only categories with enough samples; used for availability confidence. */
  async reliableOverrunRatios(userId: string): Promise<Record<string, number>> {
    const h = await this.get(userId);
    const out: Record<string, number> = {};
    for (const [key, v] of Object.entries(h.overrunByCategory)) if (v.samples >= MIN_SAMPLES) out[key] = v.ratio;
    return out;
  }

  private async compute(userId: string): Promise<RecommendationHistory> {
    const pref = await this.users.preference(userId);
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * MS_PER_HOUR);
    const now = new Date();
    const [completed, planned] = await Promise.all([
      this.prisma.activity.findMany({
        where: { userId, status: 'COMPLETED', completedAt: { gte: since }, actualDurationSec: { gt: 0 } },
        select: { estimatedDurationSec: true, plannedStart: true, plannedEnd: true, actualDurationSec: true, category: { select: { key: true } } },
      }),
      this.prisma.activity.findMany({
        where: { userId, deletedAt: null, status: { notIn: ['CANCELLED'] }, plannedStart: { gte: since }, plannedEnd: { lt: now } },
        select: { plannedStart: true, status: true },
      }),
    ]);

    const ratios = new Map<string, number[]>();
    for (const a of completed) {
      const estimate =
        a.estimatedDurationSec ?? (a.plannedStart && a.plannedEnd ? wholeSeconds(a.plannedEnd.getTime() - a.plannedStart.getTime()) : null);
      if (!estimate) continue;
      ratios.set(a.category.key, [...(ratios.get(a.category.key) ?? []), a.actualDurationSec / estimate]);
    }
    const overrunByCategory: RecommendationHistory['overrunByCategory'] = {};
    for (const [key, list] of ratios) overrunByCategory[key] = { ratio: Math.round(median(list) * 100) / 100, samples: list.length };

    const byTod = new Map<TimeOfDayKey, { done: number; total: number }>();
    for (const a of planned) {
      const tod = timeOfDayForHour(localHour((a.plannedStart as Date).getTime(), pref.timezone));
      const cur = byTod.get(tod) ?? { done: 0, total: 0 };
      cur.total++;
      if (a.status === 'COMPLETED') cur.done++;
      byTod.set(tod, cur);
    }
    const completionByTimeOfDay: RecommendationHistory['completionByTimeOfDay'] = {};
    for (const [tod, v] of byTod) completionByTimeOfDay[tod] = { rate: Math.round((v.done / v.total) * 100) / 100, samples: v.total };

    return { overrunByCategory, completionByTimeOfDay };
  }
}
