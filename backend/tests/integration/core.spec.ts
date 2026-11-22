import { QueueService } from '../../src/infrastructure/queue/queue.service';
import { Client, createTestApp, futureDate, HOUR, iso, MIN, TestApp } from './harness';

describe('TIMEFLOW API — core flows', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('authentication & security', () => {
    it('registers, sets an HttpOnly session cookie and never returns the password hash', async () => {
      const c = await Client.register(t, { label: 'auth' });
      const res = await c.get('/api/auth/session');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
      const fresh = new Client(t, 'cookie');
      const reg = await fresh.agent.post('/api/auth/register').send({ email: fresh.email, password: fresh.password, displayName: 'Cookie' });
      t.userIds.push(reg.body.user.id);
      const setCookie = (reg.headers['set-cookie'] as unknown as string[]).join(';');
      expect(setCookie).toMatch(/tf_session=/);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
    });

    it('rejects weak input and duplicate emails with stable error codes', async () => {
      const c = new Client(t, 'dup');
      const weak = await c.agent.post('/api/auth/register').send({ email: c.email, password: 'short', displayName: 'X' });
      expect(weak.status).toBe(400);
      expect(weak.body.code).toBe('VALIDATION_ERROR');
      expect(weak.body.details.join(' ')).toMatch(/password/);
      const ok = await Client.register(t, { label: 'dup2' });
      const again = await new Client(t).agent.post('/api/auth/register').send({ email: ok.email, password: ok.password, displayName: 'X' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('EMAIL_IN_USE');
    });

    it('login fails identically for unknown email and wrong password', async () => {
      const c = await Client.register(t, { label: 'login' });
      const a = await new Client(t).agent.post('/api/auth/login').send({ email: c.email, password: 'wrong password here' });
      const b = await new Client(t).agent.post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong password here' });
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(a.body.code).toBe(b.body.code);
      expect(a.body.message).toBe(b.body.message);
    });

    it('requires a session and a CSRF token for state-changing requests', async () => {
      const anon = await new Client(t).agent.get('/api/tasks');
      expect(anon.status).toBe(401);
      expect(anon.body.code).toBe('UNAUTHENTICATED');
      const c = await Client.register(t, { label: 'csrf' });
      const noToken = await c.agent.post('/api/tasks').send({ title: 'x', estimatedDurationSec: 600 });
      expect(noToken.status).toBe(403);
      expect(noToken.body.code).toBe('CSRF_TOKEN_INVALID');
      const wrongToken = await c.agent.post('/api/tasks').set('X-CSRF-Token', 'nope').send({ title: 'x', estimatedDurationSec: 600 });
      expect(wrongToken.status).toBe(403);
      expect((await c.post('/api/tasks', { title: 'x', estimatedDurationSec: 600 })).status).toBe(201);
    });

    it('logout revokes the session server-side', async () => {
      const c = await Client.register(t, { label: 'logout' });
      expect((await c.post('/api/auth/logout')).status).toBe(200);
      expect((await c.get('/api/auth/session')).status).toBe(401);
    });

    it('changing the password signs out other devices but keeps the current one', async () => {
      const a = await Client.register(t, { label: 'devices' });
      const other = new Client(t);
      other.email = a.email;
      const login = await other.agent.post('/api/auth/login').send({ email: a.email, password: a.password });
      other.csrf = login.body.csrfToken;
      expect((await a.get('/api/auth/sessions')).body).toHaveLength(2);
      const res = await a.post('/api/auth/password/change', { currentPassword: a.password, newPassword: 'a brand new passphrase' });
      expect(res.status).toBe(200);
      expect((await other.get('/api/auth/session')).status).toBe(401);
      expect((await a.get('/api/auth/session')).status).toBe(200);
    });

    it('password reset tokens work once and invalidate all sessions', async () => {
      const c = await Client.register(t, { label: 'reset' });
      expect((await new Client(t).agent.post('/api/auth/password/forgot').send({ email: 'unknown@example.com' })).status).toBe(202);
      expect((await new Client(t).agent.post('/api/auth/password/forgot').send({ email: c.email })).status).toBe(202);
      const token = new URL(t.mailer.outbox.get(c.email)!.link).searchParams.get('token')!;
      const reset = await new Client(t).agent.post('/api/auth/password/reset').send({ token, newPassword: 'another long passphrase' });
      expect(reset.status).toBe(200);
      expect((await new Client(t).agent.post('/api/auth/password/reset').send({ token, newPassword: 'yet another passphrase' })).status).toBe(400);
      expect((await c.get('/api/auth/session')).status).toBe(401);
      expect((await new Client(t).agent.post('/api/auth/login').send({ email: c.email, password: 'another long passphrase' })).status).toBe(200);
    });

    it('rejects unknown properties, answers unknown routes with the error contract and limits CORS to the frontend origin', async () => {
      const c = await Client.register(t, { label: 'misc' });
      const extra = await c.post('/api/tasks', { title: 'x', estimatedDurationSec: 600, isAdmin: true });
      expect(extra.status).toBe(400);
      const missing = await c.get('/api/does-not-exist');
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      const good = await c.agent.options('/api/tasks').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'POST');
      expect(good.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(good.headers['access-control-allow-credentials']).toBe('true');
      const bad = await c.agent.options('/api/tasks').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('activities', () => {
    let c: Client;
    let intruder: Client;
    beforeAll(async () => {
      c = await Client.register(t, { label: 'act' });
      intruder = await Client.register(t, { label: 'intruder' });
    });

    it('creates, edits, searches and filters; normalises tags; derives planned duration', async () => {
      const start = Date.now() + 24 * HOUR;
      const created = await c.post('/api/activities', {
        title: '  Deep work  ',
        categoryId: c.categories.work,
        plannedStart: iso(start),
        plannedEnd: iso(start + 90 * MIN),
        tags: ['Focus', 'focus', ' Writing '],
        priority: 'HIGH',
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ title: 'Deep work', plannedDurationSec: 5400, actualDurationSec: 0, status: 'PLANNED', tags: ['focus', 'writing'] });
      const id = created.body.id;

      expect((await c.patch(`/api/activities/${id}`, { notes: 'Bring the outline' })).body.notes).toBe('Bring the outline');
      const search = await c.get('/api/activities?q=writing');
      expect(search.body.items.map((a: { id: string }) => a.id)).toContain(id);
      expect((await c.get(`/api/activities?categoryId=${c.categories.rest}`)).body.items.map((a: { id: string }) => a.id)).not.toContain(id);
    });

    it('validates the planned range and the category', async () => {
      const now = Date.now();
      const base = { title: 'x', categoryId: c.categories.work };
      expect((await c.post('/api/activities', { ...base, plannedStart: iso(now + HOUR), plannedEnd: iso(now) })).body.code).toBe('INVALID_PLANNED_RANGE');
      expect((await c.post('/api/activities', { ...base, plannedStart: iso(now) })).body.code).toBe('INVALID_PLANNED_RANGE');
      expect((await c.post('/api/activities', { ...base, categoryId: intruder.categories.work })).body.code).toBe('INVALID_CATEGORY');
    });

    it("never exposes another user's activities", async () => {
      const mine = await c.post('/api/activities', { title: 'private', categoryId: c.categories.work });
      expect((await intruder.get(`/api/activities/${mine.body.id}`)).status).toBe(404);
      expect((await intruder.patch(`/api/activities/${mine.body.id}`, { title: 'hacked' })).status).toBe(404);
      expect((await intruder.del(`/api/activities/${mine.body.id}`)).status).toBe(404);
      expect((await intruder.get('/api/activities?q=private')).body.items).toHaveLength(0);
    });

    it('counts a reschedule only when a planned block actually moves', async () => {
      const s = Date.now() + 48 * HOUR;
      const a = (await c.post('/api/activities', { title: 'Movable', categoryId: c.categories.work, plannedStart: iso(s), plannedEnd: iso(s + HOUR) })).body;
      const same = await c.post(`/api/activities/${a.id}/reschedule`, { plannedStart: iso(s), plannedEnd: iso(s + HOUR) });
      expect(same.body.rescheduleCount).toBe(0);
      const moved = await c.post(`/api/activities/${a.id}/reschedule`, { plannedStart: iso(s + HOUR), plannedEnd: iso(s + 2 * HOUR) });
      expect(moved.body.rescheduleCount).toBe(1);
    });

    it('duplicates the plan but not tracked time; delete keeps tracked history', async () => {
      const a = (await c.post('/api/activities', { title: 'Tracked', categoryId: c.categories.work })).body;
      const start = Date.now() - 3 * HOUR;
      expect((await c.post('/api/time-tracking/manual', { activityId: a.id, startedAt: iso(start), endedAt: iso(start + HOUR) })).status).toBe(201);
      const copy = (await c.post(`/api/activities/${a.id}/duplicate`, {})).body;
      expect(copy.actualDurationSec).toBe(0);
      expect((await c.get(`/api/activities/${a.id}`)).body.actualDurationSec).toBe(3600);
      expect((await c.del(`/api/activities/${a.id}`)).status).toBe(200);
      expect((await c.get(`/api/activities/${a.id}`)).status).toBe(404);
      const sessions = await c.get(`/api/time-tracking/sessions?activityId=${a.id}`);
      expect(sessions.body.totalDurationSec).toBe(3600); // tracked time survives the removal from the plan
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('time tracking', () => {
    let c: Client;
    beforeAll(async () => {
      c = await Client.register(t, { label: 'timer' });
    });
    const activity = async (title: string) => (await c.post('/api/activities', { title, categoryId: c.categories.work })).body.id as string;

    it('persists the timer: elapsed time is derived from stored timestamps, so it survives refreshes and closed tabs', async () => {
      const id = await activity('Persisted');
      expect((await c.post('/api/time-tracking/start', { activityId: id })).status).toBe(200);
      // simulate the browser being closed for 10 minutes: move the persisted start back in time
      await t.prisma.sessionSegment.updateMany({ where: { session: { userId: c.userId, status: 'RUNNING' } }, data: { startedAt: new Date(Date.now() - 10 * MIN) } });
      const after = (await c.get('/api/time-tracking/active')).body;
      expect(after.session.status).toBe('RUNNING');
      expect(after.elapsedSec).toBeGreaterThanOrEqual(599);
      expect(after.elapsedSec).toBeLessThan(620);
      expect(await c.post('/api/time-tracking/stop')).toMatchObject({ status: 200 });
    });

    it('excludes paused time from the total', async () => {
      const id = await activity('Paused');
      await c.post('/api/time-tracking/start', { activityId: id });
      await t.prisma.sessionSegment.updateMany({ where: { session: { userId: c.userId, status: 'RUNNING' } }, data: { startedAt: new Date(Date.now() - 20 * MIN) } });
      await c.post('/api/time-tracking/pause');
      // 10 minutes pass while paused: nothing may accrue
      const paused = (await c.get('/api/time-tracking/active')).body;
      const frozen = paused.elapsedSec;
      expect(paused.session.status).toBe('PAUSED');
      expect(frozen).toBeGreaterThanOrEqual(1199);
      await new Promise((r) => setTimeout(r, 1200));
      expect((await c.get('/api/time-tracking/active')).body.elapsedSec).toBe(frozen);
      await c.post('/api/time-tracking/resume');
      const stopped = (await c.post('/api/time-tracking/stop')).body;
      expect(stopped.session.pauseCount).toBe(1);
      expect(stopped.session.segments).toHaveLength(2);
    });

    it('rejects invalid transitions with a stable code', async () => {
      const id = await activity('Transitions');
      expect((await c.post('/api/time-tracking/pause')).body.code).toBe('NO_ACTIVE_TIMER');
      await c.post('/api/time-tracking/start', { activityId: id });
      expect((await c.post('/api/time-tracking/resume')).body.code).toBe('INVALID_TIMER_TRANSITION');
      await c.post('/api/time-tracking/stop');
    });

    it('never ends up with two active timers, even when two starts race', async () => {
      const [a, b] = await Promise.all([activity('Race A'), activity('Race B')]);
      const results = await Promise.all([c.post('/api/time-tracking/start', { activityId: a }), c.post('/api/time-tracking/start', { activityId: b })]);
      expect(results.map((r) => r.status)).toEqual([200, 200]); // the second one switches activities
      const active = await t.prisma.activitySession.count({ where: { userId: c.userId, status: { in: ['RUNNING', 'PAUSED'] } } });
      expect(active).toBe(1);
      const open = await t.prisma.sessionSegment.count({ where: { userId: c.userId, endedAt: null } });
      expect(open).toBe(1);
      await c.post('/api/time-tracking/stop');
    });

    it('is idempotent when the same activity is started again, and switching stops the previous activity', async () => {
      const [a, b] = await Promise.all([activity('Same A'), activity('Same B')]);
      await c.post('/api/time-tracking/start', { activityId: a });
      const again = await c.post('/api/time-tracking/start', { activityId: a });
      expect(again.body.switchedFromSessionId).toBeNull();
      const switched = await c.post('/api/time-tracking/start', { activityId: b });
      expect(switched.body.switchedFromSessionId).not.toBeNull();
      expect(await t.prisma.activitySession.count({ where: { activityId: a } })).toBe(1);
      await c.post('/api/time-tracking/stop');
    });

    it('detects stale tabs with an optimistic version check', async () => {
      const id = await activity('Versioned');
      const started = (await c.post('/api/time-tracking/start', { activityId: id })).body;
      const v = started.timer.session.version;
      expect((await c.post('/api/time-tracking/pause', { expectedVersion: v })).status).toBe(200);
      const stale = await c.post('/api/time-tracking/resume', { expectedVersion: v });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('TIMER_STATE_CHANGED');
      await c.post('/api/time-tracking/stop');
    });

    it('closes a forgotten timer at the 12-hour mark, flags it, audits it and tells the user', async () => {
      const c = await Client.register(t, { label: 'abandon' }); // own account: a 12-hour session legitimately blocks overlapping entries
      const id = (await c.post('/api/activities', { title: 'Forgotten', categoryId: c.categories.work })).body.id as string;
      await c.post('/api/time-tracking/start', { activityId: id });
      // the person walked away 13 hours ago and never stopped it
      const startedAt = new Date(Date.now() - 13 * HOUR);
      await t.prisma.sessionSegment.updateMany({ where: { session: { userId: c.userId, status: 'RUNNING' } }, data: { startedAt } });
      await t.prisma.activitySession.updateMany({ where: { userId: c.userId, status: 'RUNNING' }, data: { startedAt } });
      const session = await t.prisma.activitySession.findFirstOrThrow({ where: { userId: c.userId, status: 'RUNNING' }, include: { segments: true } });

      // run the delayed check the way the queue would after 12 hours
      const queue = t.app.get(QueueService);
      await queue.enqueue('timer.abandoned', { userId: c.userId, sessionId: session.id, segmentId: session.segments[0]!.id }, { jobId: `test-abandoned-${session.id}` });
      await queue.drain();

      const closed = await t.prisma.activitySession.findUniqueOrThrow({ where: { id: session.id } });
      expect(closed.status).toBe('STOPPED');
      expect(closed.autoStopped).toBe(true);
      expect(closed.durationSec).toBe(12 * 3600); // capped at the cutoff, not the 13 hours that really elapsed
      expect(closed.endedAt!.getTime()).toBe(startedAt.getTime() + 12 * HOUR);
      expect((await c.get('/api/time-tracking/active')).body.session).toBeNull();
      const audit = await t.prisma.auditLog.findFirst({ where: { userId: c.userId, action: 'time-entry.auto-stopped' } });
      expect(audit?.actor).toBe('system');
      const note = (await c.get('/api/notifications')).body.items.find((n: { title: string }) => n.title === 'A forgotten timer was stopped');
      expect(note?.body).toMatch(/Forgotten/);
    });

    it('does not touch a timer that was stopped or paused before the check ran', async () => {
      const c = await Client.register(t, { label: 'paused' });
      const id = (await c.post('/api/activities', { title: 'Fine', categoryId: c.categories.work })).body.id as string;
      await c.post('/api/time-tracking/start', { activityId: id });
      const session = await t.prisma.activitySession.findFirstOrThrow({ where: { userId: c.userId, status: 'RUNNING' }, include: { segments: true } });
      await c.post('/api/time-tracking/pause');
      const queue = t.app.get(QueueService);
      await queue.enqueue('timer.abandoned', { userId: c.userId, sessionId: session.id, segmentId: session.segments[0]!.id }, { jobId: `test-paused-${session.id}` });
      await queue.drain();
      expect((await t.prisma.activitySession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('PAUSED');
      await c.post('/api/time-tracking/stop');
    });

    it('stop with complete marks the activity done and stores the tracked total', async () => {
      const id = await activity('Finish me');
      await c.post('/api/time-tracking/start', { activityId: id });
      await t.prisma.sessionSegment.updateMany({ where: { session: { userId: c.userId, status: 'RUNNING' } }, data: { startedAt: new Date(Date.now() - 5 * MIN) } });
      await c.post('/api/time-tracking/stop', { complete: true });
      const a = (await c.get(`/api/activities/${id}`)).body;
      expect(a.status).toBe('COMPLETED');
      expect(a.actualDurationSec).toBeGreaterThanOrEqual(299);
      expect(a.completedAt).not.toBeNull();
    });

    it('rejects overlapping or future manual entries, and audits corrections and deletions', async () => {
      const id = await activity('Manual');
      const start = Date.now() - 6 * HOUR;
      const entry = await c.post('/api/time-tracking/manual', { activityId: id, startedAt: iso(start), endedAt: iso(start + HOUR), note: 'forgot' });
      expect(entry.status).toBe(201);
      expect(entry.body.source).toBe('MANUAL');
      const overlap = await c.post('/api/time-tracking/manual', { activityId: id, startedAt: iso(start + 30 * MIN), endedAt: iso(start + 90 * MIN) });
      expect(overlap.body.code).toBe('TIME_ENTRY_OVERLAP');
      expect((await c.post('/api/time-tracking/manual', { activityId: id, startedAt: iso(Date.now() + HOUR), endedAt: iso(Date.now() + 2 * HOUR) })).body.code).toBe('INVALID_TIME_ENTRY');

      const missingReason = await c.patch(`/api/time-tracking/sessions/${entry.body.id}`, { startedAt: iso(start), endedAt: iso(start + 45 * MIN) });
      expect(missingReason.status).toBe(400);
      const fixed = await c.patch(`/api/time-tracking/sessions/${entry.body.id}`, { startedAt: iso(start), endedAt: iso(start + 45 * MIN), reason: 'stopped earlier than logged' });
      expect(fixed.body.durationSec).toBe(2700);
      const trail = (await c.get(`/api/time-tracking/sessions/${entry.body.id}/corrections`)).body;
      const correction = trail.find((e: { action: string }) => e.action === 'time-entry.corrected');
      expect(correction.reason).toBe('stopped earlier than logged');
      expect(correction.before.durationSec).toBe(3600);
      expect(correction.after.durationSec).toBe(2700);

      expect((await c.del(`/api/time-tracking/sessions/${entry.body.id}`, { reason: 'duplicate entry' })).status).toBe(200);
      const deleted = await t.prisma.auditLog.findFirst({ where: { userId: c.userId, action: 'time-entry.deleted', entityId: entry.body.id } });
      expect(deleted).not.toBeNull();
      expect((deleted!.before as { durationSec: number }).durationSec).toBe(2700); // content survives in the trail
      expect((await c.get(`/api/activities/${id}`)).body.actualDurationSec).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('availability (smart availability engine)', () => {
    let c: Client;
    const date = futureDate(1);
    beforeAll(async () => {
      c = await Client.register(t, { label: 'avail', timezone: 'Africa/Cairo' });
      // Cairo is UTC+2 in winter / UTC+3 in summer: compute instants from LOCAL times through the API's own day range
      await c.patch('/api/users/me/preferences', { bufferMinutes: 0, minSlotMinutes: 15 });
      await c.put('/api/users/me/availability', { rules: [{ weekday: 1, startMinute: 8 * 60, endMinute: 18 * 60, kind: 'AVAILABLE' }] });
    });
    let dayStart = 0;
    /** Instant of a local wall-clock time on `date`. The day range comes from the API itself. */
    const localInstant = async (hh: number, mm = 0) => {
      if (!dayStart) dayStart = new Date((await c.get(`/api/availability/day?date=${date}`)).body.range.start).getTime();
      return dayStart + (hh * 60 + mm) * MIN; // no DST change inside this day, so local time is linear from midnight
    };

    it('finds the free windows around the planned commitments (the product example)', async () => {
      const at = localInstant;
      const mk = async (title: string, key: string, from: [number, number], to: [number, number]) =>
        c.post('/api/activities', { title, categoryId: c.categories[key], plannedStart: iso(await at(...from)), plannedEnd: iso(await at(...to)) });
      expect((await mk('Work', 'work', [9, 0], [10, 0])).status).toBe(201);
      expect((await mk('Meeting', 'meetings', [10, 0], [10, 30])).status).toBe(201);
      expect((await mk('Learning', 'learning', [11, 0], [12, 0])).status).toBe(201);

      const day = (await c.get(`/api/availability/day?date=${date}`)).body;
      const windows = day.windows.map((w: { start: string; end: string }) => [new Date(w.start).getTime(), new Date(w.end).getTime()]);
      expect(windows).toEqual([
        [await at(8), await at(9)],
        [await at(10, 30), await at(11)],
        [await at(12), await at(18)],
      ]);
      expect(day.conflicts).toEqual([]);
      expect(day.summary.plannedSec).toBe(150 * 60);
      expect(day.windows[1]).toMatchObject({ precededBy: 'Meeting', followedBy: 'Learning', durationSec: 1800 });
    });

    it('reports overlapping commitments as conflicts', async () => {
      const at = localInstant;
      await c.post('/api/activities', { title: 'Standup clash', categoryId: c.categories.meetings, isFixed: true, plannedStart: iso(await at(13, 0)), plannedEnd: iso(await at(14, 0)) });
      await c.post('/api/activities', { title: 'Client call clash', categoryId: c.categories.meetings, isFixed: true, plannedStart: iso(await at(13, 30)), plannedEnd: iso(await at(14, 30)) });
      const conflicts = (await c.get(`/api/availability/conflicts?from=${date}&to=${date}`)).body;
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({ severity: 'HARD', overlapSec: 1800 });
    });

    it('lists slots that fit a duration, with confidence', async () => {
      const res = await c.get(`/api/availability/slots?durationMin=45&from=${date}&days=1`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const s of res.body) expect(['HIGH', 'MEDIUM', 'LOW']).toContain(s.confidence);
      expect((await c.get('/api/availability/slots?durationMin=2')).status).toBe(400);
    });

    it('does not count past untracked time as free: today is split into tracked / unknown / free', async () => {
      const today = (await c.get('/api/availability/day')).body;
      const s = today.summary;
      for (const w of today.windows) expect(new Date(w.start).getTime()).toBeGreaterThanOrEqual(new Date(today.now).getTime() - 1000);
      // everything in the strip is classified and the strip tiles the whole local day
      const strip = today.strip;
      const total = strip.reduce((sum: number, x: { start: string; end: string }) => sum + (new Date(x.end).getTime() - new Date(x.start).getTime()), 0);
      expect(total).toBe(new Date(today.range.end).getTime() - new Date(today.range.start).getTime());
      expect(s.freeSec).toBeGreaterThanOrEqual(0);
    });

    it('rejects malformed dates and oversized ranges', async () => {
      expect((await c.get('/api/availability/day?date=2026-13-45')).status).toBe(400);
      expect((await c.get('/api/availability/range?from=2026-01-01&to=2026-06-01')).body.code).toBe('INVALID_RANGE');
    });

    it('refreshes the stored availability snapshot when the plan changes (event-driven)', async () => {
      await c.drain();
      const rows = await t.prisma.availabilityWindow.count({ where: { userId: c.userId } });
      expect(rows).toBeGreaterThan(0);
    });
  });
});
