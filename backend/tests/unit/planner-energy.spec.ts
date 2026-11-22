import { forecastEnergy } from '@/modules/scheduling/domain/energy-forecast';
import { planDay, stretchEndingAt } from '@/modules/scheduling/domain/planner';
import { HourExpectation } from '@/modules/scheduling/domain/energy-forecast';

const MIN = 60_000;
const DAY = Date.UTC(2026, 2, 2);
const at = (h: number, m = 0) => DAY + (h * 60 + m) * MIN;

const hours = (fn: (h: number) => number | null): HourExpectation[] =>
  Array.from({ length: 24 }, (_, hour) => {
    const v = fn(hour);
    return { hour, energy: v, focus: v, source: v === null ? 'UNKNOWN' : 'LOGGED', samples: v === null ? 0 : 5 };
  });

describe('energy forecast', () => {
  it('returns unknown (not a "typical" rhythm) when there is no data and no declared window', () => {
    const f = forecastEnergy([], null);
    expect(f.hours.every((h) => h.energy === null && h.source === 'UNKNOWN')).toBe(true);
    expect(f.confidence).toBe(0);
  });

  it('uses a declared focus window when there are no check-ins, with low confidence', () => {
    const f = forecastEnergy([], { startMinute: 9 * 60, endMinute: 12 * 60 });
    expect(f.hours[10]).toMatchObject({ energy: 4, source: 'DECLARED' });
    expect(f.hours[15]).toMatchObject({ energy: 3, source: 'DECLARED' });
    expect(f.confidence).toBeLessThan(40);
  });

  it('prefers the user\'s own check-ins once there are enough around an hour', () => {
    const samples = Array.from({ length: 5 }, () => ({ hour: 9, energy: 5, focus: 4 }));
    const f = forecastEnergy(samples, { startMinute: 14 * 60, endMinute: 16 * 60 });
    expect(f.hours[9]).toMatchObject({ source: 'LOGGED', energy: 5 });
    expect(f.hours[9]!.samples).toBeGreaterThanOrEqual(3);
  });

  it('smooths into neighbouring hours but does not invent data far away', () => {
    const samples = Array.from({ length: 6 }, () => ({ hour: 10, energy: 4, focus: 4 }));
    const f = forecastEnergy(samples, null);
    expect(f.hours[11]!.source).toBe('LOGGED');
    expect(f.hours[15]!.energy).toBeNull();
  });
});

describe('stretchEndingAt', () => {
  it('measures the uninterrupted busy stretch before a point, bridging gaps of up to 5 minutes', () => {
    const busy = [{ start: at(9), end: at(10) }, { start: at(10, 3), end: at(11) }];
    // 09:00–11:00 with a 3-minute hole bridged; measured up to the end of the last block
    expect(stretchEndingAt(busy, at(11, 2))).toBe(120 * MIN);
  });
  it('is zero when the user had a real break', () => {
    expect(stretchEndingAt([{ start: at(9), end: at(10) }], at(10, 30))).toBe(0);
  });
});

describe('day planner', () => {
  const base = {
    now: at(8),
    timezone: 'UTC',
    windows: [{ start: at(8), end: at(18) }],
    busy: [],
    energyByHour: hours((h) => (h >= 9 && h < 12 ? 5 : 2)), // sharp morning peak
    breakAfterMs: 90 * MIN,
    breakMs: 10 * MIN,
  };
  const t = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: id,
    durationSec: 60 * 60,
    priority: 2,
    deadline: null,
    energyRequired: 3,
    focusRequired: 3,
    preferredTimeOfDay: 'ANY' as const,
    ...over,
  });

  it('puts high-focus work in the high-energy period and light work in the low-energy period', () => {
    const r = planDay({ ...base, tasks: [t('deep', { energyRequired: 5, focusRequired: 5, priority: 3 }), t('admin', { energyRequired: 1, focusRequired: 1 })] });
    const deep = r.blocks.find((b) => b.taskId === 'deep')!;
    const admin = r.blocks.find((b) => b.taskId === 'admin')!;
    expect(deep.start).toBeGreaterThanOrEqual(at(9));
    expect(deep.end).toBeLessThanOrEqual(at(12));
    // light work is kept out of the peak so the peak stays free for demanding work
    expect(admin.end <= at(9) || admin.start >= at(12)).toBe(true);
  });

  it('does not score a block as if it sat inside a peak when it only touches the peak\'s edge', () => {
    // the only free hour straddles the 09:00 peak start: half low energy, half high
    const r = planDay({ ...base, windows: [{ start: at(8, 30), end: at(9, 30) }], tasks: [t('deep', { energyRequired: 5, focusRequired: 5 })] });
    const fully = planDay({ ...base, windows: [{ start: at(9), end: at(10) }], tasks: [t('deep', { energyRequired: 5, focusRequired: 5 })] });
    expect(r.blocks[0]!.fitScore).toBeLessThan(fully.blocks[0]!.fitScore);
  });

  it('keeps the peak for demanding work: a moderate task is placed where energy is just sufficient', () => {
    const r = planDay({ ...base, windows: [{ start: at(9), end: at(13) }], tasks: [t('moderate', { energyRequired: 3, focusRequired: 3 })] });
    // hours 9–12 are energy 5 (spare capacity), 12+ is energy 2 (too low): the best compromise is straddling, not the peak start
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]!.reasons[0]).toMatch(/energy/i);
  });

  it('never overlaps blocks and stays inside the free windows', () => {
    const windows = [{ start: at(8), end: at(10) }, { start: at(13), end: at(15) }];
    const r = planDay({ ...base, windows, tasks: [t('a'), t('b'), t('c')] });
    const sorted = [...r.blocks].sort((x, y) => x.start - y.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.start).toBeGreaterThanOrEqual(sorted[i - 1]!.end);
    for (const b of r.blocks) expect(windows.some((w) => b.start >= w.start && b.end <= w.end)).toBe(true);
    // two 2-hour windows hold three 1-hour tasks
    expect(r.blocks).toHaveLength(3);
    expect(r.unscheduled).toHaveLength(0);
  });

  it('reports tasks that cannot fit, with the longest remaining window', () => {
    const r = planDay({ ...base, windows: [{ start: at(8), end: at(8, 30) }], tasks: [t('big')] });
    expect(r.blocks).toHaveLength(0);
    expect(r.unscheduled[0]!.reason).toMatch(/longest remaining free window is 30 min/);
  });

  it('schedules the most urgent task first when time is scarce', () => {
    const r = planDay({
      ...base,
      windows: [{ start: at(8), end: at(9) }],
      tasks: [t('later', { deadline: at(8) + 100 * 3600_000 }), t('urgent', { deadline: at(9, 30) })],
    });
    expect(r.blocks.map((b) => b.taskId)).toEqual(['urgent']);
  });

  it('warns when the only slot is after the deadline instead of hiding it', () => {
    const r = planDay({ ...base, now: at(12), windows: [{ start: at(12), end: at(13) }], tasks: [t('late', { deadline: at(12, 30) })] });
    expect(r.blocks[0]!.afterDeadline).toBe(true);
    expect(r.blocks[0]!.reasons.join(' ')).toMatch(/after the deadline/);
  });

  it('inserts a break after a long uninterrupted stretch of commitments', () => {
    const r = planDay({
      ...base,
      energyByHour: hours(() => 3), // uniform energy: placement is decided by earliness alone
      now: at(9),
      busy: [{ start: at(8), end: at(10, 30) }],
      windows: [{ start: at(10, 30), end: at(14) }],
      tasks: [t('next')],
    });
    expect(r.breaks).toHaveLength(1);
    expect(r.blocks[0]!.start).toBeGreaterThanOrEqual(r.breaks[0]!.end);
  });

  it('says so when it had no energy data to use', () => {
    const r = planDay({ ...base, energyByHour: hours(() => null), tasks: [t('a')] });
    expect(r.energyUnknown).toBe(true);
    expect(r.blocks[0]!.reasons[0]).toMatch(/No energy data/);
  });

  it('is deterministic', () => {
    const tasks = [t('a'), t('b', { priority: 3 }), t('c', { energyRequired: 5 })];
    expect(planDay({ ...base, tasks })).toEqual(planDay({ ...base, tasks: [...tasks].reverse() }));
  });
});
