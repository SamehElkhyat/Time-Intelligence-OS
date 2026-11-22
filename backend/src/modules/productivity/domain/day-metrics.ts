import { clip, clipAll, coveredMs, Interval, intersectIntervals, mergeIntervals, splitAt, subtractIntervals } from '@/common/time/intervals';
import { localHour, MS_PER_HOUR, MS_PER_MINUTE, wholeSeconds } from '@/common/time/time';

/**
 * Daily productivity metrics — pure computation over one local day.
 *
 * Every number is derived from stored plans and tracked segments. When something cannot be
 * measured (no plan to adhere to, nothing tracked) the metric is `null`, never a made-up value.
 */

export type TimeClassKey = 'PRODUCTIVE' | 'REST' | 'LEISURE' | 'NEUTRAL';

export interface MetricCategory {
  id: string;
  key: string;
  name: string;
  color: string;
  timeClass: TimeClassKey;
}

export interface MetricActivity {
  id: string;
  title: string;
  categoryId: string;
  plannedStart: number | null;
  plannedEnd: number | null;
  estimatedDurationSec: number | null;
  /** All-time tracked seconds of the activity (not only this day). */
  actualDurationSec: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';
  completedAt: number | null;
  rescheduleCount: number;
}

export interface MetricSegment extends Interval {
  activityId: string;
  sessionId: string;
}

export interface DayMetricsInput {
  /** Local day [start, end). */
  range: Interval;
  now: number;
  timezone: string;
  activeHours: Interval[];
  categories: MetricCategory[];
  /** Activities planned in the range, tracked in the range, or completed in the range. */
  activities: MetricActivity[];
  /** Tracked segments overlapping the range. Open segments must already be closed at `now`. */
  segments: MetricSegment[];
  /** Pause count per session id. */
  pauseCountBySession: Record<string, number>;
  completedTasks: number;
  settings: {
    deepWorkMinMs: number;
    dailyFocusGoalSec: number;
    /** Minimum uninterrupted productive segment that counts as focus time. */
    focusMinMs?: number;
  };
}

export interface CategoryBreakdownRow {
  categoryId: string;
  key: string;
  name: string;
  color: string;
  timeClass: TimeClassKey;
  plannedSec: number;
  trackedSec: number;
}

export interface HourBucket {
  hour: number;
  trackedSec: number;
  productiveSec: number;
}

export interface ScoreComponent {
  key: 'focus' | 'adherence' | 'completion' | 'continuity';
  label: string;
  /** 0..1 */
  value: number;
  /** Effective weight after re-normalising over measurable components. */
  weight: number;
  explanation: string;
}

export interface DayGap extends Interval {
  /** Titles of the activities tracked before and after the gap. */
  after: string;
  before: string;
}

export interface SessionFact {
  sessionId: string;
  activityId: string;
  title: string;
  pauseCount: number;
  trackedSec: number;
}

export interface DayMetrics {
  plannedSec: number;
  trackedSec: number;
  productiveSec: number;
  focusSec: number;
  restSec: number;
  leisureSec: number;
  neutralSec: number;
  deepWorkSessions: number;
  leakageSec: number;
  unknownSec: number;
  plannedUntrackedSec: number;
  /** Active hours that already lie in the past. */
  activePastSec: number;
  activeSec: number;
  plannedActivities: number;
  completedActivities: number;
  completedTasks: number;
  contextSwitches: number;
  /** Activity changes of any kind (same or different category). */
  transitions: number;
  /** Productive tracked time in segments shorter than the focus minimum. */
  fragmentedSec: number;
  adherencePct: number | null;
  estimationAccuracyPct: number | null;
  productivityScore: number | null;
  scoreBreakdown: ScoreComponent[];
  categoryBreakdown: CategoryBreakdownRow[];
  hourly: HourBucket[];
  /** Detail used by leakage detection. */
  gaps: DayGap[];
  sessions: SessionFact[];
}

export const LEAK_GAP_MIN_MS = 5 * MS_PER_MINUTE;
export const LEAK_GAP_MAX_MS = 45 * MS_PER_MINUTE;
const SWITCH_GAP_MS = 10 * MS_PER_MINUTE;
const DEFAULT_FOCUS_MIN_MS = 25 * MS_PER_MINUTE;

const sec = (intervals: readonly Interval[]): number => wholeSeconds(coveredMs(intervals));

export function computeDayMetrics(input: DayMetricsInput): DayMetrics {
  const { range, timezone } = input;
  const now = Math.min(Math.max(input.now, range.start), range.end);
  const past: Interval = { start: range.start, end: now };
  const focusMinMs = input.settings.focusMinMs ?? DEFAULT_FOCUS_MIN_MS;
  const catById = new Map(input.categories.map((c) => [c.id, c]));
  const actById = new Map(input.activities.map((a) => [a.id, a]));

  // Segments clipped to the day and to "now" (the future has not been tracked).
  const segments = input.segments
    .map((s) => ({ ...s, ...(clip(s, past) ?? { start: 0, end: 0 }) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const classOf = (activityId: string): TimeClassKey =>
    catById.get(actById.get(activityId)?.categoryId ?? '')?.timeClass ?? 'NEUTRAL';

  // ── Totals by class ────────────────────────────────────────────────────────
  const byClass: Record<TimeClassKey, Interval[]> = { PRODUCTIVE: [], REST: [], LEISURE: [], NEUTRAL: [] };
  for (const s of segments) byClass[classOf(s.activityId)].push(s);
  const trackedMerged = mergeIntervals(segments);

  let focusMs = 0;
  let fragmentedMs = 0;
  let deepWorkSessions = 0;
  for (const s of segments) {
    if (classOf(s.activityId) !== 'PRODUCTIVE') continue;
    const len = s.end - s.start;
    if (len >= focusMinMs) focusMs += len;
    else fragmentedMs += len;
    if (len >= input.settings.deepWorkMinMs) deepWorkSessions++;
  }

  // ── Plan ───────────────────────────────────────────────────────────────────
  const plannedActs = input.activities.filter(
    (a) => a.plannedStart !== null && a.plannedEnd !== null && a.status !== 'CANCELLED',
  );
  const plannedIntervals: (Interval & { activity: MetricActivity })[] = [];
  for (const a of plannedActs) {
    const c = clip({ start: a.plannedStart!, end: a.plannedEnd! }, range);
    if (c) plannedIntervals.push({ ...c, activity: a });
  }
  const plannedMerged = mergeIntervals(plannedIntervals);
  const plannedPast = clipAll(plannedMerged, past);
  const plannedUntracked = subtractIntervals(plannedPast, trackedMerged);

  // ── Gaps, leakage, unknown ─────────────────────────────────────────────────
  const activeHours = mergeIntervals(clipAll(input.activeHours, range));
  const activePast = clipAll(activeHours, past);
  const gaps: DayGap[] = [];
  for (let i = 1; i < trackedMerged.length; i++) {
    const gap = { start: trackedMerged[i - 1]!.end, end: trackedMerged[i]!.start };
    const len = gap.end - gap.start;
    if (len < LEAK_GAP_MIN_MS || len > LEAK_GAP_MAX_MS) continue;
    // Only time that is inside active hours and not covered by any plan is an unplanned gap.
    const unplanned = subtractIntervals(intersectIntervals([gap], activeHours), plannedMerged);
    const before = segments.filter((s) => s.end <= gap.start).sort((a, b) => b.end - a.end)[0];
    const after = segments.find((s) => s.start >= gap.end);
    for (const u of unplanned) {
      if (u.end - u.start < LEAK_GAP_MIN_MS) continue;
      gaps.push({
        ...u,
        after: before ? (actById.get(before.activityId)?.title ?? 'activity') : 'activity',
        before: after ? (actById.get(after.activityId)?.title ?? 'activity') : 'activity',
      });
    }
  }
  const leakageSec = sec(gaps);
  const unknown = subtractIntervals(subtractIntervals(subtractIntervals(activePast, trackedMerged), plannedPast), gaps);

  // ── Switching ──────────────────────────────────────────────────────────────
  let transitions = 0;
  let contextSwitches = 0;
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]!;
    const cur = segments[i]!;
    if (prev.activityId === cur.activityId) continue;
    if (cur.start - prev.end > SWITCH_GAP_MS) continue;
    transitions++;
    const pc = actById.get(prev.activityId)?.categoryId;
    const cc = actById.get(cur.activityId)?.categoryId;
    if (pc !== cc) contextSwitches++;
  }

  // ── Adherence: of the time planned so far, how much was tracked on that same activity ──
  let adherencePlannedMs = 0;
  let adherenceTrackedMs = 0;
  for (const p of plannedIntervals) {
    if (p.end > now) continue; // only blocks that are fully in the past
    if (p.activity.status === 'SKIPPED') continue;
    adherencePlannedMs += p.end - p.start;
    const own = segments.filter((s) => s.activityId === p.activity.id);
    adherenceTrackedMs += coveredMs(intersectIntervals(own, [p]));
  }
  const adherence = adherencePlannedMs > 0 ? adherenceTrackedMs / adherencePlannedMs : null;

  // ── Estimation accuracy of activities completed today ─────────────────────
  const completedToday = input.activities.filter(
    (a) => a.status === 'COMPLETED' && a.completedAt !== null && a.completedAt >= range.start && a.completedAt < range.end,
  );
  const accuracies: number[] = [];
  for (const a of completedToday) {
    const estimate =
      a.estimatedDurationSec ??
      (a.plannedStart !== null && a.plannedEnd !== null ? wholeSeconds(a.plannedEnd - a.plannedStart) : null);
    if (!estimate || a.actualDurationSec <= 0) continue;
    accuracies.push(1 - Math.min(1, Math.abs(a.actualDurationSec - estimate) / estimate));
  }
  const estimationAccuracy = accuracies.length ? accuracies.reduce((s, v) => s + v, 0) / accuracies.length : null;

  // ── Completion: planned blocks that should be done by now ─────────────────
  const dueByNow = plannedIntervals.filter((p) => p.end <= now && p.activity.status !== 'SKIPPED');
  const dueDone = dueByNow.filter((p) => p.activity.status === 'COMPLETED').length;
  const completion = dueByNow.length > 0 ? dueDone / dueByNow.length : null;

  // ── Category breakdown ─────────────────────────────────────────────────────
  const rows = new Map<string, CategoryBreakdownRow>();
  const rowFor = (categoryId: string): CategoryBreakdownRow | null => {
    const c = catById.get(categoryId);
    if (!c) return null;
    let row = rows.get(c.id);
    if (!row) {
      row = { categoryId: c.id, key: c.key, name: c.name, color: c.color, timeClass: c.timeClass, plannedSec: 0, trackedSec: 0 };
      rows.set(c.id, row);
    }
    return row;
  };
  for (const p of plannedIntervals) {
    const row = rowFor(p.activity.categoryId);
    if (row) row.plannedSec += wholeSeconds(p.end - p.start);
  }
  const trackedMsByCat = new Map<string, number>();
  for (const s of segments) {
    const catId = actById.get(s.activityId)?.categoryId;
    if (catId) trackedMsByCat.set(catId, (trackedMsByCat.get(catId) ?? 0) + (s.end - s.start));
  }
  for (const [catId, ms] of trackedMsByCat) {
    const row = rowFor(catId);
    if (row) row.trackedSec = wholeSeconds(ms);
  }

  // ── Hourly buckets (by local hour; DST-safe because we bucket by wall-clock hour) ──
  const hourlyMs = Array.from({ length: 24 }, () => ({ tracked: 0, productive: 0 }));
  const hourCuts: number[] = [];
  for (let t = range.start; t < range.end; t += MS_PER_HOUR) hourCuts.push(t);
  for (const s of segments) {
    const productive = classOf(s.activityId) === 'PRODUCTIVE';
    for (const piece of splitAt(s, hourCuts)) {
      const bucket = hourlyMs[localHour(piece.start, timezone)]!;
      bucket.tracked += piece.end - piece.start;
      if (productive) bucket.productive += piece.end - piece.start;
    }
  }
  const hourly: HourBucket[] = hourlyMs.map((b, hour) => ({
    hour,
    trackedSec: wholeSeconds(b.tracked),
    productiveSec: wholeSeconds(b.productive),
  }));

  // ── Session facts ──────────────────────────────────────────────────────────
  const sessionMs = new Map<string, { activityId: string; ms: number }>();
  for (const s of segments) {
    const cur = sessionMs.get(s.sessionId) ?? { activityId: s.activityId, ms: 0 };
    cur.ms += s.end - s.start;
    sessionMs.set(s.sessionId, cur);
  }
  const sessions: SessionFact[] = [...sessionMs.entries()].map(([sessionId, v]) => ({
    sessionId,
    activityId: v.activityId,
    title: actById.get(v.activityId)?.title ?? 'Activity',
    pauseCount: input.pauseCountBySession[sessionId] ?? 0,
    trackedSec: wholeSeconds(v.ms),
  }));

  // ── Productivity score ─────────────────────────────────────────────────────
  const trackedSec = sec(trackedMerged);
  const productiveSec = sec(byClass.PRODUCTIVE);
  const focusSec = wholeSeconds(focusMs);
  const components: { key: ScoreComponent['key']; label: string; base: number; value: number | null; explanation: string }[] = [
    {
      key: 'focus',
      label: 'Focus goal',
      base: 0.35,
      value: input.settings.dailyFocusGoalSec > 0 ? Math.min(1, focusSec / input.settings.dailyFocusGoalSec) : null,
      explanation: `${Math.round(focusSec / 60)} min of focused work against a goal of ${Math.round(input.settings.dailyFocusGoalSec / 60)} min.`,
    },
    {
      key: 'adherence',
      label: 'Schedule adherence',
      base: 0.3,
      value: adherence,
      explanation:
        adherence === null
          ? 'No planned block has finished yet.'
          : `${Math.round(adherence * 100)}% of finished planned time was tracked on the planned activity.`,
    },
    {
      key: 'completion',
      label: 'Completion',
      base: 0.25,
      value: completion,
      explanation:
        completion === null
          ? 'No planned block was due yet.'
          : `${dueDone} of ${dueByNow.length} planned activities due so far are completed.`,
    },
    {
      key: 'continuity',
      label: 'Continuity',
      base: 0.1,
      value: trackedSec > 0 ? 1 - Math.min(1, leakageSec / (trackedSec + leakageSec)) : null,
      explanation: `${Math.round(leakageSec / 60)} min of unplanned gaps between tracked blocks.`,
    },
  ];
  // No tracked time at all means there is nothing to score — not a score of zero.
  const measurable = trackedSec > 0 ? components.filter((c) => c.value !== null) : [];
  const weightSum = measurable.reduce((s, c) => s + c.base, 0);
  const scoreBreakdown: ScoreComponent[] = measurable.map((c) => ({
    key: c.key,
    label: c.label,
    value: Math.round((c.value as number) * 1000) / 1000,
    weight: Math.round((c.base / weightSum) * 1000) / 1000,
    explanation: c.explanation,
  }));
  const productivityScore =
    measurable.length > 0
      ? Math.round((measurable.reduce((s, c) => s + (c.value as number) * c.base, 0) / weightSum) * 100)
      : null;

  return {
    plannedSec: sec(plannedMerged),
    trackedSec,
    productiveSec,
    focusSec,
    restSec: sec(byClass.REST),
    leisureSec: sec(byClass.LEISURE),
    neutralSec: sec(byClass.NEUTRAL),
    deepWorkSessions,
    leakageSec,
    unknownSec: sec(unknown),
    plannedUntrackedSec: sec(plannedUntracked),
    activePastSec: sec(activePast),
    activeSec: sec(activeHours),
    plannedActivities: plannedActs.filter((a) => a.plannedStart! >= range.start && a.plannedStart! < range.end).length,
    completedActivities: completedToday.length,
    completedTasks: input.completedTasks,
    contextSwitches,
    transitions,
    fragmentedSec: wholeSeconds(fragmentedMs),
    adherencePct: adherence === null ? null : Math.round(adherence * 100),
    estimationAccuracyPct: estimationAccuracy === null ? null : Math.round(estimationAccuracy * 100),
    productivityScore,
    scoreBreakdown,
    categoryBreakdown: [...rows.values()].sort((a, b) => b.trackedSec - a.trackedSec || b.plannedSec - a.plannedSec),
    hourly,
    gaps,
    sessions,
  };
}
