import { describe, expect, it } from 'vitest';
import { clampStart, layoutLanes, pixelsToMinutes, snapMinutes } from '@/components/app/timeline-layout';

const b = (id: string, start: number, end: number) => ({ id, start, end });
const lane = (r: ReturnType<typeof layoutLanes>, id: string) => r.find((x) => x.id === id)!;

describe('layoutLanes', () => {
  it('gives non-overlapping blocks full width', () => {
    const r = layoutLanes([b('a', 0, 10), b('b', 10, 20), b('c', 30, 40)]);
    expect(r.every((x) => x.lanes === 1 && x.lane === 0)).toBe(true);
  });

  it('puts overlapping blocks side by side', () => {
    const r = layoutLanes([b('a', 0, 20), b('b', 10, 30)]);
    expect(lane(r, 'a')).toMatchObject({ lane: 0, lanes: 2 });
    expect(lane(r, 'b')).toMatchObject({ lane: 1, lanes: 2 });
  });

  it('reuses a free lane and sizes lane count per cluster, not per day', () => {
    // a overlaps b; c starts after a ends and can reuse lane 0; d is far away and keeps full width
    const r = layoutLanes([b('a', 0, 10), b('b', 5, 25), b('c', 12, 20), b('d', 100, 110)]);
    expect(lane(r, 'c').lane).toBe(0);
    expect(lane(r, 'a').lanes).toBe(2);
    expect(lane(r, 'd')).toMatchObject({ lane: 0, lanes: 1 });
  });

  it('handles three-way overlaps and identical intervals deterministically', () => {
    const r = layoutLanes([b('x', 0, 10), b('y', 0, 10), b('z', 0, 10)]);
    expect(new Set(r.map((p) => p.lane))).toEqual(new Set([0, 1, 2]));
    expect(r.every((p) => p.lanes === 3)).toBe(true);
    const byId = (x: ReturnType<typeof layoutLanes>) => [...x].sort((p, q) => p.id.localeCompare(q.id));
    expect(byId(layoutLanes([b('z', 0, 10), b('x', 0, 10), b('y', 0, 10)]))).toEqual(byId(r)); // input order does not matter
  });

  it('returns nothing for no blocks', () => expect(layoutLanes([])).toEqual([]));
});

describe('drag maths', () => {
  it('snaps minutes to the grid', () => {
    expect(snapMinutes(7, 5)).toBe(5);
    expect(snapMinutes(8, 5)).toBe(10);
    expect(snapMinutes(-7, 5)).toBe(-5);
    expect(snapMinutes(22, 15)).toBe(15);
  });
  it('converts pixels to snapped minutes for the current zoom', () => {
    // 72 px per hour → 1.2 px per minute
    expect(pixelsToMinutes(72, 72)).toBe(60);
    expect(pixelsToMinutes(36, 72)).toBe(30);
    expect(pixelsToMinutes(10, 72)).toBe(10); // 8.3 min → nearest 5-min step
    expect(pixelsToMinutes(-36, 72)).toBe(-30);
    expect(pixelsToMinutes(0, 72)).toBe(0);
  });
  it('keeps a moved block inside the day', () => {
    const hour = 3_600_000;
    expect(clampStart(-5 * hour, hour, 0, 24 * hour)).toBe(0);
    expect(clampStart(23.5 * hour, hour, 0, 24 * hour)).toBe(23 * hour);
    expect(clampStart(10 * hour, hour, 0, 24 * hour)).toBe(10 * hour);
  });
});
