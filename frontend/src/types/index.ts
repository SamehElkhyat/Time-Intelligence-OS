/**
 * Domain types. Every shape comes from the backend's OpenAPI document (api.gen.ts, regenerated
 * with `pnpm api:types`), so the frontend cannot drift from the API contract.
 */
import type { components } from './api.gen';

type S = components['schemas'];

/** Error envelope returned by every endpoint (see docs/API_CONTRACTS.md). */
export interface ApiErrorBody {
  statusCode: number;
  /** Stable machine-readable code, e.g. VALIDATION_ERROR, TIMER_ALREADY_ACTIVE. */
  code: string;
  message: string;
  details?: string[];
  requestId?: string;
}
export type SessionPayload = S['SessionDto'];
export type User = S['UserDto'];
export type Preference = S['PreferenceDto'];
export type UpdatePreference = S['UpdatePreferenceDto'];
export type Category = S['CategoryDto'];
export type CategoryRef = S['CategoryRefDto'];
export type AvailabilityRule = S['AvailabilityRuleOutDto'];
export type DeviceSession = S['DeviceSessionDto'];

export type Activity = S['ActivityDto'];
export type ActivityList = S['ActivityListDto'];
export type CreateActivity = S['CreateActivityDto'];
export type UpdateActivity = S['UpdateActivityDto'];

export type TimeSession = S['TimeSessionDto'];
export type ActiveTimer = S['ActiveTimerDto'];
export type SessionList = S['SessionListDto'];
export type Correction = S['CorrectionDto'];

export type Task = S['TaskDto'];
export type TaskList = S['TaskListDto'];
export type CreateTask = S['CreateTaskDto'];
export type UpdateTask = S['UpdateTaskDto'];
export type TaskHistoryEntry = S['TaskHistoryEntryDto'];

export type AvailabilityDay = S['AvailabilityDayDto'];
export type FreeWindow = S['FreeWindowDto'];
export type Conflict = S['ConflictDto'];
export type PlannedBlock = S['PlannedBlockDto'];
export type StripSegment = S['StripSegmentDto'];
export type Slot = S['SlotDto'];
export type AvailabilityRangeDay = S['AvailabilityRangeDayDto'];

export type Recommendation = S['RecommendationDto'];
export type RecommendationBatch = S['RecommendationBatchDto'];
export type NextAction = S['NextActionDto'];
export type AcceptResult = S['AcceptResultDto'];

export type EnergyOverview = S['EnergyOverviewDto'];
export type EnergyLog = S['EnergyLogDto'];
export type Plan = S['PlanDto'];
export type ApplyPlanResult = S['ApplyPlanResultDto'];
export type ScheduleEvent = S['ScheduleEventDto'];

export type Dashboard = S['DashboardDto'];
export type DailyAnalytics = S['DailyAnalyticsDto'];
export type AnalyticsSummary = S['AnalyticsSummaryDto'];
export type Report = S['ReportDto'];
export type LeakageReport = S['LeakageReportDto'];
export type PatternReport = S['PatternReportDto'];

export type CoachStatus = S['CoachStatusDto'];
export type CoachReply = S['CoachReplyDto'];
export type CoachMessage = S['CoachMessageDto'];
export type ConversationSummary = S['ConversationSummaryDto'];
export type ConversationDetail = S['ConversationDetailDto'];
export type PendingAction = S['PendingActionDto'];

export type AppNotification = S['NotificationDto'];
export type NotificationList = S['NotificationListDto'];

export type Priority = S['CreateActivityDto']['priority'] & string;
export type Level = NonNullable<S['CreateActivityDto']['energyRequired']>;
export type TaskStatus = S['TaskDto']['status'];
export type ActivityStatus = S['ActivityDto']['status'];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const LEVELS = ['VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'] as const;
export const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const TIMES_OF_DAY = ['ANY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT'] as const;
