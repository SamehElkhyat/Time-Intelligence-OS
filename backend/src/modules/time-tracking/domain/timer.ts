import { MS_PER_HOUR, wholeSeconds } from '@/common/time/time';

/**
 * Timer domain rules — pure functions.
 *
 * Elapsed time is always derived from persisted segment timestamps and a reference "now".
 * Nothing here counts ticks, so a browser refresh, a closed tab or a sleeping laptop cannot
 * change the result.
 */
export type TimerStatus = 'RUNNING' | 'PAUSED' | 'STOPPED';
export type TimerAction = 'PAUSE' | 'RESUME' | 'STOP';

export interface SegmentTimes {
  startedAt: number;
  /** null while the segment is running */
  endedAt: number | null;
}

export class TimerTransitionError extends Error {
  constructor(
    readonly status: TimerStatus,
    readonly action: TimerAction,
  ) {
    super(`Cannot ${action.toLowerCase()} a timer that is ${status.toLowerCase()}`);
  }
}

const TRANSITIONS: Record<TimerStatus, Partial<Record<TimerAction, TimerStatus>>> = {
  RUNNING: { PAUSE: 'PAUSED', STOP: 'STOPPED' },
  PAUSED: { RESUME: 'RUNNING', STOP: 'STOPPED' },
  STOPPED: {},
};

export function nextStatus(status: TimerStatus, action: TimerAction): TimerStatus {
  const next = TRANSITIONS[status][action];
  if (!next) throw new TimerTransitionError(status, action);
  return next;
}

export function canTransition(status: TimerStatus, action: TimerAction): boolean {
  return TRANSITIONS[status][action] !== undefined;
}

/** Total tracked milliseconds. An open segment counts up to `now`; clock skew never yields negatives. */
export function elapsedMs(segments: readonly SegmentTimes[], now: number): number {
  let total = 0;
  for (const s of segments) {
    const end = s.endedAt ?? now;
    if (end > s.startedAt) total += end - s.startedAt;
  }
  return total;
}

/** Whole seconds, floored once over the total (not per segment) to avoid accumulating rounding loss. */
export function elapsedSec(segments: readonly SegmentTimes[], now: number): number {
  return wholeSeconds(elapsedMs(segments, now));
}

export const MAX_MANUAL_ENTRY_MS = 24 * MS_PER_HOUR;
/** A segment left running this long is treated as an abandoned timer and closed automatically. */
export const ABANDONED_AFTER_MS = 12 * MS_PER_HOUR;
export const LONG_RUNNING_NOTICE_MS = 3 * MS_PER_HOUR;

/** Returns a human-readable problem, or null when the manual/corrected entry is acceptable. */
export function validateEntryRange(start: number, end: number, now: number): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Start and end must be valid timestamps.';
  if (end <= start) return 'The end time must be after the start time.';
  if (end > now + 60_000) return 'A time entry cannot end in the future.';
  if (end - start > MAX_MANUAL_ENTRY_MS) return 'A single time entry cannot be longer than 24 hours.';
  return null;
}

/** Where an abandoned running segment should be closed. */
export function abandonedCutoff(segmentStartedAt: number): number {
  return segmentStartedAt + ABANDONED_AFTER_MS;
}
