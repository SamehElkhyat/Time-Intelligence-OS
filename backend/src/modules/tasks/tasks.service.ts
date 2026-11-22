import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '@/common/http/errors';
import { pageMeta } from '@/common/http/pagination.dto';
import {
  addDays,
  dateColumnToLocalDate,
  diffDays,
  localDateToDateColumn,
  localDatesInRange,
  localDayRange,
  MS_PER_HOUR,
  toLocalDate,
} from '@/common/time/time';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { DomainEvent, DomainEventType } from '@/infrastructure/events/domain-events';
import { OutboxService } from '@/infrastructure/events/outbox.service';
import { isUniqueViolation, PrismaService, Tx } from '@/infrastructure/prisma/prisma.service';
import { CacheService } from '@/infrastructure/redis/cache.service';
import { toActivityDto, toCategoryRef } from '../activities/activity.mapper';
import { ActivityDto } from '../activities/activities.dto';
import { DayContextService, toRecurrenceSpec } from '../availability/day-context.service';
import { nextOccurrenceAfter, ruleCreateData, toRecurrenceOut } from '../availability/recurrence.dto';
import { LEVEL_VALUE, PRIORITY_VALUE } from '@/common/levels';
import { CandidateTask } from '../recommendations/domain/scoring';
import { UsersService } from '../users/users.service';
import { findCycle } from './domain/dependency-graph';
import {
  CreateTaskDto,
  ScheduleTaskDto,
  SubtaskDto,
  TaskDto,
  TaskHistoryEntryDto,
  TaskListDto,
  TaskQueryDto,
  UpdateSubtaskDto,
  UpdateTaskDto,
} from './tasks.dto';

const REF = { select: { id: true, title: true, status: true, deletedAt: true } } as const;

export const TASK_INCLUDE = {
  category: true,
  recurrenceRule: true,
  subtasks: { orderBy: { position: 'asc' } },
  dependencies: { include: { dependsOn: REF } },
  dependents: { include: { task: REF } },
  activities: {
    where: { deletedAt: null },
    select: { id: true, plannedStart: true, plannedEnd: true, status: true, actualDurationSec: true },
    orderBy: { plannedStart: 'asc' },
  },
} satisfies Prisma.TaskInclude;

export type FullTask = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export function toTaskDto(t: FullTask): TaskDto {
  const dependsOn = t.dependencies.filter((d) => d.dependsOn.deletedAt === null).map((d) => d.dependsOn);
  const blocks = t.dependents.filter((d) => d.task.deletedAt === null).map((d) => d.task);
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    estimatedDurationSec: t.estimatedDurationSec,
    priority: t.priority,
    deadline: t.deadline,
    category: t.category ? toCategoryRef(t.category) : null,
    energyRequired: t.energyRequired,
    focusRequired: t.focusRequired,
    complexity: t.complexity,
    status: t.status,
    tags: t.tags,
    preferredTimeOfDay: t.preferredTimeOfDay,
    subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, isDone: s.isDone, position: s.position })),
    dependsOn: dependsOn.map((d) => ({ id: d.id, title: d.title, status: d.status })),
    blocks: blocks.map((d) => ({ id: d.id, title: d.title, status: d.status })),
    isBlocked: dependsOn.some((d) => d.status !== 'COMPLETED' && d.status !== 'CANCELLED'),
    scheduledBlocks: t.activities.map((a) => ({
      activityId: a.id,
      plannedStart: a.plannedStart,
      plannedEnd: a.plannedEnd,
      status: a.status,
      actualDurationSec: a.actualDurationSec,
    })),
    trackedSec: t.activities.reduce((s, a) => s + a.actualDurationSec, 0),
    recurrence: t.recurrenceRule ? toRecurrenceOut(t.recurrenceRule) : null,
    seriesId: t.seriesId,
    occurrenceDate: t.occurrenceDate ? dateColumnToLocalDate(t.occurrenceDate) : null,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly dayContext: DayContextService,
  ) {
    this.outbox.on(DomainEventType.TaskCompleted, 'tasks.generate-next-occurrence', (e) => this.generateNextOccurrence(e));
    this.outbox.on(DomainEventType.ActivityStarted, 'tasks.mark-in-progress', (e) => this.markInProgress(e));
  }

  private async afterCommit(userId: string): Promise<void> {
    await this.cache.invalidateUser(userId);
    void this.outbox.kick();
  }

  private async findOwned(db: Tx | PrismaService, userId: string, id: string): Promise<FullTask> {
    const task = await db.task.findFirst({ where: { id, userId, deletedAt: null }, include: TASK_INCLUDE });
    if (!task) throw DomainError.notFound('Task');
    return task;
  }

  private async assertCategory(db: Tx | PrismaService, userId: string, categoryId?: string | null): Promise<void> {
    if (!categoryId) return;
    const ok = await db.activityCategory.findFirst({ where: { id: categoryId, userId }, select: { id: true } });
    if (!ok) throw DomainError.badRequest('INVALID_CATEGORY', 'Unknown category.');
  }

  /** Validate and replace the dependency set of a task. Rejects unknown tasks and cycles. */
  private async writeDependencies(tx: Tx, userId: string, taskId: string, dependsOnIds: string[]): Promise<void> {
    if (dependsOnIds.length) {
      const found = await tx.task.findMany({ where: { id: { in: dependsOnIds }, userId, deletedAt: null }, select: { id: true, title: true } });
      if (found.length !== dependsOnIds.length) {
        throw DomainError.badRequest('INVALID_DEPENDENCY', 'One or more dependencies do not exist.');
      }
      const edges = await tx.taskDependency.findMany({ where: { task: { userId } }, select: { taskId: true, dependsOnId: true } });
      const cycle = findCycle(edges, taskId, dependsOnIds);
      if (cycle) {
        const titles = await tx.task.findMany({ where: { id: { in: cycle } }, select: { id: true, title: true } });
        const name = (id: string) => titles.find((t) => t.id === id)?.title ?? id;
        throw DomainError.unprocessable(
          'DEPENDENCY_CYCLE',
          'These dependencies would create a loop, so none of the tasks could ever start.',
          [cycle.map(name).join(' → ')],
        );
      }
    }
    await tx.taskDependency.deleteMany({ where: { taskId } });
    if (dependsOnIds.length) {
      await tx.taskDependency.createMany({ data: dependsOnIds.map((dependsOnId) => ({ taskId, dependsOnId })) });
    }
  }

  // ── queries ────────────────────────────────────────────────────────────────

  async list(userId: string, q: TaskQueryDto): Promise<TaskListDto> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const pref = await this.users.preference(userId);
    const now = new Date();
    const open: Prisma.TaskWhereInput = { status: { notIn: ['COMPLETED', 'CANCELLED'] } };
    let due: Prisma.TaskWhereInput = {};
    if (q.due === 'overdue') due = { ...open, deadline: { lt: now } };
    else if (q.due === 'today') {
      const r = localDayRange(toLocalDate(now, pref.timezone), pref.timezone);
      due = { ...open, deadline: { gte: new Date(r.start), lt: new Date(r.end) } };
    } else if (q.due === 'week') due = { ...open, deadline: { gte: now, lt: new Date(now.getTime() + 7 * 24 * MS_PER_HOUR) } };
    else if (q.due === 'none') due = { deadline: null };

    const where: Prisma.TaskWhereInput = {
      userId,
      deletedAt: null,
      ...(q.status?.length ? { status: { in: q.status } } : {}),
      ...(q.priority?.length ? { priority: { in: q.priority } } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      AND: [
        due,
        q.q
          ? {
              OR: [
                { title: { contains: q.q, mode: 'insensitive' } },
                { description: { contains: q.q, mode: 'insensitive' } },
                { tags: { has: q.q.toLowerCase() } },
              ],
            }
          : {},
      ],
    };
    const sort = q.sort ?? 'deadline';
    const order = q.order ?? (sort === 'priority' || sort === 'createdAt' || sort === 'updatedAt' ? 'desc' : 'asc');
    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      sort === 'deadline'
        ? [{ deadline: { sort: order, nulls: 'last' } }, { priority: 'desc' }, { createdAt: 'asc' }]
        : [{ [sort]: order }, { createdAt: 'asc' }];
    const [rows, total] = await Promise.all([
      this.prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.task.count({ where }),
    ]);
    return { items: rows.map(toTaskDto), meta: pageMeta(page, pageSize, total) };
  }

  async get(userId: string, id: string): Promise<TaskDto> {
    return toTaskDto(await this.findOwned(this.prisma, userId, id));
  }

  async history(userId: string, id: string): Promise<TaskHistoryEntryDto[]> {
    await this.findOwned(this.prisma, userId, id);
    const rows = await this.audit.list(userId, 'Task', id, 100);
    return rows.map((r) => ({ id: r.id, action: r.action, actor: r.actor, before: r.before, after: r.after, createdAt: r.createdAt }));
  }

  /** Open tasks in the shape the recommendation and planning engines consume. */
  async candidates(userId: string, now: number): Promise<CandidateTask[]> {
    const rows = await this.prisma.task.findMany({
      where: { userId, deletedAt: null, status: { in: ['BACKLOG', 'TODO', 'IN_PROGRESS'] } },
      include: TASK_INCLUDE,
    });
    return rows.map((t) => {
      const dto = toTaskDto(t);
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        estimatedDurationSec: t.estimatedDurationSec,
        priority: PRIORITY_VALUE[t.priority],
        deadline: t.deadline?.getTime() ?? null,
        energyRequired: LEVEL_VALUE[t.energyRequired],
        focusRequired: LEVEL_VALUE[t.focusRequired],
        preferredTimeOfDay: t.preferredTimeOfDay,
        categoryKey: t.category?.key ?? null,
        blockedBy: dto.dependsOn.filter((d) => d.status !== 'COMPLETED' && d.status !== 'CANCELLED').map((d) => d.title),
        unblocksCount: dto.blocks.filter((d) => d.status !== 'COMPLETED' && d.status !== 'CANCELLED').length,
        alreadyScheduled: t.activities.some(
          (a) => a.plannedEnd !== null && a.plannedEnd.getTime() > now && ['PLANNED', 'IN_PROGRESS', 'PAUSED'].includes(a.status),
        ),
        createdAt: t.createdAt.getTime(),
      };
    });
  }

  // ── commands ───────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateTaskDto): Promise<TaskDto> {
    if (dto.status === 'COMPLETED') throw DomainError.badRequest('INVALID_STATUS', 'Create the task first, then complete it.');
    const pref = await this.users.preference(userId);
    const today = toLocalDate(Date.now(), pref.timezone);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertCategory(tx, userId, dto.categoryId);
      const rule = dto.recurrence ? await tx.recurrenceRule.create({ data: ruleCreateData(userId, dto.recurrence, today) }) : null;
      const task = await tx.task.create({
        data: {
          userId,
          title: dto.title,
          description: dto.description ?? null,
          estimatedDurationSec: dto.estimatedDurationSec,
          priority: dto.priority ?? 'MEDIUM',
          deadline: dto.deadline ?? null,
          categoryId: dto.categoryId ?? null,
          energyRequired: dto.energyRequired ?? 'MODERATE',
          focusRequired: dto.focusRequired ?? 'MODERATE',
          complexity: dto.complexity ?? 3,
          status: dto.status ?? 'TODO',
          tags: dto.tags ?? [],
          preferredTimeOfDay: dto.preferredTimeOfDay ?? 'ANY',
          recurrenceRuleId: rule?.id ?? null,
          occurrenceDate: rule ? rule.startDate : null,
          subtasks: dto.subtasks?.length ? { create: dto.subtasks.map((title, position) => ({ title: title.trim(), position })) } : undefined,
        },
      });
      if (dto.dependsOnIds?.length) await this.writeDependencies(tx, userId, task.id, dto.dependsOnIds);
      await this.audit.record({ userId, action: 'task.created', entityType: 'Task', entityId: task.id, after: { title: task.title, priority: task.priority, deadline: task.deadline, status: task.status } }, tx);
      await this.outbox.add(tx, {
        type: DomainEventType.TaskCreated,
        aggregateType: 'Task',
        aggregateId: task.id,
        userId,
        payload: { taskId: task.id, dates: [today] },
      });
      return task.id;
    });
    await this.afterCommit(userId);
    return this.get(userId, id);
  }

  async update(userId: string, id: string, dto: UpdateTaskDto): Promise<TaskDto> {
    const pref = await this.users.preference(userId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      if (dto.categoryId) await this.assertCategory(tx, userId, dto.categoryId);
      if (current.status === 'COMPLETED' && dto.status && dto.status !== 'CANCELLED') {
        throw DomainError.conflict('TASK_COMPLETED', 'Reopen the task before changing its status.');
      }
      if (dto.status === 'IN_PROGRESS' && toTaskDto(current).isBlocked) {
        throw DomainError.conflict('TASK_BLOCKED', 'This task is waiting on other tasks and cannot be started yet.');
      }
      const data: Prisma.TaskUncheckedUpdateInput = {};
      const tracked: (keyof UpdateTaskDto)[] = ['title', 'description', 'estimatedDurationSec', 'priority', 'deadline', 'categoryId', 'energyRequired', 'focusRequired', 'complexity', 'status', 'tags', 'preferredTimeOfDay'];
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of tracked) {
        if (dto[key] === undefined) continue;
        (data as Record<string, unknown>)[key] = dto[key];
        const prev = (current as unknown as Record<string, unknown>)[key];
        if (JSON.stringify(prev) !== JSON.stringify(dto[key])) {
          before[key] = prev;
          after[key] = dto[key];
        }
      }
      if (Object.keys(after).length === 0) return;
      await tx.task.update({ where: { id }, data });
      await this.audit.record({ userId, action: 'task.updated', entityType: 'Task', entityId: id, before, after }, tx);
      await this.outbox.add(tx, {
        type: DomainEventType.ScheduleChanged,
        aggregateType: 'Task',
        aggregateId: id,
        userId,
        payload: { taskId: id, reason: 'task.updated', dates: [toLocalDate(Date.now(), pref.timezone)] },
      });
    });
    await this.afterCommit(userId);
    return this.get(userId, id);
  }

  async complete(userId: string, id: string): Promise<TaskDto> {
    const pref = await this.users.preference(userId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      if (current.status === 'COMPLETED') return;
      if (current.status === 'CANCELLED') throw DomainError.conflict('TASK_CANCELLED', 'A cancelled task cannot be completed.');
      const dto = toTaskDto(current);
      if (dto.isBlocked) {
        const waiting = dto.dependsOn.filter((d) => d.status !== 'COMPLETED' && d.status !== 'CANCELLED').map((d) => d.title);
        throw DomainError.conflict('TASK_BLOCKED', `Complete its dependencies first: ${waiting.join(', ')}.`);
      }
      const now = new Date();
      await tx.task.update({ where: { id }, data: { status: 'COMPLETED', completedAt: now } });
      await this.audit.record({ userId, action: 'task.completed', entityType: 'Task', entityId: id, before: { status: current.status }, after: { status: 'COMPLETED' } }, tx);
      await this.outbox.add(tx, {
        type: DomainEventType.TaskCompleted,
        aggregateType: 'Task',
        aggregateId: id,
        userId,
        payload: { taskId: id, dates: [toLocalDate(now, pref.timezone)] },
      });
    });
    await this.afterCommit(userId);
    return this.get(userId, id);
  }

  async reopen(userId: string, id: string): Promise<TaskDto> {
    const pref = await this.users.preference(userId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      if (current.status !== 'COMPLETED' && current.status !== 'CANCELLED') return;
      await tx.task.update({ where: { id }, data: { status: 'TODO', completedAt: null } });
      await this.audit.record({ userId, action: 'task.reopened', entityType: 'Task', entityId: id, before: { status: current.status }, after: { status: 'TODO' } }, tx);
      const dates = [toLocalDate(Date.now(), pref.timezone)];
      if (current.completedAt) dates.push(toLocalDate(current.completedAt, pref.timezone));
      await this.outbox.add(tx, {
        type: DomainEventType.ScheduleChanged,
        aggregateType: 'Task',
        aggregateId: id,
        userId,
        payload: { taskId: id, reason: 'task.reopened', dates: [...new Set(dates)] },
      });
    });
    await this.afterCommit(userId);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const pref = await this.users.preference(userId);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      await tx.task.update({ where: { id }, data: { deletedAt: new Date() } });
      // Other tasks must not stay blocked by a task that no longer exists.
      await tx.taskDependency.deleteMany({ where: { OR: [{ taskId: id }, { dependsOnId: id }] } });
      await this.audit.record({ userId, action: 'task.deleted', entityType: 'Task', entityId: id, before: { title: current.title, status: current.status } }, tx);
      await this.outbox.add(tx, {
        type: DomainEventType.ScheduleChanged,
        aggregateType: 'Task',
        aggregateId: id,
        userId,
        payload: { reason: 'task.deleted', dates: [toLocalDate(Date.now(), pref.timezone)] },
      });
    });
    await this.afterCommit(userId);
  }

  async setDependencies(userId: string, id: string, dependsOnIds: string[]): Promise<TaskDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id);
      await this.writeDependencies(tx, userId, id, dependsOnIds);
      await this.audit.record(
        { userId, action: 'task.dependencies-changed', entityType: 'Task', entityId: id, before: { dependsOn: current.dependencies.map((d) => d.dependsOnId) }, after: { dependsOn: dependsOnIds } },
        tx,
      );
    });
    await this.cache.invalidateUser(userId);
    return this.get(userId, id);
  }

  // ── subtasks ───────────────────────────────────────────────────────────────

  async addSubtask(userId: string, taskId: string, title: string): Promise<SubtaskDto> {
    await this.findOwned(this.prisma, userId, taskId);
    const last = await this.prisma.subtask.findFirst({ where: { taskId }, orderBy: { position: 'desc' }, select: { position: true } });
    const s = await this.prisma.subtask.create({ data: { taskId, title, position: (last?.position ?? -1) + 1 } });
    return { id: s.id, title: s.title, isDone: s.isDone, position: s.position };
  }

  async updateSubtask(userId: string, taskId: string, subtaskId: string, dto: UpdateSubtaskDto): Promise<SubtaskDto> {
    await this.findOwned(this.prisma, userId, taskId);
    const res = await this.prisma.subtask.updateMany({ where: { id: subtaskId, taskId }, data: dto });
    if (res.count === 0) throw DomainError.notFound('Subtask');
    const s = await this.prisma.subtask.findUniqueOrThrow({ where: { id: subtaskId } });
    return { id: s.id, title: s.title, isDone: s.isDone, position: s.position };
  }

  async removeSubtask(userId: string, taskId: string, subtaskId: string): Promise<void> {
    await this.findOwned(this.prisma, userId, taskId);
    const res = await this.prisma.subtask.deleteMany({ where: { id: subtaskId, taskId } });
    if (res.count === 0) throw DomainError.notFound('Subtask');
  }

  // ── scheduling a work block ────────────────────────────────────────────────

  /**
   * Put a work block for the task on the calendar. Overlapping a fixed commitment is rejected;
   * overlapping movable blocks is allowed and will be reported as a soft conflict.
   */
  async schedule(userId: string, id: string, dto: ScheduleTaskDto): Promise<ActivityDto> {
    const task = await this.findOwned(this.prisma, userId, id);
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw DomainError.conflict('TASK_NOT_SCHEDULABLE', 'Completed or cancelled tasks cannot be scheduled.');
    }
    const start = dto.start;
    const end = dto.end ?? new Date(start.getTime() + task.estimatedDurationSec * 1000);
    if (end.getTime() <= start.getTime()) throw DomainError.badRequest('INVALID_PLANNED_RANGE', 'The end must be after the start.');
    if (end.getTime() - start.getTime() > 24 * MS_PER_HOUR) throw DomainError.badRequest('INVALID_PLANNED_RANGE', 'A work block cannot be longer than 24 hours.');

    const pref = await this.users.preference(userId);
    const dates = localDatesInRange(pref.timezone, start, end);
    const contexts = await this.dayContext.loadDays(userId, dates);
    for (const ctx of contexts.values()) {
      const clash = this.dayContext
        .plannedBlocks(ctx)
        .find((b) => b.isFixed && !b.done && b.start < end.getTime() && b.end > start.getTime());
      if (clash) {
        throw DomainError.conflict('SCHEDULE_CONFLICT', `This overlaps the fixed commitment "${clash.title}". Choose another time.`);
      }
    }

    const categoryId =
      task.categoryId ?? (await this.prisma.activityCategory.findFirstOrThrow({ where: { userId, key: 'work' }, select: { id: true } })).id;
    const activity = await this.prisma.$transaction(async (tx) => {
      const row = await tx.activity.create({
        data: {
          userId,
          categoryId,
          taskId: task.id,
          title: task.title,
          description: task.description,
          plannedStart: start,
          plannedEnd: end,
          estimatedDurationSec: task.estimatedDurationSec,
          priority: task.priority,
          energyRequired: task.energyRequired,
          focusRequired: task.focusRequired,
          tags: task.tags,
        },
        include: { category: true },
      });
      await this.audit.record({ userId, action: 'task.scheduled', entityType: 'Task', entityId: task.id, after: { activityId: row.id, start, end } }, tx);
      await this.outbox.add(tx, {
        type: DomainEventType.ActivityCreated,
        aggregateType: 'Activity',
        aggregateId: row.id,
        userId,
        payload: { activityId: row.id, taskId: task.id, dates },
      });
      return row;
    });
    await this.afterCommit(userId);
    return toActivityDto(activity);
  }

  // ── event handlers ─────────────────────────────────────────────────────────

  /** Starting a timer on a task's work block moves the task to IN_PROGRESS. */
  private async markInProgress(event: DomainEvent): Promise<void> {
    const activityId = event.payload.activityId as string | undefined;
    if (!activityId) return;
    const activity = await this.prisma.activity.findUnique({ where: { id: activityId }, select: { taskId: true } });
    if (!activity?.taskId) return;
    const res = await this.prisma.task.updateMany({
      where: { id: activity.taskId, userId: event.userId, status: { in: ['TODO', 'BACKLOG'] } },
      data: { status: 'IN_PROGRESS' },
    });
    if (res.count) await this.cache.invalidateUser(event.userId);
  }

  /** Recurring tasks: completing one occurrence creates the next (idempotent per series + date). */
  private async generateNextOccurrence(event: DomainEvent): Promise<void> {
    const taskId = event.payload.taskId as string | undefined;
    if (!taskId) return;
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: { recurrenceRule: true, subtasks: true } });
    if (!task?.recurrenceRule || task.status !== 'COMPLETED') return;
    const pref = await this.users.preference(event.userId);
    const today = toLocalDate(Date.now(), pref.timezone);
    const current = task.occurrenceDate ? dateColumnToLocalDate(task.occurrenceDate) : today;
    // Skip occurrences that are already in the past: the next one is the first after both.
    const anchor = current > addDays(today, -1) ? current : addDays(today, -1);
    const next = nextOccurrenceAfter(toRecurrenceSpec(task.recurrenceRule), anchor);
    if (!next) return;
    const shiftDays = diffDays(current, next);
    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.task.create({
          data: {
            userId: task.userId,
            title: task.title,
            description: task.description,
            estimatedDurationSec: task.estimatedDurationSec,
            priority: task.priority,
            deadline: task.deadline ? new Date(task.deadline.getTime() + shiftDays * 24 * MS_PER_HOUR) : null,
            categoryId: task.categoryId,
            energyRequired: task.energyRequired,
            focusRequired: task.focusRequired,
            complexity: task.complexity,
            status: 'TODO',
            tags: task.tags,
            preferredTimeOfDay: task.preferredTimeOfDay,
            recurrenceRuleId: task.recurrenceRuleId,
            seriesId: task.seriesId ?? task.id,
            occurrenceDate: localDateToDateColumn(next),
            subtasks: { create: task.subtasks.map((s) => ({ title: s.title, position: s.position })) },
          },
        });
        await this.audit.record({ userId: task.userId, actor: 'system', action: 'task.recurrence-generated', entityType: 'Task', entityId: created.id, metadata: { from: task.id, occurrenceDate: next } }, tx);
        await this.outbox.add(tx, {
          type: DomainEventType.TaskCreated,
          aggregateType: 'Task',
          aggregateId: created.id,
          userId: task.userId,
          payload: { taskId: created.id, recurring: true, dates: [today] },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) return; // already generated by an earlier delivery
      throw err;
    }
    await this.afterCommit(event.userId);
  }
}
