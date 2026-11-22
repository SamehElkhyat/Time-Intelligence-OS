import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { DomainError } from '@/common/http/errors';
import { pageMeta } from '@/common/http/pagination.dto';
import { formatClock, MS_PER_HOUR, MS_PER_MINUTE } from '@/common/time/time';
import { DomainEvent, DomainEventType } from '@/infrastructure/events/domain-events';
import { OutboxService } from '@/infrastructure/events/outbox.service';
import { isUniqueViolation, PrismaService } from '@/infrastructure/prisma/prisma.service';
import { QueueService } from '@/infrastructure/queue/queue.service';
import { RealtimeService } from '@/infrastructure/realtime/realtime.service';
import { NotificationListDto, NotificationQueryDto } from './notifications.dto';

export interface NewNotification {
  type: NotificationType;
  title: string;
  body: string;
  href?: string;
  /** Same key for the same user is stored only once (safe under job retries). */
  dedupeKey?: string;
}

const JOB_ACTIVITY_REMINDER = 'notification.activity-reminder';
const JOB_DEADLINE_REMINDER = 'notification.deadline-reminder';
const DEADLINE_LEAD_MS = 24 * MS_PER_HOUR;

interface ActivityReminderJob {
  userId: string;
  activityId: string;
  /** The planned start this reminder was scheduled for; a moved activity invalidates it. */
  plannedStart: string;
}

interface DeadlineReminderJob {
  userId: string;
  taskId: string;
  deadline: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly queue: QueueService,
    private readonly outbox: OutboxService,
  ) {
    this.queue.register<ActivityReminderJob>(JOB_ACTIVITY_REMINDER, (job) => this.sendActivityReminder(job));
    this.queue.register<DeadlineReminderJob>(JOB_DEADLINE_REMINDER, (job) => this.sendDeadlineReminder(job));

    this.outbox.on(
      [DomainEventType.ActivityCreated, DomainEventType.ScheduleChanged],
      'notifications.schedule-activity-reminder',
      (e) => this.onActivityScheduled(e),
    );
    this.outbox.on(DomainEventType.TaskCreated, 'notifications.schedule-deadline-reminder', (e) => this.onTaskChanged(e));
    this.outbox.on(DomainEventType.ScheduleChanged, 'notifications.reschedule-deadline-reminder', (e) => this.onTaskChanged(e));
  }

  /** Create an in-app notification and push it to the user's open sessions. */
  async notify(userId: string, n: NewNotification): Promise<void> {
    try {
      const row = await this.prisma.notification.create({
        data: { userId, type: n.type, title: n.title, body: n.body, href: n.href ?? null, dedupeKey: n.dedupeKey ?? null },
      });
      this.realtime.publish(userId, { topic: 'notifications', event: DomainEventType.NotificationCreated, data: { id: row.id, title: row.title } });
    } catch (err) {
      if (isUniqueViolation(err)) return; // already delivered
      throw err;
    }
  }

  async list(userId: string, q: NotificationQueryDto): Promise<NotificationListDto> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where = { userId, ...(q.unreadOnly ? { readAt: null } : {}) };
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, type: true, title: true, body: true, href: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, meta: pageMeta(page, pageSize, total), unreadCount };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    const res = await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
    if (res.count === 0) throw DomainError.notFound('Notification');
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return res.count;
  }

  // ── scheduled reminders ────────────────────────────────────────────────────

  private async onActivityScheduled(event: DomainEvent): Promise<void> {
    const activityId = event.payload.activityId as string | undefined;
    if (!activityId) return;
    const [activity, pref] = await Promise.all([
      this.prisma.activity.findFirst({ where: { id: activityId, userId: event.userId, deletedAt: null } }),
      this.prisma.userPreference.findUnique({ where: { userId: event.userId } }),
    ]);
    if (!activity?.plannedStart || !pref?.notifyActivityReminders || activity.status !== 'PLANNED') return;
    const fireAt = activity.plannedStart.getTime() - pref.reminderLeadMinutes * MS_PER_MINUTE;
    const delayMs = fireAt - Date.now();
    if (delayMs <= 0) return;
    // The planned start is part of the job id: moving the activity creates a new reminder and
    // the old one cancels itself when it fires (see sendActivityReminder).
    await this.queue.enqueue<ActivityReminderJob>(
      JOB_ACTIVITY_REMINDER,
      { userId: event.userId, activityId, plannedStart: activity.plannedStart.toISOString() },
      { jobId: `reminder-${activityId}-${activity.plannedStart.getTime()}`, delayMs },
    );
  }

  private async sendActivityReminder(job: ActivityReminderJob): Promise<void> {
    const [activity, pref] = await Promise.all([
      this.prisma.activity.findFirst({ where: { id: job.activityId, userId: job.userId, deletedAt: null } }),
      this.prisma.userPreference.findUnique({ where: { userId: job.userId } }),
    ]);
    if (!activity?.plannedStart || !pref?.notifyActivityReminders) return;
    if (activity.plannedStart.toISOString() !== job.plannedStart || activity.status !== 'PLANNED') return; // moved, started or done
    await this.notify(job.userId, {
      type: 'ACTIVITY_REMINDER',
      title: `Starting soon: ${activity.title}`,
      body: `Planned for ${formatClock(activity.plannedStart.getTime(), pref.timezone)}.`,
      href: `/activities/${activity.id}`,
      dedupeKey: `reminder:${activity.id}:${job.plannedStart}`,
    });
  }

  private async onTaskChanged(event: DomainEvent): Promise<void> {
    const taskId = event.payload.taskId as string | undefined;
    if (!taskId) return;
    const [task, pref] = await Promise.all([
      this.prisma.task.findFirst({ where: { id: taskId, userId: event.userId, deletedAt: null } }),
      this.prisma.userPreference.findUnique({ where: { userId: event.userId } }),
    ]);
    if (!task?.deadline || !pref?.notifyDeadlines) return;
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return;
    const delayMs = task.deadline.getTime() - DEADLINE_LEAD_MS - Date.now();
    if (task.deadline.getTime() <= Date.now()) return;
    await this.queue.enqueue<DeadlineReminderJob>(
      JOB_DEADLINE_REMINDER,
      { userId: event.userId, taskId, deadline: task.deadline.toISOString() },
      { jobId: `deadline-${taskId}-${task.deadline.getTime()}`, delayMs: Math.max(0, delayMs) },
    );
  }

  private async sendDeadlineReminder(job: DeadlineReminderJob): Promise<void> {
    const [task, pref] = await Promise.all([
      this.prisma.task.findFirst({ where: { id: job.taskId, userId: job.userId, deletedAt: null } }),
      this.prisma.userPreference.findUnique({ where: { userId: job.userId } }),
    ]);
    if (!task?.deadline || !pref?.notifyDeadlines) return;
    if (task.deadline.toISOString() !== job.deadline) return; // deadline moved
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return;
    const hours = Math.max(1, Math.round((task.deadline.getTime() - Date.now()) / MS_PER_HOUR));
    await this.notify(job.userId, {
      type: 'DEADLINE_APPROACHING',
      title: `Due soon: ${task.title}`,
      body: `This task is due in about ${hours} hour${hours === 1 ? '' : 's'} and is not completed yet.`,
      href: `/tasks/${task.id}`,
      dedupeKey: `deadline:${task.id}:${job.deadline}`,
    });
  }
}
