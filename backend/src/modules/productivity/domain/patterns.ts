import { addDays, formatDuration, isoWeekday, LocalDate } from '@/common/time/time';
import { timeOfDayForHour } from '@/common/levels';
import { median } from './leakage';

/**
 * Predictive productivity engine (statistical baseline).
 *
 * Explainable descriptive statistics only: medians, quartiles, rolling means, least-squares
 * trend. No machine learning — with a few weeks of personal data, simple statistics are both
 * more honest and easier to verify. Every insight carries a sample size, a data-sufficiency
 * level and a confidence value, and wording stays probabilistic ("tends to", "expected").
 *
 * `PredictionProvider` is the seam for a future out-of-process analytics service
 * (e.g. Python); `StatisticalPredictionProvider` is the built-in implementation.
 */

export type Sufficiency = 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface PatternDay {
  date: LocalDate;
  trackedSec: number;
  productiveSec: number;
  focusSec: number;
  deepWorkSessions: number;
  /** 24 entries */
  hourlyProductiveSec: number[];
}

export interface PatternInput {
  today: LocalDate;
  days: PatternDay[];
  /** Lengths of productive tracked segments in the period (seconds). */
  productiveSegmentSecs: number[];
  /** Completed work with both an estimate and tracked time. */
  estimates: { categoryName: string; estimateSec: number; actualSec: number }[];
  /** Planned activities that were tracked: how late they started (seconds, negative = early). */
  startDelays: { categoryName: string; title: string; delaySec: number }[];
  energyLogs: { hour: number; energy: number; focus: number }[];
}

export interface PatternInsight {
  key:
    | 'peak_hours'
    | 'consistent_days'
    | 'completion_time'
    | 'delayed_activities'
    | 'preferred_duration'
    | 'focus_pattern'
    | 'energy_pattern'
    | 'trend';
  title: string;
  /** Plain-language finding. Probabilistic wording; never stated as certain fact. */
  statement: string;
  sufficiency: Sufficiency;
  /** 0..100 */
  confidence: number;
  sampleSize: number;
  sampleUnit: string;
  /** Machine-readable values for charts. */
  data: Record<string, unknown>;
}

export interface ProductivityForecast {
  date: LocalDate;
  expectedProductiveSec: number | null;
  lowSec: number | null;
  highSec: number | null;
  basis: string;
  sufficiency: Sufficiency;
  confidence: number;
  sampleSize: number;
}

export interface PatternReport {
  periodStart: LocalDate | null;
  periodEnd: LocalDate | null;
  daysWithData: number;
  sufficiency: Sufficiency;
  insights: PatternInsight[];
  forecast: ProductivityForecast;
}

export interface PredictionProvider {
  readonly name: string;
  analyse(input: PatternInput): PatternReport | Promise<PatternReport>;
}

export const SUFFICIENCY_THRESHOLDS = { low: 5, medium: 14, high: 28 } as const;

export function sufficiencyFor(samples: number, t: { low: number; medium: number; high: number } = SUFFICIENCY_THRESHOLDS): Sufficiency {
  if (samples >= t.high) return 'HIGH';
  if (samples >= t.medium) return 'MEDIUM';
  if (samples >= t.low) return 'LOW';
  return 'INSUFFICIENT';
}

/** Saturating confidence from sample size: 0 with no data, ≈63 at `scale` samples, capped at 95. */
export function confidenceFromSamples(samples: number, scale = 12): number {
  if (samples <= 0) return 0;
  return Math.min(95, Math.round(100 * (1 - Math.exp(-samples / scale))));
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

const mean = (v: readonly number[]): number => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);

function stdev(v: readonly number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/** Least-squares slope of y over x = 0..n-1. */
export function slope(y: readonly number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  const ym = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (y[i]! - ym);
    den += (i - xm) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hh = (h: number): string => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
const need = (have: number, min: number, unit: string): string =>
  `Not enough data yet — ${have} ${unit} so far, at least ${min} needed.`;

export class StatisticalPredictionProvider implements PredictionProvider {
  readonly name = 'statistical-baseline';

  analyse(input: PatternInput): PatternReport {
    const days = input.days.filter((d) => d.trackedSec > 0).sort((a, b) => a.date.localeCompare(b.date));
    const n = days.length;
    const overall = sufficiencyFor(n);
    const insights: PatternInsight[] = [];

    // ── Most productive hours: best 2-hour stretch of the average day ────────
    {
      const avg = Array.from({ length: 24 }, (_, h) => (n ? mean(days.map((d) => d.hourlyProductiveSec[h] ?? 0)) : 0));
      let bestStart = 0;
      let bestSum = -1;
      for (let h = 0; h < 23; h++) {
        const s = avg[h]! + avg[h + 1]!;
        if (s > bestSum) {
          bestSum = s;
          bestStart = h;
        }
      }
      const totalAvg = avg.reduce((s, v) => s + v, 0);
      const ok = overall !== 'INSUFFICIENT' && totalAvg > 0;
      insights.push({
        key: 'peak_hours',
        title: 'Most productive hours',
        statement: ok
          ? `You tend to be most productive between ${hh(bestStart)} and ${hh(bestStart + 2)} — about ${Math.round((bestSum / totalAvg) * 100)}% of your productive time falls in that window.`
          : need(n, SUFFICIENCY_THRESHOLDS.low, 'tracked days'),
        sufficiency: ok ? overall : 'INSUFFICIENT',
        confidence: ok ? confidenceFromSamples(n) : 0,
        sampleSize: n,
        sampleUnit: 'tracked days',
        data: { hourlyAvgProductiveSec: avg.map((v) => Math.round(v)), peakStartHour: ok ? bestStart : null, peakEndHour: ok ? bestStart + 2 : null },
      });
    }

    // ── Most consistent working days ─────────────────────────────────────────
    {
      const byWd = new Map<number, number[]>();
      for (const d of days) {
        const wd = isoWeekday(d.date);
        byWd.set(wd, [...(byWd.get(wd) ?? []), d.productiveSec]);
      }
      const stats = [...byWd.entries()]
        .filter(([, v]) => v.length >= 2 && mean(v) > 0)
        .map(([wd, v]) => ({ weekday: wd, name: WEEKDAY_NAMES[wd]!, meanSec: Math.round(mean(v)), cv: stdev(v) / mean(v), samples: v.length }));
      const ok = stats.length >= 3;
      const steady = [...stats].sort((a, b) => a.cv - b.cv)[0];
      const strongest = [...stats].sort((a, b) => b.meanSec - a.meanSec)[0];
      insights.push({
        key: 'consistent_days',
        title: 'Most consistent days',
        statement:
          ok && steady && strongest
            ? `${steady.name} is your steadiest day (productive time varies least), and ${strongest.name} is typically your strongest at about ${formatDuration(strongest.meanSec)}.`
            : 'Not enough data yet — at least two tracked weeks are needed to compare weekdays.',
        sufficiency: ok ? sufficiencyFor(n, { low: 10, medium: 21, high: 42 }) : 'INSUFFICIENT',
        confidence: ok ? confidenceFromSamples(n, 20) : 0,
        sampleSize: n,
        sampleUnit: 'tracked days',
        data: { weekdays: stats.sort((a, b) => a.weekday - b.weekday) },
      });
    }

    // ── Completion time vs estimate ──────────────────────────────────────────
    {
      const ratios = input.estimates.filter((e) => e.estimateSec > 0 && e.actualSec > 0).map((e) => e.actualSec / e.estimateSec);
      const m = median(ratios);
      const ok = ratios.length >= 5;
      const byCat = new Map<string, number[]>();
      for (const e of input.estimates) {
        if (e.estimateSec > 0 && e.actualSec > 0) byCat.set(e.categoryName, [...(byCat.get(e.categoryName) ?? []), e.actualSec / e.estimateSec]);
      }
      insights.push({
        key: 'completion_time',
        title: 'Completion time vs. estimate',
        statement: ok
          ? Math.abs(m - 1) < 0.1
            ? `Your estimates are well calibrated: completed work typically takes ${m.toFixed(2)}× the estimate.`
            : `Completed work typically takes ${m.toFixed(2)}× your estimate (${m > 1 ? 'longer' : 'shorter'} than planned).`
          : need(ratios.length, 5, 'completed estimated activities'),
        sufficiency: sufficiencyFor(ratios.length, { low: 5, medium: 15, high: 40 }),
        confidence: ok ? confidenceFromSamples(ratios.length, 15) : 0,
        sampleSize: ratios.length,
        sampleUnit: 'completed activities',
        data: {
          medianRatio: ok ? Math.round(m * 100) / 100 : null,
          byCategory: [...byCat.entries()].filter(([, v]) => v.length >= 3).map(([name, v]) => ({ name, medianRatio: Math.round(median(v) * 100) / 100, samples: v.length })),
        },
      });
    }

    // ── Frequently delayed activities ────────────────────────────────────────
    {
      const byCat = new Map<string, number[]>();
      for (const d of input.startDelays) byCat.set(d.categoryName, [...(byCat.get(d.categoryName) ?? []), d.delaySec]);
      const rows = [...byCat.entries()]
        .filter(([, v]) => v.length >= 3)
        .map(([name, v]) => ({ name, medianDelaySec: Math.round(median(v)), samples: v.length }))
        .sort((a, b) => b.medianDelaySec - a.medianDelaySec);
      const top = rows[0];
      const ok = input.startDelays.length >= 5 && top !== undefined;
      insights.push({
        key: 'delayed_activities',
        title: 'Late starts',
        statement: ok
          ? top.medianDelaySec >= 5 * 60
            ? `${top.name} activities tend to start about ${formatDuration(top.medianDelaySec)} later than planned.`
            : 'You generally start planned activities on time (typical delay under 5 minutes).'
          : need(input.startDelays.length, 5, 'planned activities with tracking'),
        sufficiency: sufficiencyFor(input.startDelays.length, { low: 5, medium: 20, high: 50 }),
        confidence: ok ? confidenceFromSamples(input.startDelays.length, 18) : 0,
        sampleSize: input.startDelays.length,
        sampleUnit: 'tracked planned activities',
        data: { byCategory: rows },
      });
    }

    // ── Preferred activity duration ──────────────────────────────────────────
    {
      const segs = input.productiveSegmentSecs.filter((s) => s >= 5 * 60);
      const ok = segs.length >= 8;
      insights.push({
        key: 'preferred_duration',
        title: 'Natural working rhythm',
        statement: ok
          ? `Your uninterrupted work blocks typically last ${formatDuration(Math.round(median(segs)))} (half of them fall between ${formatDuration(Math.round(quantile(segs, 0.25)))} and ${formatDuration(Math.round(quantile(segs, 0.75)))}).`
          : need(segs.length, 8, 'work blocks'),
        sufficiency: sufficiencyFor(segs.length, { low: 8, medium: 25, high: 60 }),
        confidence: ok ? confidenceFromSamples(segs.length, 25) : 0,
        sampleSize: segs.length,
        sampleUnit: 'work blocks',
        data: ok ? { medianSec: Math.round(median(segs)), p25Sec: Math.round(quantile(segs, 0.25)), p75Sec: Math.round(quantile(segs, 0.75)) } : {},
      });
    }

    // ── Focus pattern ────────────────────────────────────────────────────────
    {
      const ok = overall !== 'INSUFFICIENT';
      const avgFocus = Math.round(mean(days.map((d) => d.focusSec)));
      const deepDays = days.filter((d) => d.deepWorkSessions > 0).length;
      insights.push({
        key: 'focus_pattern',
        title: 'Focus pattern',
        statement: ok
          ? `On tracked days you average ${formatDuration(avgFocus)} of focused work, and reach at least one deep-work session on ${Math.round((deepDays / n) * 100)}% of them.`
          : need(n, SUFFICIENCY_THRESHOLDS.low, 'tracked days'),
        sufficiency: overall,
        confidence: ok ? confidenceFromSamples(n) : 0,
        sampleSize: n,
        sampleUnit: 'tracked days',
        data: { avgFocusSec: ok ? avgFocus : null, deepWorkDayShare: ok ? Math.round((deepDays / n) * 100) : null, avgDeepWorkSessions: ok ? Math.round(mean(days.map((d) => d.deepWorkSessions)) * 10) / 10 : null },
      });
    }

    // ── Energy pattern ───────────────────────────────────────────────────────
    {
      const buckets = new Map<string, { energy: number[]; focus: number[] }>();
      for (const l of input.energyLogs) {
        const key = timeOfDayForHour(l.hour);
        const b = buckets.get(key) ?? { energy: [], focus: [] };
        b.energy.push(l.energy);
        b.focus.push(l.focus);
        buckets.set(key, b);
      }
      const rows = [...buckets.entries()]
        .filter(([, b]) => b.energy.length >= 2)
        .map(([part, b]) => ({ part, avgEnergy: Math.round(mean(b.energy) * 10) / 10, avgFocus: Math.round(mean(b.focus) * 10) / 10, samples: b.energy.length }));
      const best = [...rows].sort((a, b) => b.avgEnergy - a.avgEnergy)[0];
      const ok = input.energyLogs.length >= 6 && rows.length >= 2 && best !== undefined;
      insights.push({
        key: 'energy_pattern',
        title: 'Energy pattern',
        statement: ok
          ? `Your logged energy is usually highest in the ${best.part.toLowerCase()} (average ${best.avgEnergy} out of 5).`
          : need(input.energyLogs.length, 6, 'energy check-ins'),
        sufficiency: sufficiencyFor(input.energyLogs.length, { low: 6, medium: 20, high: 50 }),
        confidence: ok ? confidenceFromSamples(input.energyLogs.length, 20) : 0,
        sampleSize: input.energyLogs.length,
        sampleUnit: 'energy check-ins',
        data: { byPartOfDay: rows },
      });
    }

    // ── Trend: last 7 calendar days vs the 7 before ──────────────────────────
    {
      const byDate = new Map(input.days.map((d) => [d.date, d.productiveSec]));
      const series: number[] = [];
      for (let i = 13; i >= 0; i--) series.push(byDate.get(addDays(input.today, -i - 1)) ?? 0);
      const prev = mean(series.slice(0, 7));
      const last = mean(series.slice(7));
      const active = series.filter((v) => v > 0).length;
      const ok = active >= 6 && prev > 0;
      const changePct = ok ? Math.round(((last - prev) / prev) * 100) : null;
      insights.push({
        key: 'trend',
        title: 'Two-week trend',
        statement: ok
          ? Math.abs(changePct!) < 5
            ? `Your productive time is steady: about ${formatDuration(Math.round(last))} per day over the last week, similar to the week before.`
            : `Your productive time is ${changePct! > 0 ? 'up' : 'down'} ${Math.abs(changePct!)}% versus the previous week (${formatDuration(Math.round(last))} vs ${formatDuration(Math.round(prev))} per day).`
          : need(active, 6, 'tracked days in the last two weeks'),
        sufficiency: ok ? (active >= 11 ? 'MEDIUM' : 'LOW') : 'INSUFFICIENT',
        confidence: ok ? confidenceFromSamples(active, 10) : 0,
        sampleSize: active,
        sampleUnit: 'tracked days (last 14)',
        data: { dailyProductiveSec: series, lastWeekAvgSec: Math.round(last), previousWeekAvgSec: Math.round(prev), changePct, slopeSecPerDay: Math.round(slope(series)) },
      });
    }

    return {
      periodStart: days[0]?.date ?? null,
      periodEnd: days[n - 1]?.date ?? null,
      daysWithData: n,
      sufficiency: overall,
      insights,
      forecast: this.forecast(input, days),
    };
  }

  /** Expected productive time for `today`: median of the same weekday, else of all tracked days. */
  private forecast(input: PatternInput, days: PatternDay[]): ProductivityForecast {
    const wd = isoWeekday(input.today);
    const history = days.filter((d) => d.date < input.today);
    const sameWd = history.filter((d) => isoWeekday(d.date) === wd).slice(-8).map((d) => d.productiveSec);
    const all = history.slice(-28).map((d) => d.productiveSec);
    const useWd = sameWd.length >= 3;
    const sample = useWd ? sameWd : all;
    if (sample.length < (useWd ? 3 : 5)) {
      return {
        date: input.today,
        expectedProductiveSec: null,
        lowSec: null,
        highSec: null,
        basis: `Not enough history to estimate (${history.length} tracked day${history.length === 1 ? '' : 's'}; 5 needed).`,
        sufficiency: 'INSUFFICIENT',
        confidence: 0,
        sampleSize: history.length,
      };
    }
    return {
      date: input.today,
      expectedProductiveSec: Math.round(median(sample)),
      lowSec: Math.round(quantile(sample, 0.25)),
      highSec: Math.round(quantile(sample, 0.75)),
      basis: useWd
        ? `Median of your last ${sample.length} ${WEEKDAY_NAMES[wd]}s; the range is the middle half of those days.`
        : `Median of your last ${sample.length} tracked days (not enough ${WEEKDAY_NAMES[wd]}s yet for a weekday-specific estimate).`,
      sufficiency: useWd ? sufficiencyFor(sample.length, { low: 3, medium: 5, high: 8 }) : 'LOW',
      confidence: confidenceFromSamples(sample.length, useWd ? 5 : 14),
      sampleSize: sample.length,
    };
  }
}
