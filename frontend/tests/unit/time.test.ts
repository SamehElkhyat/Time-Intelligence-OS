import { describe, expect, it } from 'vitest';
import { addDays, fmtClock, fmtDuration, fmtTime, fromLocalInput, fromNow, localDateOf, minuteOfDay, relativeDay, startOfWeek, toLocalInput, todayIn } from '@/lib/time';

describe('fmtDuration', () => {
  it.each([
    [0, '0 min'],
    [30, '<1 min'],
    [60, '1 min'],
    [3600, '1h'],
    [3725, '1h 2m'],
    [5400, '1h 30m'],
    [3599, '1h'], // 59m59s rounds up to the hour, not "60m"
    [null, '—'],
    [undefined, '—'],
  ])('%s → %s', (input, out) => expect(fmtDuration(input as number | null)).toBe(out));
});

describe('fmtClock', () => {
  it('formats a stopwatch and never goes negative', () => {
    expect(fmtClock(3725)).toBe('01:02:05');
    expect(fmtClock(59.9)).toBe('00:00:59');
    expect(fmtClock(-5)).toBe('00:00:00');
    expect(fmtClock(100 * 3600)).toBe('100:00:00');
  });
});

describe('time zones — the UI must use the user\'s zone, never the browser\'s', () => {
  const instant = Date.UTC(2026, 2, 1, 22, 30); // 22:30Z

  it('shows the same instant differently per zone', () => {
    expect(fmtTime(instant, 'UTC')).toBe('22:30');
    expect(fmtTime(instant, 'Africa/Cairo')).toBe('00:30');
    expect(fmtTime(instant, 'America/Los_Angeles')).toBe('14:30');
    expect(fmtTime(instant, 'UTC', false)).toBe('10:30 PM');
  });

  it('derives the local calendar date in the user\'s zone', () => {
    expect(localDateOf(new Date(instant).toISOString(), 'UTC')).toBe('2026-03-01');
    expect(localDateOf(new Date(instant).toISOString(), 'Africa/Cairo')).toBe('2026-03-02');
    expect(todayIn('Pacific/Kiritimati', instant)).toBe('2026-03-02'); // UTC+14
  });

  it('round-trips datetime-local values through a zone', () => {
    const iso = fromLocalInput('2026-03-02T09:00', 'Africa/Cairo');
    expect(iso).toBe('2026-03-02T07:00:00.000Z');
    expect(toLocalInput(iso, 'Africa/Cairo')).toBe('2026-03-02T09:00');
  });

  it('keeps wall-clock times across a daylight-saving change', () => {
    const before = fromLocalInput('2026-03-28T09:00', 'Europe/Paris'); // CET, +01:00
    const after = fromLocalInput('2026-03-30T09:00', 'Europe/Paris'); // CEST, +02:00
    expect(new Date(before).getUTCHours()).toBe(8);
    expect(new Date(after).getUTCHours()).toBe(7);
    expect(minuteOfDay(before, 'Europe/Paris')).toBe(540);
    expect(minuteOfDay(after, 'Europe/Paris')).toBe(540);
  });

  it('rejects invalid input instead of producing a wrong instant', () => {
    expect(() => fromLocalInput('not a date', 'UTC')).toThrow();
  });
});

describe('local dates', () => {
  it('does calendar arithmetic without drifting', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('finds the configured start of the week', () => {
    expect(startOfWeek('2026-03-04', 1)).toBe('2026-03-02'); // Monday
    expect(startOfWeek('2026-03-04', 7)).toBe('2026-03-01'); // Sunday
    expect(startOfWeek('2026-03-02', 1)).toBe('2026-03-02');
  });
  it('labels nearby days relatively', () => {
    expect(relativeDay('2026-03-04', '2026-03-04')).toBe('Today');
    expect(relativeDay('2026-03-05', '2026-03-04')).toBe('Tomorrow');
    expect(relativeDay('2026-03-03', '2026-03-04')).toBe('Yesterday');
    expect(relativeDay('2026-03-10', '2026-03-04')).toBe('Tue 10 Mar');
  });
});

describe('fromNow', () => {
  const now = Date.UTC(2026, 2, 1, 12, 0);
  it('describes past and future', () => {
    expect(fromNow(new Date(now + 20 * 60_000), now)).toBe('in 20 min');
    expect(fromNow(new Date(now - 2 * 3_600_000), now)).toBe('2 h ago');
    expect(fromNow(new Date(now + 3 * 86_400_000), now)).toBe('in 3 d');
    expect(fromNow(new Date(now + 10_000), now)).toBe('now');
  });
});
