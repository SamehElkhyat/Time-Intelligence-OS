import { Injectable } from '@nestjs/common';
import { ActivityCategory, Prisma, User, UserPreference } from '@prisma/client';
import { DomainError } from '@/common/http/errors';
import { toLocalDate } from '@/common/time/time';
import { DomainEventType } from '@/infrastructure/events/domain-events';
import { OutboxService } from '@/infrastructure/events/outbox.service';
import { Db, PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DEFAULT_CATEGORIES } from './default-categories';
import { CacheService } from '@/infrastructure/redis/cache.service';
import {
  AvailabilityRuleDto,
  AvailabilityRuleOutDto,
  CategoryDto,
  PreferenceDto,
  UpdatePreferenceDto,
  UserDto,
} from './users.dto';

export { DEFAULT_CATEGORIES };

export const toUserDto = (u: User): UserDto => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  emailVerified: u.emailVerifiedAt !== null,
  isDemo: u.isDemo,
  createdAt: u.createdAt,
});

export const toPreferenceDto = (p: UserPreference): PreferenceDto => ({
  timezone: p.timezone,
  locale: p.locale,
  weekStartsOn: p.weekStartsOn,
  use24HourClock: p.use24HourClock,
  dayStartMinute: p.dayStartMinute,
  dayEndMinute: p.dayEndMinute,
  bufferMinutes: p.bufferMinutes,
  minSlotMinutes: p.minSlotMinutes,
  deepWorkMinMinutes: p.deepWorkMinMinutes,
  dailyFocusGoalMinutes: p.dailyFocusGoalMinutes,
  breakAfterMinutes: p.breakAfterMinutes,
  focusPeakStartMinute: p.focusPeakStartMinute,
  focusPeakEndMinute: p.focusPeakEndMinute,
  notifyActivityReminders: p.notifyActivityReminders,
  notifyDeadlines: p.notifyDeadlines,
  notifyWeeklyReport: p.notifyWeeklyReport,
  reminderLeadMinutes: p.reminderLeadMinutes,
  onboardingCompleted: p.onboardingCompletedAt !== null,
});

export const toCategoryDto = (c: ActivityCategory): CategoryDto => ({
  id: c.id,
  key: c.key,
  name: c.name,
  color: c.color,
  timeClass: c.timeClass,
  isCommitment: c.isCommitment,
});

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly cache: CacheService,
  ) {}

  /** Rows every account needs. Runs inside the registration transaction. */
  async provisionDefaults(db: Db, userId: string, timezone: string, locale?: string): Promise<void> {
    await db.userPreference.create({ data: { userId, timezone, ...(locale ? { locale } : {}) } });
    await db.activityCategory.createMany({
      data: DEFAULT_CATEGORIES.map((c, position) => ({ ...c, userId, position })),
    });
    await db.schedule.create({ data: { userId, name: 'My routine' } });
  }

  async getUser(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw DomainError.notFound('User');
    return toUserDto(user);
  }

  async updateProfile(userId: string, displayName: string): Promise<UserDto> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { displayName: displayName.trim() } });
    return toUserDto(user);
  }

  /** Raw preference row (internal callers need the timezone on almost every request). */
  async preference(userId: string): Promise<UserPreference> {
    const pref = await this.prisma.userPreference.findUnique({ where: { userId } });
    if (!pref) throw DomainError.notFound('User preferences');
    return pref;
  }

  async getPreference(userId: string): Promise<PreferenceDto> {
    return toPreferenceDto(await this.preference(userId));
  }

  async updatePreference(userId: string, dto: UpdatePreferenceDto): Promise<PreferenceDto> {
    const current = await this.preference(userId);
    // DTO instances carry every declared field as an own property (value undefined when the client
    // did not send it). Spreading them would overwrite stored values with undefined and silently
    // skip the cross-field checks below, so only fields that were actually provided are merged.
    const provided = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as UpdatePreferenceDto;
    const next = { ...current, ...provided };
    if (next.dayEndMinute <= next.dayStartMinute) {
      throw DomainError.badRequest('INVALID_ACTIVE_HOURS', 'The end of your day must be after its start.');
    }
    const peakStart = next.focusPeakStartMinute;
    const peakEnd = next.focusPeakEndMinute;
    if ((peakStart === null) !== (peakEnd === null)) {
      throw DomainError.badRequest('INVALID_FOCUS_WINDOW', 'Set both the start and the end of your focus window, or neither.');
    }
    if (peakStart !== null && peakEnd !== null && peakEnd <= peakStart) {
      throw DomainError.badRequest('INVALID_FOCUS_WINDOW', 'Your focus window must end after it starts.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.userPreference.update({ where: { userId }, data: dto as Prisma.UserPreferenceUpdateInput });
      // Timezone, active hours and buffers all change what "available" means.
      await this.outbox.add(tx, {
        type: DomainEventType.ScheduleChanged,
        aggregateType: 'UserPreference',
        aggregateId: userId,
        userId,
        payload: { reason: 'preferences.updated', dates: [toLocalDate(Date.now(), row.timezone)] },
      });
      return row;
    });
    await this.cache.invalidateUser(userId);
    void this.outbox.kick();
    return toPreferenceDto(updated);
  }

  async completeOnboarding(userId: string): Promise<PreferenceDto> {
    const row = await this.prisma.userPreference.update({
      where: { userId },
      data: { onboardingCompletedAt: new Date() },
    });
    return toPreferenceDto(row);
  }

  async listAvailability(userId: string): Promise<AvailabilityRuleOutDto[]> {
    return this.prisma.userAvailability.findMany({
      where: { userId },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      select: { id: true, weekday: true, startMinute: true, endMinute: true, kind: true, label: true },
    });
  }

  async replaceAvailability(userId: string, rules: AvailabilityRuleDto[]): Promise<AvailabilityRuleOutDto[]> {
    const problems: string[] = [];
    rules.forEach((r, i) => {
      if (r.endMinute <= r.startMinute) problems.push(`rules[${i}]: end must be after start`);
    });
    // AVAILABLE rules of the same weekday must not overlap each other (BLOCKED may sit inside them).
    for (let wd = 1; wd <= 7; wd++) {
      const day = rules.filter((r) => r.weekday === wd && r.kind === 'AVAILABLE').sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < day.length; i++) {
        if (day[i]!.startMinute < day[i - 1]!.endMinute) problems.push(`weekday ${wd}: available ranges overlap`);
      }
    }
    if (problems.length) throw DomainError.badRequest('INVALID_AVAILABILITY', 'Availability rules are invalid.', problems);

    const pref = await this.preference(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.userAvailability.deleteMany({ where: { userId } });
      if (rules.length) {
        await tx.userAvailability.createMany({
          data: rules.map((r) => ({ userId, weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute, kind: r.kind, label: r.label ?? null })),
        });
      }
      await this.outbox.add(tx, {
        type: DomainEventType.ScheduleChanged,
        aggregateType: 'UserAvailability',
        aggregateId: userId,
        userId,
        payload: { reason: 'availability.replaced', dates: [toLocalDate(Date.now(), pref.timezone)] },
      });
    });
    await this.cache.invalidateUser(userId);
    void this.outbox.kick();
    return this.listAvailability(userId);
  }

  async listCategories(userId: string): Promise<CategoryDto[]> {
    const rows = await this.prisma.activityCategory.findMany({ where: { userId }, orderBy: { position: 'asc' } });
    return rows.map(toCategoryDto);
  }
}
