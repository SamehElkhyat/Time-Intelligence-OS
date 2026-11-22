import { Injectable } from '@nestjs/common';
import { Activity, Prisma } from '@prisma/client';
import { DomainError } from '@/common/http/errors';
import { pageMeta } from '@/common/http/pagination.dto';
import { localDatesInRange, MS_PER_HOUR } from '@/common/time/time';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { DomainEventType, NewDomainEvent } from '@/infrastructure/events/domain-events';
import { OutboxService } from '@/infrastructure/events/outbox.service';
import { PrismaService, Tx } from '@/infrastructure/prisma/prisma.service';
import { CacheService } from '@/infrastructure/redis/cache.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { UsersService } from '../users/users.service';
import {
  ActivityDto,
  ActivityListDto,
  ActivityQueryDto,
  CreateActivityDto,
  DuplicateActivityDto,
  RescheduleActivityDto,
  UpdateActivityDto,
} from './activities.dto';
import { toActivityDto } from './activity.mapper';

const MAX_PLANNED_MS = 24 * MS_PER_HOUR;

export function assertPlannedRange(start?: Date | null, end?: Date | null): void {
  if ((start == null) !== (end == null)) {
    throw DomainError.badRequest('INVALID_PLANNED_RANGE', 'Provide both a planned start and a planned end, or neither.');
  }
  if (start && end) {
    if (end.getTime() <= start.getTime()) {
      throw DomainError.badRequest('INVALID_PLANNED_RANGE', 'The planned end must be after the planned start.');
    }
    if (end.getTime() - start.getTime() > MAX_PLANNED_MS) {
      throw DomainError.badRequest('INVALID_PLANNED_RANGE', 'A single activity cannot be planned for more than 24 hours.');
    }
  }
}

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly timers: TimeTrackingService,
  ) {}

  private async afterCommit(userId: string): Promise<void> {
    await this.cache.invalidateUser(userId);
    void this.outbox.kick();
  }

  private datesFor(tz: string, ...acts: (Pick<Activity, 'plannedStart' | 'plannedEnd'> | null | undefined)[]): string[] {
    const out = new Set<string>();
    for (const a of acts) {
      if (a?.plannedStart && a.plannedEnd) for (const d of localDatesInRange(tz, a.plannedStart, a.plannedEnd)) out.add(d);
    }
    if (out.size === 0) for (const d of localDatesInRange(tz, Date.now(), Date.now() + 1)) out.add(d);
    return [...out];
  }

  private async assertCategory(db: Tx | PrismaService, userId: string, categoryId: string): Promise<void> {
    const ok = await db.activityCategory.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
    if (!ok) throw DomainError.badRequest('INVALID_CATEGORY', 'Unknown category.');
  }

  private async findOwned(db: Tx | PrismaService, userId: string, id: string) {
    const a = await db.activity.findFirst({ where: { id, userId, deletedAt: null }, include: { category: true } });
    if (!a) throw DomainError.notFound('Activity');
    return a;
  }

  async list(userId: string, q: ActivityQueryDto): Promise<ActivityListDto> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const and: Prisma.ActivityWhereInput[] = [];
    if (q.from || q.to) {
      const from = q.from ?? new Date(0);
      const to = q.to ?? new Date(8.64e15);
      // Planned inside the range, OR tracked inside the range (ad-hoc activities have no plan).
      and.push({
        OR: [
          { plannedStart: { lt: to }, plannedEnd: { gt: from } },
          { sessions: { some: { startedAt: { lt: to }, OR: [{ endedAt: { gt: from } }, { endedAt: null }] } } },
        ],
      });
    }
    if (q.q) {
      and.push({
        OR: [
          { title: { contains: q.q, mode: 'insensitive' } },
          { description: { contains: q.q, mode: 'insensitive' } },
          { notes: { contains: q.q, mode: 'insensitive' } },
          { tags: { has: q.q.toLowerCase() } },
        ],
      });
    }
    const where: Prisma.ActivityWhereInput = {
      userId,
      deletedAt: null,
      ...(q.status?.length ? { status: { in: q.status } } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const sort = q.sort ?? 'plannedStart';
    const order = q.order ?? (sort === 'title' ? 'asc' : 'desc');
    const orderBy: Prisma.ActivityOrderByWithRelationInput[] =
      sort === 'plannedStart' ? [{ plannedStart: { sort: order, nulls: 'last' } }, { createdAt: order }] : [{ [sort]: order }];
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({ where, include: { category: true }, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.activity.count({ where }),
    ]);
    return { items: rows.map(toActivityDto), meta: pageMeta(page, pageSize, total) };
  }

  async get(userId: string, id: string): Promise<ActivityDto> {
    return toActivityDto(await this.findOwned(this.prisma, userId, id));
  }

  async create(userId: string, dto: CreateActivityDto): Promise<ActivityDto> {
    assertPlannedRange(dto.plannedStart, dto.plannedEnd);
    const pref = await this.users.preference(userId);
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertCategory(tx, userId, dto.categoryId);
      if (dto.taskId) {
        const task = await tx.task.findFirst({ where: { id: dto.taskId, userId, deletedAt: null }, select: { id: true } });
        if (!task) throw DomainError.badRequest('INVALID_TASK', 'Unknown task.');
      }
      const row = await tx.activity.create({
        data: {
          userId,
          categoryId: dto.categoryId,
          title: dto.title,
          description: dto.description ?? null,
          notes: dto.notes ?? null,
          plannedStart: dto.plannedStart ?? null,
          plannedEnd: dto.plannedEnd ?? null,
          estimatedDurationSec: dto.estimatedDurationSec ?? null,
          priority: dto.priority ?? 'MEDIUM',
          energyRequired: dto.energyRequired ?? 'MODERATE',
          focusRequired: dto.focusRequired ?? 'MODERATE',
          isFixed: dto.isFixed ?? false,
          tags: dto.tags ?? [],
          taskId: dto.taskId ?? null,
        },
        include: { category: true },
      });
      await this.outbox.add(tx, {
        type: DomainEventType.ActivityCreated,
        aggregateType: 'Activity',
        aggregateId: row.id,
        userId,
        payload: { activityId: row.id, dates: this.datesFor(pref.timezone, row) },
      });
      return row;
    });
    await this.afterCommit(userId);
    return toActivityDto(created);
  }

  async update(userId: string, id: string, dto: UpdateActivityDto): Promise<ActivityDto> {
    const pref = await this.users.preference(userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      const plannedStart = dto.plannedStart === undefined ? current.plannedStart : dto.plannedStart;
      const plannedEnd = dto.plannedEnd === undefined ? current.plannedEnd : dto.plannedEnd;
      assertPlannedRange(plannedStart, plannedEnd);
      if (dto.categoryId) await this.assertCategory(tx, userId, dto.categoryId);
      const moved =
        plannedStart?.getTime() !== current.plannedStart?.getTime() || plannedEnd?.getTime() !== current.plannedEnd?.getTime();
      const row = await tx.activity.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.estimatedDurationSec !== undefined ? { estimatedDurationSec: dto.estimatedDurationSec } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(dto.energyRequired !== undefined ? { energyRequired: dto.energyRequired } : {}),
          ...(dto.focusRequired !== undefined ? { focusRequired: dto.focusRequired } : {}),
          ...(dto.isFixed !== undefined ? { isFixed: dto.isFixed } : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
          plannedStart,
          plannedEnd,
          // Moving an already-planned block counts as a reschedule.
          ...(moved && current.plannedStart ? { rescheduleCount: { increment: 1 } } : {}),
        },
        include: { category: true },
      });
      await this.outbox.add(tx, {
        type: DomainEventType.ScheduleChanged,
        aggregateType: 'Activity',
        aggregateId: id,
        userId,
        payload: { activityId: id, reason: moved ? 'activity.rescheduled' : 'activity.updated', dates: this.datesFor(pref.timezone, current, row) },
      });
      return row;
    });
    await this.afterCommit(userId);
    return toActivityDto(updated);
  }

  reschedule(userId: string, id: string, dto: RescheduleActivityDto): Promise<ActivityDto> {
    return this.update(userId, id, { plannedStart: dto.plannedStart, plannedEnd: dto.plannedEnd });
  }

  async duplicate(userId: string, id: string, dto: DuplicateActivityDto): Promise<ActivityDto> {
    const pref = await this.users.preference(userId);
    const copy = await this.prisma.$transaction(async (tx) => {
      const src = await this.findOwned(tx, userId, id);
      let plannedStart: Date | null = null;
      let plannedEnd: Date | null = null;
      if (dto.plannedStart) {
        const length =
          src.plannedStart && src.plannedEnd
            ? src.plannedEnd.getTime() - src.plannedStart.getTime()
            : (src.estimatedDurationSec ?? 3600) * 1000;
        plannedStart = dto.plannedStart;
        plannedEnd = new Date(dto.plannedStart.getTime() + length);
      }
      const row = await tx.activity.create({
        data: {
          userId,
          categoryId: src.categoryId,
          title: src.title,
          description: src.description,
          notes: src.notes,
          plannedStart,
          plannedEnd,
          estimatedDurationSec: src.estimatedDurationSec,
          priority: src.priority,
          energyRequired: src.energyRequired,
          focusRequired: src.focusRequired,
          isFixed: src.isFixed,
          tags: src.tags,
          taskId: src.taskId,
          // Tracking history, status and completion are intentionally NOT copied.
        },
        include: { category: true },
      });
      await this.outbox.add(tx, {
        type: DomainEventType.ActivityCreated,
        aggregateType: 'Activity',
        aggregateId: row.id,
        userId,
        payload: { activityId: row.id, duplicatedFrom: id, dates: this.datesFor(pref.timezone, row) },
      });
      return row;
    });
    await this.afterCommit(userId);
    return toActivityDto(copy);
  }

  /** Mark done. A running timer on the activity is stopped in the same transaction. */
  async complete(userId: string, id: string): Promise<ActivityDto> {
    const pref = await this.users.preference(userId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      if (current.status === 'COMPLETED') return;
      if (current.status === 'CANCELLED') {
        throw DomainError.conflict('ACTIVITY_CANCELLED', 'A cancelled activity cannot be completed.');
      }
      const events: NewDomainEvent[] = await this.timers.closeActiveForActivity(tx, userId, id, pref.timezone, true);
      if (!events.some((e) => e.type === DomainEventType.ActivityCompleted)) {
        const now = new Date();
        await tx.activity.update({ where: { id }, data: { status: 'COMPLETED', completedAt: now } });
        events.push({
          type: DomainEventType.ActivityCompleted,
          aggregateType: 'Activity',
          aggregateId: id,
          userId,
          payload: { activityId: id, taskId: current.taskId, dates: [...new Set([...this.datesFor(pref.timezone, current), ...localDatesInRange(pref.timezone, now, now)])] },
        });
      }
      for (const e of events) await this.outbox.add(tx, e);
    });
    await this.afterCommit(userId);
    return this.get(userId, id);
  }

  private async setStatus(userId: string, id: string, status: 'SKIPPED' | 'CANCELLED' | 'PLANNED', reason: string): Promise<ActivityDto> {
    const pref = await this.users.preference(userId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      const events = status === 'PLANNED' ? [] : await this.timers.closeActiveForActivity(tx, userId, id, pref.timezone, false);
      await tx.activity.update({ where: { id }, data: { status, ...(status === 'PLANNED' ? { completedAt: null } : {}) } });
      events.push({
        type: DomainEventType.ScheduleChanged,
        aggregateType: 'Activity',
        aggregateId: id,
        userId,
        payload: { activityId: id, reason, dates: this.datesFor(pref.timezone, current) },
      });
      for (const e of events) await this.outbox.add(tx, e);
    });
    await this.afterCommit(userId);
    return this.get(userId, id);
  }

  skip = (userId: string, id: string) => this.setStatus(userId, id, 'SKIPPED', 'activity.skipped');
  cancel = (userId: string, id: string) => this.setStatus(userId, id, 'CANCELLED', 'activity.cancelled');
  reopen = (userId: string, id: string) => this.setStatus(userId, id, 'PLANNED', 'activity.reopened');

  /** Soft delete: the block leaves the plan, its tracked history stays for analytics and audit. */
  async remove(userId: string, id: string): Promise<void> {
    const pref = await this.users.preference(userId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      const events = await this.timers.closeActiveForActivity(tx, userId, id, pref.timezone, false);
      await tx.activity.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        { userId, action: 'activity.deleted', entityType: 'Activity', entityId: id, before: { title: current.title, plannedStart: current.plannedStart, plannedEnd: current.plannedEnd, actualDurationSec: current.actualDurationSec } },
        tx,
      );
      events.push({
        type: DomainEventType.ScheduleChanged,
        aggregateType: 'Activity',
        aggregateId: id,
        userId,
        payload: { activityId: id, reason: 'activity.deleted', dates: this.datesFor(pref.timezone, current) },
      });
      for (const e of events) await this.outbox.add(tx, e);
    });
    await this.afterCommit(userId);
  }
}
