import {
  clip,
  clipAll,
  coveredMs,
  findOverlaps,
  Interval,
  mergeIntervals,
  pad,
  subtractIntervals,
} from '@/common/time/intervals';
import { MS_PER_MINUTE, wholeSeconds } from '@/common/time/time';

/**
 * TIMEFLOW availability engine.
 *
 * A pure function of its input: no clock, no database, no randomness. The caller resolves
 * everything timezone-dependent (the range of the local day, active hours, recurring
 * occurrences) into absolute instants first, so the engine itself is DST-agnostic.
 *
 * The engine deliberately separates three questions that are easy to conflate:
 *   1. Future  — when is the user genuinely available?  -> `windows` (with explicit confidence)
 *   2. Past    — what do we actually know happened?      -> TRACKED / PLANNED_UNTRACKED / UNKNOWN
 *   3. Plan    — is the plan itself consistent?          -> `conflicts`
 * Past time without tracking data is reported as UNKNOWN. It is never counted as free time.
 */

export type TimeClassKey = 'PRODUCTIVE' | 'REST' | 'LEISURE' | 'NEUTRAL';

export interface PlannedBlock extends Interval {
  /** Unique within the input (activity id, or `${eventId}:${date}` for recurring occurrences). */
  id: string;
  kind: 'ACTIVITY' | 'RECURRING';
  title: string;
  categoryKey: string;
  timeClass: TimeClassKey;
  /** Fixed commitments cannot move and receive protective buffers. */
  isFixed: boolean;
  /** Meeting-like category: receives buffers even when not marked fixed. */
  isCommitment: boolean;
  /** Completed or skipped: it no longer occupies future time. */
  done: boolean;
}

export interface TrackedBlock extends Interval {
  activityId: string;
}

export interface ActiveTimerInfo {
  activityId: string;
  title: string;
  paused: boolean;
  /** Tracked time so far in this session. */
  elapsedMs: number;
  /** Expected total duration (estimate or planned length); null when unknown. */
  expectedTotalMs: number | null;
}

export interface AvailabilityInput {
  /** Usually one local day [00:00, next 00:00). */
  range: Interval;
  now: number;
  /** Hours in which the user can be scheduled, already resolved to instants inside `range`. */
  activeHours: Interval[];
  /** True when `activeHours` comes from availability the user declared (not defaults). */
  hasExplicitAvailability: boolean;
  /** User-declared blocked time inside `range`. */
  blocked: Interval[];
  planned: PlannedBlock[];
  tracked: TrackedBlock[];
  activeTimer: ActiveTimerInfo | null;
  bufferMs: number;
  minSlotMs: number;
  /** Whole local days between "today" and the day being evaluated (0 = today). */
  daysAhead: number;
  /** Historical actual/planned ratio per category key (e.g. 1.3 = runs 30% long). Only reliable entries. */
  overrunRatioByCategory: Record<string, number>;
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConfidenceFactor {
  code:
    | 'DEFAULT_HOURS'
    | 'NOTHING_PLANNED'
    | 'TIMER_OPEN_ENDED'
    | 'TIMER_MAY_OVERRUN'
    | 'TIMER_PAUSED'
    | 'PRECEDING_OVERRUNS'
    | 'FAR_AHEAD'
    | 'ADJACENT_CONFLICT';
  /** Points removed from 100. */
  penalty: number;
  message: string;
}

export interface FreeWindow extends Interval {
  durationSec: number;
  /** 0..100 */
  confidenceScore: number;
  confidence: ConfidenceLevel;
  factors: ConfidenceFactor[];
  /** Title of the block that ends right before / starts right after this window. */
  precededBy: string | null;
  followedBy: string | null;
}

export interface ScheduleConflict extends Interval {
  aId: string;
  aTitle: string;
  bId: string;
  bTitle: string;
  overlapSec: number;
  /** HARD: both sides are fixed commitments. SOFT: at least one side can move. */
  severity: 'HARD' | 'SOFT';
}

export type StripState =
  | 'TRACKED'
  | 'PLANNED_UNTRACKED'
  | 'UNKNOWN'
  | 'BUSY'
  | 'BUFFER'
  | 'BLOCKED'
  | 'FREE'
  | 'FRAGMENT'
  | 'OUTSIDE_HOURS';

export interface StripSegment extends Interval {
  state: StripState;
}

export interface AvailabilitySummary {
  /** Bookable future time: sum of offered windows. */
  freeSec: number;
  /** Portion of freeSec in HIGH-confidence windows. */
  highConfidenceFreeSec: number;
  /** Future free gaps too short to be offered (below the minimum slot). */
  fragmentSec: number;
  busyFutureSec: number;
  bufferSec: number;
  /** Planned time in the whole range (overlaps counted once). */
  plannedSec: number;
  trackedSec: number;
  /** Past planned time with no tracking — it may or may not have happened. */
  plannedUntrackedSec: number;
  /** Past active-hours time with neither plan nor tracking. Not free: unknown. */
  unknownSec: number;
  conflictCount: number;
}

export interface AvailabilityResult {
  range: Interval;
  now: number;
  windows: FreeWindow[];
  conflicts: ScheduleConflict[];
  /** Disjoint classification of the entire range, in order. */
  strip: StripSegment[];
  summary: AvailabilitySummary;
}

export const CONFIDENCE_HIGH_MIN = 80;
export const CONFIDENCE_MEDIUM_MIN = 55;
const OPEN_TIMER_HOLD_MS = 15 * MS_PER_MINUTE;
const OPEN_TIMER_HORIZON_MS = 60 * MS_PER_MINUTE;
const OVERRUN_THRESHOLD = 1.2;

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_HIGH_MIN) return 'HIGH';
  if (score >= CONFIDENCE_MEDIUM_MIN) return 'MEDIUM';
  return 'LOW';
}

const sumSec = (intervals: readonly Interval[]): number => wholeSeconds(coveredMs(intervals));

export function detectConflicts(planned: readonly PlannedBlock[]): ScheduleConflict[] {
  const candidates = planned.filter((p) => !p.done).map((p) => ({ start: p.start, end: p.end, ref: p }));
  return findOverlaps(candidates)
    .map((o) => ({
      aId: o.a.id,
      aTitle: o.a.title,
      bId: o.b.id,
      bTitle: o.b.title,
      start: o.start,
      end: o.end,
      overlapSec: wholeSeconds(o.end - o.start),
      severity: (o.a.isFixed && o.b.isFixed ? 'HARD' : 'SOFT') as ScheduleConflict['severity'],
    }))
    .sort((x, y) => x.start - y.start || x.aId.localeCompare(y.aId) || x.bId.localeCompare(y.bId));
}

export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const { range } = input;
  const now = Math.min(Math.max(input.now, range.start), range.end);
  const past: Interval = { start: range.start, end: now };
  const future: Interval = { start: now, end: range.end };

  const activeHours = mergeIntervals(clipAll(input.activeHours, range));
  const planned = input.planned
    .map((p) => ({ ...p, ...(clip(p, range) ?? { start: 0, end: 0 }) }))
    .filter((p) => p.end > p.start)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  const conflicts = detectConflicts(planned);

  // ── Past: what do we actually know? ────────────────────────────────────────
  const tracked = mergeIntervals(clipAll(input.tracked, past));
  const plannedPast = mergeIntervals(clipAll(planned, past));
  const plannedUntracked = subtractIntervals(plannedPast, tracked);
  const unknown = subtractIntervals(subtractIntervals(clipAll(activeHours, past), tracked), plannedPast);

  // ── Future: what is occupied? ──────────────────────────────────────────────
  const livePlanned = planned.filter((p) => !p.done);
  const busyParts: Interval[] = clipAll(livePlanned, future);

  let timerBusyEnd: number | null = null;
  let timerOpenEnded = false;
  if (input.activeTimer && now < range.end && input.now >= range.start && input.now < range.end) {
    const t = input.activeTimer;
    if (!t.paused) {
      const remaining = t.expectedTotalMs !== null ? t.expectedTotalMs - t.elapsedMs : null;
      if (remaining !== null && remaining > 0) {
        timerBusyEnd = Math.min(range.end, now + remaining);
      } else {
        timerOpenEnded = true;
        timerBusyEnd = Math.min(range.end, now + OPEN_TIMER_HOLD_MS);
      }
      busyParts.push({ start: now, end: timerBusyEnd });
    }
  }
  const busy = mergeIntervals(busyParts);

  const bufferCandidates =
    input.bufferMs > 0
      ? livePlanned.filter((p) => p.isFixed || p.isCommitment).map((p) => pad(p, input.bufferMs, input.bufferMs))
      : [];
  const buffers = subtractIntervals(clipAll(bufferCandidates, future), busy);
  const blocked = subtractIntervals(subtractIntervals(clipAll(input.blocked, future), busy), buffers);

  const activeFuture = clipAll(activeHours, future);
  const freeAll = subtractIntervals(
    subtractIntervals(subtractIntervals(activeFuture, busy), buffers),
    blocked,
  );
  const offered = freeAll.filter((w) => w.end - w.start >= input.minSlotMs);
  const fragments = freeAll.filter((w) => w.end - w.start < input.minSlotMs);

  // ── Confidence ─────────────────────────────────────────────────────────────
  const nothingPlanned = livePlanned.length === 0 && input.tracked.length === 0;
  const isToday = input.now >= range.start && input.now < range.end;

  const windows: FreeWindow[] = offered.map((w) => {
    const factors: ConfidenceFactor[] = [];

    if (!input.hasExplicitAvailability) {
      factors.push({
        code: 'DEFAULT_HOURS',
        penalty: 10,
        message: 'Based on your default active hours, not on availability you declared for this weekday.',
      });
    }
    if (nothingPlanned) {
      factors.push({
        code: 'NOTHING_PLANNED',
        penalty: 20,
        message: 'Nothing is scheduled on this day yet, so this is unplanned time rather than confirmed availability.',
      });
    }
    if (input.daysAhead >= 3) {
      factors.push({
        code: 'FAR_AHEAD',
        penalty: input.daysAhead >= 7 ? 15 : 10,
        message: `This is ${input.daysAhead} days ahead; plans that far out often change.`,
      });
    }
    if (isToday && input.activeTimer) {
      const t = input.activeTimer;
      if (t.paused && w.start - now < OPEN_TIMER_HORIZON_MS) {
        factors.push({
          code: 'TIMER_PAUSED',
          penalty: 15,
          message: `"${t.title}" is paused and may resume at any moment.`,
        });
      } else if (timerOpenEnded && w.start - now < OPEN_TIMER_HORIZON_MS) {
        factors.push({
          code: 'TIMER_OPEN_ENDED',
          penalty: 35,
          message: `You are currently tracking "${t.title}" with no known end time.`,
        });
      } else if (!timerOpenEnded && timerBusyEnd !== null && w.start === timerBusyEnd) {
        factors.push({
          code: 'TIMER_MAY_OVERRUN',
          penalty: 10,
          message: `Starts when "${t.title}" is expected to finish — it may run over.`,
        });
      }
    }

    const before = livePlanned
      .filter((p) => p.end <= w.start && w.start - p.end <= input.bufferMs)
      .sort((a, b) => b.end - a.end)[0];
    const after = livePlanned
      .filter((p) => p.start >= w.end && p.start - w.end <= input.bufferMs)
      .sort((a, b) => a.start - b.start)[0];

    if (before) {
      const ratio = input.overrunRatioByCategory[before.categoryKey];
      if (ratio !== undefined && ratio >= OVERRUN_THRESHOLD) {
        factors.push({
          code: 'PRECEDING_OVERRUNS',
          penalty: 15,
          message: `"${before.title}" comes right before, and your ${before.categoryKey} activities usually run about ${Math.round(
            (ratio - 1) * 100,
          )}% over plan.`,
        });
      }
    }
    const touchesConflict = conflicts.some(
      (c) => Math.abs(c.end - w.start) <= input.bufferMs || Math.abs(c.start - w.end) <= input.bufferMs,
    );
    if (touchesConflict) {
      factors.push({
        code: 'ADJACENT_CONFLICT',
        penalty: 10,
        message: 'Next to overlapping commitments that still need to be resolved.',
      });
    }

    const score = Math.max(0, 100 - factors.reduce((s, f) => s + f.penalty, 0));
    return {
      start: w.start,
      end: w.end,
      durationSec: wholeSeconds(w.end - w.start),
      confidenceScore: score,
      confidence: confidenceLevel(score),
      factors,
      precededBy: before?.title ?? null,
      followedBy: after?.title ?? null,
    };
  });

  // ── Classification strip covering the whole range ─────────────────────────
  const tagged: StripSegment[] = [];
  const push = (list: readonly Interval[], state: StripState) => {
    for (const i of list) tagged.push({ start: i.start, end: i.end, state });
  };
  push(tracked, 'TRACKED');
  push(plannedUntracked, 'PLANNED_UNTRACKED');
  push(unknown, 'UNKNOWN');
  push(busy, 'BUSY');
  push(buffers, 'BUFFER');
  push(blocked, 'BLOCKED');
  push(offered, 'FREE');
  push(fragments, 'FRAGMENT');
  push(subtractIntervals([range], tagged), 'OUTSIDE_HOURS');
  tagged.sort((a, b) => a.start - b.start);

  const summary: AvailabilitySummary = {
    freeSec: sumSec(offered),
    highConfidenceFreeSec: windows.filter((w) => w.confidence === 'HIGH').reduce((s, w) => s + w.durationSec, 0),
    fragmentSec: sumSec(fragments),
    busyFutureSec: sumSec(busy),
    bufferSec: sumSec(buffers),
    plannedSec: sumSec(planned),
    trackedSec: sumSec(tracked),
    plannedUntrackedSec: sumSec(plannedUntracked),
    unknownSec: sumSec(unknown),
    conflictCount: conflicts.length,
  };

  return { range, now, windows, conflicts, strip: tagged, summary };
}
