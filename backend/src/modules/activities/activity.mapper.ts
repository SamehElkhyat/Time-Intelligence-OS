import { Activity, ActivityCategory } from '@prisma/client';
import { wholeSeconds } from '@/common/time/time';
import { ActivityDto, CategoryRefDto } from './activities.dto';

export type ActivityWithCategory = Activity & { category: ActivityCategory };

export const toCategoryRef = (c: ActivityCategory): CategoryRefDto => ({
  id: c.id,
  key: c.key,
  name: c.name,
  color: c.color,
  timeClass: c.timeClass,
});

export const toActivityDto = (a: ActivityWithCategory): ActivityDto => ({
  id: a.id,
  title: a.title,
  description: a.description,
  notes: a.notes,
  category: toCategoryRef(a.category),
  plannedStart: a.plannedStart,
  plannedEnd: a.plannedEnd,
  plannedDurationSec:
    a.plannedStart && a.plannedEnd ? wholeSeconds(a.plannedEnd.getTime() - a.plannedStart.getTime()) : null,
  estimatedDurationSec: a.estimatedDurationSec,
  actualDurationSec: a.actualDurationSec,
  priority: a.priority,
  energyRequired: a.energyRequired,
  focusRequired: a.focusRequired,
  status: a.status,
  isFixed: a.isFixed,
  tags: a.tags,
  taskId: a.taskId,
  scheduleEventId: a.scheduleEventId,
  rescheduleCount: a.rescheduleCount,
  completedAt: a.completedAt,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});
