import { ApiProperty } from '@nestjs/swagger';
import { Level, Priority, RecommendationStatus } from '@prisma/client';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { EnumOut, IsLocalDateString, OptionalEnumProp } from '@/common/http/decorators';
import { ActivityDto } from '../activities/activities.dto';
import { EnergyStateDto } from '../scheduling/scheduling.dto';

export class FactorScoreDto {
  /** urgency | priority | fit | energy | focus | timeOfDay | history | momentum | leverage */
  factor: string;
  /** 0..1 */
  value: number;
  weight: number;
  /** Points this factor contributed to the 0..100 score. */
  points: number;
  note: string;
}

export class RecommendationWindowDto {
  start: Date;
  end: Date;
}

export class RecommendationDto {
  id: string;
  taskId: string;
  title: string;
  /** 0..100 */
  score: number;
  /** 0..100 — how well the inputs support this recommendation (not how good the task is). */
  confidence: number;
  /** Human-readable reasons, strongest first. Generated from the same numbers as the score. */
  reasons: string[];
  summary: string;
  /** Estimate adjusted by the user's own history. */
  estimatedDurationSec: number;
  suitableWindow: RecommendationWindowDto;
  breakdown: FactorScoreDto[];
  @EnumOut(RecommendationStatus, 'RecommendationStatus') status: RecommendationStatus;
  generatedAt: Date;
  @EnumOut(Priority, 'Priority') priority: Priority;
  deadline: Date | null;
  categoryName: string | null;
  categoryColor: string | null;
}

export class ExcludedTaskDto {
  taskId: string;
  title: string;
  @ApiProperty({ enum: ['NOT_ACTIONABLE', 'BLOCKED', 'ALREADY_SCHEDULED', 'TOO_LONG_FOR_LIMIT', 'NO_WINDOW'], enumName: 'ExclusionCode' })
  code: string;
  reason: string;
}

export class RecommendationBatchDto {
  generatedAt: Date | null;
  recommendations: RecommendationDto[];
  /** Open tasks that were considered but not recommended, with the reason. */
  excluded: ExcludedTaskDto[];
  /** The user state the scoring used. */
  userState: EnergyStateDto;
  /** Free windows that were considered. */
  windowCount: number;
  /** Set when the user-declared time was used because the calendar showed no free window now. */
  usedDeclaredTime: boolean;
}

export class NextActionDto {
  @ApiProperty({ type: RecommendationDto, nullable: true }) recommendation: RecommendationDto | null;
  /** Why there is nothing to recommend, when `recommendation` is null. */
  emptyReason: string | null;
}

export class GenerateRecommendationsDto {
  /** "I have N minutes": only tasks that fit are considered. */
  @IsOptional() @IsInt() @Min(5) @Max(720) availableMinutes?: number;
  /** Override the current energy level for this request. */
  @OptionalEnumProp(Level, 'Level') energy?: Level;
  @OptionalEnumProp(Level, 'Level') focus?: Level;
  /** Local date to recommend for. Defaults to today. */
  @IsOptional() @IsLocalDateString() date?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) limit?: number;
}

export class AcceptResultDto {
  recommendation: RecommendationDto;
  /** The work block created on the calendar. */
  activity: ActivityDto;
}
