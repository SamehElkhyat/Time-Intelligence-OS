import {
  AvailabilityInput,
  computeAvailability,
  detectConflicts,
  PlannedBlock,
} from '@/modules/availability/domain/availability-engine';
import { localDayRange, localMinuteToInstant, MS_PER_MINUTE } from '@/common/time/time';

const MIN = MS_PER_MINUTE;
const DAY = Date.UTC(2026, 2, 2); // 2026-03-02 00:00Z
const at = (h: number, m = 0) => DAY + (h * 60 + m) * MIN;

const block = (id: string, from: [number, number], to: [number, number], extra: Partial<PlannedBlock> = {}): PlannedBlock => ({
  id,
  kind: 'ACTIVITY',
  title: id,
  start: at(...from),
  end: at(...to),
  categoryKey: 'work',
  timeClass: 'PRODUCTIVE',
  isFixed: false,
  isCommitment: false,
  done: false,
  ...extra,
});

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    range: { start: DAY, end: DAY + 24 * 60 * MIN },
    now: DAY, // start of day: everything is still ahead
    activeHours: [{ start: at(8), end: at(18) }],
    hasExplicitAvailability: true,
    blocked: [],
    planned: [],
    tracked: [],
    activeTimer: null,
    bufferMs: 0,
    minSlotMs: 15 * MIN,
    daysAhead: 0,
    overrunRatioByCategory: {},
    ...overrides,
  };
}

const spans = (r: ReturnType<typeof computeAvailability>) => r.windows.map((w) => [w.start, w.end]);

describe('availability engine', () => {
  describe('the product example', () => {
    // 09:00–10:00 Work, 10:00–10:30 Meeting, 11:00–12:00 Learning
    const planned = [
      block('work', [9, 0], [10, 0]),
      block('meeting', [10, 0], [10, 30], { categoryKey: 'meetings' }),
      block('learning', [11, 0], [12, 0], { categoryKey: 'learning' }),
    ];

    it('finds 10:30–11:00 as a free window and everything after 12:00 until the day ends', () => {
      const r = computeAvailability(input({ planned }));
      expect(spans(r)).toEqual([
        [at(8), at(9)],
        [at(10, 30), at(11)],
        [at(12), at(18)],
      ]);
      expect(r.windows.every((w) => w.confidence === 'HIGH')).toBe(true);
    });

    it('names what comes before and after each window', () => {
      const r = computeAvailability(input({ planned }));
      const gap = r.windows[1]!;
      expect(gap.precededBy).toBe('meeting');
      expect(gap.followedBy).toBe('learning');
      expect(gap.durationSec).toBe(30 * 60);
    });

    it('does not treat completed blocks as occupying future time', () => {
      const r = computeAvailability(input({ planned: planned.map((p) => ({ ...p, done: true })) }));
      expect(spans(r)).toEqual([[at(8), at(18)]]);
    });
  });

  describe('free time vs unknown time', () => {
    it('never reports past untracked time as free', () => {
      const planned = [block('work', [9, 0], [10, 0])];
      const r = computeAvailability(input({ now: at(12), planned, tracked: [{ start: at(9), end: at(10), activityId: 'work' }] }));
      expect(r.windows.every((w) => w.start >= at(12))).toBe(true);
      // 08–09 (before the plan) and 10–12 (after it) were neither planned nor tracked
      expect(r.summary.unknownSec).toBe(3 * 3600);
      expect(r.summary.trackedSec).toBe(3600);
      expect(r.summary.freeSec).toBe(6 * 3600); // 12:00–18:00
    });

    it('separates planned-but-untracked time from tracked time', () => {
      const planned = [block('gym', [9, 0], [10, 0])];
      const r = computeAvailability(input({ now: at(12), planned }));
      expect(r.summary.plannedUntrackedSec).toBe(3600);
      expect(r.summary.trackedSec).toBe(0);
      expect(r.strip.find((s) => s.start === at(9))?.state).toBe('PLANNED_UNTRACKED');
    });

    it('classifies unplanned past hours as UNKNOWN in the strip', () => {
      const r = computeAvailability(input({ now: at(12) }));
      const unknown = r.strip.filter((s) => s.state === 'UNKNOWN');
      expect(unknown).toEqual([{ start: at(8), end: at(12), state: 'UNKNOWN' }]);
    });
  });

  describe('buffers, blocked time and minimum slot', () => {
    it('keeps buffers around fixed commitments', () => {
      const r = computeAvailability(input({ bufferMs: 10 * MIN, planned: [block('exam', [12, 0], [13, 0], { isFixed: true })] }));
      expect(spans(r)).toEqual([
        [at(8), at(11, 50)],
        [at(13, 10), at(18)],
      ]);
      expect(r.summary.bufferSec).toBe(20 * 60);
    });

    it('does not buffer movable, non-commitment blocks', () => {
      const r = computeAvailability(input({ bufferMs: 10 * MIN, planned: [block('chores', [12, 0], [13, 0])] }));
      expect(spans(r)).toEqual([[at(8), at(12)], [at(13), at(18)]]);
    });

    it('buffers meeting-like categories even when not marked fixed', () => {
      const r = computeAvailability(input({ bufferMs: 10 * MIN, planned: [block('sync', [12, 0], [13, 0], { isCommitment: true })] }));
      expect(spans(r)).toEqual([[at(8), at(11, 50)], [at(13, 10), at(18)]]);
    });

    it('removes user-blocked time and reports short gaps as fragments, not windows', () => {
      const r = computeAvailability(
        input({
          blocked: [{ start: at(12), end: at(13) }],
          planned: [block('a', [8, 0], [11, 50]), block('b', [13, 0], [18, 0])],
        }),
      );
      // 11:50–12:00 is a 10 minute gap (< 15 min minimum): a fragment
      expect(r.windows).toHaveLength(0);
      expect(r.summary.fragmentSec).toBe(10 * 60);
      expect(r.summary.freeSec).toBe(0);
    });
  });

  describe('conflicts', () => {
    it('flags overlapping fixed commitments as HARD and others as SOFT', () => {
      const conflicts = detectConflicts([
        block('a', [9, 0], [10, 0], { isFixed: true }),
        block('b', [9, 30], [10, 30], { isFixed: true }),
        block('c', [10, 15], [11, 0]),
      ]);
      const byPair = Object.fromEntries(conflicts.map((c) => [`${c.aId}${c.bId}`, c.severity]));
      expect(byPair).toEqual({ ab: 'HARD', bc: 'SOFT' });
      expect(conflicts.find((c) => c.aId === 'a')?.overlapSec).toBe(30 * 60);
    });
    it('ignores completed blocks and blocks that merely touch', () => {
      expect(detectConflicts([block('a', [9, 0], [10, 0]), block('b', [10, 0], [11, 0])])).toEqual([]);
      expect(detectConflicts([block('a', [9, 0], [10, 0], { done: true }), block('b', [9, 30], [10, 30])])).toEqual([]);
    });
    it('counts overlapped time once in planned totals', () => {
      const r = computeAvailability(input({ planned: [block('a', [9, 0], [10, 0]), block('b', [9, 30], [10, 30])] }));
      expect(r.summary.plannedSec).toBe(90 * 60);
      expect(r.summary.conflictCount).toBe(1);
    });
  });

  describe('active timer', () => {
    it('holds time until the expected end of the activity being tracked', () => {
      const r = computeAvailability(
        input({ now: at(10), tracked: [{ start: at(9, 30), end: at(10), activityId: 't' }], activeTimer: { activityId: 't', title: 'Report', paused: false, elapsedMs: 30 * MIN, expectedTotalMs: 90 * MIN } }),
      );
      expect(r.windows[0]!.start).toBe(at(11)); // 60 minutes remain
      expect(r.windows[0]!.factors.some((f) => f.code === 'TIMER_MAY_OVERRUN')).toBe(true);
    });

    it('lowers confidence when the timer has no known end', () => {
      const r = computeAvailability(
        input({ now: at(10), tracked: [{ start: at(9, 30), end: at(10), activityId: 't' }], activeTimer: { activityId: 't', title: 'Report', paused: false, elapsedMs: 30 * MIN, expectedTotalMs: null } }),
      );
      const first = r.windows[0]!;
      expect(first.start).toBe(at(10, 15));
      expect(first.factors.some((f) => f.code === 'TIMER_OPEN_ENDED')).toBe(true);
      expect(first.confidence).not.toBe('HIGH');
    });

    it('does not block time while the timer is paused, but warns', () => {
      const r = computeAvailability(
        input({ now: at(10), planned: [block('x', [14, 0], [15, 0])], activeTimer: { activityId: 't', title: 'Report', paused: true, elapsedMs: 30 * MIN, expectedTotalMs: null } }),
      );
      expect(r.windows[0]!.start).toBe(at(10));
      expect(r.windows[0]!.factors.some((f) => f.code === 'TIMER_PAUSED')).toBe(true);
    });
  });

  describe('confidence', () => {
    it('is lower when the day is empty (unplanned, not confirmed) and when using default hours', () => {
      const r = computeAvailability(input({ hasExplicitAvailability: false, planned: [] }));
      const codes = r.windows[0]!.factors.map((f) => f.code);
      expect(codes).toEqual(expect.arrayContaining(['DEFAULT_HOURS', 'NOTHING_PLANNED']));
      expect(r.windows[0]!.confidenceScore).toBe(70);
      expect(r.windows[0]!.confidence).toBe('MEDIUM');
    });
    it('drops with distance into the future', () => {
      const near = computeAvailability(input({ planned: [block('a', [9, 0], [10, 0])], daysAhead: 1 }));
      const far = computeAvailability(input({ planned: [block('a', [9, 0], [10, 0])], daysAhead: 8 }));
      expect(near.windows[0]!.confidenceScore).toBeGreaterThan(far.windows[0]!.confidenceScore);
    });
    it('warns when the preceding activity category habitually overruns', () => {
      const r = computeAvailability(input({ planned: [block('a', [9, 0], [10, 0])], overrunRatioByCategory: { work: 1.5 } }));
      const after = r.windows.find((w) => w.start === at(10))!;
      expect(after.factors.some((f) => f.code === 'PRECEDING_OVERRUNS')).toBe(true);
    });
  });

  describe('day boundaries', () => {
    const tz = 'Europe/Paris';
    const date = '2026-03-29'; // spring forward: 23 hour day
    const range = localDayRange(date, tz);
    const base = (overrides: Partial<AvailabilityInput> = {}): AvailabilityInput =>
      input({
        range,
        now: range.start,
        activeHours: [{ start: localMinuteToInstant(date, 8 * 60, tz), end: localMinuteToInstant(date, 22 * 60, tz) }],
        ...overrides,
      });

    it('classifies the whole local day with no gaps and no overlaps, even on a 23-hour day', () => {
      const nine = { ...block('x', [0, 0], [1, 0]), start: localMinuteToInstant(date, 9 * 60, tz), end: localMinuteToInstant(date, 10 * 60, tz) };
      const r = computeAvailability(base({ planned: [nine] }));
      const sorted = [...r.strip].sort((a, b) => a.start - b.start);
      expect(sorted[0]!.start).toBe(range.start);
      expect(sorted[sorted.length - 1]!.end).toBe(range.end);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.start).toBe(sorted[i - 1]!.end);
      expect(sorted.reduce((s, x) => s + (x.end - x.start), 0)).toBe(23 * 3600_000);
    });

    it('keeps a block that crosses midnight on the day it started, clipped to the day range', () => {
      const tzDay = localDayRange('2026-03-02', 'Africa/Cairo');
      const start = localMinuteToInstant('2026-03-02', 23 * 60, 'Africa/Cairo');
      const r = computeAvailability(
        input({
          range: tzDay,
          now: tzDay.start,
          activeHours: [{ start: tzDay.start, end: tzDay.end }],
          planned: [{ ...block('late', [0, 0], [1, 0]), start, end: start + 2 * 3600_000 }],
        }),
      );
      expect(r.summary.plannedSec).toBe(3600); // only the part inside this local day
      expect(r.windows[r.windows.length - 1]!.end).toBe(start); // free time stops where the block begins
    });

    it('is deterministic: identical input gives identical output', () => {
      const a = computeAvailability(input({ planned: [block('a', [9, 0], [10, 0]), block('b', [9, 30], [11, 0])] }));
      const b = computeAvailability(input({ planned: [block('b', [9, 30], [11, 0]), block('a', [9, 0], [10, 0])] }));
      expect(b).toEqual(a);
    });
  });
});
