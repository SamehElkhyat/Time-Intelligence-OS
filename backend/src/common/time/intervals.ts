/**
 * Interval algebra used by the availability, scheduling and analytics engines.
 *
 * All intervals are half-open [start, end) in integer epoch milliseconds, so two
 * intervals that merely touch (a.end === b.start) do NOT overlap. Every function is
 * pure and deterministic: same input, same output, no clock access.
 */
export interface Interval {
  start: number;
  end: number;
}

export interface TaggedInterval<T> extends Interval {
  ref: T;
}

export const isValidInterval = (i: Interval): boolean =>
  Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start;

export const durationMs = (i: Interval): number => Math.max(0, i.end - i.start);

export const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

/** Sorted copy (by start, then end) with empty/invalid intervals dropped. */
export function normalise(intervals: readonly Interval[]): Interval[] {
  return intervals
    .filter(isValidInterval)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Merge overlapping or touching intervals into a minimal disjoint, sorted set.
 * O(n log n).
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = normalise(intervals);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Intersection of an interval with bounds, or null when they do not overlap. */
export function clip(interval: Interval, bounds: Interval): Interval | null {
  const start = Math.max(interval.start, bounds.start);
  const end = Math.min(interval.end, bounds.end);
  return end > start ? { start, end } : null;
}

export function clipAll(intervals: readonly Interval[], bounds: Interval): Interval[] {
  const out: Interval[] = [];
  for (const i of intervals) {
    const c = clip(i, bounds);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Pairwise intersection of two interval sets (each may be unsorted/overlapping).
 * Result is disjoint and sorted. O((n + m) log(n + m)).
 */
export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const x = A[i]!;
    const y = B[j]!;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (end > start) out.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return out;
}

/**
 * Interval difference: the parts of `base` not covered by any interval in `cuts`.
 * Result is disjoint and sorted. O((n + m) log(n + m)).
 */
export function subtractIntervals(base: readonly Interval[], cuts: readonly Interval[]): Interval[] {
  const B = mergeIntervals(base);
  const C = mergeIntervals(cuts);
  const out: Interval[] = [];
  let j = 0;
  for (const b of B) {
    let cursor = b.start;
    while (j < C.length && C[j]!.end <= b.start) j++;
    let k = j;
    while (k < C.length && C[k]!.start < b.end) {
      const c = C[k]!;
      if (c.start > cursor) out.push({ start: cursor, end: Math.min(c.start, b.end) });
      cursor = Math.max(cursor, c.end);
      if (cursor >= b.end) break;
      k++;
    }
    if (cursor < b.end) out.push({ start: cursor, end: b.end });
  }
  return out;
}

/** Total covered time of a set, counting overlapping stretches once. */
export function coveredMs(intervals: readonly Interval[]): number {
  let total = 0;
  for (const i of mergeIntervals(intervals)) total += i.end - i.start;
  return total;
}

/** Grow an interval on both sides (buffers). Negative values shrink it. */
export function pad(interval: Interval, beforeMs: number, afterMs: number): Interval {
  return { start: interval.start - beforeMs, end: interval.end + afterMs };
}

/** Free windows inside `bounds` once `occupied` is removed. */
export function freeWindows(bounds: readonly Interval[], occupied: readonly Interval[]): Interval[] {
  return subtractIntervals(bounds, occupied);
}

export interface Overlap<T> {
  a: T;
  b: T;
  start: number;
  end: number;
}

/**
 * Detect every overlapping pair using a sweep over start-sorted intervals.
 * O(n log n + k) where k is the number of overlapping pairs.
 */
export function findOverlaps<T>(items: readonly TaggedInterval<T>[]): Overlap<T>[] {
  const sorted = items.filter(isValidInterval).sort((x, y) => x.start - y.start || x.end - y.end);
  const out: Overlap<T>[] = [];
  let active: TaggedInterval<T>[] = [];
  for (const cur of sorted) {
    active = active.filter((a) => a.end > cur.start);
    for (const a of active) {
      out.push({ a: a.ref, b: cur.ref, start: Math.max(a.start, cur.start), end: Math.min(a.end, cur.end) });
    }
    active.push(cur);
  }
  return out;
}

/** Split an interval at given cut points (used for hourly bucketing). */
export function splitAt(interval: Interval, cutPoints: readonly number[]): Interval[] {
  const cuts = [...new Set(cutPoints)].filter((c) => c > interval.start && c < interval.end).sort((a, b) => a - b);
  const out: Interval[] = [];
  let cursor = interval.start;
  for (const c of cuts) {
    out.push({ start: cursor, end: c });
    cursor = c;
  }
  out.push({ start: cursor, end: interval.end });
  return out;
}

/**
 * Earliest sub-interval of `durationMs` inside the windows, optionally not before `notBefore`
 * and aligned up to a `stepMs` grid (e.g. 5-minute starts).
 */
export function findEarliestSlot(
  windows: readonly Interval[],
  needMs: number,
  opts: { notBefore?: number; stepMs?: number } = {},
): Interval | null {
  if (needMs <= 0) return null;
  for (const w of mergeIntervals(windows)) {
    let start = Math.max(w.start, opts.notBefore ?? w.start);
    if (opts.stepMs && opts.stepMs > 0) start = Math.ceil(start / opts.stepMs) * opts.stepMs;
    if (start + needMs <= w.end) return { start, end: start + needMs };
  }
  return null;
}
