import { ApiProperty } from '@nestjs/swagger';
import { Level, Priority } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
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
import { EnumOut, EnumProp, IsLocalDateString, OptionalEnumProp } from '@/common/http/decorators';
import { ActivityDto, CategoryRefDto } from '../activities/activities.dto';
import { RecurrenceDto, RecurrenceOutDto } from '../availability/recurrence.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const SOURCES = ['LOGGED', 'FORECAST', 'DECLARED', 'UNKNOWN'];

// ── Energy ───────────────────────────────────────────────────────────────────

export class LogEnergyDto {
  @EnumProp(Level, 'Level') energy: Level;
  @EnumProp(Level, 'Level') focus: Level;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class EnergyLogDto {
  id: string;
  recordedAt: Date;
  @EnumOut(Level, 'Level') energy: Level;
  @EnumOut(Level, 'Level') focus: Level;
  note: string | null;
}

export class HourExpectationDto {
  hour: number;
  /** 1..5, or null when there is no basis for an expectation. */
  energy: number | null;
  focus: number | null;
  @ApiProperty({ enum: ['LOGGED', 'DECLARED', 'UNKNOWN'], enumName: 'EnergyBasis' }) source: string;
  samples: number;
}

export class EnergyStateDto {
  /** 1..5, null when unknown. */
  energy: number | null;
  focus: number | null;
  /** LOGGED: recent check-in. FORECAST: from your history. DECLARED: from your preferences. UNKNOWN: no basis. */
  @ApiProperty({ enum: SOURCES, enumName: 'EnergySource' }) source: string;
  recordedAt: Date | null;
}

export class EnergyOverviewDto {
  current: EnergyStateDto;
  forecast: HourExpectationDto[];
  /** Check-ins the forecast is built from (last 60 days). */
  sampleSize: number;
  /** 0..100 */
  confidence: number;
}

export class EnergyQueryDto {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

// ── Recurring commitments ────────────────────────────────────────────────────

export class CreateScheduleEventDto {
  @Transform(trim) @IsString() @Length(1, 160) title: string;
  @IsUUID() categoryId: string;
  /** Local start time, minutes from midnight (0..1439). */
  @IsInt() @Min(0) @Max(1439) startMinute: number;
  @IsInt() @Min(5) @Max(1440) durationMin: number;
  @IsOptional() @IsBoolean() isFixed?: boolean;
  @OptionalEnumProp(Priority, 'Priority') priority?: Priority;
  @OptionalEnumProp(Level, 'Level') energyRequired?: Level;
  @OptionalEnumProp(Level, 'Level') focusRequired?: Level;
  @ValidateNested() @Type(() => RecurrenceDto) recurrence: RecurrenceDto;
}

export class UpdateScheduleEventDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1439) startMinute?: number;
  @IsOptional() @IsInt() @Min(5) @Max(1440) durationMin?: number;
  @IsOptional() @IsBoolean() isFixed?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @OptionalEnumProp(Priority, 'Priority') priority?: Priority;
  @OptionalEnumProp(Level, 'Level') energyRequired?: Level;
  @OptionalEnumProp(Level, 'Level') focusRequired?: Level;
  @IsOptional() @ValidateNested() @Type(() => RecurrenceDto) recurrence?: RecurrenceDto;
}

export class ScheduleEventDto {
  id: string;
  scheduleId: string;
  title: string;
  category: CategoryRefDto;
  startMinute: number;
  durationMin: number;
  isFixed: boolean;
  isActive: boolean;
  @EnumOut(Priority, 'Priority') priority: Priority;
  @EnumOut(Level, 'Level') energyRequired: Level;
  @EnumOut(Level, 'Level') focusRequired: Level;
  recurrence: RecurrenceOutDto;
  /** Next local dates on which it occurs (up to 5). */
  nextOccurrences: string[];
}

export class OccurrenceDateDto {
  @IsLocalDateString() date: string;
}

// ── Smart scheduling ─────────────────────────────────────────────────────────

export class PlanRequestDto {
  /** Local date to plan. Defaults to today. */
  @IsOptional() @IsLocalDateString() date?: string;
  /** Restrict the plan to these tasks. Default: every actionable, unscheduled task. */
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsUUID('all', { each: true }) taskIds?: string[];
}

export class PlanBlockDto {
  taskId: string;
  title: string;
  start: Date;
  end: Date;
  /** 0..100 */
  fitScore: number;
  reasons: string[];
  afterDeadline: boolean;
}

export class PlanBreakDto {
  start: Date;
  end: Date;
  reason: string;
}

export class UnscheduledDto {
  taskId: string;
  title: string;
  reason: string;
}

export class PlanDto {
  date: string;
  timezone: string;
  /** A proposal only — nothing is saved until it is applied. */
  blocks: PlanBlockDto[];
  breaks: PlanBreakDto[];
  unscheduled: UnscheduledDto[];
  scheduledSec: number;
  /** Free time on the day before the proposal. */
  freeSec: number;
  /** True when placement could not use any energy data. */
  energyUnknown: boolean;
  /** 0..100 confidence of the energy forecast used. */
  energyConfidence: number;
  consideredTasks: number;
}

export class ApplyBlockDto {
  @IsUUID() taskId: string;
  @Type(() => Date) @IsDate() start: Date;
  @Type(() => Date) @IsDate() end: Date;
}

export class ApplyPlanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ApplyBlockDto)
  blocks: ApplyBlockDto[];
}

export class ApplyFailureDto {
  taskId: string;
  code: string;
  message: string;
}

export class ApplyPlanResultDto {
  created: ActivityDto[];
  failed: ApplyFailureDto[];
}
