import { formatClock, formatDuration, LocalDate } from '@/common/time/time';
import { DayGap, SessionFact } from './day-metrics';

/**
 * Time leakage detection — explainable rules over measured facts.
 *
 * Vocabulary (kept strictly apart):
 *   productive      tracked time in productive categories
 *   rest / leisure  tracked or planned downtime — never reported as waste
 *   unplanned gap   short untracked hole between two tracked blocks, not covered by any plan
 *   unknown         active-hours time with neither plan nor tracking: we simply do not know
 * Only unplanned gaps count as "leakage". Unknown time is surfaced as a data-quality note.
 */

export interface LeakageDay {
  date: LocalDate;
  trackedSec: number;
  productiveSec: number;
  restSec: number;
  leisureSec: number;
  plannedSec: number;
  /** Planned time in rest/leisure categories — deliberate downtime. */
  plannedDowntimeSec: number;
  leakageSec: number;
  unknownSec: number;
  plannedUntrackedSec: number;
  activeSec: number;
  activePastSec: number;
  transitions: number;
  contextSwitches: number;
  fragmentedSec: number;
  conflictCount: number;
  gaps: DayGap[];
  sessions: SessionFact[];
}

export interface EstimateSample {
  categoryKey: string;
  categoryName: string;
  estimateSec: number;
  actualSec: number;
}

export interface LeakageInput {
  timezone: string;
  days: LeakageDay[];
  /** Completed activities in the period that had both an estimate and tracked time. */
  estimates: EstimateSample[];
  /** Activities moved repeatedly in the period. */
  rescheduled: { title: string; count: number }[];
}

export type LeakageType =
  | 'UNPLANNED_GAPS'
  | 'EXCESSIVE_TRANSITIONS'
  | 'CONTEXT_SWITCHING'
  | 'REPEATED_INTERRUPTIONS'
  | 'OVERLOADED_SCHEDULE'
  | 'ESTIMATE_OVERRUNS'
  | 'UNTRACKED_TIME'
  | 'FREQUENT_RESCHEDULING';

export interface LeakageInsight {
  type: LeakageType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  title: string;
  explanation: string;
  suggestion: string;
  /** Measured time affected, in seconds. Null when the pattern has no directly measurable cost. */
  impactSec: number | null;
  evidence: { label: string; value: string }[];
}

export interface LeakageTotals {
  trackedSec: number;
  productiveSec: number;
  restSec: number;
  leisureSec: number;
  plannedDowntimeSec: number;
  unplannedGapSec: number;
  unknownSec: number;
  plannedUntrackedSec: number;
  activePastSec: number;
}

export interface LeakageReport {
  totals: LeakageTotals;
  insights: LeakageInsight[];
  /** Days in the period that contain any tracked time. */
  daysWithData: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export function detectLeakage(input: LeakageInput): LeakageReport {
  const { days, timezone } = input;
  const sum = (pick: (d: LeakageDay) => number) => days.reduce((s, d) => s + pick(d), 0);
  const totals: LeakageTotals = {
    trackedSec: sum((d) => d.trackedSec),
    productiveSec: sum((d) => d.productiveSec),
    restSec: sum((d) => d.restSec),
    leisureSec: sum((d) => d.leisureSec),
    plannedDowntimeSec: sum((d) => d.plannedDowntimeSec),
    unplannedGapSec: sum((d) => d.leakageSec),
    unknownSec: sum((d) => d.unknownSec),
    plannedUntrackedSec: sum((d) => d.plannedUntrackedSec),
    activePastSec: sum((d) => d.activePastSec),
  };
  const tracked = days.filter((d) => d.trackedSec > 0);
  const insights: LeakageInsight[] = [];

  // 1. Unplanned gaps
  const allGaps = days.flatMap((d) => d.gaps.map((g) => ({ ...g, date: d.date })));
  if (totals.unplannedGapSec >= 30 * 60) {
    const share = totals.unplannedGapSec / Math.max(1, totals.trackedSec + totals.unplannedGapSec);
    const largest = [...allGaps].sort((a, b) => b.end - b.start - (a.end - a.start))[0]!;
    insights.push({
      type: 'UNPLANNED_GAPS',
      severity: share >= 0.15 ? 'HIGH' : share >= 0.07 ? 'MEDIUM' : 'LOW',
      title: `${formatDuration(totals.unplannedGapSec)} slipped between activities`,
      explanation: `There were ${allGaps.length} short untracked gaps (5–45 min) between tracked blocks that no plan accounted for. That is ${Math.round(share * 100)}% of your tracked day.`,
      suggestion: 'Decide in advance what follows each block, or log the gap as a break so it becomes intentional rest.',
      impactSec: totals.unplannedGapSec,
      evidence: [
        { label: 'Gaps', value: String(allGaps.length) },
        {
          label: 'Largest',
          value: `${formatDuration(Math.floor((largest.end - largest.start) / 1000))} on ${largest.date}, ${formatClock(largest.start, timezone)}–${formatClock(largest.end, timezone)} (after "${largest.after}")`,
        },
      ],
    });
  }

  // 2. Excessive transitions
  if (tracked.length > 0) {
    const perDay = sum((d) => d.transitions) / tracked.length;
    const worst = [...tracked].sort((a, b) => b.transitions - a.transitions)[0]!;
    if (perDay >= 6 || worst.transitions >= 10) {
      insights.push({
        type: 'EXCESSIVE_TRANSITIONS',
        severity: perDay >= 10 ? 'HIGH' : 'MEDIUM',
        title: `About ${Math.round(perDay)} activity switches per tracked day`,
        explanation: `You moved straight from one activity to another ${sum((d) => d.transitions)} times across ${tracked.length} tracked day(s). The busiest day was ${worst.date} with ${worst.transitions} switches.`,
        suggestion: 'Batch similar activities into one longer block to cut down on restarts.',
        impactSec: null,
        evidence: [
          { label: 'Total switches', value: String(sum((d) => d.transitions)) },
          { label: 'Busiest day', value: `${worst.date} (${worst.transitions})` },
        ],
      });
    }
  }

  // 3. Context switching (fragmented productive time across categories)
  if (totals.productiveSec >= 60 * 60) {
    const fragmented = sum((d) => d.fragmentedSec);
    const share = fragmented / totals.productiveSec;
    const switches = sum((d) => d.contextSwitches);
    if (share >= 0.3 && switches >= 3) {
      insights.push({
        type: 'CONTEXT_SWITCHING',
        severity: share >= 0.5 ? 'HIGH' : 'MEDIUM',
        title: `${Math.round(share * 100)}% of productive time came in fragments under 25 minutes`,
        explanation: `${formatDuration(fragmented)} of your ${formatDuration(totals.productiveSec)} productive time was tracked in short pieces, with ${switches} jumps between different kinds of work.`,
        suggestion: 'Protect at least one uninterrupted block per day for your most demanding work.',
        impactSec: fragmented,
        evidence: [
          { label: 'Fragmented time', value: formatDuration(fragmented) },
          { label: 'Category switches', value: String(switches) },
        ],
      });
    }
  }

  // 4. Repeated interruptions
  const interrupted = days
    .flatMap((d) => d.sessions.map((s) => ({ ...s, date: d.date })))
    .filter((s) => s.pauseCount >= 3)
    .sort((a, b) => b.pauseCount - a.pauseCount);
  if (interrupted.length >= 2 || (interrupted[0]?.pauseCount ?? 0) >= 5) {
    insights.push({
      type: 'REPEATED_INTERRUPTIONS',
      severity: interrupted.length >= 5 ? 'HIGH' : 'MEDIUM',
      title: `${interrupted.length} session${interrupted.length === 1 ? ' was' : 's were'} paused three or more times`,
      explanation: `The most interrupted was "${interrupted[0]!.title}" on ${interrupted[0]!.date}, paused ${interrupted[0]!.pauseCount} times.`,
      suggestion: 'Note what interrupts these sessions. If it is the same source, block it for the duration of the session.',
      impactSec: null,
      evidence: interrupted.slice(0, 3).map((s) => ({ label: s.title, value: `${s.pauseCount} pauses (${s.date})` })),
    });
  }

  // 5. Overloaded schedule
  const overloaded = days.filter((d) => d.activeSec > 0 && (d.plannedSec > d.activeSec * 0.9 || d.conflictCount > 0));
  if (overloaded.length > 0) {
    const conflicts = overloaded.reduce((s, d) => s + d.conflictCount, 0);
    insights.push({
      type: 'OVERLOADED_SCHEDULE',
      severity: overloaded.length >= 3 || conflicts >= 3 ? 'HIGH' : 'MEDIUM',
      title: `${overloaded.length} day${overloaded.length === 1 ? ' is' : 's are'} over-committed`,
      explanation:
        conflicts > 0
          ? `${conflicts} pair(s) of commitments overlap, and planned time exceeds 90% of your active hours on the days listed.`
          : 'Planned time exceeds 90% of your active hours on the days listed, leaving no slack for overruns.',
      suggestion: 'Move or drop the lowest-priority block on these days and keep a buffer for overruns.',
      impactSec: null,
      evidence: overloaded.slice(0, 5).map((d) => ({
        label: d.date,
        value: `${formatDuration(d.plannedSec)} planned of ${formatDuration(d.activeSec)} active${d.conflictCount ? `, ${d.conflictCount} conflict(s)` : ''}`,
      })),
    });
  }

  // 6. Tasks consistently exceeding estimates
  const byCat = new Map<string, { name: string; ratios: number[]; overSec: number }>();
  for (const e of input.estimates) {
    if (e.estimateSec <= 0 || e.actualSec <= 0) continue;
    const cur = byCat.get(e.categoryKey) ?? { name: e.categoryName, ratios: [], overSec: 0 };
    cur.ratios.push(e.actualSec / e.estimateSec);
    cur.overSec += Math.max(0, e.actualSec - e.estimateSec);
    byCat.set(e.categoryKey, cur);
  }
  const overruns = [...byCat.values()]
    .filter((c) => c.ratios.length >= 3 && median(c.ratios) >= 1.25)
    .sort((a, b) => median(b.ratios) - median(a.ratios));
  if (overruns.length > 0) {
    const top = overruns[0]!;
    const pct = Math.round((median(top.ratios) - 1) * 100);
    insights.push({
      type: 'ESTIMATE_OVERRUNS',
      severity: pct >= 60 ? 'HIGH' : 'MEDIUM',
      title: `${top.name} activities run about ${pct}% over their estimate`,
      explanation: `Across ${top.ratios.length} completed ${top.name.toLowerCase()} activities, the typical one took ${median(top.ratios).toFixed(2)}× its estimate.`,
      suggestion: `Add ${pct}% to new ${top.name.toLowerCase()} estimates. Recommendations already apply this correction automatically.`,
      impactSec: overruns.reduce((s, c) => s + c.overSec, 0),
      evidence: overruns.slice(0, 4).map((c) => ({
        label: c.name,
        value: `${median(c.ratios).toFixed(2)}× estimate over ${c.ratios.length} activities`,
      })),
    });
  }

  // 7. Untracked time — a data-quality note, deliberately not framed as waste
  const untracked = totals.unknownSec + totals.plannedUntrackedSec;
  if (totals.activePastSec > 0 && untracked / totals.activePastSec >= 0.4 && untracked >= 2 * 3600) {
    insights.push({
      type: 'UNTRACKED_TIME',
      severity: 'LOW',
      title: `${formatDuration(untracked)} of active hours have no tracking data`,
      explanation: `${formatDuration(totals.plannedUntrackedSec)} was planned but never tracked, and ${formatDuration(totals.unknownSec)} had neither a plan nor tracking. This time is unknown — it is not counted as free time or as wasted time.`,
      suggestion: 'Start the timer when you begin a planned activity, or add a manual entry afterwards, to make your analytics trustworthy.',
      impactSec: untracked,
      evidence: [
        { label: 'Planned, not tracked', value: formatDuration(totals.plannedUntrackedSec) },
        { label: 'Unknown', value: formatDuration(totals.unknownSec) },
        { label: 'Coverage', value: `${Math.round((1 - untracked / totals.activePastSec) * 100)}% of past active hours accounted for` },
      ],
    });
  }

  // 8. Frequent rescheduling
  const moved = input.rescheduled.filter((r) => r.count >= 3).sort((a, b) => b.count - a.count);
  if (moved.length > 0) {
    insights.push({
      type: 'FREQUENT_RESCHEDULING',
      severity: moved.length >= 3 || moved[0]!.count >= 5 ? 'MEDIUM' : 'LOW',
      title: `${moved.length} activit${moved.length === 1 ? 'y keeps' : 'ies keep'} getting moved`,
      explanation: `"${moved[0]!.title}" has been rescheduled ${moved[0]!.count} times. Repeatedly moved work is often too large, unclear, or scheduled at the wrong time of day.`,
      suggestion: 'Split it into a smaller first step, or schedule it in a window where your energy usually matches.',
      impactSec: null,
      evidence: moved.slice(0, 4).map((r) => ({ label: r.title, value: `moved ${r.count}×` })),
    });
  }

  insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.impactSec ?? 0) - (a.impactSec ?? 0));
  return { totals, insights, daysWithData: tracked.length };
}
