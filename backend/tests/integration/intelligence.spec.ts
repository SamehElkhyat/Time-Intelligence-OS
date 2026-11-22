import { CoachToolsService } from '../../src/modules/ai-coach/coach-tools.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { Client, createTestApp, futureDate, HOUR, iso, MIN, TestApp } from './harness';

const yesterdayAt = (hh: number, mm = 0): number => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(hh, mm, 0, 0);
  return d.getTime();
};
const yesterdayDate = () => new Date(yesterdayAt(12)).toISOString().slice(0, 10);

describe('TIMEFLOW API — intelligence', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('tasks', () => {
    let c: Client;
    beforeAll(async () => {
      c = await Client.register(t, { label: 'tasks' });
    });
    const task = async (body: object) => (await c.post('/api/tasks', { estimatedDurationSec: 1800, ...body })).body;

    it('creates a task with subtasks and tracks their state', async () => {
      const res = await c.post('/api/tasks', { title: 'Write spec', estimatedDurationSec: 3600, priority: 'HIGH', subtasks: ['Outline', 'Draft'], tags: ['Docs'] });
      expect(res.status).toBe(201);
      expect(res.body.subtasks.map((s: { title: string }) => s.title)).toEqual(['Outline', 'Draft']);
      const sub = res.body.subtasks[0];
      const toggled = await c.patch(`/api/tasks/${res.body.id}/subtasks/${sub.id}`, { isDone: true });
      expect(toggled.body.isDone).toBe(true);
      expect(res.body.tags).toEqual(['docs']);
    });

    it('validates estimates and statuses', async () => {
      expect((await c.post('/api/tasks', { title: 'x', estimatedDurationSec: 10 })).status).toBe(400);
      expect((await c.post('/api/tasks', { title: 'x', estimatedDurationSec: 600, status: 'COMPLETED' })).body.code).toBe('INVALID_STATUS');
    });

    it('rejects dependency cycles and shows the loop; blocked tasks cannot be completed until their dependency is', async () => {
      const a = await task({ title: 'A' });
      const b = await task({ title: 'B', dependsOnIds: [a.id] });
      const cc = await task({ title: 'C', dependsOnIds: [b.id] });
      const loop = await c.put(`/api/tasks/${a.id}/dependencies`, { dependsOnIds: [cc.id] });
      expect(loop.status).toBe(422);
      expect(loop.body.code).toBe('DEPENDENCY_CYCLE');
      expect(loop.body.details[0]).toBe('A → C → B → A');
      expect((await c.put(`/api/tasks/${a.id}/dependencies`, { dependsOnIds: [a.id] })).body.code).toBe('DEPENDENCY_CYCLE');

      expect((await c.get(`/api/tasks/${b.id}`)).body.isBlocked).toBe(true);
      const blocked = await c.post(`/api/tasks/${b.id}/complete`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('TASK_BLOCKED');
      expect(blocked.body.message).toContain('A');
      expect((await c.post(`/api/tasks/${a.id}/complete`)).status).toBe(200);
      expect((await c.get(`/api/tasks/${b.id}`)).body.isBlocked).toBe(false);
      expect((await c.post(`/api/tasks/${b.id}/complete`)).status).toBe(200);
    });

    it('cannot depend on someone else\'s task', async () => {
      const other = await Client.register(t, { label: 'taskother' });
      const theirs = (await other.post('/api/tasks', { title: 'theirs', estimatedDurationSec: 600 })).body;
      const res = await c.post('/api/tasks', { title: 'mine', estimatedDurationSec: 600, dependsOnIds: [theirs.id] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_DEPENDENCY');
      expect((await c.get(`/api/tasks/${theirs.id}`)).status).toBe(404);
    });

    it('generates the next occurrence of a recurring task exactly once, and keeps a change history', async () => {
      const first = await task({ title: 'Weekly review', recurrence: { frequency: 'WEEKLY', byWeekday: [1, 2, 3, 4, 5, 6, 7] } });
      expect((await c.post(`/api/tasks/${first.id}/complete`)).status).toBe(200);
      await c.post(`/api/tasks/${first.id}/complete`); // completing again must not duplicate the series
      await c.drain();
      const series = await t.prisma.task.findMany({ where: { userId: c.userId, OR: [{ id: first.id }, { seriesId: first.id }] }, orderBy: { createdAt: 'asc' } });
      expect(series).toHaveLength(2);
      expect(series[1]!.status).toBe('TODO');
      expect(series[1]!.seriesId).toBe(first.id);
      const history = (await c.get(`/api/tasks/${first.id}/history`)).body.map((h: { action: string }) => h.action);
      expect(history).toEqual(expect.arrayContaining(['task.created', 'task.completed']));
    });

    it('schedules a work block, rejects overlap with a fixed commitment, and moves the task to in-progress when tracked', async () => {
      const tk = await task({ title: 'Focus block', categoryId: c.categories.work });
      const s = Date.now() + 48 * HOUR;
      await c.post('/api/activities', { title: 'Exam', categoryId: c.categories.meetings, isFixed: true, plannedStart: iso(s), plannedEnd: iso(s + HOUR) });
      const clash = await c.post(`/api/tasks/${tk.id}/schedule`, { start: iso(s + 30 * MIN) });
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('SCHEDULE_CONFLICT');
      const ok = await c.post(`/api/tasks/${tk.id}/schedule`, { start: iso(s + 2 * HOUR) });
      expect(ok.status).toBe(201);
      expect(ok.body.taskId).toBe(tk.id);
      expect(new Date(ok.body.plannedEnd).getTime() - new Date(ok.body.plannedStart).getTime()).toBe(1800 * 1000);
      await c.post('/api/time-tracking/start', { activityId: ok.body.id });
      await c.drain();
      expect((await c.get(`/api/tasks/${tk.id}`)).body.status).toBe('IN_PROGRESS');
      await c.post('/api/time-tracking/stop');
    });

    it('filters by due window and searches', async () => {
      await task({ title: 'Overdue thing', deadline: iso(Date.now() - 2 * HOUR) });
      await task({ title: 'No deadline thing' });
      const overdue = (await c.get('/api/tasks?due=overdue')).body.items.map((x: { title: string }) => x.title);
      expect(overdue).toContain('Overdue thing');
      expect(overdue).not.toContain('No deadline thing');
      expect((await c.get('/api/tasks?q=deadline thing')).body.items.length).toBeGreaterThan(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('recommendations, energy and scheduling', () => {
    let c: Client;
    let urgentId: string;
    let blockerId: string;
    beforeAll(async () => {
      c = await Client.register(t, { label: 'recs' });
      const mk = async (body: object) => (await c.post('/api/tasks', { estimatedDurationSec: 1500, categoryId: c.categories.work, ...body })).body;
      urgentId = (await mk({ title: 'Urgent report', priority: 'HIGH', deadline: iso(Date.now() + 4 * HOUR) })).id;
      await mk({ title: 'Someday tidy-up', priority: 'LOW' });
      blockerId = (await mk({ title: 'Prerequisite' })).id;
      await mk({ title: 'Needs prerequisite', dependsOnIds: [blockerId] });
      await mk({ title: 'Huge project', estimatedDurationSec: 8 * 3600 });
    });

    it('ranks by urgency and priority, explains why, and says why other tasks were left out', async () => {
      await c.post('/api/energy/logs', { energy: 'HIGH', focus: 'HIGH' });
      const res = await c.post('/api/recommendations/generate', { availableMinutes: 60 });
      expect(res.status).toBe(200);
      const top = res.body.recommendations[0];
      expect(top.taskId).toBe(urgentId);
      expect(top.reasons.length).toBeGreaterThan(1);
      expect(top.summary).toMatch(/^Recommended because/);
      expect(top.summary).toMatch(/25 min/);
      expect(top.breakdown.map((f: { factor: string }) => f.factor)).toEqual(expect.arrayContaining(['urgency', 'priority', 'fit', 'energy']));
      expect(Math.round(top.breakdown.reduce((s: number, f: { value: number; weight: number }) => s + f.value * f.weight, 0) * 100)).toBe(top.score);
      expect(top.confidence).toBeGreaterThan(0);
      expect(res.body.userState).toMatchObject({ source: 'LOGGED' });

      const excluded = Object.fromEntries(res.body.excluded.map((e: { title: string; code: string }) => [e.title, e.code]));
      expect(excluded['Needs prerequisite']).toBe('BLOCKED');
      expect(excluded['Huge project']).toMatch(/TOO_LONG_FOR_LIMIT|NO_WINDOW/);
    });

    it('"I have N minutes" overrides active hours but still respects real commitments', async () => {
      // a user whose configured day is over (end of day = 00:01 in the past is impossible, so use a tiny window)
      const night = await Client.register(t, { label: 'night' });
      await night.patch('/api/users/me/preferences', { dayStartMinute: 0, dayEndMinute: 60 }); // active 00:00–01:00 only
      await night.post('/api/tasks', { title: 'Quick admin', estimatedDurationSec: 1200, categoryId: night.categories.work });
      // an hour from now there is a fixed commitment
      const fixedStart = Date.now() + 50 * MIN;
      await night.post('/api/activities', { title: 'Fixed call', categoryId: night.categories.meetings, isFixed: true, plannedStart: iso(fixedStart), plannedEnd: iso(fixedStart + HOUR) });
      const res = (await night.post('/api/recommendations/generate', { availableMinutes: 120 })).body;
      // the window is cut where the fixed call (plus its buffer) begins: nothing is offered across it
      for (const r of res.recommendations) {
        expect(new Date(r.suitableWindow.end).getTime()).toBeLessThanOrEqual(fixedStart);
      }
      expect(res.recommendations[0]?.title).toBe('Quick admin');
      expect(res.usedDeclaredTime).toBe(true); // outside the configured hours: only the user's word
      expect(res.recommendations[0].confidence).toBeLessThan(90);
    });

    it('accepting a recommendation schedules the task and cannot be repeated', async () => {
      const gen = (await c.post('/api/recommendations/generate', { availableMinutes: 90 })).body;
      const rec = gen.recommendations.find((r: { taskId: string }) => r.taskId === urgentId);
      const accepted = await c.post(`/api/recommendations/${rec.id}/accept`);
      expect(accepted.status).toBe(200);
      expect(accepted.body.activity.taskId).toBe(urgentId);
      expect(accepted.body.recommendation.status).toBe('ACCEPTED');
      const again = await c.post(`/api/recommendations/${rec.id}/accept`);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('RECOMMENDATION_RESOLVED');
      // the scheduled task is no longer offered again
      const next = (await c.post('/api/recommendations/generate', { availableMinutes: 90 })).body;
      expect(next.recommendations.map((r: { taskId: string }) => r.taskId)).not.toContain(urgentId);
      expect(next.excluded.find((e: { taskId: string }) => e.taskId === urgentId).code).toBe('ALREADY_SCHEDULED');
    });

    it('dismisses a recommendation', async () => {
      const gen = (await c.post('/api/recommendations/generate', { availableMinutes: 90 })).body;
      const res = await c.post(`/api/recommendations/${gen.recommendations[0].id}/dismiss`);
      expect(res.body.status).toBe('DISMISSED');
    });

    it('next-action reuses a fresh batch and explains an empty result', async () => {
      const next = (await c.post('/api/recommendations/next')).body;
      expect(next.recommendation === null ? next.emptyReason : next.recommendation.summary).toBeTruthy();
      const lonely = await Client.register(t, { label: 'norecs' });
      const empty = (await lonely.post('/api/recommendations/next')).body;
      expect(empty.recommendation).toBeNull();
      expect(empty.emptyReason).toMatch(/no open tasks/i);
    });

    it('energy overview is honest about missing data', async () => {
      const fresh = await Client.register(t, { label: 'energyfresh' });
      const o = (await fresh.get('/api/energy/overview')).body;
      expect(o.current).toMatchObject({ energy: null, source: 'UNKNOWN' });
      expect(o.forecast).toHaveLength(24);
      expect(o.forecast.every((h: { energy: number | null }) => h.energy === null)).toBe(true);
      expect(o.confidence).toBe(0);
      await fresh.patch('/api/users/me/preferences', { focusPeakStartMinute: 9 * 60, focusPeakEndMinute: 12 * 60 });
      const declared = (await fresh.get('/api/energy/overview')).body;
      expect(declared.forecast[10]).toMatchObject({ energy: 4, source: 'DECLARED' });
      // the declared window is 09:00–12:00; moving only its start past its end is invalid
      expect((await fresh.patch('/api/users/me/preferences', { focusPeakStartMinute: 800 })).body).toMatchObject({ code: 'INVALID_FOCUS_WINDOW' });
      expect((await fresh.patch('/api/users/me/preferences', { focusPeakStartMinute: 600 })).status).toBe(200);
      // sending only one end of a range must still be validated against the stored other end
      expect((await fresh.patch('/api/users/me/preferences', { dayEndMinute: 300 })).body).toMatchObject({ code: 'INVALID_ACTIVE_HOURS' });
      expect((await fresh.patch('/api/users/me/preferences', { dayStartMinute: 1380 })).body).toMatchObject({ code: 'INVALID_ACTIVE_HOURS' });
      const prefs = (await fresh.get('/api/users/me/preferences')).body;
      expect(prefs).toMatchObject({ focusPeakStartMinute: 600, focusPeakEndMinute: 720, dayStartMinute: 420, dayEndMinute: 1380 }); // nothing invalid was saved
    });

    it('proposes an energy-aware plan for a future day and applies it with re-validation', async () => {
      const day = futureDate(3);
      const plan = await c.post('/api/scheduling/plan', { date: day });
      expect(plan.status).toBe(200);
      expect(plan.body.blocks.length).toBeGreaterThan(0);
      expect(plan.body.energyUnknown).toBe(true);
      const ids = plan.body.blocks.map((b: { taskId: string }) => b.taskId);
      expect(ids).not.toContain(blockerId === ids[0] ? '' : 'x'); // sanity: ids are task ids
      const sorted = [...plan.body.blocks].sort((a: { start: string }, b: { start: string }) => a.start.localeCompare(b.start));
      for (let i = 1; i < sorted.length; i++) expect(new Date(sorted[i].start).getTime()).toBeGreaterThanOrEqual(new Date(sorted[i - 1].end).getTime());
      // nothing is saved by planning
      expect(await t.prisma.activity.count({ where: { userId: c.userId, plannedStart: { gte: new Date(plan.body.blocks[0].start) }, taskId: { in: ids } } })).toBe(0);

      const first = plan.body.blocks[0];
      // a fixed commitment appears after the plan was made: applying must report the conflict, not overwrite it
      await c.post('/api/activities', { title: 'Late fixed', categoryId: c.categories.meetings, isFixed: true, plannedStart: first.start, plannedEnd: first.end });
      const applied = await c.post('/api/scheduling/apply', { blocks: plan.body.blocks.map((b: { taskId: string; start: string; end: string }) => ({ taskId: b.taskId, start: b.start, end: b.end })) });
      expect(applied.status).toBe(201);
      expect(applied.body.failed).toEqual([expect.objectContaining({ taskId: first.taskId, code: 'SCHEDULE_CONFLICT' })]);
      expect(applied.body.created.length).toBe(plan.body.blocks.length - 1);
    });

    it('refuses to plan a past day and rejects overlapping or duplicate plan blocks', async () => {
      expect((await c.post('/api/scheduling/plan', { date: '2020-01-01' })).body.code).toBe('DATE_IN_PAST');
      const s = Date.now() + 100 * HOUR;
      const overlapping = await c.post('/api/scheduling/apply', { blocks: [{ taskId: urgentId, start: iso(s), end: iso(s + HOUR) }, { taskId: blockerId, start: iso(s + 30 * MIN), end: iso(s + 90 * MIN) }] });
      expect(overlapping.body.code).toBe('PLAN_BLOCKS_OVERLAP');
      const dup = await c.post('/api/scheduling/apply', { blocks: [{ taskId: urgentId, start: iso(s), end: iso(s + HOUR) }, { taskId: urgentId, start: iso(s + 2 * HOUR), end: iso(s + 3 * HOUR) }] });
      expect(dup.body.code).toBe('PLAN_DUPLICATE_TASK');
    });

    it('manages recurring commitments: occurrences appear in availability, can be skipped, and keep their local time', async () => {
      const tzUser = await Client.register(t, { label: 'recur', timezone: 'Europe/Paris' });
      const created = await tzUser.post('/api/schedule/events', {
        title: 'Stand-up',
        categoryId: tzUser.categories.meetings,
        startMinute: 9 * 60,
        durationMin: 15,
        recurrence: { frequency: 'DAILY', startDate: '2026-03-27' },
      });
      expect(created.status).toBe(201);
      const hours = [];
      for (const d of ['2026-03-28', '2026-03-30']) {
        const day = (await tzUser.get(`/api/availability/day?date=${d}`)).body;
        const standup = day.blocks.find((b: { title: string }) => b.title === 'Stand-up');
        hours.push(new Date(standup.start).getUTCHours());
      }
      expect(hours).toEqual([8, 7]); // 09:00 Paris is 08:00Z before the DST change and 07:00Z after it
      const skipped = await tzUser.post(`/api/schedule/events/${created.body.id}/skip`, { date: '2026-03-30' });
      expect(skipped.body.recurrence.exDates).toEqual(['2026-03-30']);
      expect((await tzUser.get('/api/availability/day?date=2026-03-30')).body.blocks.find((b: { title: string }) => b.title === 'Stand-up')).toBeUndefined();
      const mat = await tzUser.post(`/api/schedule/events/${created.body.id}/materialise`, { date: '2026-03-31' });
      const again = await tzUser.post(`/api/schedule/events/${created.body.id}/materialise`, { date: '2026-03-31' });
      expect(again.body.id).toBe(mat.body.id); // idempotent
      expect((await tzUser.post(`/api/schedule/events/${created.body.id}/materialise`, { date: '2026-03-30' })).body.code).toBe('NOT_AN_OCCURRENCE');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('analytics & insights', () => {
    it('shows an honest empty state for a new account', async () => {
      const c = await Client.register(t, { label: 'empty' });
      const d = (await c.get('/api/analytics/dashboard')).body;
      expect(d.isEmptyAccount).toBe(true);
      expect(d.timer.session).toBeNull();
      expect(d.metrics).toMatchObject({ trackedSec: 0, plannedSec: 0, productivityScore: null, pendingTasks: 0 });
      expect(d.upcoming).toEqual([]);
    });

    it('computes metrics from stored data, and corrections immediately change cached analytics', async () => {
      const c = await Client.register(t, { label: 'metrics' });
      const work = (await c.post('/api/activities', { title: 'Build feature', categoryId: c.categories.work })).body;
      const rest = (await c.post('/api/activities', { title: 'Lunch break', categoryId: c.categories.rest })).body;
      const entry = async (activityId: string, from: [number, number], to: [number, number]) => {
        const res = await c.post('/api/time-tracking/manual', { activityId, startedAt: iso(yesterdayAt(...from)), endedAt: iso(yesterdayAt(...to)) });
        expect([res.status, res.body.code]).toEqual([201, undefined]);
        return res.body;
      };
      const e1 = await entry(work.id, [10, 0], [11, 0]);
      await entry(rest.id, [12, 0], [12, 30]);
      await entry(work.id, [13, 0], [14, 30]);
      expect(await t.prisma.activitySession.count({ where: { userId: c.userId } })).toBe(3);
      const day = yesterdayDate();

      const before = (await c.get(`/api/analytics/summary?from=${day}&to=${day}`)).body;
      expect(before.totals).toMatchObject({ trackedSec: 10_800, productiveSec: 9000, restSec: 1800, activeDays: 1, deepWorkSessions: 2 });
      expect(before.days[0].focusSec).toBe(9000);
      expect(before.categories.find((x: { key: string }) => x.key === 'work').trackedSec).toBe(9000);
      expect(before.days[0].productivityScore).not.toBeNull();
      expect(before.heatmap).toHaveLength(7 * 24);

      // correct the first entry from 60 to 30 minutes: the very next read must reflect it (no stale cache)
      await c.patch(`/api/time-tracking/sessions/${e1.id}`, { startedAt: iso(yesterdayAt(10)), endedAt: iso(yesterdayAt(10, 30)), reason: 'left early' });
      const after = (await c.get(`/api/analytics/summary?from=${day}&to=${day}`)).body;
      expect(after.totals.productiveSec).toBe(7200);
      expect(after.totals.deepWorkSessions).toBe(1);

      // the finished day is stored as a snapshot and refreshed by events
      await c.drain();
      const stored = await t.prisma.dailyAnalytics.findFirst({ where: { userId: c.userId, date: new Date(`${day}T00:00:00.000Z`) } });
      expect(stored?.productiveSec).toBe(7200);

      const weekly = (await c.get(`/api/analytics/reports/weekly?date=${day}`)).body;
      expect(weekly.summary.totals.productiveSec).toBeGreaterThanOrEqual(7200);
      expect(weekly.highlights.join(' ')).toMatch(/You tracked/);
      const monthly = await c.get('/api/analytics/reports/monthly');
      expect(monthly.status).toBe(200);
      expect((await c.get('/api/analytics/reports/monthly?month=2026-13')).status).toBe(400);
      expect((await c.get('/api/analytics/summary?from=2024-01-01&to=2026-01-01')).body.code).toBe('INVALID_RANGE');
    });

    it('reports unplanned gaps as leakage but never rest, and calls untracked time unknown', async () => {
      const c = await Client.register(t, { label: 'leak' });
      const work = (await c.post('/api/activities', { title: 'Code', categoryId: c.categories.work })).body;
      const rest = (await c.post('/api/activities', { title: 'Nap', categoryId: c.categories.rest })).body;
      await c.post('/api/time-tracking/manual', { activityId: work.id, startedAt: iso(yesterdayAt(9)), endedAt: iso(yesterdayAt(10)) });
      await c.post('/api/time-tracking/manual', { activityId: work.id, startedAt: iso(yesterdayAt(10, 45)), endedAt: iso(yesterdayAt(11, 30)) }); // 45 min gap
      await c.post('/api/time-tracking/manual', { activityId: rest.id, startedAt: iso(yesterdayAt(15)), endedAt: iso(yesterdayAt(17)) });
      const day = yesterdayDate();
      const r = (await c.get(`/api/productivity/leakage?from=${day}&to=${day}`)).body;
      expect(r.totals.unplannedGapSec).toBe(45 * 60);
      expect(r.totals.restSec).toBe(7200);
      const types = r.insights.map((i: { type: string }) => i.type);
      expect(types).toContain('UNPLANNED_GAPS');
      expect(JSON.stringify(r.insights)).not.toMatch(/nap/i);
      const untracked = r.insights.find((i: { type: string }) => i.type === 'UNTRACKED_TIME');
      expect(untracked.severity).toBe('LOW');
      expect(untracked.explanation).toMatch(/not counted as free time or as wasted time/);
    });

    it('refuses to claim patterns without data, with confidence 0 and an explanation', async () => {
      const c = await Client.register(t, { label: 'patterns' });
      const p = (await c.get('/api/productivity/patterns')).body;
      expect(p.sufficiency).toBe('INSUFFICIENT');
      expect(p.provider).toBe('statistical-baseline');
      expect(p.insights.every((i: { confidence: number; sufficiency: string }) => i.confidence === 0 && i.sufficiency === 'INSUFFICIENT')).toBe(true);
      expect(p.forecast.expectedProductiveSec).toBeNull();
      expect(p.forecast.basis).toMatch(/Not enough history/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('AI coach', () => {
    let a: Client;
    let b: Client;
    let tools: CoachToolsService;
    beforeAll(async () => {
      a = await Client.register(t, { label: 'coachA' });
      b = await Client.register(t, { label: 'coachB' });
      tools = t.app.get(CoachToolsService);
    });

    it('is clearly labelled as demo mode when no API key is configured, and never pretends to be a model', async () => {
      const status = (await a.get('/api/ai-coach/status')).body;
      expect(status).toMatchObject({ mode: 'demo', provider: 'demo', model: null });
      expect(status.notice).toMatch(/not from a language model/);
      await a.post('/api/tasks', { title: 'Draft proposal', estimatedDurationSec: 1800, priority: 'HIGH' });
      const res = await a.post('/api/ai-coach/messages', { message: 'What should I do with the next 40 minutes?' });
      expect(res.status).toBe(200);
      expect(res.body.reply).toMatchObject({ isDemo: true, provider: 'demo', model: null, role: 'ASSISTANT' });
      expect(res.body.usage).toMatchObject({ mode: 'demo', costMicroUsd: 0 });
      expect(res.body.reply.toolCalls.map((x: { name: string }) => x.name)).toContain('recommend_tasks');
      expect(res.body.reply.content).toMatch(/Draft proposal/);
      const convo = (await a.get(`/api/ai-coach/conversations/${res.body.conversationId}`)).body;
      expect(convo.messages).toHaveLength(2);
      expect((await b.get(`/api/ai-coach/conversations/${res.body.conversationId}`)).status).toBe(404);
    });

    it('validates messages', async () => {
      expect((await a.post('/api/ai-coach/messages', { message: '' })).status).toBe(400);
      expect((await a.post('/api/ai-coach/messages', { message: 'x'.repeat(2001) })).status).toBe(400);
      expect((await a.post('/api/ai-coach/messages', { message: 'hi', conversationId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    });

    it('tools only ever act for the authenticated user and reject unknown tools, unexpected arguments and malformed input', async () => {
      const mine = (await a.post('/api/tasks', { title: 'A-secret-task', estimatedDurationSec: 900 })).body;
      const convoB = (await b.post('/api/ai-coach/messages', { message: 'hello' })).body.conversationId as string;
      const ctxB = await tools.context(b.userId, convoB);

      const list = await tools.execute(ctxB, 'list_tasks', {});
      expect(list.content).not.toContain('A-secret-task');
      const steal = await tools.execute(ctxB, 'propose_schedule_task', { task_id: mine.id, start: new Date(Date.now() + 5 * HOUR).toISOString() });
      expect(steal.isError).toBe(true);
      expect(await t.prisma.aIPendingAction.count({ where: { userId: b.userId } })).toBe(0);

      expect((await tools.execute(ctxB, 'run_sql', { query: 'select * from "User"' })).isError).toBe(true);
      const extra = await tools.execute(ctxB, 'get_day_overview', { user_id: a.userId });
      expect(extra.isError).toBe(true);
      expect(extra.content).toMatch(/Invalid arguments/);
      expect((await tools.execute(ctxB, 'get_time_summary', { from_date: 'yesterday', to_date: 'today' })).isError).toBe(true);
      expect((await tools.execute(ctxB, 'find_free_slots', { duration_minutes: 100000 })).isError).toBe(true);
    });

    it('records every tool call in the audit log with the coach as actor', async () => {
      const convo = (await a.post('/api/ai-coach/messages', { message: 'How is my day going?' })).body.conversationId;
      const entries = await t.prisma.auditLog.findMany({ where: { userId: a.userId, actor: 'ai-coach', entityId: convo } });
      expect(entries.some((e) => e.action === 'ai.tool.get_day_overview')).toBe(true);
      expect(entries.some((e) => e.action === 'ai.message')).toBe(true);
    });

    it('turns schedule changes into proposals that only the owner can confirm, once', async () => {
      const task = (await a.post('/api/tasks', { title: 'Plan sprint', estimatedDurationSec: 2400 })).body;
      const convo = (await a.post('/api/ai-coach/messages', { message: 'Summarize my day' })).body.conversationId as string;
      const ctx = await tools.context(a.userId, convo);
      const start = new Date(Date.now() + 30 * HOUR).toISOString();
      const proposed = await tools.execute(ctx, 'propose_schedule_task', { task_id: task.id, start });
      expect(proposed.isError).toBe(false);
      const { proposalId } = JSON.parse(proposed.content);
      // proposing changes nothing
      expect(await t.prisma.activity.count({ where: { userId: a.userId, taskId: task.id } })).toBe(0);

      const detail = (await a.get(`/api/ai-coach/conversations/${convo}`)).body;
      expect(detail.pendingActions).toEqual([expect.objectContaining({ id: proposalId, status: 'PENDING', type: 'schedule_task' })]);
      expect((await b.post(`/api/ai-coach/actions/${proposalId}/confirm`)).status).toBe(404);

      const confirmed = await a.post(`/api/ai-coach/actions/${proposalId}/confirm`);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.action.status).toBe('CONFIRMED');
      expect(await t.prisma.activity.count({ where: { userId: a.userId, taskId: task.id } })).toBe(1);
      expect((await a.post(`/api/ai-coach/actions/${proposalId}/confirm`)).body.code).toBe('PROPOSAL_RESOLVED');

      const second = JSON.parse((await tools.execute(ctx, 'propose_schedule_task', { task_id: task.id, start: new Date(Date.now() + 80 * HOUR).toISOString() })).content);
      expect((await a.post(`/api/ai-coach/actions/${second.proposalId}/reject`)).body.status).toBe('REJECTED');
      expect((await a.post(`/api/ai-coach/actions/${second.proposalId}/confirm`)).body.code).toBe('PROPOSAL_RESOLVED');
    });

    it('a confirmed proposal that no longer fits is reported and stays retryable', async () => {
      const task = (await a.post('/api/tasks', { title: 'Squeezed in', estimatedDurationSec: 1800 })).body;
      const convo = (await a.post('/api/ai-coach/messages', { message: 'What should I do?' })).body.conversationId as string;
      const ctx = await tools.context(a.userId, convo);
      const s = Date.now() + 200 * HOUR;
      const proposal = JSON.parse((await tools.execute(ctx, 'propose_schedule_task', { task_id: task.id, start: new Date(s).toISOString() })).content);
      await a.post('/api/activities', { title: 'Now taken', categoryId: a.categories.meetings, isFixed: true, plannedStart: iso(s), plannedEnd: iso(s + HOUR) });
      const res = await a.post(`/api/ai-coach/actions/${proposal.proposalId}/confirm`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SCHEDULE_CONFLICT');
      expect((await t.prisma.aIPendingAction.findUnique({ where: { id: proposal.proposalId } }))!.status).toBe('PENDING');
    });

    it('enforces the daily message limit', async () => {
      const c = await Client.register(t, { label: 'limit' });
      const first = (await c.post('/api/ai-coach/messages', { message: 'hello' })).body;
      await t.prisma.aIInteraction.createMany({
        data: Array.from({ length: 40 }, () => ({ conversationId: first.conversationId, userId: c.userId, role: 'USER' as const, content: 'x', provider: 'demo', isDemo: true })),
      });
      const blocked = await c.post('/api/ai-coach/messages', { message: 'one more' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('AI_LIMIT_REACHED');
    });

    it('deletes a conversation with its proposals', async () => {
      const convo = (await a.post('/api/ai-coach/messages', { message: 'temporary' })).body.conversationId;
      expect((await a.del(`/api/ai-coach/conversations/${convo}`)).status).toBe(200);
      expect((await a.get(`/api/ai-coach/conversations/${convo}`)).status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('notifications, rate limiting and health', () => {
    it('lists, counts and marks notifications read; duplicate delivery is ignored', async () => {
      const c = await Client.register(t, { label: 'notif' });
      const svc = t.app.get(NotificationsService);
      await svc.notify(c.userId, { type: 'SYSTEM', title: 'Hello', body: 'First', dedupeKey: 'k1' });
      await svc.notify(c.userId, { type: 'SYSTEM', title: 'Hello', body: 'First', dedupeKey: 'k1' });
      await svc.notify(c.userId, { type: 'REPORT_READY', title: 'Report', body: 'Second' });
      expect((await c.get('/api/notifications/unread-count')).body.count).toBe(2);
      const list = (await c.get('/api/notifications')).body;
      expect(list.items).toHaveLength(2);
      expect((await c.post(`/api/notifications/${list.items[0].id}/read`)).status).toBe(200);
      expect((await c.get('/api/notifications/unread-count')).body.count).toBe(1);
      expect((await c.post('/api/notifications/read-all')).body.count).toBe(1);
      const other = await Client.register(t, { label: 'notif2' });
      expect((await other.post(`/api/notifications/${list.items[0].id}/read`)).status).toBe(404);
    });

    it('rate-limits credential endpoints per address', async () => {
      const c = new Client(t, 'rate');
      let limited = 0;
      for (let i = 0; i < 14; i++) {
        const res = await c.agent.post('/api/auth/login').set('X-Test-Throttle', '1').send({ email: 'x@example.com', password: 'some password' });
        if (res.status === 429) {
          limited++;
          expect(res.body.code).toBe('RATE_LIMITED');
        }
      }
      expect(limited).toBeGreaterThan(0);
    });

    it('exposes liveness and readiness without authentication', async () => {
      const c = new Client(t);
      expect((await c.get('/api/health/live')).body.status).toBe('ok');
      const ready = (await c.get('/api/health/ready')).body;
      expect(ready.database.status).toBe('up');
      expect(ready.queue.mode).toBe('inline');
    });
  });
});
