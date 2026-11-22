import { formatClock, formatDuration, localHour, MS_PER_HOUR, MS_PER_SECOND } from '@/common/time/time';
import { timeOfDayForHour } from '@/common/levels';

/**
 * Task recommendation engine — transparent weighted scoring.
 *
 * score = 100 × Σ weight_i × factor_i, every factor in [0, 1].
 * Each factor is returned in the breakdown together with its contribution, and the reasons
 * are generated from the same numbers, so the explanation cannot drift from the ranking.
 * Pure function: same input, same ranking.
 */

export type TimeOfDayKey = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

export interface CandidateTask {
  id: string;
  title: string;
  status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  estimatedDurationSec: number;
  /** 1 (low) … 4 (urgent) */
  priority: number;
  deadline: number | null;
  /** 1..5 */
  energyRequired: number;
  /** 1..5 */
  focusRequired: number;
  preferredTimeOfDay: 'ANY' | TimeOfDayKey;
  categoryKey: string | null;
  /** Titles of dependencies that are not completed yet. */
  blockedBy: string[];
  /** Number of open tasks waiting on this one. */
  unblocksCount: number;
  /** A future work block already exists for this task. */
  alreadyScheduled: boolean;
  createdAt: number;
}

export interface CandidateWindow {
  start: number;
  end: number;
  /** 0..100 from the availability engine */
  confidenceScore: number;
}

export interface UserState {
  /** 1..5, or null when unknown */
  energy: number | null;
  focus: number | null;
  source: 'LOGGED' | 'FORECAST' | 'DECLARED' | 'UNKNOWN';
}

export interface RecommendationHistory {
  /** Median actual/estimate ratio per category key with its sample size. */
  overrunByCategory: Record<string, { ratio: number; samples: number }>;
  /** Share of planned blocks that were completed, per part of day. */
  completionByTimeOfDay: Partial<Record<TimeOfDayKey, { rate: number; samples: number }>>;
}

export interface ScoringContext {
  now: number;
  timezone: string;
  windows: CandidateWindow[];
  user: UserState;
  /** Expected energy for a local hour (1..5) or null when unknown. Used for windows later today. */
  energyAtHour?: (hour: number) => number | null;
  history: RecommendationHistory;
  /** Optional hard cap: "I only have N minutes". */
  maxDurationSec?: number;
  limit?: number;
}

export const WEIGHTS = {
  urgency: 0.26,
  priority: 0.22,
  fit: 0.14,
  energy: 0.14,
  focus: 0.08,
  timeOfDay: 0.06,
  history: 0.04,
  momentum: 0.03,
  leverage: 0.03,
} as const;

export type FactorKey = keyof typeof WEIGHTS;

export interface FactorScore {
  factor: FactorKey;
  /** 0..1 */
  value: number;
  weight: number;
  /** Points contributed to the 0..100 score. */
  points: number;
  note: string;
}

export interface ScoredRecommendation {
  taskId: string;
  title: string;
  /** 0..100 */
  score: number;
  /** 0..100 — how much the inputs support this recommendation. */
  confidence: number;
  reasons: string[];
  /** One-sentence explanation composed from the reasons. */
  summary: string;
  /** Estimate adjusted by the user's own history for this kind of task. */
  estimatedDurationSec: number;
  suitableWindow: { start: number; end: number };
  breakdown: FactorScore[];
}

export interface ExcludedTask {
  taskId: string;
  title: string;
  code: 'NOT_ACTIONABLE' | 'BLOCKED' | 'ALREADY_SCHEDULED' | 'TOO_LONG_FOR_LIMIT' | 'NO_WINDOW';
  reason: string;
}

export interface RecommendationResult {
  recommendations: ScoredRecommendation[];
  excluded: ExcludedTask[];
}

const MIN_HISTORY_SAMPLES = 3;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Estimate corrected by how this user's tasks of the same category actually turn out. */
export function predictDurationSec(task: CandidateTask, history: RecommendationHistory): { sec: number; adjusted: boolean } {
  const h = task.categoryKey ? history.overrunByCategory[task.categoryKey] : undefined;
  if (!h || h.samples < MIN_HISTORY_SAMPLES) return { sec: task.estimatedDurationSec, adjusted: false };
  const ratio = Math.min(2.5, Math.max(0.5, h.ratio));
  if (Math.abs(ratio - 1) < 0.1) return { sec: task.estimatedDurationSec, adjusted: false };
  // Round to whole minutes; integer seconds throughout.
  return { sec: Math.max(60, Math.round((task.estimatedDurationSec * ratio) / 60) * 60), adjusted: true };
}

/** 1 when overdue or due before it can finish; decays with slack (≈0.61 at 24h, ≈0.37 at 48h). */
export function urgencyFactor(deadline: number | null, now: number, durationSec: number): number {
  if (deadline === null) return 0.3;
  const slackMs = deadline - now - durationSec * MS_PER_SECOND;
  if (slackMs <= 0) return 1;
  return Math.max(0.05, Math.exp(-slackMs / (48 * MS_PER_HOUR)));
}

/** How well the user's current level (1..5) covers a requirement (1..5). Unknown state is neutral. */
export function levelMatch(userLevel: number | null, required: number): number {
  if (userLevel === null) return 0.5;
  const diff = userLevel - required;
  if (diff >= 0) return Math.max(0.6, 1 - 0.1 * diff); // spare capacity is fine, slightly wasteful
  return clamp01(1 + diff * 0.35); // each missing step costs 35%
}

function describeDeadline(deadline: number, now: number): string {
  const diffH = (deadline - now) / MS_PER_HOUR;
  if (diffH < 0) return 'it is already overdue';
  if (diffH < 1) return 'it is due within the hour';
  if (diffH < 24) return `it is due in about ${Math.round(diffH)} hour${Math.round(diffH) === 1 ? '' : 's'}`;
  const days = Math.round(diffH / 24);
  return `it is due in ${days} day${days === 1 ? '' : 's'}`;
}

const PRIORITY_LABEL = ['', 'low', 'medium', 'high', 'urgent'];
const LEVEL_WORD = ['', 'very low', 'low', 'moderate', 'high', 'very high'];

function scoreTaskInWindow(
  task: CandidateTask,
  durationSec: number,
  adjusted: boolean,
  window: CandidateWindow,
  ctx: ScoringContext,
): ScoredRecommendation {
  const start = Math.max(window.start, ctx.now);
  const slot = { start, end: start + durationSec * MS_PER_SECOND };
  const hour = localHour(start, ctx.timezone);
  const tod = timeOfDayForHour(hour);
  const startsNow = start - ctx.now < 30 * 60_000;

  // Current state applies to "now"; later windows use the hourly expectation when there is one.
  const energyThen = startsNow ? ctx.user.energy : (ctx.energyAtHour?.(hour) ?? null);
  const focusThen = startsNow ? ctx.user.focus : energyThen;

  const windowSec = Math.max(1, Math.floor((window.end - start) / MS_PER_SECOND));
  const fill = clamp01(durationSec / windowSec);
  const hist = ctx.history.completionByTimeOfDay[tod];
  const histKnown = hist !== undefined && hist.samples >= 5;

  const values: Record<FactorKey, { value: number; note: string }> = {
    urgency: {
      value: urgencyFactor(task.deadline, ctx.now, durationSec),
      note: task.deadline === null ? 'No deadline set.' : `Deadline: ${describeDeadline(task.deadline, ctx.now)}.`,
    },
    priority: {
      value: (Math.min(4, Math.max(1, task.priority)) - 1) / 3,
      note: `Priority is ${PRIORITY_LABEL[task.priority] ?? 'medium'}.`,
    },
    fit: {
      value: 0.4 + 0.6 * fill,
      note: `Needs ${formatDuration(durationSec)} of a ${formatDuration(windowSec)} window.`,
    },
    energy: {
      value: levelMatch(energyThen, task.energyRequired),
      note:
        energyThen === null
          ? 'Your energy at that time is unknown.'
          : `Needs ${LEVEL_WORD[task.energyRequired]} energy; yours is ${LEVEL_WORD[Math.round(energyThen)]}.`,
    },
    focus: {
      value: levelMatch(focusThen, task.focusRequired),
      note:
        focusThen === null
          ? 'Your focus at that time is unknown.'
          : `Needs ${LEVEL_WORD[task.focusRequired]} focus; yours is ${LEVEL_WORD[Math.round(focusThen)]}.`,
    },
    timeOfDay: {
      value: task.preferredTimeOfDay === 'ANY' ? 0.5 : task.preferredTimeOfDay === tod ? 1 : 0,
      note:
        task.preferredTimeOfDay === 'ANY'
          ? 'No preferred time of day.'
          : `Preferred in the ${task.preferredTimeOfDay.toLowerCase()}; the window is in the ${tod.toLowerCase()}.`,
    },
    history: {
      value: histKnown ? clamp01(hist.rate) : 0.5,
      note: histKnown
        ? `You complete ${Math.round(hist.rate * 100)}% of the blocks you plan in the ${tod.toLowerCase()}.`
        : 'Not enough history for this time of day yet.',
    },
    momentum: {
      value: task.status === 'IN_PROGRESS' ? 1 : 0,
      note: task.status === 'IN_PROGRESS' ? 'Already in progress.' : 'Not started yet.',
    },
    leverage: {
      value: clamp01(task.unblocksCount / 2),
      note: task.unblocksCount > 0 ? `Unblocks ${task.unblocksCount} other task(s).` : 'No tasks depend on it.',
    },
  };

  const breakdown: FactorScore[] = (Object.keys(WEIGHTS) as FactorKey[]).map((factor) => {
    const { value, note } = values[factor];
    return { factor, value: Math.round(value * 1000) / 1000, weight: WEIGHTS[factor], points: Math.round(value * WEIGHTS[factor] * 1000) / 10, note };
  });
  const score = Math.round(breakdown.reduce((s, f) => s + f.value * f.weight, 0) * 100);

  // Reasons: only statements the numbers support, strongest contribution first.
  const reasons: { points: number; text: string }[] = [];
  const add = (factor: FactorKey, text: string) =>
    reasons.push({ points: breakdown.find((b) => b.factor === factor)!.points, text });

  add('fit', `it needs about ${formatDuration(durationSec)} and fits your free window ${formatClock(window.start, ctx.timezone)}–${formatClock(window.end, ctx.timezone)}`);
  if (task.priority >= 3) add('priority', `it has ${PRIORITY_LABEL[task.priority]} priority`);
  if (task.deadline !== null && values.urgency.value >= 0.35) add('urgency', describeDeadline(task.deadline, ctx.now));
  if (energyThen !== null && values.energy.value >= 0.9) add('energy', `its ${LEVEL_WORD[task.energyRequired]} energy demand matches how you feel`);
  if (focusThen !== null && values.focus.value >= 0.9 && task.focusRequired >= 4) add('focus', 'you have the focus it requires');
  if (values.timeOfDay.value === 1) add('timeOfDay', `you prefer doing it in the ${tod.toLowerCase()}`);
  if (task.status === 'IN_PROGRESS') add('momentum', 'you have already started it');
  if (task.unblocksCount > 0) add('leverage', `finishing it unblocks ${task.unblocksCount} other task${task.unblocksCount === 1 ? '' : 's'}`);
  if (histKnown && hist.rate >= 0.75) add('history', `you usually finish what you plan in the ${tod.toLowerCase()}`);
  if (adjusted) reasons.push({ points: 0, text: 'the duration is adjusted from your own history for similar work' });

  const ordered = [reasons[0]!, ...reasons.slice(1).sort((a, b) => b.points - a.points)].map((r) => r.text);
  const summary =
    ordered.length === 1
      ? `Recommended because ${ordered[0]}.`
      : `Recommended because ${ordered.slice(0, -1).join(', ')}, and ${ordered[ordered.length - 1]}.`;

  // Confidence: what we do not know lowers it; it is independent of how high the score is.
  let confidence = 100;
  if (energyThen === null) confidence -= 20;
  else if (!startsNow || ctx.user.source !== 'LOGGED') confidence -= 8;
  if (!adjusted && !(task.categoryKey && ctx.history.overrunByCategory[task.categoryKey]?.samples)) confidence -= 7;
  if (!histKnown) confidence -= 5;
  confidence -= Math.round((100 - window.confidenceScore) * 0.4);
  confidence = Math.min(100, Math.max(5, confidence));

  return {
    taskId: task.id,
    title: task.title,
    score,
    confidence,
    reasons: ordered.map((r) => r.charAt(0).toUpperCase() + r.slice(1) + '.'),
    summary,
    estimatedDurationSec: durationSec,
    suitableWindow: slot,
    breakdown,
  };
}

export function recommendTasks(tasks: readonly CandidateTask[], ctx: ScoringContext): RecommendationResult {
  const excluded: ExcludedTask[] = [];
  const scored: { rec: ScoredRecommendation; task: CandidateTask }[] = [];
  const windows = ctx.windows
    .map((w) => ({ ...w, start: Math.max(w.start, ctx.now) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const longestSec = windows.reduce((m, w) => Math.max(m, Math.floor((w.end - w.start) / MS_PER_SECOND)), 0);

  for (const task of tasks) {
    if (task.status !== 'TODO' && task.status !== 'IN_PROGRESS') {
      excluded.push({ taskId: task.id, title: task.title, code: 'NOT_ACTIONABLE', reason: `Status is ${task.status.toLowerCase().replace('_', ' ')}.` });
      continue;
    }
    if (task.blockedBy.length > 0) {
      excluded.push({ taskId: task.id, title: task.title, code: 'BLOCKED', reason: `Waiting on: ${task.blockedBy.join(', ')}.` });
      continue;
    }
    if (task.alreadyScheduled) {
      excluded.push({ taskId: task.id, title: task.title, code: 'ALREADY_SCHEDULED', reason: 'A work block is already scheduled for it.' });
      continue;
    }
    const { sec: durationSec, adjusted } = predictDurationSec(task, ctx.history);
    if (ctx.maxDurationSec !== undefined && durationSec > ctx.maxDurationSec) {
      excluded.push({
        taskId: task.id,
        title: task.title,
        code: 'TOO_LONG_FOR_LIMIT',
        reason: `Needs ${formatDuration(durationSec)}, more than the ${formatDuration(ctx.maxDurationSec)} you have.`,
      });
      continue;
    }
    const viable = windows.filter((w) => w.end - w.start >= durationSec * MS_PER_SECOND).slice(0, 8);
    if (viable.length === 0) {
      excluded.push({
        taskId: task.id,
        title: task.title,
        code: 'NO_WINDOW',
        reason:
          longestSec > 0
            ? `Needs ${formatDuration(durationSec)}; your longest free window is ${formatDuration(longestSec)}.`
            : 'There is no free window left in this period.',
      });
      continue;
    }
    // Best window for this task; on equal score the earlier window wins.
    let best: ScoredRecommendation | null = null;
    for (const w of viable) {
      const rec = scoreTaskInWindow(task, durationSec, adjusted, w, ctx);
      if (!best || rec.score > best.score) best = rec;
    }
    scored.push({ rec: best!, task });
  }

  scored.sort(
    (a, b) =>
      b.rec.score - a.rec.score ||
      (a.task.deadline ?? Number.MAX_SAFE_INTEGER) - (b.task.deadline ?? Number.MAX_SAFE_INTEGER) ||
      b.task.priority - a.task.priority ||
      a.task.createdAt - b.task.createdAt ||
      a.task.id.localeCompare(b.task.id),
  );

  return { recommendations: scored.slice(0, ctx.limit ?? 5).map((s) => s.rec), excluded };
}
