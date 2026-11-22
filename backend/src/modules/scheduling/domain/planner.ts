import { Interval, mergeIntervals, subtractIntervals } from '@/common/time/intervals';
import { formatClock, localHour, MS_PER_MINUTE, MS_PER_SECOND } from '@/common/time/time';
import { timeOfDayForHour } from '@/common/levels';
import { levelMatch, urgencyFactor } from '@/modules/recommendations/domain/scoring';
import { HourExpectation } from './energy-forecast';

/**
 * Energy-based day planner — pure and deterministic.
 *
 * Greedy "big rocks first" placement: tasks are ordered by urgency and priority, and each is
 * placed at the start time (on a 15-minute grid inside the free windows) that best matches the
 * user's expected energy/focus, its preferred time of day and its deadline. Breaks are inserted
 * when a placement would extend an uninterrupted stretch of scheduled work past the user's limit.
 * The result is a proposal only: nothing is persisted until the user applies it.
 */

export interface PlannerTask {
  id: string;
  title: string;
  durationSec: number;
  /** 1..4 */
  priority: number;
  deadline: number | null;
  energyRequired: number;
  focusRequired: number;
  preferredTimeOfDay: 'ANY' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';
}

export interface PlannerInput {
  now: number;
  timezone: string;
  /** Free windows from the availability engine. */
  windows: Interval[];
  /** Already-occupied blocks of the day (used to measure uninterrupted stretches). */
  busy: Interval[];
  tasks: PlannerTask[];
  /** 24 entries, index = local hour. */
  energyByHour: HourExpectation[];
  breakAfterMs: number;
  breakMs: number;
}

export interface PlannedTaskBlock extends Interval {
  taskId: string;
  title: string;
  /** 0..100 quality of this placement */
  fitScore: number;
  reasons: string[];
  afterDeadline: boolean;
}

export interface SuggestedBreak extends Interval {
  reason: string;
}

export interface UnscheduledTask {
  taskId: string;
  title: string;
  reason: string;
}

export interface PlanResult {
  blocks: PlannedTaskBlock[];
  breaks: SuggestedBreak[];
  unscheduled: UnscheduledTask[];
  scheduledSec: number;
  /** True when no energy data existed, so placement used only deadlines and preferences. */
  energyUnknown: boolean;
}

const GRID_MS = 15 * MS_PER_MINUTE;
const CONTIGUOUS_GAP_MS = 5 * MS_PER_MINUTE;

/**
 * Mean expected energy/focus across a whole block (sampled every 15 minutes), so a block that
 * straddles the edge of a peak is not scored as if it were entirely inside it.
 * Hours without an expectation are skipped; null when there is no basis at all.
 */
export function expectationOver(
  byHour: readonly HourExpectation[],
  start: number,
  durationMs: number,
  timezone: string,
): { energy: number | null; focus: number | null } {
  let e = 0;
  let f = 0;
  let n = 0;
  const steps = Math.max(1, Math.ceil(durationMs / GRID_MS));
  for (let i = 0; i < steps; i++) {
    const t = start + Math.min(durationMs - 1, i * GRID_MS + GRID_MS / 2);
    const h = byHour[localHour(t, timezone)];
    if (h?.energy !== null && h?.energy !== undefined) {
      e += h.energy;
      f += h.focus ?? h.energy;
      n++;
    }
  }
  return n === 0 ? { energy: null, focus: null } : { energy: e / n, focus: f / n };
}

/** Length of the uninterrupted busy stretch that ends at (or within 5 minutes before) `at`. */
export function stretchEndingAt(busy: readonly Interval[], at: number): number {
  const merged = mergeIntervals(busy);
  let runStart: number | null = null;
  let runEnd: number | null = null;
  for (const b of merged) {
    if (b.start >= at) break;
    if (runEnd !== null && b.start - runEnd <= CONTIGUOUS_GAP_MS) {
      runEnd = Math.max(runEnd, b.end);
    } else {
      runStart = b.start;
      runEnd = b.end;
    }
  }
  if (runStart === null || runEnd === null) return 0;
  return at - runEnd <= CONTIGUOUS_GAP_MS ? Math.min(at, runEnd) - runStart : 0;
}

export function planDay(input: PlannerInput): PlanResult {
  const { now, timezone } = input;
  let free = mergeIntervals(
    input.windows.map((w) => ({ start: Math.max(w.start, now), end: w.end })).filter((w) => w.end > w.start),
  );
  const busy: Interval[] = [...input.busy];
  const blocks: PlannedTaskBlock[] = [];
  const breaks: SuggestedBreak[] = [];
  const unscheduled: UnscheduledTask[] = [];
  const energyUnknown = input.energyByHour.every((h) => h.energy === null);

  const dayStart = free[0]?.start ?? now;
  const dayEnd = free[free.length - 1]?.end ?? now;
  const daySpan = Math.max(1, dayEnd - dayStart);

  const ordered = [...input.tasks].sort(
    (a, b) =>
      urgencyFactor(b.deadline, now, b.durationSec) - urgencyFactor(a.deadline, now, a.durationSec) ||
      b.priority - a.priority ||
      b.durationSec - a.durationSec ||
      a.id.localeCompare(b.id),
  );

  for (const task of ordered) {
    const needMs = task.durationSec * MS_PER_SECOND;
    let best: { start: number; score: number; energy: number | null; focus: number | null; tod: string; late: boolean } | null = null;

    for (const w of free) {
      if (w.end - w.start < needMs) continue;
      const first = w.start;
      const candidates = new Set<number>([first]);
      for (let t = Math.ceil(first / GRID_MS) * GRID_MS; t + needMs <= w.end; t += GRID_MS) candidates.add(t);
      for (const start of candidates) {
        if (start + needMs > w.end) continue;
        const { energy, focus } = expectationOver(input.energyByHour, start, needMs, timezone);
        const tod = timeOfDayForHour(localHour(start, timezone));
        const todMatch = task.preferredTimeOfDay === 'ANY' ? 0.5 : task.preferredTimeOfDay === tod ? 1 : 0;
        const late = task.deadline !== null && start + needMs > task.deadline;
        const earliness = 1 - (start - dayStart) / daySpan;
        const score =
          0.4 * levelMatch(energy, task.energyRequired) +
          0.25 * levelMatch(focus, task.focusRequired) +
          0.2 * todMatch +
          0.15 * earliness -
          (late ? 1 : 0);
        if (!best || score > best.score + 1e-9) best = { start, score, energy, focus, tod, late };
      }
    }

    if (!best) {
      const longest = free.reduce((m, w) => Math.max(m, w.end - w.start), 0);
      unscheduled.push({
        taskId: task.id,
        title: task.title,
        reason:
          longest === 0
            ? 'No free time is left on this day.'
            : `Needs ${Math.round(needMs / MS_PER_MINUTE)} min, but the longest remaining free window is ${Math.round(longest / MS_PER_MINUTE)} min.`,
      });
      continue;
    }

    // Break rule: do not extend an uninterrupted stretch beyond the user's limit when a pause fits.
    let start = best.start;
    const reasons: string[] = [];
    const stretch = stretchEndingAt(busy, start);
    if (stretch > 0 && stretch + needMs > input.breakAfterMs) {
      const window = free.find((w) => w.start <= start && w.end >= start + needMs)!;
      if (start + input.breakMs + needMs <= window.end) {
        breaks.push({
          start,
          end: start + input.breakMs,
          reason: `${Math.round(stretch / MS_PER_MINUTE)} minutes of back-to-back commitments come right before "${task.title}".`,
        });
        start += input.breakMs;
        reasons.push(`A ${Math.round(input.breakMs / MS_PER_MINUTE)}-minute break is placed before it.`);
      } else {
        reasons.push('No room for a break before it — consider shortening something nearby.');
      }
    }

    const end = start + needMs;
    if (best.energy !== null) {
      const match = levelMatch(best.energy, task.energyRequired);
      reasons.unshift(
        match >= 0.9
          ? `Your energy is usually sufficient around ${formatClock(start, timezone)}.`
          : `Best available match, though your energy around ${formatClock(start, timezone)} is usually below what this needs.`,
      );
    } else {
      reasons.unshift('No energy data for this hour yet — placed by deadline and preference only.');
    }
    if (task.preferredTimeOfDay !== 'ANY' && task.preferredTimeOfDay === best.tod) {
      reasons.push(`Matches your preferred time of day (${best.tod.toLowerCase()}).`);
    }
    if (best.late) reasons.push('Warning: this finishes after the deadline — no earlier slot was free.');

    blocks.push({
      taskId: task.id,
      title: task.title,
      start,
      end,
      fitScore: Math.round(Math.min(1, Math.max(0, best.score)) * 100),
      reasons,
      afterDeadline: best.late,
    });
    const reserved = { start: Math.min(start, best.start), end };
    busy.push(reserved);
    free = subtractIntervals(free, [reserved]);
  }

  blocks.sort((a, b) => a.start - b.start);
  breaks.sort((a, b) => a.start - b.start);
  return {
    blocks,
    breaks,
    unscheduled,
    scheduledSec: blocks.reduce((s, b) => s + Math.floor((b.end - b.start) / MS_PER_SECOND), 0),
    energyUnknown,
  };
}
