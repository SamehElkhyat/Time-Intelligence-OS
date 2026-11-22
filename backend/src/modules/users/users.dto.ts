import { AvailabilityKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { EnumOut, EnumProp, IsIanaTimezone } from '@/common/http/decorators';

export class UserDto {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  /** Seeded demonstration account. */
  isDemo: boolean;
  createdAt: Date;
}

export class PreferenceDto {
  /** IANA timezone, e.g. "Africa/Cairo". */
  timezone: string;
  locale: string;
  /** ISO weekday the week starts on (1 = Monday … 7 = Sunday). */
  weekStartsOn: number;
  use24HourClock: boolean;
  /** Default active hours (minutes from local midnight). */
  dayStartMinute: number;
  dayEndMinute: number;
  bufferMinutes: number;
  minSlotMinutes: number;
  deepWorkMinMinutes: number;
  dailyFocusGoalMinutes: number;
  breakAfterMinutes: number;
  focusPeakStartMinute: number | null;
  focusPeakEndMinute: number | null;
  notifyActivityReminders: boolean;
  notifyDeadlines: boolean;
  notifyWeeklyReport: boolean;
  reminderLeadMinutes: number;
  onboardingCompleted: boolean;
}

export class UpdateProfileDto {
  @IsString()
  @Length(1, 80)
  displayName: string;
}

export class UpdatePreferenceDto {
  @IsOptional() @IsIanaTimezone() timezone?: string;
  @IsOptional() @IsString() @Length(2, 16) locale?: string;
  @IsOptional() @IsInt() @Min(1) @Max(7) weekStartsOn?: number;
  @IsOptional() @IsBoolean() use24HourClock?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1380) dayStartMinute?: number;
  @IsOptional() @IsInt() @Min(60) @Max(1440) dayEndMinute?: number;
  @IsOptional() @IsInt() @Min(0) @Max(60) bufferMinutes?: number;
  @IsOptional() @IsInt() @Min(5) @Max(120) minSlotMinutes?: number;
  @IsOptional() @IsInt() @Min(20) @Max(240) deepWorkMinMinutes?: number;
  @IsOptional() @IsInt() @Min(15) @Max(960) dailyFocusGoalMinutes?: number;
  @IsOptional() @IsInt() @Min(25) @Max(360) breakAfterMinutes?: number;
  /** Send null for both to clear the declared focus window. */
  @IsOptional() @IsInt() @Min(0) @Max(1439) focusPeakStartMinute?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(1440) focusPeakEndMinute?: number | null;
  @IsOptional() @IsBoolean() notifyActivityReminders?: boolean;
  @IsOptional() @IsBoolean() notifyDeadlines?: boolean;
  @IsOptional() @IsBoolean() notifyWeeklyReport?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(120) reminderLeadMinutes?: number;
}

export class AvailabilityRuleDto {
  /** ISO weekday 1..7 */
  @IsInt() @Min(1) @Max(7) weekday: number;
  @IsInt() @Min(0) @Max(1439) startMinute: number;
  @IsInt() @Min(1) @Max(1440) endMinute: number;
  @EnumProp(AvailabilityKind, 'AvailabilityKind') kind: AvailabilityKind;
  @IsOptional() @IsString() @MaxLength(80) label?: string;
}

export class AvailabilityRuleOutDto {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  @EnumOut(AvailabilityKind, 'AvailabilityKind') kind: AvailabilityKind;
  label: string | null;
}

export class ReplaceAvailabilityDto {
  @IsArray()
  @ArrayMaxSize(70)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityRuleDto)
  rules: AvailabilityRuleDto[];
}

export class CategoryDto {
  id: string;
  key: string;
  name: string;
  color: string;
  timeClass: string;
  isCommitment: boolean;
}
