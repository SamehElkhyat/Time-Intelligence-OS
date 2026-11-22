/**
 * Demo data for TIMEFLOW.
 *
 *   pnpm db:seed          create the demo account (does nothing if it already exists)
 *   pnpm db:seed:reset    delete ONLY the demo account and recreate it from scratch
 *
 * Everything lives under one clearly marked account (User.isDemo = true). Real accounts are never
 * read, modified or deleted. The generator uses a fixed random seed, so every run produces the same
 * shape of data (dates are relative to "today"). It writes six weeks of tracked history with the
 * imperfections real data has: late starts, overruns, interruptions, skipped blocks, planned time
 * that was never tracked, and short unplanned gaps.
 */
import { Level, Prisma, PrismaClient, Priority, TaskStatus, TimeOfDay } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CATEGORIES } from '../src/modules/users/default-categories';
import { addDays, isoWeekday, LocalDate, localDateToDateColumn, localMinuteToInstant, toLocalDate } from '../src/common/time/time';

const DEMO_EMAIL = 'demo@timeflow.app';
const DEMO_PASSWORD = 'demo-timeflow-2026';
const TIMEZONE = 'Africa/Cairo';
const HISTORY_DAYS = 42;
const FUTURE_DAYS = 4;
const MIN = 60_000;

const prisma = new PrismaClient();

// Deterministic PRNG (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260314);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const chance = (p: number) => rand() < p;

interface Slot {
  title: string;
  category: string;
  /** local start, minutes from midnight */
  start: number;
  durationMin: number;
  /** ISO weekdays 1..7 */
  days: number[];
  energy: Level;
  focus: Level;
  priority: Priority;
  fixed?: boolean;
  tags?: string[];
  /** probability that the block was actually tracked on a past day */
  trackProb: number;
  /** how much longer than planned it tends to run */
  overrun: [number, number];
  recurring?: 'standup' | 'gym';
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const SLOTS: Slot[] = [
  { title: 'Daily stand-up', category: 'meetings', start: 540, durationMin: 15, days: WEEKDAYS, energy: 'MODERATE', focus: 'LOW', priority: 'MEDIUM', fixed: true, trackProb: 0.95, overrun: [0.9, 1.3], recurring: 'standup' },
  { title: 'Deep work: product roadmap', category: 'work', start: 570, durationMin: 120, days: WEEKDAYS, energy: 'HIGH', focus: 'VERY_HIGH', priority: 'HIGH', tags: ['focus'], trackProb: 0.85, overrun: [0.85, 1.4] },
  { title: 'Emails & admin', category: 'work', start: 705, durationMin: 45, days: WEEKDAYS, energy: 'LOW', focus: 'LOW', priority: 'LOW', trackProb: 0.8, overrun: [0.9, 1.6] },
  { title: 'Lunch break', category: 'rest', start: 750, durationMin: 60, days: WEEKDAYS, energy: 'VERY_LOW', focus: 'VERY_LOW', priority: 'LOW', trackProb: 0.7, overrun: [0.9, 1.2] },
  { title: 'Learning: TypeScript deep dive', category: 'learning', start: 840, durationMin: 60, days: [2, 4], energy: 'MODERATE', focus: 'HIGH', priority: 'MEDIUM', tags: ['study'], trackProb: 0.85, overrun: [0.9, 1.2] },
  { title: 'Team meeting', category: 'meetings', start: 900, durationMin: 60, days: [3], energy: 'MODERATE', focus: 'MODERATE', priority: 'MEDIUM', fixed: true, trackProb: 0.9, overrun: [0.95, 1.25] },
  { title: 'Project work', category: 'work', start: 840, durationMin: 120, days: [1, 3, 5], energy: 'MODERATE', focus: 'HIGH', priority: 'MEDIUM', trackProb: 0.8, overrun: [0.9, 1.45] },
  { title: 'Gym', category: 'exercise', start: 1050, durationMin: 60, days: [1, 3, 5], energy: 'HIGH', focus: 'LOW', priority: 'MEDIUM', trackProb: 0.75, overrun: [0.9, 1.1], recurring: 'gym' },
  { title: 'Reading', category: 'personal', start: 1200, durationMin: 45, days: [6, 7], energy: 'LOW', focus: 'MODERATE', priority: 'LOW', trackProb: 0.6, overrun: [0.9, 1.3] },
  { title: 'Side project', category: 'learning', start: 600, durationMin: 120, days: [6], energy: 'MODERATE', focus: 'HIGH', priority: 'LOW', trackProb: 0.55, overrun: [0.9, 1.4] },
  { title: 'Movie night', category: 'entertainment', start: 1290, durationMin: 120, days: [5, 6], energy: 'VERY_LOW', focus: 'VERY_LOW', priority: 'LOW', trackProb: 0.5, overrun: [0.95, 1.1] },
];

const toDate = (ms: number) => new Date(ms);

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Seeding demo data is disabled in production.');
  const reset = process.argv.includes('--reset');

  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing && !existing.isDemo) throw new Error(`${DEMO_EMAIL} belongs to a real account; refusing to touch it.`);
  if (existing && !reset) {
    console.log(`Demo account already exists (${DEMO_EMAIL}). Run "pnpm db:seed:reset" to rebuild it.`);
    return;
  }
  if (existing) {
    await prisma.outboxEvent.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } }); // cascades to everything the demo account owns
    await prisma.auditLog.deleteMany({ where: { userId: null, actor: 'system', action: 'demo.seeded' } });
    console.log('Removed the previous demo account.');
  }

  const now = Date.now();
  const today: LocalDate = toLocalDate(now, TIMEZONE);
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, passwordHash, displayName: 'Demo User (sample data)', isDemo: true, emailVerifiedAt: new Date() },
  });
  await prisma.userPreference.create({
    data: {
      userId: user.id,
      timezone: TIMEZONE,
      dayStartMinute: 480,
      dayEndMinute: 1320,
      bufferMinutes: 10,
      minSlotMinutes: 15,
      deepWorkMinMinutes: 50,
      dailyFocusGoalMinutes: 240,
      breakAfterMinutes: 90,
      focusPeakStartMinute: 570,
      focusPeakEndMinute: 690,
      onboardingCompletedAt: new Date(),
    },
  });
  await prisma.activityCategory.createMany({ data: DEFAULT_CATEGORIES.map((c, position) => ({ ...c, userId: user.id, position })) });
  const categories = Object.fromEntries((await prisma.activityCategory.findMany({ where: { userId: user.id } })).map((c) => [c.key, c.id]));
  const schedule = await prisma.schedule.create({ data: { userId: user.id, name: 'My routine' } });

  // Weekly availability: Sunday–Thursday style is user specific; here Mon–Fri 08:00–18:00 with a blocked lunch hour.
  await prisma.userAvailability.createMany({
    data: [
      ...WEEKDAYS.map((weekday) => ({ userId: user.id, weekday, startMinute: 480, endMinute: 1080, kind: 'AVAILABLE' as const })),
      ...WEEKDAYS.map((weekday) => ({ userId: user.id, weekday, startMinute: 750, endMinute: 810, kind: 'BLOCKED' as const, label: 'Lunch' })),
      ...[6, 7].map((weekday) => ({ userId: user.id, weekday, startMinute: 600, endMinute: 1320, kind: 'AVAILABLE' as const })),
    ],
  });

  // ── recurring commitments ──────────────────────────────────────────────────
  const firstDate = addDays(today, -HISTORY_DAYS);
  const standupRule = await prisma.recurrenceRule.create({ data: { userId: user.id, frequency: 'WEEKLY', byWeekday: WEEKDAYS, startDate: localDateToDateColumn(firstDate) } });
  const gymRule = await prisma.recurrenceRule.create({ data: { userId: user.id, frequency: 'WEEKLY', byWeekday: [1, 3, 5], startDate: localDateToDateColumn(firstDate) } });
  const standup = await prisma.scheduleEvent.create({
    data: { scheduleId: schedule.id, userId: user.id, categoryId: categories.meetings!, recurrenceRuleId: standupRule.id, title: 'Daily stand-up', startMinute: 540, durationMin: 15, isFixed: true },
  });
  const gym = await prisma.scheduleEvent.create({
    data: { scheduleId: schedule.id, userId: user.id, categoryId: categories.exercise!, recurrenceRuleId: gymRule.id, title: 'Gym', startMinute: 1050, durationMin: 60, isFixed: false },
  });
  const eventFor = { standup, gym } as const;

  // ── plans and tracked history ──────────────────────────────────────────────
  const activities: Prisma.ActivityCreateManyInput[] = [];
  const sessions: { id: string; userId: string; activityId: string; status: 'STOPPED'; source: 'TIMER'; startedAt: Date; endedAt: Date; durationSec: number; pauseCount: number }[] = [];
  const segments: { id: string; sessionId: string; userId: string; startedAt: Date; endedAt: Date }[] = [];

  for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset++) {
    const date = addDays(today, offset);
    const weekday = isoWeekday(date);
    const daySlots = SLOTS.filter((s) => s.days.includes(weekday)).sort((a, b) => a.start - b.start);
    // A real person is off now and then.
    const dayOff = offset < 0 && chance(0.06);

    daySlots.forEach((slot, i) => {
      const start = localMinuteToInstant(date, slot.start, TIMEZONE);
      const end = start + slot.durationMin * MIN;
      const isPast = end <= now;
      const nextStart = daySlots[i + 1] ? localMinuteToInstant(date, daySlots[i + 1]!.start, TIMEZONE) : localMinuteToInstant(date, 1410, TIMEZONE);
      const recurringEvent = slot.recurring ? eventFor[slot.recurring] : null;
      // Future recurring occurrences stay virtual (expanded from the rule on demand).
      if (recurringEvent && !isPast) return;

      const id = randomUUID();
      const tracked = isPast && !dayOff && chance(slot.trackProb);
      let status: 'PLANNED' | 'COMPLETED' | 'SKIPPED' = 'PLANNED';
      let actualSec = 0;
      let completedAt: Date | null = null;

      if (tracked) {
        const delay = Math.floor(between(0, slot.fixed ? 4 : 14));
        const factor = between(slot.overrun[0], slot.overrun[1]);
        const trackStart = start + delay * MIN;
        const trackEnd = Math.min(nextStart - 3 * MIN, trackStart + Math.max(10, Math.round(slot.durationMin * factor)) * MIN, now - MIN);
        if (trackEnd - trackStart >= 10 * MIN) {
          const interrupted = slot.focus === 'VERY_HIGH' && chance(0.4);
          const pieces: [number, number][] = [];
          if (interrupted && trackEnd - trackStart > 60 * MIN) {
            const cut = trackStart + Math.floor((trackEnd - trackStart) * between(0.35, 0.6));
            const pause = Math.round(between(6, 14)) * MIN;
            pieces.push([trackStart, cut], [cut + pause, trackEnd]);
          } else {
            pieces.push([trackStart, trackEnd]);
          }
          const sessionId = randomUUID();
          const durationMs = pieces.reduce((s, [a, b]) => s + (b - a), 0);
          actualSec = Math.floor(durationMs / 1000);
          sessions.push({ id: sessionId, userId: user.id, activityId: id, status: 'STOPPED', source: 'TIMER', startedAt: toDate(pieces[0]![0]), endedAt: toDate(pieces[pieces.length - 1]![1]), durationSec: actualSec, pauseCount: pieces.length - 1 });
          for (const [a, b] of pieces) segments.push({ id: randomUUID(), sessionId, userId: user.id, startedAt: toDate(a), endedAt: toDate(b) });
          status = 'COMPLETED';
          completedAt = toDate(pieces[pieces.length - 1]![1]);
        }
      } else if (isPast && chance(0.35)) {
        status = 'SKIPPED';
      }

      activities.push({
        id,
        userId: user.id,
        categoryId: categories[slot.category]!,
        title: slot.title,
        plannedStart: toDate(start),
        plannedEnd: toDate(end),
        estimatedDurationSec: slot.durationMin * 60,
        actualDurationSec: actualSec,
        priority: slot.priority,
        energyRequired: slot.energy,
        focusRequired: slot.focus,
        status,
        isFixed: Boolean(slot.fixed),
        tags: slot.tags ?? [],
        scheduleEventId: recurringEvent?.id ?? null,
        occurrenceDate: recurringEvent ? localDateToDateColumn(date) : null,
        rescheduleCount: !isPast && chance(0.1) ? 3 : chance(0.04) ? 2 : 0,
        completedAt,
      });
    });

    // A short unplanned gap now and then between tracked blocks happens on its own from the jitter above;
    // ad-hoc quick-started activities add the untracked/unplanned flavour of real data.
    if (offset < 0 && !dayOff && weekday <= 5 && chance(0.3)) {
      const id = randomUUID();
      const s = localMinuteToInstant(date, 1130 + Math.floor(between(0, 20)), TIMEZONE);
      const e = s + Math.round(between(10, 25)) * MIN;
      const sessionId = randomUUID();
      const sec = Math.floor((e - s) / 1000);
      activities.push({ id, userId: user.id, categoryId: categories.other!, title: 'Quick call', actualDurationSec: sec, status: 'COMPLETED', completedAt: toDate(e), tags: [] });
      sessions.push({ id: sessionId, userId: user.id, activityId: id, status: 'STOPPED', source: 'TIMER', startedAt: toDate(s), endedAt: toDate(e), durationSec: sec, pauseCount: 0 });
      segments.push({ id: randomUUID(), sessionId, userId: user.id, startedAt: toDate(s), endedAt: toDate(e) });
    }
  }

  // ── tasks ──────────────────────────────────────────────────────────────────
  interface TaskSeed {
    key: string;
    title: string;
    minutes: number;
    priority: Priority;
    category: string;
    energy: Level;
    focus: Level;
    complexity: number;
    status: TaskStatus;
    deadlineHours?: number;
    preferred?: TimeOfDay;
    tags?: string[];
    dependsOn?: string[];
    subtasks?: string[];
  }
  const OPEN: TaskSeed[] = [
    { key: 'metrics', title: 'Collect Q3 metrics', minutes: 45, priority: 'HIGH', category: 'work', energy: 'MODERATE', focus: 'MODERATE', complexity: 2, status: 'TODO', deadlineHours: 26 },
    { key: 'report', title: 'Prepare Q3 board report', minutes: 120, priority: 'HIGH', category: 'work', energy: 'HIGH', focus: 'VERY_HIGH', complexity: 4, status: 'TODO', deadlineHours: 52, preferred: 'MORNING', dependsOn: ['metrics'], subtasks: ['Outline the narrative', 'Draft charts', 'Write executive summary'] },
    { key: 'prs', title: 'Review pull requests', minutes: 30, priority: 'MEDIUM', category: 'work', energy: 'MODERATE', focus: 'MODERATE', complexity: 2, status: 'TODO', deadlineHours: 6 },
    { key: 'emails', title: 'Reply to client emails', minutes: 20, priority: 'LOW', category: 'work', energy: 'LOW', focus: 'LOW', complexity: 1, status: 'TODO', preferred: 'AFTERNOON' },
    { key: 'sprint', title: 'Plan next sprint', minutes: 60, priority: 'MEDIUM', category: 'work', energy: 'MODERATE', focus: 'HIGH', complexity: 3, status: 'IN_PROGRESS', deadlineHours: 76, preferred: 'MORNING' },
    { key: 'docs', title: 'Update documentation', minutes: 90, priority: 'LOW', category: 'work', energy: 'LOW', focus: 'MODERATE', complexity: 2, status: 'BACKLOG', tags: ['docs'] },
    { key: 'dentist', title: 'Book dentist appointment', minutes: 10, priority: 'LOW', category: 'personal', energy: 'LOW', focus: 'LOW', complexity: 1, status: 'TODO', deadlineHours: 120 },
    { key: 'generics', title: 'Study TypeScript generics chapter', minutes: 50, priority: 'MEDIUM', category: 'learning', energy: 'MODERATE', focus: 'HIGH', complexity: 3, status: 'TODO', deadlineHours: 100, tags: ['study'] },
    { key: 'refactor', title: 'Refactor authentication module', minutes: 180, priority: 'MEDIUM', category: 'work', energy: 'HIGH', focus: 'VERY_HIGH', complexity: 5, status: 'BACKLOG' },
    { key: 'slides', title: 'Prepare workshop slides', minutes: 90, priority: 'HIGH', category: 'work', energy: 'MODERATE', focus: 'HIGH', complexity: 3, status: 'TODO', deadlineHours: 118 },
    { key: 'expense', title: 'Submit expense report', minutes: 20, priority: 'MEDIUM', category: 'other', energy: 'LOW', focus: 'LOW', complexity: 1, status: 'TODO', deadlineHours: -20 },
  ];
  const taskIds: Record<string, string> = {};
  for (const t of OPEN) {
    const created = await prisma.task.create({
      data: {
        userId: user.id,
        title: t.title,
        estimatedDurationSec: t.minutes * 60,
        priority: t.priority,
        categoryId: categories[t.category]!,
        energyRequired: t.energy,
        focusRequired: t.focus,
        complexity: t.complexity,
        status: t.status,
        deadline: t.deadlineHours === undefined ? null : toDate(now + t.deadlineHours * 3_600_000),
        preferredTimeOfDay: t.preferred ?? 'ANY',
        tags: t.tags ?? [],
        subtasks: t.subtasks ? { create: t.subtasks.map((title, position) => ({ title, position, isDone: position === 0 })) } : undefined,
      },
    });
    taskIds[t.key] = created.id;
  }
  for (const t of OPEN) {
    for (const dep of t.dependsOn ?? []) await prisma.taskDependency.create({ data: { taskId: taskIds[t.key]!, dependsOnId: taskIds[dep]! } });
  }
  const reviewRule = await prisma.recurrenceRule.create({ data: { userId: user.id, frequency: 'WEEKLY', byWeekday: [5], startDate: localDateToDateColumn(addDays(today, -HISTORY_DAYS)) } });
  await prisma.task.create({
    data: { userId: user.id, title: 'Weekly review', estimatedDurationSec: 1800, priority: 'MEDIUM', categoryId: categories.work!, energyRequired: 'LOW', focusRequired: 'MODERATE', status: 'TODO', recurrenceRuleId: reviewRule.id, occurrenceDate: localDateToDateColumn(addDays(today, ((5 - isoWeekday(today) + 7) % 7) || 7)), preferredTimeOfDay: 'AFTERNOON', tags: ['routine'] },
  });

  // Completed tasks with tracked work: they feed task-completion and estimate-accuracy analytics.
  const DONE = ['Fix login redirect bug', 'Write onboarding email copy', 'Set up CI pipeline', 'Design settings page', 'Migrate database indexes', 'Prepare sprint demo', 'Triage support tickets', 'Update API client'];
  let doneIdx = 0;
  for (let offset = -HISTORY_DAYS + 2; offset < 0 && doneIdx < DONE.length; offset += 5) {
    const date = addDays(today, offset);
    if (isoWeekday(date) > 5) continue;
    const title = DONE[doneIdx++]!;
    const plannedMin = [45, 60, 90, 60, 75, 60, 45, 60][doneIdx - 1]!;
    const actualMin = Math.round(plannedMin * between(1.2, 1.55)); // this person underestimates work by about 35%
    const start = localMinuteToInstant(date, 975, TIMEZONE); // 16:15
    const trackEnd = start + actualMin * MIN;
    const taskId = randomUUID();
    const activityId = randomUUID();
    const sessionId = randomUUID();
    await prisma.task.create({
      data: { id: taskId, userId: user.id, title, estimatedDurationSec: plannedMin * 60, priority: chance(0.4) ? 'HIGH' : 'MEDIUM', categoryId: categories.work!, energyRequired: 'MODERATE', focusRequired: 'MODERATE', status: 'COMPLETED', completedAt: toDate(trackEnd), createdAt: toDate(start - 3 * 86_400_000) },
    });
    activities.push({ id: activityId, userId: user.id, taskId, categoryId: categories.work!, title, plannedStart: toDate(start), plannedEnd: toDate(start + plannedMin * MIN), estimatedDurationSec: plannedMin * 60, actualDurationSec: actualMin * 60, status: 'COMPLETED', completedAt: toDate(trackEnd), tags: [] });
    sessions.push({ id: sessionId, userId: user.id, activityId, status: 'STOPPED', source: 'TIMER', startedAt: toDate(start), endedAt: toDate(trackEnd), durationSec: actualMin * 60, pauseCount: 0 });
    segments.push({ id: randomUUID(), sessionId, userId: user.id, startedAt: toDate(start), endedAt: toDate(trackEnd) });
  }

  await prisma.activity.createMany({ data: activities });
  await prisma.activitySession.createMany({ data: sessions });
  await prisma.sessionSegment.createMany({ data: segments });

  // ── energy check-ins: a morning-peak pattern with day-to-day noise ───────────
  const logs: { userId: string; recordedAt: Date; energy: Level; focus: Level }[] = [];
  const LEVELS: Level[] = ['VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'];
  const level = (v: number) => LEVELS[Math.min(4, Math.max(0, Math.round(v) - 1))]!;
  const HOURS: [number, number][] = [[9, 4.2], [11, 4.4], [14, 2.8], [16, 3.0], [20, 2.3]];
  for (let offset = -HISTORY_DAYS; offset < 0; offset++) {
    const date = addDays(today, offset);
    if (chance(0.15)) continue;
    for (const [hour, mean] of HOURS) {
      if (chance(0.25)) continue;
      const at = localMinuteToInstant(date, hour * 60 + Math.floor(between(0, 25)), TIMEZONE);
      logs.push({ userId: user.id, recordedAt: toDate(at), energy: level(mean + between(-1, 1)), focus: level(mean + between(-1.2, 0.8)) });
    }
  }
  await prisma.energyLog.createMany({ data: logs });

  await prisma.auditLog.create({ data: { userId: user.id, actor: 'system', action: 'demo.seeded', entityType: 'User', entityId: user.id, metadata: { sessions: sessions.length, activities: activities.length, tasks: OPEN.length + DONE.length + 1, energyLogs: logs.length } } });

  console.log(`Seeded demo data (isDemo = true)
  account   ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}
  timezone  ${TIMEZONE}
  history   ${HISTORY_DAYS} days  |  ${activities.length} activities, ${sessions.length} tracked sessions, ${logs.length} energy check-ins
  tasks     ${OPEN.length + DONE.length + 1} (${DONE.length} completed, 1 recurring, 1 dependency chain, 1 overdue)`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
