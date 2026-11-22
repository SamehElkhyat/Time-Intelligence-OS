import { ActivityStatus, Level, Priority } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
} from 'class-validator';
import { EnumOut, OptionalEnumProp } from '@/common/http/decorators';
import { PageMetaDto, PaginationQueryDto } from '@/common/http/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toArray = ({ value }: { value: unknown }) =>
  value === undefined || value === null || value === '' ? undefined : Array.isArray(value) ? value : String(value).split(',');
const cleanTags = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.map((t) => String(t).trim().toLowerCase()).filter(Boolean))] : value;

export class CategoryRefDto {
  id: string;
  key: string;
  name: string;
  color: string;
  timeClass: string;
}

export class ActivityDto {
  id: string;
  title: string;
  description: string | null;
  notes: string | null;
  category: CategoryRefDto;
  /** Planned start (UTC instant). Null for ad-hoc activities that were only tracked. */
  plannedStart: Date | null;
  plannedEnd: Date | null;
  /** Planned length in seconds, derived from plannedStart/plannedEnd. */
  plannedDurationSec: number | null;
  estimatedDurationSec: number | null;
  /** Seconds actually tracked. Scheduled time alone never counts as done. */
  actualDurationSec: number;
  @EnumOut(Priority, 'Priority') priority: Priority;
  @EnumOut(Level, 'Level') energyRequired: Level;
  @EnumOut(Level, 'Level') focusRequired: Level;
  @EnumOut(ActivityStatus, 'ActivityStatus') status: ActivityStatus;
  isFixed: boolean;
  tags: string[];
  taskId: string | null;
  scheduleEventId: string | null;
  rescheduleCount: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ActivityListDto {
  items: ActivityDto[];
  meta: PageMetaDto;
}

export class CreateActivityDto {
  @Transform(trim) @IsString() @Length(1, 160) title: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(8000) notes?: string;
  @IsUUID() categoryId: string;
  /** ISO-8601 instant with offset, e.g. 2026-03-14T09:00:00+02:00 */
  @IsOptional() @Type(() => Date) @IsDate() plannedStart?: Date;
  @IsOptional() @Type(() => Date) @IsDate() plannedEnd?: Date;
  @IsOptional() @IsInt() @Min(60) @Max(86_400) estimatedDurationSec?: number;
  @OptionalEnumProp(Priority, 'Priority') priority?: Priority;
  @OptionalEnumProp(Level, 'Level') energyRequired?: Level;
  @OptionalEnumProp(Level, 'Level') focusRequired?: Level;
  @IsOptional() @IsBoolean() isFixed?: boolean;
  @IsOptional() @Transform(cleanTags) @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(32, { each: true }) tags?: string[];
  /** Link this block to a task (a scheduled work block for it). */
  @IsOptional() @IsUUID() taskId?: string;
}

export class UpdateActivityDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(8000) notes?: string | null;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Type(() => Date) @IsDate() plannedStart?: Date | null;
  @IsOptional() @Type(() => Date) @IsDate() plannedEnd?: Date | null;
  @IsOptional() @IsInt() @Min(60) @Max(86_400) estimatedDurationSec?: number | null;
  @OptionalEnumProp(Priority, 'Priority') priority?: Priority;
  @OptionalEnumProp(Level, 'Level') energyRequired?: Level;
  @OptionalEnumProp(Level, 'Level') focusRequired?: Level;
  @IsOptional() @IsBoolean() isFixed?: boolean;
  @IsOptional() @Transform(cleanTags) @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(32, { each: true }) tags?: string[];
}

export class RescheduleActivityDto {
  @Type(() => Date) @IsDate() plannedStart: Date;
  @Type(() => Date) @IsDate() plannedEnd: Date;
}

export class DuplicateActivityDto {
  /** New planned start; the original length is kept. Omit to create an unscheduled copy. */
  @IsOptional() @Type(() => Date) @IsDate() plannedStart?: Date;
}

export class ActivityQueryDto extends PaginationQueryDto {
  /** Only activities whose plan or tracked time overlaps [from, to). */
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  /** Comma-separated statuses. */
  @IsOptional() @Transform(toArray) @IsArray() @IsIn(Object.values(ActivityStatus), { each: true }) status?: ActivityStatus[];
  @IsOptional() @IsUUID() categoryId?: string;
  /** Case-insensitive search in title, description, notes and tags. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['plannedStart', 'createdAt', 'updatedAt', 'title']) sort?: 'plannedStart' | 'createdAt' | 'updatedAt' | 'title';
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}
