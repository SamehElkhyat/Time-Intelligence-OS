import {
  canTransition,
  elapsedMs,
  elapsedSec,
  MAX_MANUAL_ENTRY_MS,
  nextStatus,
  TimerTransitionError,
  validateEntryRange,
} from '@/modules/time-tracking/domain/timer';

const T0 = Date.UTC(2026, 2, 2, 9, 0, 0);
const sec = (n: number) => n * 1000;

describe('timer domain', () => {
  describe('state transitions', () => {
    it('allows the documented transitions', () => {
      expect(nextStatus('RUNNING', 'PAUSE')).toBe('PAUSED');
      expect(nextStatus('PAUSED', 'RESUME')).toBe('RUNNING');
      expect(nextStatus('RUNNING', 'STOP')).toBe('STOPPED');
      expect(nextStatus('PAUSED', 'STOP')).toBe('STOPPED');
    });
    it.each([
      ['RUNNING', 'RESUME'],
      ['PAUSED', 'PAUSE'],
      ['STOPPED', 'PAUSE'],
      ['STOPPED', 'RESUME'],
      ['STOPPED', 'STOP'],
    ] as const)('rejects %s + %s', (status, action) => {
      expect(() => nextStatus(status, action)).toThrow(TimerTransitionError);
      expect(canTransition(status, action)).toBe(false);
    });
  });

  describe('elapsed time from persisted timestamps', () => {
    it('sums closed segments and counts an open segment up to now', () => {
      const segments = [
        { startedAt: T0, endedAt: T0 + sec(600) }, // 10 min
        { startedAt: T0 + sec(900), endedAt: null }, // running
      ];
      expect(elapsedSec(segments, T0 + sec(900 + 300))).toBe(900); // 10 + 5 min
    });
    it('does not count paused time', () => {
      const segments = [
        { startedAt: T0, endedAt: T0 + sec(60) },
        { startedAt: T0 + sec(3600), endedAt: T0 + sec(3660) },
      ];
      expect(elapsedSec(segments, T0 + sec(7200))).toBe(120);
    });
    it('recovers the right value after a "browser refresh": same persisted data, later now', () => {
      const persisted = [{ startedAt: T0, endedAt: null }];
      const beforeRefresh = elapsedSec(persisted, T0 + sec(100));
      const afterRefresh = elapsedSec(persisted, T0 + sec(160));
      expect(afterRefresh - beforeRefresh).toBe(60);
    });
    it('never returns negative time when the clock is behind a segment start', () => {
      expect(elapsedMs([{ startedAt: T0 + sec(100), endedAt: null }], T0)).toBe(0);
      expect(elapsedMs([{ startedAt: T0 + sec(100), endedAt: T0 + sec(50) }], T0)).toBe(0);
    });
    it('floors once over the total instead of per segment', () => {
      const segments = [
        { startedAt: T0, endedAt: T0 + 600 },
        { startedAt: T0 + 1000, endedAt: T0 + 1600 },
        { startedAt: T0 + 2000, endedAt: T0 + 2800 },
      ];
      // 600 + 600 + 800 = 2000 ms = 2 s (per-segment flooring would give 0)
      expect(elapsedSec(segments, T0 + sec(10))).toBe(2);
    });
  });

  describe('manual entry validation', () => {
    const now = T0 + sec(86_400);
    it('accepts a normal past entry', () => {
      expect(validateEntryRange(now - sec(7200), now - sec(3600), now)).toBeNull();
    });
    it('rejects end before start, equal times, future end and entries over 24 hours', () => {
      expect(validateEntryRange(now, now - 1000, now)).not.toBeNull();
      expect(validateEntryRange(now - 1000, now - 1000, now)).not.toBeNull();
      expect(validateEntryRange(now - 1000, now + 10 * 60_000, now)).not.toBeNull();
      expect(validateEntryRange(now - MAX_MANUAL_ENTRY_MS - 5000, now - 1000, now)).not.toBeNull();
    });
    it('tolerates up to a minute of client clock skew', () => {
      expect(validateEntryRange(now - 60_000, now + 30_000, now)).toBeNull();
    });
  });
});
