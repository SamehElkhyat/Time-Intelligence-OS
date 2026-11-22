import { DateTime } from 'luxon';
import {
  addDays,
  diffDays,
  eachLocalDate,
  isoWeekday,
  isValidTimezone,
  localDatesInRange,
  localDayRange,
  localMinuteToInstant,
  minuteOfLocalDay,
  startOfWeek,
  toLocalDate,
  wholeSeconds,
} from '@/common/time/time';

const HOUR = 3_600_000;

describe('time helpers', () => {
  it('validates IANA zones', () => {
    expect(isValidTimezone('Africa/Cairo')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });

  describe('local day length (daylight saving)', () => {
    it('is 23h on the spring-forward day in Paris', () => {
      const r = localDayRange('2026-03-29', 'Europe/Paris');
      expect((r.end - r.start) / HOUR).toBe(23);
    });
    it('is 25h on the fall-back day in New York', () => {
      const r = localDayRange('2026-11-01', 'America/New_York');
      expect((r.end - r.start) / HOUR).toBe(25);
    });
    it('is 24h on an ordinary day and for zones without DST', () => {
      expect((localDayRange('2026-06-10', 'Europe/Paris').end - localDayRange('2026-06-10', 'Europe/Paris').start) / HOUR).toBe(24);
      expect((localDayRange('2026-03-29', 'Asia/Tokyo').end - localDayRange('2026-03-29', 'Asia/Tokyo').start) / HOUR).toBe(24);
    });
    it('consecutive local days tile the timeline with no gap or overlap', () => {
      const a = localDayRange('2026-03-28', 'Europe/Paris');
      const b = localDayRange('2026-03-29', 'Europe/Paris');
      const c = localDayRange('2026-03-30', 'Europe/Paris');
      expect(a.end).toBe(b.start);
      expect(b.end).toBe(c.start);
    });
  });

  describe('localMinuteToInstant', () => {
    it('keeps the same wall-clock time across a DST change', () => {
      const before = localMinuteToInstant('2026-03-28', 9 * 60, 'Europe/Paris');
      const after = localMinuteToInstant('2026-03-30', 9 * 60, 'Europe/Paris');
      expect(minuteOfLocalDay(before, 'Europe/Paris')).toBe(540);
      expect(minuteOfLocalDay(after, 'Europe/Paris')).toBe(540);
      // …while the UTC instant shifted by an hour
      expect(DateTime.fromMillis(before, { zone: 'utc' }).hour).toBe(8);
      expect(DateTime.fromMillis(after, { zone: 'utc' }).hour).toBe(7);
    });
    it('moves a non-existent local time (spring-forward gap) to the first valid instant after the gap', () => {
      // 02:30 does not exist in Paris on 2026-03-29
      const t = localMinuteToInstant('2026-03-29', 150, 'Europe/Paris');
      expect(DateTime.fromMillis(t, { zone: 'Europe/Paris' }).toFormat('HH:mm')).toBe('03:30');
    });
    it('resolves an ambiguous local time (fall-back overlap) to the earlier occurrence', () => {
      const t = localMinuteToInstant('2026-10-25', 150, 'Europe/Paris'); // 02:30 happens twice
      const dt = DateTime.fromMillis(t, { zone: 'Europe/Paris' });
      expect(dt.toFormat('HH:mm')).toBe('02:30');
      expect(dt.offset).toBe(120); // CEST (+02:00), the first occurrence
    });
    it('addresses the following day with minute >= 1440', () => {
      const t = localMinuteToInstant('2026-03-01', 1440 + 90, 'UTC');
      expect(new Date(t).toISOString()).toBe('2026-03-02T01:30:00.000Z');
    });
  });

  describe('local dates', () => {
    it('maps an instant to the user\'s local date, not the UTC date', () => {
      const instant = Date.UTC(2026, 2, 1, 22, 30); // 22:30Z
      expect(toLocalDate(instant, 'UTC')).toBe('2026-03-01');
      expect(toLocalDate(instant, 'Africa/Cairo')).toBe('2026-03-02'); // UTC+2 -> 00:30 next day
      expect(toLocalDate(instant, 'America/Los_Angeles')).toBe('2026-03-01');
    });
    it('does date arithmetic without timezone drift', () => {
      expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
      expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
      expect(eachLocalDate('2026-03-30', '2026-04-02')).toEqual(['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02']);
    });
    it('computes weekday and configurable week start', () => {
      expect(isoWeekday('2026-03-02')).toBe(1); // Monday
      expect(startOfWeek('2026-03-04', 1)).toBe('2026-03-02');
      expect(startOfWeek('2026-03-04', 7)).toBe('2026-03-01'); // Sunday start
      expect(startOfWeek('2026-03-01', 1)).toBe('2026-02-23');
    });
    it('lists every local date an interval touches, including past midnight', () => {
      const start = Date.UTC(2026, 2, 1, 21, 0); // 23:00 in Cairo on Mar 1
      const end = Date.UTC(2026, 2, 1, 23, 0); // 01:00 in Cairo on Mar 2
      expect(localDatesInRange('Africa/Cairo', start, end)).toEqual(['2026-03-01', '2026-03-02']);
    });
  });

  it('floors durations to whole seconds', () => {
    expect(wholeSeconds(1999)).toBe(1);
    expect(wholeSeconds(2000)).toBe(2);
  });
});
