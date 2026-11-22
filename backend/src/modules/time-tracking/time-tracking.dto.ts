import { SessionSource, SessionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateIf } from 'class-validator';
import { EnumOut } from '@/common/http/decorators';
import { PageMetaDto, PaginationQueryDto } from '@/common/http/pagination.dto';
import { CategoryRefDto } from '../activities/activities.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SegmentDto {
  id: string;
  startedAt: Date;
  /** Null while running. */
  endedAt: Date | null;
}

export class TimeSessionDto {
  id: string;
  activityId: string;
  activityTitle: string;
  category: CategoryRefDto;
  @EnumOut(SessionStatus, 'SessionStatus') status: SessionStatus;
  @EnumOut(SessionSource, 'SessionSource') source: SessionSource;
  startedAt: Date;
  endedAt: Date | null;
  /** Tracked seconds, computed by the server from persisted timestamps. */
  durationSec: number;
  pauseCount: number;
  note: string | null;
  /** The stop time was reconstructed because the timer was left running. */
  autoStopped: boolean;
  /** Concurrency token: send it back as expectedVersion to detect stale tabs. */
  version: number;
  segments: SegmentDto[];
}

export class ActiveTimerDto {
  /** Null when no timer is running or paused. */
  session: TimeSessionDto | null;
  /** Server clock at the moment `elapsedSec` was computed. */
  serverTime: Date;
  /**
   * Tracked seconds at `serverTime`. While the session is RUNNING the client adds its own
   * monotonic time since receiving this response — it never counts on its own.
   */
  elapsedSec: number;
  /** Planned/estimated total for the activity, when known. */
  expectedTotalSec: number | null;
}

export class StartTimerDto {
  /** Existing activity to track. Omit to quick-start a new ad-hoc activity with title + categoryId. */
  @IsOptional() @IsUUID() activityId?: string;

  @ValidateIf((o: StartTimerDto) => !o.activityId)
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  title?: string;

  @ValidateIf((o: StartTimerDto) => !o.activityId)
  @IsUUID()
  categoryId?: string;
}

export class TimerActionDto {
  /** Optional optimistic-concurrency check; 409 TIMER_STATE_CHANGED if another tab acted first. */
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}

export class StopTimerDto extends TimerActionDto {
  /** Also mark the activity as completed. */
  @IsOptional() @IsBoolean() complete?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class StartTimerResultDto {
  timer: ActiveTimerDto;
  /** Set when starting this timer stopped a different running activity (activity switch). */
  switchedFromSessionId: string | null;
}

export class ManualEntryDto {
  @IsUUID() activityId: string;
  @Type(() => Date) @IsDate() startedAt: Date;
  @Type(() => Date) @IsDate() endedAt: Date;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class CorrectSessionDto {
  @Type(() => Date) @IsDate() startedAt: Date;
  @Type(() => Date) @IsDate() endedAt: Date;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  /** Why the entry is being corrected. Stored in the audit trail. */
  @Transform(trim) @IsString() @Length(3, 300) reason: string;
}

export class DeleteSessionDto {
  @Transform(trim) @IsString() @Length(3, 300) reason: string;
}

export class SessionQueryDto extends PaginationQueryDto {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @IsUUID() activityId?: string;
}

export class SessionListDto {
  items: TimeSessionDto[];
  meta: PageMetaDto;
  /** Total tracked seconds across all sessions matching the filter (not just this page). */
  totalDurationSec: number;
}

export class CorrectionDto {
  id: string;
  action: string;
  reason: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}
