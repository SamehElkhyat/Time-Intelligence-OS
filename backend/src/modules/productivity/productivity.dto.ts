import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsLocalDateString } from '@/common/http/decorators';

const SUFFICIENCY = ['INSUFFICIENT', 'LOW', 'MEDIUM', 'HIGH'];

export class EvidenceDto {
  label: string;
  value: string;
}

export class LeakageInsightDto {
  @ApiProperty({
    enum: ['UNPLANNED_GAPS', 'EXCESSIVE_TRANSITIONS', 'CONTEXT_SWITCHING', 'REPEATED_INTERRUPTIONS', 'OVERLOADED_SCHEDULE', 'ESTIMATE_OVERRUNS', 'UNTRACKED_TIME', 'FREQUENT_RESCHEDULING'],
    enumName: 'LeakageType',
  })
  type: string;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'], enumName: 'Severity' }) severity: string;
  title: string;
  explanation: string;
  suggestion: string;
  /** Measured seconds affected; null when the pattern has no directly measurable cost. */
  @ApiProperty({ type: Number, nullable: true }) impactSec: number | null;
  evidence: EvidenceDto[];
}

export class LeakageTotalsDto {
  trackedSec: number;
  productiveSec: number;
  /** Tracked rest. Rest is never treated as wasted time. */
  restSec: number;
  leisureSec: number;
  /** Time deliberately planned for rest or leisure. */
  plannedDowntimeSec: number;
  /** The only bucket counted as leakage. */
  unplannedGapSec: number;
  /** No plan, no tracking: unknown. */
  unknownSec: number;
  plannedUntrackedSec: number;
  activePastSec: number;
}

export class LeakageReportDto {
  from: string;
  to: string;
  daysWithData: number;
  totals: LeakageTotalsDto;
  insights: LeakageInsightDto[];
}

export class PatternInsightDto {
  key: string;
  title: string;
  /** Probabilistic wording. When data is insufficient this says so instead of guessing. */
  statement: string;
  @ApiProperty({ enum: SUFFICIENCY, enumName: 'Sufficiency' }) sufficiency: string;
  /** 0..100 */
  confidence: number;
  sampleSize: number;
  sampleUnit: string;
  @ApiProperty({ type: Object, additionalProperties: true }) data: Record<string, unknown>;
}

export class ForecastDto {
  date: string;
  @ApiProperty({ type: Number, nullable: true }) expectedProductiveSec: number | null;
  @ApiProperty({ type: Number, nullable: true }) lowSec: number | null;
  @ApiProperty({ type: Number, nullable: true }) highSec: number | null;
  basis: string;
  @ApiProperty({ enum: SUFFICIENCY, enumName: 'Sufficiency' }) sufficiency: string;
  confidence: number;
  sampleSize: number;
}

export class PatternReportDto {
  /** Engine that produced the report (statistical baseline today; pluggable). */
  provider: string;
  @ApiProperty({ type: String, nullable: true }) periodStart: string | null;
  @ApiProperty({ type: String, nullable: true }) periodEnd: string | null;
  daysWithData: number;
  @ApiProperty({ enum: SUFFICIENCY, enumName: 'Sufficiency' }) sufficiency: string;
  insights: PatternInsightDto[];
  forecast: ForecastDto;
}

export class LeakageQueryDto {
  /** Defaults to the last 7 days ending today. */
  @IsOptional() @IsLocalDateString() from?: string;
  @IsOptional() @IsLocalDateString() to?: string;
}
