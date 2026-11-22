import {
  CandidateTask,
  levelMatch,
  predictDurationSec,
  recommendTasks,
  RecommendationHistory,
  ScoringContext,
  urgencyFactor,
  WEIGHTS,
} from '@/modules/recommendations/domain/scoring';

const MIN = 60_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 2, 2, 9, 0); // 09:00 UTC, Monday
const noHistory: RecommendationHistory = { overrunByCategory: {}, completionByTimeOfDay: {} };

const task = (id: string, over: Partial<CandidateTask> = {}): CandidateTask => ({
  id,
  title: `Task ${id}`,
  status: 'TODO',
  estimatedDurationSec: 25 * 60,
  priority: 2,
  deadline: null,
  energyRequired: 3,
  focusRequired: 3,
  preferredTimeOfDay: 'ANY',
  categoryKey: 'work',
  blockedBy: [],
  unblocksCount: 0,
  alreadyScheduled: false,
  createdAt: 1,
  ...over,
});

const ctx = (over: Partial<ScoringContext> = {}): ScoringContext => ({
  now: NOW,
  timezone: 'UTC',
  windows: [{ start: NOW, end: NOW + 60 * MIN, confidenceScore: 100 }],
  user: { energy: 3, focus: 3, source: 'LOGGED' },
  history: noHistory,
  ...over,
});

describe('recommendation engine', () => {
  it('weights sum to 1 so scores are comparable and bounded at 100', () => {
    expect(Object.values(WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 10);
  });

  describe('ranking', () => {
    it('does not simply pick the highest priority: an urgent-by-deadline task can beat a higher-priority one', () => {
      const result = recommendTasks(
        [task('highPrioNoDeadline', { priority: 4 }), task('dueSoon', { priority: 2, deadline: NOW + 2 * HOUR })],
        ctx(),
      );
      expect(result.recommendations[0]!.taskId).toBe('dueSoon');
    });

    it('prefers a task that fits the window over one that barely fits or does not fit', () => {
      const r = recommendTasks(
        [task('long', { estimatedDurationSec: 90 * 60 }), task('short', { estimatedDurationSec: 20 * 60 })],
        ctx({ windows: [{ start: NOW, end: NOW + 30 * MIN, confidenceScore: 100 }] }),
      );
      expect(r.recommendations.map((x) => x.taskId)).toEqual(['short']);
      expect(r.excluded).toEqual([expect.objectContaining({ taskId: 'long', code: 'NO_WINDOW' })]);
    });

    it('penalises a task whose energy demand exceeds the user\'s current energy', () => {
      const r = recommendTasks([task('demanding', { energyRequired: 5, focusRequired: 5 }), task('light', { energyRequired: 2, focusRequired: 2 })], ctx({ user: { energy: 2, focus: 2, source: 'LOGGED' } }));
      expect(r.recommendations[0]!.taskId).toBe('light');
    });

    it('rewards a matching preferred time of day', () => {
      const r = recommendTasks([task('evening', { preferredTimeOfDay: 'EVENING' }), task('morning', { preferredTimeOfDay: 'MORNING' })], ctx());
      expect(r.recommendations[0]!.taskId).toBe('morning'); // window is 09:00 UTC
    });

    it('treats overdue work as maximally urgent', () => {
      expect(urgencyFactor(NOW - HOUR, NOW, 1800)).toBe(1);
      expect(urgencyFactor(NOW + 20 * 24 * HOUR, NOW, 1800)).toBeLessThan(0.1);
      expect(urgencyFactor(null, NOW, 1800)).toBe(0.3);
    });

    it('lifts tasks that unblock others and tasks already in progress', () => {
      const r = recommendTasks([task('plain'), task('unblocker', { unblocksCount: 2 }), task('started', { status: 'IN_PROGRESS' })], ctx());
      expect(r.recommendations[0]!.taskId).not.toBe('plain');
      expect(r.recommendations.find((x) => x.taskId === 'plain')!.score).toBeLessThan(r.recommendations.find((x) => x.taskId === 'unblocker')!.score);
    });
  });

  describe('filtering', () => {
    it('excludes non-actionable, blocked and already scheduled tasks, each with a reason', () => {
      const r = recommendTasks(
        [
          task('done', { status: 'COMPLETED' }),
          task('backlog', { status: 'BACKLOG' }),
          task('blocked', { blockedBy: ['Write spec'] }),
          task('planned', { alreadyScheduled: true }),
          task('ok'),
        ],
        ctx(),
      );
      expect(r.recommendations.map((x) => x.taskId)).toEqual(['ok']);
      expect(Object.fromEntries(r.excluded.map((e) => [e.taskId, e.code]))).toEqual({
        done: 'NOT_ACTIONABLE',
        backlog: 'NOT_ACTIONABLE',
        blocked: 'BLOCKED',
        planned: 'ALREADY_SCHEDULED',
      });
      expect(r.excluded.find((e) => e.taskId === 'blocked')!.reason).toContain('Write spec');
    });

    it('returns nothing and explains why when there is no free window', () => {
      const r = recommendTasks([task('a')], ctx({ windows: [] }));
      expect(r.recommendations).toEqual([]);
      expect(r.excluded[0]!.code).toBe('NO_WINDOW');
    });

    it('respects an "I only have N minutes" cap', () => {
      const r = recommendTasks([task('a', { estimatedDurationSec: 45 * 60 })], ctx({ maxDurationSec: 30 * 60 }));
      expect(r.excluded[0]!.code).toBe('TOO_LONG_FOR_LIMIT');
    });

    it('ignores window time that already passed', () => {
      const r = recommendTasks([task('a')], ctx({ windows: [{ start: NOW - 5 * HOUR, end: NOW - 4 * HOUR, confidenceScore: 100 }] }));
      expect(r.recommendations).toEqual([]);
    });
  });

  describe('explanations', () => {
    it('states reasons that match the inputs and a score breakdown that adds up', () => {
      const r = recommendTasks([task('a', { priority: 4, deadline: NOW + 3 * HOUR, estimatedDurationSec: 25 * 60 })], ctx());
      const rec = r.recommendations[0]!;
      expect(rec.reasons.join(' ')).toMatch(/25 min/);
      expect(rec.reasons.join(' ')).toMatch(/urgent priority/);
      expect(rec.reasons.join(' ')).toMatch(/due in/);
      expect(rec.summary.startsWith('Recommended because')).toBe(true);
      expect(Math.round(rec.breakdown.reduce((s, f) => s + f.value * f.weight, 0) * 100)).toBe(rec.score);
    });

    it('does not claim an energy match when energy is unknown, and lowers confidence', () => {
      const known = recommendTasks([task('a')], ctx()).recommendations[0]!;
      const unknown = recommendTasks([task('a')], ctx({ user: { energy: null, focus: null, source: 'UNKNOWN' } })).recommendations[0]!;
      expect(unknown.reasons.join(' ')).not.toMatch(/matches how you feel/);
      expect(unknown.confidence).toBeLessThan(known.confidence);
    });
  });

  describe('history-adjusted estimates', () => {
    it('stretches an estimate when the user habitually overruns, but only with enough samples', () => {
      const t = task('a', { estimatedDurationSec: 30 * 60 });
      expect(predictDurationSec(t, { ...noHistory, overrunByCategory: { work: { ratio: 1.5, samples: 2 } } })).toEqual({ sec: 1800, adjusted: false });
      expect(predictDurationSec(t, { ...noHistory, overrunByCategory: { work: { ratio: 1.5, samples: 6 } } })).toEqual({ sec: 2700, adjusted: true });
    });
    it('ignores negligible differences and clamps extreme ratios', () => {
      const t = task('a', { estimatedDurationSec: 30 * 60 });
      expect(predictDurationSec(t, { ...noHistory, overrunByCategory: { work: { ratio: 1.05, samples: 20 } } }).adjusted).toBe(false);
      expect(predictDurationSec(t, { ...noHistory, overrunByCategory: { work: { ratio: 9, samples: 20 } } }).sec).toBe(30 * 60 * 2.5);
    });
    it('uses the adjusted duration when testing whether the task fits', () => {
      const history = { ...noHistory, overrunByCategory: { work: { ratio: 2, samples: 10 } } };
      const r = recommendTasks([task('a', { estimatedDurationSec: 25 * 60 })], ctx({ history, windows: [{ start: NOW, end: NOW + 40 * MIN, confidenceScore: 100 }] }));
      expect(r.excluded[0]!.code).toBe('NO_WINDOW'); // 25 min becomes 50 min
    });
  });

  describe('level matching', () => {
    it('is neutral for unknown, penalises shortfalls more than surplus', () => {
      expect(levelMatch(null, 4)).toBe(0.5);
      expect(levelMatch(5, 3)).toBeGreaterThan(levelMatch(2, 4));
      expect(levelMatch(3, 3)).toBe(1);
      expect(levelMatch(1, 5)).toBe(0);
    });
  });

  describe('determinism', () => {
    it('gives the same ranking for any input order and breaks ties by deadline, priority, age and id', () => {
      const a = task('a', { createdAt: 5 });
      const b = task('b', { createdAt: 5 });
      const c = task('c', { createdAt: 1 });
      const forward = recommendTasks([a, b, c], ctx()).recommendations.map((r) => r.taskId);
      const reversed = recommendTasks([c, b, a], ctx()).recommendations.map((r) => r.taskId);
      expect(forward).toEqual(reversed);
      expect(forward).toEqual(['c', 'a', 'b']); // oldest first, then id order
    });
    it('honours the result limit', () => {
      const many = Array.from({ length: 10 }, (_, i) => task(`t${i}`));
      expect(recommendTasks(many, ctx({ limit: 3 })).recommendations).toHaveLength(3);
    });
  });
});
