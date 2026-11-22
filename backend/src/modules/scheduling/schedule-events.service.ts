import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '@/common/http/errors';
import { addDays, LocalDate, localDateToDateColumn, localMinuteToInstant, MS_PER_MINUTE, toLocalDate } from '@/common/time/time';
import { DomainEventType } from '@/infrastructure/events/domain-events';
import { OutboxService } from '@/infrastructure/events/outbox.service';
import { isUniqueViolation, PrismaService, Tx } from '@/infrastructure/prisma/prisma.service';
import { CacheService } from '@/infrastructure/redis/cache.service';
import { toActivityDto, toCategoryRef } from '../activities/activity.mapper';
import { ActivityDto } from '../activities/activities.dto';
import { toRecurrenceSpec } from '../availability/day-context.service';
import { occurrenceDates } from '../availability/domain/recurrence';
import { ruleCreateData, toRecurrenceOut } from '../availability/recurrence.dto';
import { UsersService } from '../users/users.service';
import { CreateScheduleEventDto, ScheduleEventDto, UpdateScheduleEventDto } from './scheduling.dto';

const INCLUDE = { category: true, recurrenceRule: true } satisfies Prisma.ScheduleEventInclude;
type EventRow = Prisma.ScheduleEventGetPayload<{ include: typeof INCLUDE }>;

/** Recurring commitments ("every weekday 09:00 stand-up"). Occurrences are virtual until tracked. */
@Injectable()
export class ScheduleEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly outbox: OutboxService,
    private readonly cache: CacheService,
  ) {}

  private toDto(e: EventRow, today: LocalDate): ScheduleEventDto {
    return {
      id: e.id,
      scheduleId: e.scheduleId,
      title: e.title,
      category: toCategoryRef(e.category),
      startMinute: e.startMinute,
      durationMin: e.durationMin,
      isFixed: e.isFixed,
      isActive: e.isActive,
      priority: e.priority,
      energyRequired: e.energyRequired,
      focusRequired: e.focusRequired,
      recurrence: toRecurrenceOut(e.recurrenceRule),
      nextOccurrences: e.isActive ? occurrenceDates(toRecurrenceSpec(e.recurrenceRule), today, addDays(today, 60)).slice(0, 5) : [],
    };
  }

  private async changed(tx: Tx, userId: string, eventId: string, today: LocalDate, reason: string): Promise<void> {
    await this.outbox.add(tx, {
      type: DomainEventType.ScheduleChanged,
      aggregateType: 'ScheduleEvent',
      aggregateId: eventId,
      userId,
      // A recurring change can affect many days; refresh the coming two weeks.
      payload: { reason, dates: Array.from({ length: 14 }, (_, i) => addDays(today, i)) },
    });
  }

  private async afterCommit(userId: string): Promise<void> {
    await this.cache.invalidateUser(userId);
    void this.outbox.kick();
  }

  private async findOwned(db: Tx | PrismaService, userId: string, id: string): Promise<EventRow> {
    const e = await db.scheduleEvent.findFirst({ where: { id, userId }, include: INCLUDE });
    if (!e) throw DomainError.notFound('Recurring event');
    return e;
  }

  async list(userId: string): Promise<ScheduleEventDto[]> {
    const pref = await this.users.preference(userId);
    const today = toLocalDate(Date.now(), pref.timezone);
    const rows = await this.prisma.scheduleEvent.findMany({ where: { userId }, include: INCLUDE, orderBy: [{ isActive: 'desc' }, { startMinute: 'asc' }] });
    return rows.map((r) => this.toDto(r, today));
  }

  async create(userId: string, dto: CreateScheduleEventDto): Promise<ScheduleEventDto> {
    const pref = await this.users.preference(userId);
    const today = toLocalDate(Date.now(), pref.timezone);
    const row = await this.prisma.$transaction(async (tx) => {
      const category = await tx.activityCategory.findFirst({ where: { id: dto.categoryId, userId }, select: { id: true } });
      if (!category) throw DomainError.badRequest('INVALID_CATEGORY', 'Unknown category.');
      const schedule =
        (await tx.schedule.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })) ??
        (await tx.schedule.create({ data: { userId, name: 'My routine' } }));
      const rule = await tx.recurrenceRule.create({ data: ruleCreateData(userId, dto.recurrence, today) });
      const created = await tx.scheduleEvent.create({
        data: {
          userId,
          scheduleId: schedule.id,
          categoryId: dto.categoryId,
          recurrenceRuleId: rule.id,
          title: dto.title,
          startMinute: dto.startMinute,
          durationMin: dto.durationMin,
          isFixed: dto.isFixed ?? true,
          priority: dto.priority ?? 'MEDIUM',
          energyRequired: dto.energyRequired ?? 'MODERATE',
          focusRequired: dto.focusRequired ?? 'MODERATE',
        },
        include: INCLUDE,
      });
      await this.changed(tx, userId, created.id, today, 'recurring.created');
      return created;
    });
    await this.afterCommit(userId);
    return this.toDto(row, today);
  }

  async update(userId: string, id: string, dto: UpdateScheduleEventDto): Promise<ScheduleEventDto> {
    const pref = await this.users.preference(userId);
    const today = toLocalDate(Date.now(), pref.timezone);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      if (dto.categoryId) {
        const category = await tx.activityCategory.findFirst({ where: { id: dto.categoryId, userId }, select: { id: true } });
        if (!category) throw DomainError.badRequest('INVALID_CATEGORY', 'Unknown category.');
      }
      if (dto.recurrence) {
        const { userId: _u, ...data } = ruleCreateData(userId, dto.recurrence, today);
        await tx.recurrenceRule.update({ where: { id: current.recurrenceRuleId }, data });
      }
      const { recurrence: _r, ...fields } = dto;
      const updated = await tx.scheduleEvent.update({ where: { id }, data: fields, include: INCLUDE });
      await this.changed(tx, userId, id, today, 'recurring.updated');
      return updated;
    });
    await this.afterCommit(userId);
    return this.toDto(row, today);
  }

  async remove(userId: string, id: string): Promise<void> {
    const pref = await this.users.preference(userId);
    const today = toLocalDate(Date.now(), pref.timezone);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      // Activities already created from past occurrences keep their history (FK is SET NULL).
      await tx.scheduleEvent.delete({ where: { id } });
      await tx.recurrenceRule.delete({ where: { id: current.recurrenceRuleId } }).catch(() => undefined);
      await this.changed(tx, userId, id, today, 'recurring.deleted');
    });
    await this.afterCommit(userId);
  }

  private assertOccurs(event: EventRow, date: LocalDate): void {
    if (occurrenceDates(toRecurrenceSpec(event.recurrenceRule), date, date).length === 0) {
      throw DomainError.badRequest('NOT_AN_OCCURRENCE', 'This event does not occur on that date.');
    }
  }

  /** Skip a single occurrence (adds an exception date). */
  async skip(userId: string, id: string, date: LocalDate): Promise<ScheduleEventDto> {
    const pref = await this.users.preference(userId);
    const today = toLocalDate(Date.now(), pref.timezone);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      this.assertOccurs(current, date);
      await tx.recurrenceRule.update({ where: { id: current.recurrenceRuleId }, data: { exDates: { push: localDateToDateColumn(date) } } });
      await this.outbox.add(tx, {
        type: DomainEventType.ScheduleChanged,
        aggregateType: 'ScheduleEvent',
        aggregateId: id,
        userId,
        payload: { reason: 'recurring.occurrence-skipped', dates: [date] },
      });
      return this.findOwned(tx, userId, id);
    });
    await this.afterCommit(userId);
    return this.toDto(row, today);
  }

  /**
   * Turn one occurrence into a real activity so it can be tracked, edited or moved on its own.
   * Idempotent: the unique (scheduleEventId, occurrenceDate) pair returns the existing activity.
   */
  async materialise(userId: string, id: string, date: LocalDate): Promise<ActivityDto> {
    const pref = await this.users.preference(userId);
    const event = await this.findOwned(this.prisma, userId, id);
    this.assertOccurs(event, date);
    const start = localMinuteToInstant(date, event.startMinute, pref.timezone);
    const column = localDateToDateColumn(date);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.activity.create({
          data: {
            userId,
            categoryId: event.categoryId,
            title: event.title,
            plannedStart: new Date(start),
            plannedEnd: new Date(start + event.durationMin * MS_PER_MINUTE),
            priority: event.priority,
            energyRequired: event.energyRequired,
            focusRequired: event.focusRequired,
            isFixed: event.isFixed,
            scheduleEventId: event.id,
            occurrenceDate: column,
          },
          include: { category: true },
        });
        await this.outbox.add(tx, {
          type: DomainEventType.ActivityCreated,
          aggregateType: 'Activity',
          aggregateId: row.id,
          userId,
          payload: { activityId: row.id, fromRecurring: event.id, dates: [date] },
        });
        return row;
      });
      await this.afterCommit(userId);
      return toActivityDto(created);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await this.prisma.activity.findFirst({
        where: { userId, scheduleEventId: event.id, occurrenceDate: column },
        include: { category: true },
      });
      if (!existing || existing.deletedAt) {
        throw DomainError.conflict('OCCURRENCE_REMOVED', 'This occurrence was removed from your plan.');
      }
      return toActivityDto(existing);
    }
  }
}
