import { expandOccurrences, occurrenceDates, RecurrenceSpec } from '@/modules/availability/domain/recurrence';
import { minuteOfLocalDay } from '@/common/time/time';
import { DateTime } from 'luxon';

const rule = (over: Partial<RecurrenceSpec>): RecurrenceSpec => ({
  frequency: 'DAILY',
  interval: 1,
  byWeekday: [],
  byMonthDay: null,
  startDate: '2026-03-02', // a Monday
  untilDate: null,
  count: null,
  exDates: [],
  ...over,
});

describe('recurrence', () => {
  describe('occurrenceDates', () => {
    it('daily with an interval', () => {
      expect(occurrenceDates(rule({ interval: 3 }), '2026-03-02', '2026-03-12')).toEqual(['2026-03-02', '2026-03-05', '2026-03-08', '2026-03-11']);
    });

    it('weekly on chosen weekdays', () => {
      expect(occurrenceDates(rule({ frequency: 'WEEKLY', byWeekday: [1, 3, 5] }), '2026-03-02', '2026-03-13')).toEqual([
        '2026-03-02', '2026-03-04', '2026-03-06', '2026-03-09', '2026-03-11', '2026-03-13',
      ]);
    });

    it('weekly defaults to the weekday of the start date and honours a 2-week interval', () => {
      expect(occurrenceDates(rule({ frequency: 'WEEKLY', interval: 2 }), '2026-03-01', '2026-04-05')).toEqual(['2026-03-02', '2026-03-16', '2026-03-30']);
    });

    it('does not produce occurrences before the start date even for an early window', () => {
      expect(occurrenceDates(rule({ startDate: '2026-03-10' }), '2026-03-01', '2026-03-12')).toEqual(['2026-03-10', '2026-03-11', '2026-03-12']);
    });

    it('monthly clamps to the month length (31st → Feb 28) and returns to 31 afterwards', () => {
      const r = rule({ frequency: 'MONTHLY', startDate: '2026-01-31', byMonthDay: 31 });
      expect(occurrenceDates(r, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    });

    it('stops at the until date (inclusive)', () => {
      expect(occurrenceDates(rule({ untilDate: '2026-03-04' }), '2026-03-01', '2026-03-31')).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    });

    it('count limits the whole series, counted before exclusions, regardless of the query window', () => {
      const r = rule({ count: 4, exDates: ['2026-03-03'] });
      expect(occurrenceDates(r, '2026-03-01', '2026-03-31')).toEqual(['2026-03-02', '2026-03-04', '2026-03-05']);
      // a late window sees nothing because the series already ended
      expect(occurrenceDates(r, '2026-03-20', '2026-03-31')).toEqual([]);
    });

    it('skips excluded dates', () => {
      expect(occurrenceDates(rule({ exDates: ['2026-03-03'] }), '2026-03-02', '2026-03-04')).toEqual(['2026-03-02', '2026-03-04']);
    });

    it('jumps ahead efficiently for far-future windows (no count)', () => {
      const out = occurrenceDates(rule({ startDate: '2020-01-01' }), '2026-03-02', '2026-03-03');
      expect(out).toEqual(['2026-03-02', '2026-03-03']);
    });
  });

  describe('expandOccurrences', () => {
    const tz = 'Europe/Paris';
    const event = (over: Partial<{ startMinute: number; durationMin: number }> = {}) => ({
      id: 'standup',
      startMinute: 540,
      durationMin: 30,
      rule: rule({ startDate: '2026-03-27' }),
      ...over,
    });
    const range = (from: string, to: string) => ({
      start: DateTime.fromISO(from, { zone: tz }).startOf('day').toMillis(),
      end: DateTime.fromISO(to, { zone: tz }).endOf('day').toMillis(),
    });

    it('stays at the same local time across a daylight-saving change', () => {
      const occ = expandOccurrences(event(), range('2026-03-27', '2026-03-31'), tz);
      expect(occ.map((o) => o.date)).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
      expect(occ.every((o) => minuteOfLocalDay(o.start, tz) === 540)).toBe(true);
      // UTC hour moves from 08:00Z (CET) to 07:00Z (CEST)
      expect(new Date(occ[1]!.start).getUTCHours()).toBe(8);
      expect(new Date(occ[3]!.start).getUTCHours()).toBe(7);
    });

    it('gives a fixed real-time duration', () => {
      const [o] = expandOccurrences(event({ durationMin: 90 }), range('2026-03-27', '2026-03-27'), tz);
      expect(o!.end - o!.start).toBe(90 * 60_000);
    });

    it('includes an occurrence that began the previous evening and crosses midnight into the range', () => {
      const night = event({ startMinute: 23 * 60 + 30, durationMin: 120, rule: rule({ startDate: '2026-03-27' }) } as never);
      const occ = expandOccurrences(night, range('2026-03-28', '2026-03-28'), tz);
      expect(occ.map((o) => o.date)).toContain('2026-03-27');
      const first = occ.find((o) => o.date === '2026-03-27')!;
      expect(DateTime.fromMillis(first.end, { zone: tz }).toFormat('yyyy-LL-dd HH:mm')).toBe('2026-03-28 01:30');
    });

    it('returns nothing for a series that has not started', () => {
      expect(expandOccurrences(event({ }), range('2026-03-01', '2026-03-10'), tz)).toEqual([]);
    });
  });
});
