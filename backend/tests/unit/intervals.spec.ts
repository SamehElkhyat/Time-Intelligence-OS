import {
  clip,
  coveredMs,
  findEarliestSlot,
  findOverlaps,
  intersectIntervals,
  mergeIntervals,
  overlaps,
  splitAt,
  subtractIntervals,
} from '@/common/time/intervals';

const iv = (start: number, end: number) => ({ start, end });

describe('intervals', () => {
  describe('mergeIntervals', () => {
    it('merges overlapping and touching intervals, sorted', () => {
      expect(mergeIntervals([iv(10, 20), iv(0, 5), iv(5, 8), iv(18, 25)])).toEqual([iv(0, 8), iv(10, 25)]);
    });
    it('drops empty and inverted intervals and does not mutate input', () => {
      const input = [iv(5, 5), iv(9, 3), iv(1, 2)];
      expect(mergeIntervals(input)).toEqual([iv(1, 2)]);
      expect(input[0]).toEqual(iv(5, 5));
    });
    it('absorbs fully contained intervals', () => {
      expect(mergeIntervals([iv(0, 100), iv(10, 20), iv(30, 40)])).toEqual([iv(0, 100)]);
    });
    it('is idempotent', () => {
      const once = mergeIntervals([iv(3, 9), iv(1, 4), iv(20, 30)]);
      expect(mergeIntervals(once)).toEqual(once);
    });
  });

  describe('overlaps', () => {
    it('treats intervals that only touch as NOT overlapping (half-open)', () => {
      expect(overlaps(iv(0, 10), iv(10, 20))).toBe(false);
      expect(overlaps(iv(0, 11), iv(10, 20))).toBe(true);
    });
  });

  describe('subtractIntervals', () => {
    it('cuts holes out of a base interval', () => {
      expect(subtractIntervals([iv(0, 100)], [iv(10, 20), iv(50, 60)])).toEqual([iv(0, 10), iv(20, 50), iv(60, 100)]);
    });
    it('returns the base when nothing overlaps', () => {
      expect(subtractIntervals([iv(0, 10)], [iv(20, 30)])).toEqual([iv(0, 10)]);
    });
    it('returns nothing when the cut covers the base', () => {
      expect(subtractIntervals([iv(10, 20)], [iv(0, 100)])).toEqual([]);
    });
    it('handles cuts spanning several base intervals and unsorted/overlapping cuts', () => {
      expect(subtractIntervals([iv(0, 10), iv(20, 30)], [iv(25, 40), iv(5, 22), iv(8, 9)])).toEqual([iv(0, 5), iv(22, 25)]);
    });
    it('satisfies covered(base) = covered(base − cuts) + covered(base ∩ cuts)', () => {
      const base = [iv(0, 50), iv(70, 120)];
      const cuts = [iv(40, 80), iv(100, 130)];
      const diff = subtractIntervals(base, cuts);
      const inter = intersectIntervals(base, cuts);
      expect(coveredMs(diff) + coveredMs(inter)).toBe(coveredMs(base));
    });
  });

  describe('intersectIntervals', () => {
    it('returns pairwise overlaps', () => {
      expect(intersectIntervals([iv(0, 10), iv(20, 30)], [iv(5, 25)])).toEqual([iv(5, 10), iv(20, 25)]);
    });
    it('is empty for touching sets', () => {
      expect(intersectIntervals([iv(0, 10)], [iv(10, 20)])).toEqual([]);
    });
  });

  describe('clip / coveredMs', () => {
    it('clips to bounds', () => {
      expect(clip(iv(0, 100), iv(20, 30))).toEqual(iv(20, 30));
      expect(clip(iv(0, 10), iv(10, 20))).toBeNull();
    });
    it('counts overlapping time once', () => {
      expect(coveredMs([iv(0, 10), iv(5, 15)])).toBe(15);
    });
  });

  describe('findOverlaps', () => {
    it('reports every overlapping pair with the shared range', () => {
      const found = findOverlaps([
        { ...iv(0, 10), ref: 'a' },
        { ...iv(5, 15), ref: 'b' },
        { ...iv(14, 20), ref: 'c' },
        { ...iv(20, 30), ref: 'd' }, // touches c only
      ]);
      expect(found.map((o) => `${o.a}${o.b}:${o.start}-${o.end}`).sort()).toEqual(['ab:5-10', 'bc:14-15']);
    });
    it('reports a long interval against every interval inside it', () => {
      const found = findOverlaps([{ ...iv(0, 100), ref: 'x' }, { ...iv(10, 20), ref: 'y' }, { ...iv(30, 40), ref: 'z' }]);
      expect(found).toHaveLength(2);
    });
  });

  describe('splitAt / findEarliestSlot', () => {
    it('splits at interior cut points only', () => {
      expect(splitAt(iv(0, 10), [0, 4, 4, 10, 20])).toEqual([iv(0, 4), iv(4, 10)]);
    });
    it('finds the earliest slot that fits, honouring notBefore and a grid', () => {
      const windows = [iv(0, 10), iv(20, 100)];
      expect(findEarliestSlot(windows, 15)).toEqual(iv(20, 35));
      // start 7 aligns up to 8 on a 4-grid; 8+5 > 10, so the first window cannot hold it
      expect(findEarliestSlot(windows, 5, { notBefore: 7, stepMs: 4 })).toEqual(iv(20, 25));
      expect(findEarliestSlot(windows, 2, { notBefore: 7, stepMs: 4 })).toEqual(iv(8, 10));
      expect(findEarliestSlot(windows, 200)).toBeNull();
    });
  });
});
