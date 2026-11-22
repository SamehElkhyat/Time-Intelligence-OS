import { computeDayMetrics, DayMetricsInput, MetricActivity } from '@/modules/productivity/domain/day-metrics';
import { detectLeakage, LeakageDay, median } from '@/modules/productivity/domain/leakage';
import { confidenceFromSamples, PatternDay, StatisticalPredictionProvider, slope, sufficiencyFor } from '@/modules/productivity/domain/patterns';
import { findCycle, topologicalOrder } from '@/modules/tasks/domain/dependency-graph';

const MIN = 60_000;
const DAY = Date.UTC(2026, 2, 2);
const at = (h: number, m = 0) => DAY + (h * 60 + m) * MIN;

const categories = [
  { id: 'work', key: 'work', name: 'Work', color: '#b5f34d', timeClass: 'PRODUCTIVE' as const },
  { id: 'rest', key: 'rest', name: 'Rest', color: '#999', timeClass: 'REST' as const },
  { id: 'fun', key: 'entertainment', name: 'Entertainment', color: '#f0f', timeClass: 'LEISURE' as const },
];

const activity = (id: string, categoryId: string, over: Partial<MetricActivity> = {}): MetricActivity => ({
  id,
  title: id,
  categoryId,
  plannedStart: null,
  plannedEnd: null,
  estimatedDurationSec: null,
  actualDurationSec: 0,
  status: 'PLANNED',
  completedAt: null,
  rescheduleCount: 0,
  ...over,
});

const seg = (activityId: string, from: [number, number], to: [number, number], sessionId = activityId) => ({
  activityId,
  sessionId,
  start: at(...from),
  end: at(...to),
});

function metricsInput(over: Partial<DayMetricsInput> = {}): DayMetricsInput {
  return {
    range: { start: DAY, end: DAY + 24 * 60 * MIN },
    now: at(18),
    timezone: 'UTC',
    activeHours: [{ start: at(8), end: at(18) }],
    categories,
    activities: [],
    segments: [],
    pauseCountBySession: {},
    completedTasks: 0,
    settings: { deepWorkMinMs: 50 * MIN, dailyFocusGoalSec: 4 * 3600 },
    ...over,
  };
}

describe('day metrics', () => {
  it('reports no score at all (null) when nothing was tracked — absence of data is not a score of zero', () => {
    const m = computeDayMetrics(metricsInput());
    expect(m.trackedSec).toBe(0);
    expect(m.productivityScore).toBeNull();
    expect(m.adherencePct).toBeNull();
    expect(m.estimationAccuracyPct).toBeNull();
  });

  it('separates productive, rest and leisure time and counts focus and deep work', () => {
    const m = computeDayMetrics(
      metricsInput({
        activities: [activity('w1', 'work'), activity('w2', 'work'), activity('r', 'rest'), activity('f', 'fun')],
        segments: [seg('w1', [9, 0], [10, 0]), seg('w2', [10, 0], [10, 20]), seg('r', [12, 0], [12, 30]), seg('f', [20, 0], [20, 0])],
      }),
    );
    expect(m.productiveSec).toBe(80 * 60);
    expect(m.focusSec).toBe(60 * 60); // only the 60 min block is >= 25 min uninterrupted? 20 min block is fragmented
    expect(m.fragmentedSec).toBe(20 * 60);
    expect(m.restSec).toBe(30 * 60);
    expect(m.deepWorkSessions).toBe(1); // >= 50 min
    expect(m.trackedSec).toBe(110 * 60);
  });

  it('never counts tracked time in the future', () => {
    const m = computeDayMetrics(metricsInput({ now: at(9, 30), activities: [activity('w', 'work')], segments: [seg('w', [9, 0], [11, 0])] }));
    expect(m.trackedSec).toBe(30 * 60);
  });

  it('measures adherence only on blocks that have already finished, per planned activity', () => {
    const planned = (id: string, from: [number, number], to: [number, number]) => activity(id, 'work', { plannedStart: at(...from), plannedEnd: at(...to) });
    const m = computeDayMetrics(
      metricsInput({
        now: at(14),
        activities: [planned('done', [9, 0], [10, 0]), planned('missed', [11, 0], [12, 0]), planned('future', [15, 0], [16, 0])],
        segments: [seg('done', [9, 0], [10, 0])],
      }),
    );
    expect(m.adherencePct).toBe(50); // 60 of 120 finished planned minutes were tracked on the planned activity
  });

  it('flags only short UNPLANNED gaps between tracked blocks as leakage; planned gaps and long breaks are not leakage', () => {
    const m = computeDayMetrics(
      metricsInput({
        activities: [activity('a', 'work'), activity('b', 'work'), activity('c', 'work', { plannedStart: at(11, 0), plannedEnd: at(11, 30) }), activity('d', 'work')],
        // a 10:00–10:20 | gap 20 min (unplanned) | b 10:40–11:00 | gap 11:00–11:30 (planned, so not leakage) | d 11:30–12:00 | long gap | e
        segments: [seg('a', [9, 0], [10, 0]), seg('b', [10, 20], [11, 0]), seg('d', [11, 30], [12, 0]), seg('a', [15, 0], [16, 0], 'a2')],
      }),
    );
    expect(m.gaps.map((g) => (g.end - g.start) / MIN)).toEqual([20]);
    expect(m.leakageSec).toBe(20 * 60);
  });

  it('does not count a gap that is also unknown time twice: unknown excludes leakage', () => {
    const m = computeDayMetrics(
      metricsInput({ activities: [activity('a', 'work')], segments: [seg('a', [9, 0], [10, 0]), seg('a', [10, 20], [11, 0], 's2')] }),
    );
    expect(m.leakageSec).toBe(20 * 60);
    // active 08–18 = 10h; tracked 100 min; leakage 20 min; unknown = remainder
    expect(m.unknownSec).toBe(10 * 3600 - 100 * 60 - 20 * 60);
  });

  it('counts category switches only for quick changes between different categories', () => {
    const m = computeDayMetrics(
      metricsInput({
        activities: [activity('a', 'work'), activity('b', 'rest'), activity('c', 'work')],
        segments: [seg('a', [9, 0], [9, 30]), seg('b', [9, 32], [9, 50]), seg('c', [9, 52], [10, 30]), seg('a', [14, 0], [14, 30], 'a2')],
      }),
    );
    expect(m.transitions).toBe(2);
    expect(m.contextSwitches).toBe(2);
  });

  it('computes estimation accuracy from completed activities that have an estimate', () => {
    const m = computeDayMetrics(
      metricsInput({
        activities: [activity('a', 'work', { status: 'COMPLETED', completedAt: at(10), estimatedDurationSec: 3600, actualDurationSec: 4500 })],
        segments: [seg('a', [9, 0], [10, 15])],
      }),
    );
    expect(m.estimationAccuracyPct).toBe(75); // 1 - |4500-3600|/3600
  });

  it('buckets tracked time by local hour', () => {
    const m = computeDayMetrics(metricsInput({ activities: [activity('a', 'work')], segments: [seg('a', [9, 30], [10, 30])] }));
    expect(m.hourly[9]).toMatchObject({ trackedSec: 1800, productiveSec: 1800 });
    expect(m.hourly[10]).toMatchObject({ trackedSec: 1800, productiveSec: 1800 });
    expect(m.hourly[11]!.trackedSec).toBe(0);
  });

  it('re-normalises the score weights over the components that could be measured', () => {
    const m = computeDayMetrics(metricsInput({ activities: [activity('a', 'work')], segments: [seg('a', [9, 0], [13, 0])] }));
    const total = m.scoreBreakdown.reduce((s, c) => s + c.weight, 0);
    expect(total).toBeCloseTo(1, 2);
    expect(m.scoreBreakdown.map((c) => c.key)).not.toContain('adherence'); // nothing planned -> not measurable
    expect(m.productivityScore).toBeGreaterThan(0);
  });
});

const day = (date: string, over: Partial<LeakageDay> = {}): LeakageDay => ({
  date,
  trackedSec: 6 * 3600,
  productiveSec: 5 * 3600,
  restSec: 0,
  leisureSec: 0,
  plannedSec: 5 * 3600,
  plannedDowntimeSec: 0,
  leakageSec: 0,
  unknownSec: 0,
  plannedUntrackedSec: 0,
  activeSec: 10 * 3600,
  activePastSec: 10 * 3600,
  transitions: 2,
  contextSwitches: 1,
  fragmentedSec: 0,
  conflictCount: 0,
  gaps: [],
  sessions: [],
  ...over,
});

describe('leakage detection', () => {
  const empty = { timezone: 'UTC', estimates: [], rescheduled: [] };

  it('reports nothing for a healthy period', () => {
    const r = detectLeakage({ ...empty, days: [day('2026-03-02'), day('2026-03-03')] });
    expect(r.insights).toEqual([]);
  });

  it('never labels rest or leisure as waste', () => {
    const r = detectLeakage({ ...empty, days: [day('2026-03-02', { restSec: 3 * 3600, leisureSec: 3 * 3600, plannedDowntimeSec: 6 * 3600, trackedSec: 12 * 3600 })] });
    expect(r.insights).toEqual([]);
    expect(r.totals.unplannedGapSec).toBe(0);
  });

  it('flags unplanned gaps with measured impact and evidence', () => {
    const gaps = [{ start: at(10), end: at(10, 30), before: 'B', after: 'A' }];
    const r = detectLeakage({ ...empty, days: [day('2026-03-02', { leakageSec: 40 * 60, gaps })] });
    const i = r.insights.find((x) => x.type === 'UNPLANNED_GAPS')!;
    expect(i.impactSec).toBe(40 * 60);
    expect(i.evidence.length).toBeGreaterThan(0);
  });

  it('reports untracked time as a data-quality note (LOW severity), not as waste, and keeps it out of leakage', () => {
    const r = detectLeakage({ ...empty, days: [day('2026-03-02', { unknownSec: 5 * 3600, plannedUntrackedSec: 1 * 3600 })] });
    const i = r.insights.find((x) => x.type === 'UNTRACKED_TIME')!;
    expect(i.severity).toBe('LOW');
    expect(i.explanation).toMatch(/not counted as free time or as wasted time/);
    expect(r.totals.unplannedGapSec).toBe(0);
  });

  it('detects estimate overruns only with enough samples', () => {
    const sample = (actual: number) => ({ categoryKey: 'work', categoryName: 'Work', estimateSec: 3600, actualSec: actual });
    expect(detectLeakage({ ...empty, days: [day('2026-03-02')], estimates: [sample(5400), sample(5400)] }).insights).toEqual([]);
    const r = detectLeakage({ ...empty, days: [day('2026-03-02')], estimates: [sample(5400), sample(5400), sample(5000)] });
    expect(r.insights[0]).toMatchObject({ type: 'ESTIMATE_OVERRUNS' });
  });

  it('flags over-committed days and repeated rescheduling, and sorts the most severe first', () => {
    const r = detectLeakage({
      ...empty,
      days: [day('2026-03-02', { plannedSec: 10 * 3600, conflictCount: 2 }), day('2026-03-03', { plannedSec: 10 * 3600 }), day('2026-03-04', { plannedSec: 10 * 3600 })],
      rescheduled: [{ title: 'Write spec', count: 4 }],
    });
    expect(r.insights.map((i) => i.type)).toEqual(expect.arrayContaining(['OVERLOADED_SCHEDULE', 'FREQUENT_RESCHEDULING']));
    expect(r.insights[0]!.severity).toBe('HIGH');
  });

  it('median handles even, odd and empty inputs', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('pattern engine', () => {
  const provider = new StatisticalPredictionProvider();
  const mkDay = (date: string, productiveSec: number, peakHour = 10): PatternDay => ({
    date,
    trackedSec: productiveSec,
    productiveSec,
    focusSec: productiveSec,
    deepWorkSessions: productiveSec >= 7200 ? 1 : 0,
    hourlyProductiveSec: Array.from({ length: 24 }, (_, h) => (h === peakHour || h === peakHour + 1 ? productiveSec / 2 : 0)),
  });
  const base = { today: '2026-03-30', productiveSegmentSecs: [], estimates: [], startDelays: [], energyLogs: [] };

  it('refuses to claim patterns without enough data, and says what is missing', () => {
    const r = provider.analyse({ ...base, days: [mkDay('2026-03-27', 3600), mkDay('2026-03-28', 3600)] });
    expect(r.sufficiency).toBe('INSUFFICIENT');
    expect(r.insights.every((i) => i.sufficiency === 'INSUFFICIENT' && i.confidence === 0)).toBe(true);
    expect(r.insights[0]!.statement).toMatch(/Not enough data/);
    expect(r.forecast.expectedProductiveSec).toBeNull();
  });

  it('finds the productive hours and uses hedged wording', () => {
    const days = Array.from({ length: 15 }, (_, i) => mkDay(`2026-03-${String(10 + i).padStart(2, '0')}`, 4 * 3600, 10));
    const peak = provider.analyse({ ...base, days }).insights.find((i) => i.key === 'peak_hours')!;
    expect(peak.statement).toMatch(/tend to be most productive between 10:00 and 12:00/);
    expect(peak.sufficiency).toBe('MEDIUM');
    expect(peak.sampleSize).toBe(15);
    expect(peak.confidence).toBeGreaterThan(50);
  });

  it('forecasts from the same weekday when it has enough of them, with a range', () => {
    // Mondays 03-02, 03-09, 03-16, 03-23 and "today" is Monday 03-30
    const mondays = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'].map((d, i) => mkDay(d, (3 + i) * 3600));
    const others = Array.from({ length: 6 }, (_, i) => mkDay(`2026-03-${String(3 + i).padStart(2, '0')}`, 1800));
    const f = provider.analyse({ ...base, days: [...mondays, ...others] }).forecast;
    expect(f.basis).toMatch(/Mondays/);
    expect(f.expectedProductiveSec).toBe(Math.round(4.5 * 3600));
    expect(f.lowSec!).toBeLessThanOrEqual(f.expectedProductiveSec!);
    expect(f.highSec!).toBeGreaterThanOrEqual(f.expectedProductiveSec!);
  });

  it('describes the estimate calibration from completed work', () => {
    const estimates = Array.from({ length: 6 }, () => ({ categoryName: 'Work', estimateSec: 3600, actualSec: 5400 }));
    const i = provider.analyse({ ...base, days: [], estimates }).insights.find((x) => x.key === 'completion_time')!;
    expect(i.statement).toMatch(/1\.50×/);
    expect(i.sufficiency).toBe('LOW');
  });

  it('math helpers behave', () => {
    expect(slope([1, 2, 3, 4])).toBeCloseTo(1, 10);
    expect(slope([5, 5, 5])).toBe(0);
    expect(slope([1])).toBe(0);
    expect(sufficiencyFor(4)).toBe('INSUFFICIENT');
    expect(sufficiencyFor(5)).toBe('LOW');
    expect(sufficiencyFor(14)).toBe('MEDIUM');
    expect(sufficiencyFor(28)).toBe('HIGH');
    expect(confidenceFromSamples(0)).toBe(0);
    expect(confidenceFromSamples(1000)).toBe(95);
    expect(confidenceFromSamples(12)).toBeCloseTo(63, 0);
  });
});

describe('task dependency graph', () => {
  const edges = [
    { taskId: 'b', dependsOnId: 'a' },
    { taskId: 'c', dependsOnId: 'b' },
  ];
  it('detects direct and indirect cycles and reports the path', () => {
    expect(findCycle(edges, 'a', ['c'])).toEqual(['a', 'c', 'b', 'a']);
    expect(findCycle(edges, 'a', ['a'])).toEqual(['a', 'a']);
  });
  it('allows acyclic changes, including replacing a task\'s own dependencies', () => {
    expect(findCycle(edges, 'd', ['c'])).toBeNull();
    expect(findCycle(edges, 'b', ['x'])).toBeNull();
    // b currently depends on a; replacing that with nothing can't create a loop even though a -> ... -> b would
    expect(findCycle([...edges, { taskId: 'a', dependsOnId: 'z' }], 'b', [])).toBeNull();
  });
  it('orders dependencies first and rejects cycles', () => {
    expect(topologicalOrder(['c', 'a', 'b'], edges)).toEqual(['a', 'b', 'c']);
    expect(() => topologicalOrder(['a', 'b'], [{ taskId: 'a', dependsOnId: 'b' }, { taskId: 'b', dependsOnId: 'a' }])).toThrow();
  });
});
