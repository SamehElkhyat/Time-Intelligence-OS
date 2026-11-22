import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsLocalDateString } from '@/common/http/decorators';

const CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'];
const STRIP_STATES = ['TRACKED', 'PLANNED_UNTRACKED', 'UNKNOWN', 'BUSY', 'BUFFER', 'BLOCKED', 'FREE', 'FRAGMENT', 'OUTSIDE_HOURS'];

export class ConfidenceFactorDto {
  code: string;
  /** Points removed from 100. */
  penalty: number;
  message: string;
}

export class FreeWindowDto {
  start: Date;
  end: Date;
  durationSec: number;
  /** 0..100 */
  confidenceScore: number;
  @ApiProperty({ enum: CONFIDENCE, enumName: 'ConfidenceLevel' }) confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Why the confidence is not 100. Empty for fully confirmed availability. */
  factors: ConfidenceFactorDto[];
  precededBy: string | null;
  followedBy: string | null;
}

export class ConflictDto {
  aId: string;
  aTitle: string;
  bId: string;
  bTitle: string;
  start: Date;
  end: Date;
  overlapSec: number;
  @ApiProperty({ enum: ['HARD', 'SOFT'], enumName: 'ConflictSeverity' }) severity: 'HARD' | 'SOFT';
}

export class StripSegmentDto {
  start: Date;
  end: Date;
  /**
   * Past: TRACKED (measured), PLANNED_UNTRACKED (planned, no tracking), UNKNOWN (no data — not free).
   * Future: BUSY, BUFFER, BLOCKED, FREE (offered), FRAGMENT (free but below minimum slot).
   * OUTSIDE_HOURS: outside the user's active hours.
   */
  @ApiProperty({ enum: STRIP_STATES, enumName: 'StripState' }) state: string;
}

export class PlannedBlockDto {
  /** Activity id, or `${scheduleEventId}:${date}` for a recurring occurrence. */
  id: string;
  @ApiProperty({ enum: ['ACTIVITY', 'RECURRING'], enumName: 'PlannedBlockKind' }) kind: 'ACTIVITY' | 'RECURRING';
  title: string;
  start: Date;
  end: Date;
  categoryKey: string;
  categoryName: string;
  color: string;
  isFixed: boolean;
  done: boolean;
  status: string | null;
  /** Seconds tracked on this block's activity (0 for recurring occurrences). */
  actualDurationSec: number;
  scheduleEventId: string | null;
  taskId: string | null;
}

export class AvailabilitySummaryDto {
  /** Bookable future time in offered windows. */
  freeSec: number;
  highConfidenceFreeSec: number;
  fragmentSec: number;
  busyFutureSec: number;
  bufferSec: number;
  plannedSec: number;
  trackedSec: number;
  /** Past planned time without tracking — unverified. */
  plannedUntrackedSec: number;
  /** Past active-hours time with no plan and no tracking. Unknown, NOT free. */
  unknownSec: number;
  conflictCount: number;
}

export class IntervalDto {
  start: Date;
  end: Date;
}

export class AvailabilityDayDto {
  date: string;
  timezone: string;
  /** Instant range of the local day (23–25h long around DST changes). */
  range: IntervalDto;
  now: Date;
  isToday: boolean;
  activeHours: IntervalDto[];
  hasExplicitAvailability: boolean;
  windows: FreeWindowDto[];
  conflicts: ConflictDto[];
  strip: StripSegmentDto[];
  blocks: PlannedBlockDto[];
  summary: AvailabilitySummaryDto;
}

export class AvailabilityRangeDayDto {
  date: string;
  summary: AvailabilitySummaryDto;
  windowCount: number;
  longestWindowSec: number;
}

export class SlotDto {
  date: string;
  start: Date;
  end: Date;
  /** The free window the slot was taken from. */
  windowStart: Date;
  windowEnd: Date;
  confidenceScore: number;
  @ApiProperty({ enum: CONFIDENCE, enumName: 'ConfidenceLevel' }) confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export class DayQueryDto {
  /** Local date (YYYY-MM-DD) in the user's timezone. Defaults to today. */
  @IsOptional() @IsLocalDateString() date?: string;
}

export class RangeQueryDto {
  @IsLocalDateString() from: string;
  @IsLocalDateString() to: string;
}

export class SlotQueryDto {
  @Type(() => Number) @IsInt() @Min(5) @Max(720) durationMin: number;
  /** First local date to search. Defaults to today. */
  @IsOptional() @IsLocalDateString() from?: string;
  /** Number of days to search (default 3, max 14). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(14) days?: number;
}
