import { ApiProperty } from '@nestjs/swagger';
import { Level, Priority, TaskStatus, TimeOfDay } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { EnumOut, OptionalEnumProp } from '@/common/http/decorators';
import { PageMetaDto, PaginationQueryDto } from '@/common/http/pagination.dto';
import { CategoryRefDto } from '../activities/activities.dto';
import { RecurrenceDto, RecurrenceOutDto } from '../availability/recurrence.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toArray = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' ? undefined : Array.isArray(value) ? value : String(value).split(',');
const cleanTags = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.map((t) => String(t).trim().toLowerCase()).filter(Boolean))] : value;

export class SubtaskDto {
  id: string;
  title: string;
  isDone: boolean;
  position: number;
}

export class TaskRefDto {
  id: string;
  title: string;
  @EnumOut(TaskStatus, 'TaskStatus') status: TaskStatus;
}

export class TaskBlockDto {
  activityId: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  status: string;
  actualDurationSec: number;
}

export class TaskDto {
  id: string;
  title: string;
  description: string | null;
  estimatedDurationSec: number;
  @EnumOut(Priority, 'Priority') priority: Priority;
  deadline: Date | null;
  @ApiProperty({ type: CategoryRefDto, nullable: true }) category: CategoryRefDto | null;
  @EnumOut(Level, 'Level') energyRequired: Level;
  @EnumOut(Level, 'Level') focusRequired: Level;
  /** 1 (trivial) … 5 (very complex) */
  complexity: number;
  @EnumOut(TaskStatus, 'TaskStatus') status: TaskStatus;
  tags: string[];
  @EnumOut(TimeOfDay, 'TimeOfDay') preferredTimeOfDay: TimeOfDay;
  subtasks: SubtaskDto[];
  /** Tasks that must be completed first. */
  dependsOn: TaskRefDto[];
  /** Tasks waiting on this one. */
  blocks: TaskRefDto[];
  /** True while any dependency is not completed. */
  isBlocked: boolean;
  /** Work blocks scheduled on the calendar for this task. */
  scheduledBlocks: TaskBlockDto[];
  /** Seconds tracked across all of its work blocks. */
  trackedSec: number;
  @ApiProperty({ type: RecurrenceOutDto, nullable: true }) recurrence: RecurrenceOutDto | null;
  seriesId: string | null;
  occurrenceDate: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class TaskListDto {
  items: TaskDto[];
  meta: PageMetaDto;
}

export class CreateTaskDto {
  @Transform(trim) @IsString() @Length(1, 160) title: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  /** 1 minute … 24 hours, in seconds. */
  @IsInt() @Min(60) @Max(86_400) estimatedDurationSec: number;
  @OptionalEnumProp(Priority, 'Priority') priority?: Priority;
  @IsOptional() @Type(() => Date) @IsDate() deadline?: Date;
  @IsOptional() @IsUUID() categoryId?: string;
  @OptionalEnumProp(Level, 'Level') energyRequired?: Level;
  @OptionalEnumProp(Level, 'Level') focusRequired?: Level;
  @IsOptional() @IsInt() @Min(1) @Max(5) complexity?: number;
  @OptionalEnumProp(TaskStatus, 'TaskStatus') status?: TaskStatus;
  @IsOptional() @Transform(cleanTags) @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(32, { each: true }) tags?: string[];
  @OptionalEnumProp(TimeOfDay, 'TimeOfDay') preferredTimeOfDay?: TimeOfDay;
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsUUID('all', { each: true }) dependsOnIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(160, { each: true }) subtasks?: string[];
  @IsOptional() @ValidateNested() @Type(() => RecurrenceDto) recurrence?: RecurrenceDto;
}

export class UpdateTaskDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsInt() @Min(60) @Max(86_400) estimatedDurationSec?: number;
  @OptionalEnumProp(Priority, 'Priority') priority?: Priority;
  @IsOptional() @Type(() => Date) @IsDate() deadline?: Date | null;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @OptionalEnumProp(Level, 'Level') energyRequired?: Level;
  @OptionalEnumProp(Level, 'Level') focusRequired?: Level;
  @IsOptional() @IsInt() @Min(1) @Max(5) complexity?: number;
  /** Use the complete / reopen endpoints to move to or from COMPLETED. */
  @IsOptional() @IsIn(['BACKLOG', 'TODO', 'IN_PROGRESS', 'CANCELLED']) status?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'CANCELLED';
  @IsOptional() @Transform(cleanTags) @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(32, { each: true }) tags?: string[];
  @OptionalEnumProp(TimeOfDay, 'TimeOfDay') preferredTimeOfDay?: TimeOfDay;
}

export class SetDependenciesDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsUUID('all', { each: true }) dependsOnIds: string[];
}

export class CreateSubtaskDto {
  @Transform(trim) @IsString() @Length(1, 160) title: string;
}

export class UpdateSubtaskDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsBoolean() isDone?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1000) position?: number;
}

export class ScheduleTaskDto {
  @Type(() => Date) @IsDate() start: Date;
  /** Defaults to start + the task's estimated duration. */
  @IsOptional() @Type(() => Date) @IsDate() end?: Date;
}

export class TaskQueryDto extends PaginationQueryDto {
  @IsOptional() @Transform(toArray) @IsArray() @IsIn(Object.values(TaskStatus), { each: true }) status?: TaskStatus[];
  @IsOptional() @Transform(toArray) @IsArray() @IsIn(Object.values(Priority), { each: true }) priority?: Priority[];
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  /** overdue | today | week (next 7 days) | none (no deadline) */
  @IsOptional() @IsIn(['overdue', 'today', 'week', 'none']) due?: 'overdue' | 'today' | 'week' | 'none';
  @IsOptional() @IsIn(['deadline', 'priority', 'createdAt', 'updatedAt', 'title']) sort?: 'deadline' | 'priority' | 'createdAt' | 'updatedAt' | 'title';
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

export class TaskHistoryEntryDto {
  id: string;
  action: string;
  actor: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
}
