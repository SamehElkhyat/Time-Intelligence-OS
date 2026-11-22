import { Injectable } from '@nestjs/common';
import { LEVEL_VALUE } from '@/common/levels';
import { localHour, MS_PER_HOUR } from '@/common/time/time';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CacheService } from '@/infrastructure/redis/cache.service';
import { UserState } from '../recommendations/domain/scoring';
import { UsersService } from '../users/users.service';
import { EnergyForecast, forecastEnergy } from './domain/energy-forecast';
import { EnergyLogDto, EnergyOverviewDto, EnergyQueryDto, LogEnergyDto } from './scheduling.dto';

const FORECAST_WINDOW_DAYS = 60;
/** A check-in describes "now" for this long. */
const FRESH_MS = 3 * MS_PER_HOUR;

@Injectable()
export class EnergyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly cache: CacheService,
  ) {}

  async log(userId: string, dto: LogEnergyDto): Promise<EnergyLogDto> {
    const row = await this.prisma.energyLog.create({
      data: { userId, energy: dto.energy, focus: dto.focus, note: dto.note ?? null },
      select: { id: true, recordedAt: true, energy: true, focus: true, note: true },
    });
    await this.cache.invalidateUser(userId);
    return row;
  }

  list(userId: string, q: EnergyQueryDto): Promise<EnergyLogDto[]> {
    return this.prisma.energyLog.findMany({
      where: { userId, recordedAt: { gte: q.from ?? new Date(Date.now() - 14 * 24 * MS_PER_HOUR), ...(q.to ? { lt: q.to } : {}) } },
      orderBy: { recordedAt: 'desc' },
      take: 500,
      select: { id: true, recordedAt: true, energy: true, focus: true, note: true },
    });
  }

  forecast(userId: string): Promise<EnergyForecast> {
    return this.cache.wrap(userId, 'energy-forecast:v1', 900, async () => {
      const pref = await this.users.preference(userId);
      const logs = await this.prisma.energyLog.findMany({
        where: { userId, recordedAt: { gte: new Date(Date.now() - FORECAST_WINDOW_DAYS * 24 * MS_PER_HOUR) } },
        select: { recordedAt: true, energy: true, focus: true },
      });
      const declared =
        pref.focusPeakStartMinute !== null && pref.focusPeakEndMinute !== null
          ? { startMinute: pref.focusPeakStartMinute, endMinute: pref.focusPeakEndMinute }
          : null;
      return forecastEnergy(
        logs.map((l) => ({ hour: localHour(l.recordedAt.getTime(), pref.timezone), energy: LEVEL_VALUE[l.energy], focus: LEVEL_VALUE[l.focus] })),
        declared,
      );
    });
  }

  /** Best available knowledge of the user's state right now — or an honest "unknown". */
  async stateNow(userId: string, now = Date.now()): Promise<UserState & { recordedAt: Date | null }> {
    const latest = await this.prisma.energyLog.findFirst({
      where: { userId, recordedAt: { gte: new Date(now - FRESH_MS), lte: new Date(now) } },
      orderBy: { recordedAt: 'desc' },
    });
    if (latest) {
      return { energy: LEVEL_VALUE[latest.energy], focus: LEVEL_VALUE[latest.focus], source: 'LOGGED', recordedAt: latest.recordedAt };
    }
    const [forecast, pref] = await Promise.all([this.forecast(userId), this.users.preference(userId)]);
    const hour = forecast.hours[localHour(now, pref.timezone)];
    if (hour && hour.energy !== null) {
      return { energy: hour.energy, focus: hour.focus, source: hour.source === 'LOGGED' ? 'FORECAST' : 'DECLARED', recordedAt: null };
    }
    return { energy: null, focus: null, source: 'UNKNOWN', recordedAt: null };
  }

  async overview(userId: string): Promise<EnergyOverviewDto> {
    const [current, forecast] = await Promise.all([this.stateNow(userId), this.forecast(userId)]);
    return { current, forecast: forecast.hours, sampleSize: forecast.sampleSize, confidence: forecast.confidence };
  }
}
