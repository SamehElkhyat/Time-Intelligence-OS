-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "Level" AS ENUM ('VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimeClass" AS ENUM ('PRODUCTIVE', 'REST', 'LEISURE', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('RUNNING', 'PAUSED', 'STOPPED');

-- CreateEnum
CREATE TYPE "SessionSource" AS ENUM ('TIMER', 'MANUAL');

-- CreateEnum
CREATE TYPE "TimeOfDay" AS ENUM ('ANY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AvailabilityKind" AS ENUM ('AVAILABLE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "WindowConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('GENERATED', 'ACCEPTED', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ACTIVITY_REMINDER', 'DEADLINE_APPROACHING', 'TIMER_LONG_RUNNING', 'REPORT_READY', 'RECOMMENDATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "AiRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "PendingActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "userAgent" VARCHAR(400),
    "ipAddress" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" UUID NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en-US',
    "weekStartsOn" SMALLINT NOT NULL DEFAULT 1,
    "use24HourClock" BOOLEAN NOT NULL DEFAULT true,
    "dayStartMinute" SMALLINT NOT NULL DEFAULT 420,
    "dayEndMinute" SMALLINT NOT NULL DEFAULT 1380,
    "bufferMinutes" SMALLINT NOT NULL DEFAULT 10,
    "minSlotMinutes" SMALLINT NOT NULL DEFAULT 15,
    "deepWorkMinMinutes" SMALLINT NOT NULL DEFAULT 50,
    "dailyFocusGoalMinutes" SMALLINT NOT NULL DEFAULT 240,
    "breakAfterMinutes" SMALLINT NOT NULL DEFAULT 90,
    "focusPeakStartMinute" SMALLINT,
    "focusPeakEndMinute" SMALLINT,
    "notifyActivityReminders" BOOLEAN NOT NULL DEFAULT true,
    "notifyDeadlines" BOOLEAN NOT NULL DEFAULT true,
    "notifyWeeklyReport" BOOLEAN NOT NULL DEFAULT true,
    "reminderLeadMinutes" SMALLINT NOT NULL DEFAULT 10,
    "onboardingCompletedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserAvailability" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "startMinute" SMALLINT NOT NULL,
    "endMinute" SMALLINT NOT NULL,
    "kind" "AvailabilityKind" NOT NULL DEFAULT 'AVAILABLE',
    "label" VARCHAR(80),

    CONSTRAINT "UserAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityCategory" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "color" VARCHAR(9) NOT NULL,
    "timeClass" "TimeClass" NOT NULL DEFAULT 'NEUTRAL',
    "isCommitment" BOOLEAN NOT NULL DEFAULT false,
    "position" SMALLINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(4000),
    "notes" VARCHAR(8000),
    "plannedStart" TIMESTAMPTZ(3),
    "plannedEnd" TIMESTAMPTZ(3),
    "estimatedDurationSec" INTEGER,
    "actualDurationSec" INTEGER NOT NULL DEFAULT 0,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "energyRequired" "Level" NOT NULL DEFAULT 'MODERATE',
    "focusRequired" "Level" NOT NULL DEFAULT 'MODERATE',
    "status" "ActivityStatus" NOT NULL DEFAULT 'PLANNED',
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "taskId" UUID,
    "scheduleEventId" UUID,
    "occurrenceDate" DATE,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'RUNNING',
    "source" "SessionSource" NOT NULL DEFAULT 'TIMER',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "pauseCount" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "autoStopped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ActivitySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionSegment" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SessionSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnergyLog" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "energy" "Level" NOT NULL,
    "focus" "Level" NOT NULL,
    "note" VARCHAR(500),

    CONSTRAINT "EnergyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "categoryId" UUID,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(4000),
    "estimatedDurationSec" INTEGER NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "deadline" TIMESTAMPTZ(3),
    "energyRequired" "Level" NOT NULL DEFAULT 'MODERATE',
    "focusRequired" "Level" NOT NULL DEFAULT 'MODERATE',
    "complexity" SMALLINT NOT NULL DEFAULT 3,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredTimeOfDay" "TimeOfDay" NOT NULL DEFAULT 'ANY',
    "recurrenceRuleId" UUID,
    "seriesId" UUID,
    "occurrenceDate" DATE,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subtask" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "position" SMALLINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subtask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" UUID NOT NULL,
    "dependsOnId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleEvent" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "recurrenceRuleId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "startMinute" SMALLINT NOT NULL,
    "durationMin" SMALLINT NOT NULL,
    "isFixed" BOOLEAN NOT NULL DEFAULT true,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "energyRequired" "Level" NOT NULL DEFAULT 'MODERATE',
    "focusRequired" "Level" NOT NULL DEFAULT 'MODERATE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurrenceRule" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" SMALLINT NOT NULL DEFAULT 1,
    "byWeekday" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "byMonthDay" SMALLINT,
    "startDate" DATE NOT NULL,
    "untilDate" DATE,
    "count" INTEGER,
    "exDates" DATE[] DEFAULT ARRAY[]::DATE[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurrenceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityWindow" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "confidence" "WindowConfidence" NOT NULL,
    "confidenceScore" SMALLINT NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "score" SMALLINT NOT NULL,
    "confidence" SMALLINT NOT NULL,
    "reasons" TEXT[],
    "breakdown" JSONB NOT NULL,
    "estimatedDurationSec" INTEGER NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'GENERATED',
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductivityMetric" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "value" INTEGER NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "confidence" SMALLINT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "payload" JSONB,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductivityMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAnalytics" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "plannedSec" INTEGER NOT NULL DEFAULT 0,
    "trackedSec" INTEGER NOT NULL DEFAULT 0,
    "productiveSec" INTEGER NOT NULL DEFAULT 0,
    "focusSec" INTEGER NOT NULL DEFAULT 0,
    "restSec" INTEGER NOT NULL DEFAULT 0,
    "leisureSec" INTEGER NOT NULL DEFAULT 0,
    "neutralSec" INTEGER NOT NULL DEFAULT 0,
    "deepWorkSessions" INTEGER NOT NULL DEFAULT 0,
    "leakageSec" INTEGER NOT NULL DEFAULT 0,
    "unknownSec" INTEGER NOT NULL DEFAULT 0,
    "plannedActivities" INTEGER NOT NULL DEFAULT 0,
    "completedActivities" INTEGER NOT NULL DEFAULT 0,
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "contextSwitches" INTEGER NOT NULL DEFAULT 0,
    "adherencePct" SMALLINT,
    "estimationAccuracyPct" SMALLINT,
    "productivityScore" SMALLINT,
    "scoreBreakdown" JSONB,
    "categoryBreakdown" JSONB NOT NULL,
    "hourly" JSONB NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyAnalytics" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "plannedSec" INTEGER NOT NULL DEFAULT 0,
    "trackedSec" INTEGER NOT NULL DEFAULT 0,
    "productiveSec" INTEGER NOT NULL DEFAULT 0,
    "focusSec" INTEGER NOT NULL DEFAULT 0,
    "restSec" INTEGER NOT NULL DEFAULT 0,
    "leakageSec" INTEGER NOT NULL DEFAULT 0,
    "deepWorkSessions" INTEGER NOT NULL DEFAULT 0,
    "completedActivities" INTEGER NOT NULL DEFAULT 0,
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "activeDays" SMALLINT NOT NULL DEFAULT 0,
    "avgProductivityScore" SMALLINT,
    "summary" JSONB NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "href" VARCHAR(300),
    "dedupeKey" VARCHAR(200),
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConversation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AIConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInteraction" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "AiRole" NOT NULL,
    "content" TEXT NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(80),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "toolCalls" JSONB,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIPendingAction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PendingActionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AIPendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "actor" VARCHAR(40) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(60) NOT NULL,
    "entityId" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ipAddress" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "aggregateType" VARCHAR(60) NOT NULL,
    "aggregateId" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(1000),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "eventId" UUID NOT NULL,
    "handler" VARCHAR(80) NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("eventId","handler")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_type_idx" ON "AuthToken"("userId", "type");

-- CreateIndex
CREATE INDEX "UserAvailability_userId_weekday_idx" ON "UserAvailability"("userId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityCategory_userId_key_key" ON "ActivityCategory"("userId", "key");

-- CreateIndex
CREATE INDEX "Activity_userId_plannedStart_plannedEnd_idx" ON "Activity"("userId", "plannedStart", "plannedEnd");

-- CreateIndex
CREATE INDEX "Activity_userId_status_idx" ON "Activity"("userId", "status");

-- CreateIndex
CREATE INDEX "Activity_userId_categoryId_idx" ON "Activity"("userId", "categoryId");

-- CreateIndex
CREATE INDEX "Activity_userId_deletedAt_createdAt_idx" ON "Activity"("userId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_taskId_idx" ON "Activity"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_scheduleEventId_occurrenceDate_key" ON "Activity"("scheduleEventId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "ActivitySession_userId_startedAt_idx" ON "ActivitySession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "ActivitySession_activityId_startedAt_idx" ON "ActivitySession"("activityId", "startedAt");

-- CreateIndex
CREATE INDEX "ActivitySession_userId_status_idx" ON "ActivitySession"("userId", "status");

-- CreateIndex
CREATE INDEX "SessionSegment_sessionId_startedAt_idx" ON "SessionSegment"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "SessionSegment_userId_startedAt_endedAt_idx" ON "SessionSegment"("userId", "startedAt", "endedAt");

-- CreateIndex
CREATE INDEX "EnergyLog_userId_recordedAt_idx" ON "EnergyLog"("userId", "recordedAt");

-- CreateIndex
CREATE INDEX "Task_userId_status_deadline_idx" ON "Task"("userId", "status", "deadline");

-- CreateIndex
CREATE INDEX "Task_userId_deletedAt_createdAt_idx" ON "Task"("userId", "deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_seriesId_occurrenceDate_key" ON "Task"("seriesId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "Subtask_taskId_position_idx" ON "Subtask"("taskId", "position");

-- CreateIndex
CREATE INDEX "TaskDependency_dependsOnId_idx" ON "TaskDependency"("dependsOnId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_userId_name_key" ON "Schedule"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleEvent_recurrenceRuleId_key" ON "ScheduleEvent"("recurrenceRuleId");

-- CreateIndex
CREATE INDEX "ScheduleEvent_userId_isActive_idx" ON "ScheduleEvent"("userId", "isActive");

-- CreateIndex
CREATE INDEX "AvailabilityWindow_userId_date_idx" ON "AvailabilityWindow"("userId", "date");

-- CreateIndex
CREATE INDEX "Recommendation_userId_status_generatedAt_idx" ON "Recommendation"("userId", "status", "generatedAt");

-- CreateIndex
CREATE INDEX "Recommendation_taskId_idx" ON "Recommendation"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductivityMetric_userId_key_periodStart_periodEnd_key" ON "ProductivityMetric"("userId", "key", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAnalytics_userId_date_key" ON "DailyAnalytics"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyAnalytics_userId_weekStart_key" ON "WeeklyAnalytics"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AIConversation_userId_updatedAt_idx" ON "AIConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AIInteraction_conversationId_createdAt_idx" ON "AIInteraction"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIInteraction_userId_role_createdAt_idx" ON "AIInteraction"("userId", "role", "createdAt");

-- CreateIndex
CREATE INDEX "AIPendingAction_userId_status_idx" ON "AIPendingAction"("userId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_userId_createdAt_idx" ON "OutboxEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAvailability" ADD CONSTRAINT "UserAvailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityCategory" ADD CONSTRAINT "ActivityCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ActivityCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_scheduleEventId_fkey" FOREIGN KEY ("scheduleEventId") REFERENCES "ScheduleEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySession" ADD CONSTRAINT "ActivitySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySession" ADD CONSTRAINT "ActivitySession_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSegment" ADD CONSTRAINT "SessionSegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ActivitySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionSegment" ADD CONSTRAINT "SessionSegment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnergyLog" ADD CONSTRAINT "EnergyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ActivityCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrenceRuleId_fkey" FOREIGN KEY ("recurrenceRuleId") REFERENCES "RecurrenceRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ActivityCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_recurrenceRuleId_fkey" FOREIGN KEY ("recurrenceRuleId") REFERENCES "RecurrenceRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurrenceRule" ADD CONSTRAINT "RecurrenceRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityWindow" ADD CONSTRAINT "AvailabilityWindow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductivityMetric" ADD CONSTRAINT "ProductivityMetric_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAnalytics" ADD CONSTRAINT "DailyAnalytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyAnalytics" ADD CONSTRAINT "WeeklyAnalytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConversation" ADD CONSTRAINT "AIConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteraction" ADD CONSTRAINT "AIInteraction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteraction" ADD CONSTRAINT "AIInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPendingAction" ADD CONSTRAINT "AIPendingAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPendingAction" ADD CONSTRAINT "AIPendingAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Hand-written constraints (not expressible in the Prisma schema) ─────────

-- Timer invariant: a user can have at most ONE active (running or paused) session.
-- This is the database-level guard behind concurrent "start timer" requests.
CREATE UNIQUE INDEX "ActivitySession_one_active_per_user"
  ON "ActivitySession" ("userId")
  WHERE "status" IN ('RUNNING', 'PAUSED');

-- A session can have at most one open (running) segment.
CREATE UNIQUE INDEX "SessionSegment_one_open_per_session"
  ON "SessionSegment" ("sessionId")
  WHERE "endedAt" IS NULL;

-- Interval sanity.
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_planned_range_chk"
  CHECK (("plannedStart" IS NULL AND "plannedEnd" IS NULL)
      OR ("plannedStart" IS NOT NULL AND "plannedEnd" IS NOT NULL AND "plannedEnd" > "plannedStart"));
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_durations_chk"
  CHECK ("actualDurationSec" >= 0 AND ("estimatedDurationSec" IS NULL OR "estimatedDurationSec" > 0));
ALTER TABLE "SessionSegment"
  ADD CONSTRAINT "SessionSegment_range_chk"
  CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "ActivitySession"
  ADD CONSTRAINT "ActivitySession_range_chk"
  CHECK ("durationSec" >= 0 AND ("endedAt" IS NULL OR "endedAt" >= "startedAt"));
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_estimate_chk"
  CHECK ("estimatedDurationSec" > 0 AND "complexity" BETWEEN 1 AND 5);
ALTER TABLE "TaskDependency"
  ADD CONSTRAINT "TaskDependency_no_self_chk"
  CHECK ("taskId" <> "dependsOnId");
ALTER TABLE "UserAvailability"
  ADD CONSTRAINT "UserAvailability_range_chk"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
ALTER TABLE "UserPreference"
  ADD CONSTRAINT "UserPreference_day_range_chk"
  CHECK ("dayStartMinute" >= 0 AND "dayEndMinute" <= 1440 AND "dayEndMinute" > "dayStartMinute"
     AND "weekStartsOn" BETWEEN 1 AND 7);
ALTER TABLE "ScheduleEvent"
  ADD CONSTRAINT "ScheduleEvent_time_chk"
  CHECK ("startMinute" BETWEEN 0 AND 1439 AND "durationMin" BETWEEN 1 AND 1440);

-- Outbox relay scans only unpublished rows.
CREATE INDEX "OutboxEvent_unpublished_idx"
  ON "OutboxEvent" ("createdAt")
  WHERE "publishedAt" IS NULL;
