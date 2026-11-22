import { Prisma, RecurrenceFrequency, RecurrenceRule } from '@prisma/client';
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';
import { EnumOut, EnumProp, IsLocalDateString } from '@/common/http/decorators';
import { DomainError } from '@/common/http/errors';
import { addDays, dateColumnToLocalDate, LocalDate, localDateToDateColumn } from '@/common/time/time';
import { occurrenceDates, RecurrenceSpec } from './domain/recurrence';

export class RecurrenceDto {
  @EnumProp(RecurrenceFrequency, 'RecurrenceFrequency') frequency: RecurrenceFrequency;
  /** Every N days / weeks / months. */
  @IsOptional() @IsInt() @Min(1) @Max(52) interval?: number;
  /** ISO weekdays (1 = Monday … 7 = Sunday) for weekly rules. */
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) byWeekday?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(31) byMonthDay?: number;
  /** First local date of the series. Defaults to today. */
  @IsOptional() @IsLocalDateString() startDate?: string;
  @IsOptional() @IsLocalDateString() untilDate?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) count?: number;
}

export class RecurrenceOutDto {
  @EnumOut(RecurrenceFrequency, 'RecurrenceFrequency') frequency: RecurrenceFrequency;
  interval: number;
  byWeekday: number[];
  byMonthDay: number | null;
  startDate: string;
  untilDate: string | null;
  count: number | null;
  exDates: string[];
}

export function ruleCreateData(userId: string, dto: RecurrenceDto, today: LocalDate): Prisma.RecurrenceRuleUncheckedCreateInput {
  const startDate = dto.startDate ?? today;
  if (dto.untilDate && dto.untilDate < startDate) {
    throw DomainError.badRequest('INVALID_RECURRENCE', 'The recurrence end date must not be before its start date.');
  }
  return {
    userId,
    frequency: dto.frequency,
    interval: dto.interval ?? 1,
    byWeekday: dto.frequency === 'WEEKLY' ? [...(dto.byWeekday ?? [])].sort((a, b) => a - b) : [],
    byMonthDay: dto.frequency === 'MONTHLY' ? (dto.byMonthDay ?? null) : null,
    startDate: localDateToDateColumn(startDate),
    untilDate: dto.untilDate ? localDateToDateColumn(dto.untilDate) : null,
    count: dto.count ?? null,
  };
}

export function toRecurrenceOut(rule: RecurrenceRule): RecurrenceOutDto {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    byWeekday: rule.byWeekday,
    byMonthDay: rule.byMonthDay,
    startDate: dateColumnToLocalDate(rule.startDate),
    untilDate: rule.untilDate ? dateColumnToLocalDate(rule.untilDate) : null,
    count: rule.count,
    exDates: rule.exDates.map(dateColumnToLocalDate),
  };
}

/** First occurrence strictly after `after`, looking up to ~13 months ahead. */
export function nextOccurrenceAfter(rule: RecurrenceSpec, after: LocalDate): LocalDate | null {
  return occurrenceDates(rule, addDays(after, 1), addDays(after, 400))[0] ?? null;
}
