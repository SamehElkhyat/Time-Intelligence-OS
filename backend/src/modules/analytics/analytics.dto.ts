import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { IsLocalDateString } from '@/common/http/decorators';
import { FreeWindowDto, PlannedBlockDto } from '../availability/availability.dto';
import { ActiveTimerDto } from '../time-tracking/time-tracking.dto';

export class ScoreComponentDto {
  /** focus | adherence | completion | continuity */
  key: string;
  label: string;
  /** 0..1 */
  value: number;
  /** Effective weight after re-normalising over the components that could be measured. */
  weight: number;
  explanation: string;
}

export class CategoryBreakdownDto {
  categoryId: string;
  key: string;
  name: string;
  color: string;
  timeClass: string;
  plannedSec: number;
  trackedSec: number;
}

export class HourBucketDto {
  hour: number;
  trackedSec: number;
  productiveSec: number;
}

export class DailyAnalyticsDto {
  date: string;
  plannedSec: number;
  trackedSec: number;
  productiveSec: number;
  /** Productive time in uninterrupted segments of 25+ minutes. */
  focusSec: number;
  restSec: number;
  leisureSec: number;
  neutralSec: number;
  deepWorkSessions: number;
  /** Short unplanned gaps between tracked blocks. */
  leakageSec: number;
  /** Past active-hours time with no plan and no tracking — unknown, not free and not wasted. */
  unknownSec: number;
  plannedActivities: number;
  completedActivities: number;
  completedTasks: number;
  contextSwitches: number;
  /** Null = not measurable for this day (e.g. nothing was planned). */
  @ApiProperty({ type: Number, nullable: true }) adherencePct: number | null;
  @ApiProperty({ type: Number, nullable: true }) estimationAccuracyPct: number | null;
  /** 0..100, or null when nothing was tracked (no data is not a score of zero). */
  @ApiProperty({ type: Number, nullable: true }) productivityScore: number | null;
  scoreBreakdown: ScoreComponentDto[];
  categoryBreakdown: CategoryBreakdownDto[];
  hourly: HourBucketDto[];
}

export class DashboardMetricsDto {
  plannedSec: number;
  trackedSec: number;
  /** Bookable free time left today (from the availability engine). */
  availableSec: number;
  highConfidenceAvailableSec: number;
  plannedActivities: number;
  completedActivities: number;
  /** Open tasks (TODO + IN_PROGRESS). */
  pendingTasks: number;
  overdueTasks: number;
  completedTasksToday: number;
  @ApiProperty({ type: Number, nullable: true }) productivityScore: number | null;
  scoreBreakdown: ScoreComponentDto[];
  productiveSec: number;
  focusSec: number;
  focusGoalSec: number;
  breakSec: number;
  leakageSec: number;
  unknownSec: number;
  plannedUntrackedSec: number;
  deepWorkSessions: number;
  conflictCount: number;
}

export class DashboardDto {
  date: string;
  timezone: string;
  now: Date;
  isToday: boolean;
  /** True until the user has created any activity or task — drives onboarding empty states. */
  isEmptyAccount: boolean;
  metrics: DashboardMetricsDto;
  timer: ActiveTimerDto;
  /** Next planned blocks after now. */
  upcoming: PlannedBlockDto[];
  /** Free windows left today, soonest first. */
  windows: FreeWindowDto[];
  categoryBreakdown: CategoryBreakdownDto[];
  hourly: HourBucketDto[];
}

export class TotalsDto {
  plannedSec: number;
  trackedSec: number;
  productiveSec: number;
  focusSec: number;
  restSec: number;
  leisureSec: number;
  leakageSec: number;
  unknownSec: number;
  deepWorkSessions: number;
  completedActivities: number;
  completedTasks: number;
  /** Days in the period with any tracked time. */
  activeDays: number;
  @ApiProperty({ type: Number, nullable: true }) avgProductivityScore: number | null;
  @ApiProperty({ type: Number, nullable: true }) avgAdherencePct: number | null;
  @ApiProperty({ type: Number, nullable: true }) avgEstimationAccuracyPct: number | null;
  /** Completed ÷ (completed + still-open tasks that were due) in the period. Null when nothing was due or done. */
  @ApiProperty({ type: Number, nullable: true }) taskCompletionRatePct: number | null;
  /** Mean length of stopped tracking sessions in the period. */
  @ApiProperty({ type: Number, nullable: true }) avgSessionSec: number | null;
}

export class HeatmapCellDto {
  /** ISO weekday 1..7 */
  weekday: number;
  hour: number;
  /** Average tracked seconds in this weekday-hour across the period. */
  avgTrackedSec: number;
  avgProductiveSec: number;
}

export class AnalyticsSummaryDto {
  from: string;
  to: string;
  timezone: string;
  totals: TotalsDto;
  days: DailyAnalyticsDto[];
  categories: CategoryBreakdownDto[];
  heatmap: HeatmapCellDto[];
}

export class ChangeDto {
  metric: string;
  current: number;
  previous: number;
  /** Null when the previous value is zero (no meaningful percentage). */
  @ApiProperty({ type: Number, nullable: true }) changePct: number | null;
}

export class ReportDto {
  kind: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** False while the period is still running. */
  isComplete: boolean;
  summary: AnalyticsSummaryDto;
  previousTotals: TotalsDto;
  changes: ChangeDto[];
  /** Plain-language statements derived from the numbers above. */
  highlights: string[];
}

export class DateQueryDto {
  @IsOptional() @IsLocalDateString() date?: string;
}

export class RangeDto {
  @IsLocalDateString() from: string;
  @IsLocalDateString() to: string;
}

export class WeeklyReportQueryDto {
  /** Any local date inside the week. Defaults to the current week. */
  @IsOptional() @IsLocalDateString() date?: string;
}

export class MonthlyReportQueryDto {
  /** YYYY-MM. Defaults to the current month. */
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be in YYYY-MM format' }) month?: string;
}
