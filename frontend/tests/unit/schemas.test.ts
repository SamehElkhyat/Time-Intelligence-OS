import { describe, expect, it } from 'vitest';
import { activitySchema } from '@/features/activities/activity-form';
import { changePasswordSchema, forgotSchema, loginSchema, registerSchema, resetSchema, safeNext } from '@/features/auth/schemas';
import { preferencesSchema, toFormValues, toPayload } from '@/features/settings/preferences-form';
import { taskSchema } from '@/features/tasks/task-form';
import { correctionSchema, manualSchema } from '@/features/time-tracking/entry-dialogs';
import { quickStartSchema } from '@/features/time-tracking/time-tracking-view';

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? [] : r.error!.issues.map((i) => i.message));

describe('auth schemas', () => {
  it('login requires a valid email and a password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(messages(loginSchema.safeParse({ email: '', password: '' }))).toEqual(expect.arrayContaining(['Enter your email address', 'Enter your password']));
    expect(messages(loginSchema.safeParse({ email: 'nope', password: 'x' }))).toContain('Enter a valid email address');
  });

  it('register enforces the same password length as the API', () => {
    const ok = { displayName: 'Ana', email: 'ana@example.com', password: '1234567890' };
    expect(registerSchema.safeParse(ok).success).toBe(true);
    expect(messages(registerSchema.safeParse({ ...ok, password: '123456789' }))).toContain('Use at least 10 characters');
    expect(messages(registerSchema.safeParse({ ...ok, displayName: '   ' }))).toContain('Tell us what to call you');
    expect(registerSchema.safeParse({ ...ok, email: '  ana@example.com ' }).data?.email).toBe('ana@example.com'); // trimmed
  });

  it('password reset and change check confirmation and reuse', () => {
    expect(messages(resetSchema.safeParse({ newPassword: '1234567890', confirm: '1234567891' }))).toContain('Passwords do not match');
    expect(changePasswordSchema.safeParse({ currentPassword: 'old-password!', newPassword: 'brand-new-pass', confirm: 'brand-new-pass' }).success).toBe(true);
    expect(messages(changePasswordSchema.safeParse({ currentPassword: 'same-password', newPassword: 'same-password', confirm: 'same-password' }))).toContain('Choose a different password');
    expect(forgotSchema.safeParse({ email: 'x' }).success).toBe(false);
  });
});

describe('safeNext (open-redirect protection)', () => {
  it.each([
    ['/tasks', '/tasks'],
    ['/tasks?due=today', '/tasks?due=today'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
  ])('%s → %s', (input, out) => expect(safeNext(input)).toBe(out));
});

describe('activity schema', () => {
  const base = { title: 'Write', categoryId: 'c1', priority: 'MEDIUM', energyRequired: 'MODERATE', focusRequired: 'MODERATE', isFixed: false } as const;
  it('accepts an unscheduled activity and a valid range', () => {
    expect(activitySchema.safeParse(base).success).toBe(true);
    expect(activitySchema.safeParse({ ...base, plannedStart: '2026-03-02T09:00', plannedEnd: '2026-03-02T10:00' }).success).toBe(true);
  });
  it('requires both ends of the range, a positive length and at most 24 hours', () => {
    expect(messages(activitySchema.safeParse({ ...base, plannedStart: '2026-03-02T09:00' }))).toContain('Set both a start and an end, or neither');
    expect(messages(activitySchema.safeParse({ ...base, plannedStart: '2026-03-02T10:00', plannedEnd: '2026-03-02T09:00' }))).toContain('The end must be after the start');
    expect(messages(activitySchema.safeParse({ ...base, plannedStart: '2026-03-02T10:00', plannedEnd: '2026-03-03T11:00' }))).toContain('An activity can be at most 24 hours long');
  });
  it('validates the estimate and the title', () => {
    expect(messages(activitySchema.safeParse({ ...base, estimatedMin: '0' }))).toContain('Enter 1 to 1440 minutes');
    expect(messages(activitySchema.safeParse({ ...base, estimatedMin: '12.5' }))).toContain('Enter 1 to 1440 minutes');
    expect(messages(activitySchema.safeParse({ ...base, title: '   ' }))).toContain('Give the activity a title');
  });
});

describe('task schema', () => {
  const base = { title: 'Report', estimatedMin: '30', priority: 'HIGH', energyRequired: 'HIGH', focusRequired: 'HIGH', complexity: '3', status: 'TODO', preferredTimeOfDay: 'ANY', dependsOnIds: [], recurrence: 'NONE', byWeekday: [] } as const;
  it('accepts a normal task', () => expect(taskSchema.safeParse(base).success).toBe(true));
  it('requires a whole-minute estimate within a day', () => {
    expect(messages(taskSchema.safeParse({ ...base, estimatedMin: 'abc' }))).toContain('Enter whole minutes');
    expect(messages(taskSchema.safeParse({ ...base, estimatedMin: '2000' }))).toContain('Enter 1 to 1440 minutes');
  });
  it('weekly recurrence needs at least one weekday', () => {
    expect(messages(taskSchema.safeParse({ ...base, recurrence: 'WEEKLY' }))).toContain('Pick at least one weekday');
    expect(taskSchema.safeParse({ ...base, recurrence: 'WEEKLY', byWeekday: ['1', '3'] }).success).toBe(true);
  });
});

describe('time-entry schemas', () => {
  it('manual entries need an activity, ordered times and at most 24h', () => {
    const ok = { activityId: 'a', startedAt: '2026-03-02T09:00', endedAt: '2026-03-02T10:00' };
    expect(manualSchema.safeParse(ok).success).toBe(true);
    expect(messages(manualSchema.safeParse({ ...ok, activityId: '' }))).toContain('Choose an activity');
    expect(messages(manualSchema.safeParse({ ...ok, endedAt: '2026-03-02T08:00' }))).toContain('The end must be after the start');
    expect(messages(manualSchema.safeParse({ ...ok, endedAt: '2026-03-03T10:00' }))).toContain('An entry can be at most 24 hours');
  });
  it('corrections must explain themselves', () => {
    const ok = { startedAt: '2026-03-02T09:00', endedAt: '2026-03-02T10:00', reason: 'left early' };
    expect(correctionSchema.safeParse(ok).success).toBe(true);
    expect(messages(correctionSchema.safeParse({ ...ok, reason: 'x' }))).toEqual(expect.arrayContaining([expect.stringContaining('at least 3')]));
  });
  it('quick start needs a title and a category', () => {
    expect(quickStartSchema.safeParse({ title: 'Review', categoryId: 'c' }).success).toBe(true);
    expect(quickStartSchema.safeParse({ title: ' ', categoryId: 'c' }).success).toBe(false);
    expect(quickStartSchema.safeParse({ title: 'x', categoryId: '' }).success).toBe(false);
  });
});

describe('preferences schema', () => {
  const prefs = { timezone: 'Africa/Cairo', locale: 'en-US', weekStartsOn: 1, use24HourClock: true, dayStartMinute: 420, dayEndMinute: 1380, bufferMinutes: 10, minSlotMinutes: 15, deepWorkMinMinutes: 50, dailyFocusGoalMinutes: 240, breakAfterMinutes: 90, focusPeakStartMinute: null, focusPeakEndMinute: null, notifyActivityReminders: true, notifyDeadlines: true, notifyWeeklyReport: true, reminderLeadMinutes: 10, onboardingCompleted: true };

  it('round-trips between the API shape and the form', () => {
    const form = toFormValues(prefs);
    expect(preferencesSchema.safeParse(form).success).toBe(true);
    expect(toPayload(form)).toMatchObject({ dayStartMinute: 420, dayEndMinute: 1380, dailyFocusGoalMinutes: 240, focusPeakStartMinute: null, focusPeakEndMinute: null });
  });
  it('converts a fractional focus goal to whole minutes', () => {
    expect(toPayload({ ...toFormValues(prefs), dailyFocusGoalHours: '3.5' }).dailyFocusGoalMinutes).toBe(210);
  });
  it('validates cross-field rules', () => {
    const form = toFormValues(prefs);
    expect(messages(preferencesSchema.safeParse({ ...form, dayStart: '22:00', dayEnd: '08:00' }))).toContain('Your day must end after it starts');
    expect(messages(preferencesSchema.safeParse({ ...form, focusStart: '09:00', focusEnd: '' }))).toContain('Set both ends of the focus window, or neither');
    expect(messages(preferencesSchema.safeParse({ ...form, focusStart: '12:00', focusEnd: '09:00' }))).toContain('The focus window must end after it starts');
    expect(preferencesSchema.safeParse({ ...form, focusStart: '09:00', focusEnd: '12:00' }).success).toBe(true);
  });
});
