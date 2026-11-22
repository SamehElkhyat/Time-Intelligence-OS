import { DateTime } from 'luxon';
import { addDays, diffDays, isoWeekday, LocalDate, localMinuteToInstant, MS_PER_MINUTE } from '@/common/time/time';
import { Interval } from '@/common/time/intervals';

export interface RecurrenceSpec {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  /** Every N days / weeks / months (>= 1). */
  interval: number;
  /** ISO weekdays 1..7 (WEEKLY). Empty = weekday of startDate. */
  byWeekday: number[];
  /** Day of month (MONTHLY). Null = day of startDate. Clamped to the month length. */
  byMonthDay: number | null;
  startDate: LocalDate;
  untilDate: LocalDate | null;
  /** Total number of occurrences in the series, counted before exclusions (RFC 5545 semantics). */
  count: number | null;
  exDates: LocalDate[];
}

const MAX_ITERATIONS = 20_000;

/**
 * Local dates on which a rule occurs within [from, to] (inclusive), in ascending order.
 * Works purely on calendar dates, so it is independent of timezone and DST.
 */
export function occurrenceDates(rule: RecurrenceSpec, from: LocalDate, to: LocalDate): LocalDate[] {
  const interval = Math.max(1, Math.floor(rule.interval));
  const lastDate = rule.untilDate && rule.untilDate < to ? rule.untilDate : to;
  if (lastDate < rule.startDate || lastDate < from) return [];
  const excluded = new Set(rule.exDates);
  const out: LocalDate[] = [];
  let produced = 0;

  /** Returns false when iteration must stop. */
  const emit = (date: LocalDate): boolean => {
    if (date < rule.startDate) return true;
    if (date > lastDate) return false;
    if (rule.count !== null && produced >= rule.count) return false;
    produced++;
    if (date >= from && !excluded.has(date)) out.push(date);
    return true;
  };

  // When the series is not count-limited we can jump close to `from` instead of walking from the start.
  const canSkip = rule.count === null;

  if (rule.frequency === 'DAILY') {
    let k = canSkip ? Math.max(0, Math.floor(diffDays(rule.startDate, from) / interval)) : 0;
    for (let i = 0; i < MAX_ITERATIONS; i++, k++) {
      if (!emit(addDays(rule.startDate, k * interval))) break;
    }
    return out;
  }

  if (rule.frequency === 'WEEKLY') {
    const weekdays = [...new Set(rule.byWeekday.length ? rule.byWeekday : [isoWeekday(rule.startDate)])]
      .filter((d) => d >= 1 && d <= 7)
      .sort((a, b) => a - b);
    const firstMonday = addDays(rule.startDate, -(isoWeekday(rule.startDate) - 1));
    let w = canSkip ? Math.max(0, Math.floor(diffDays(firstMonday, from) / 7 / interval)) : 0;
    outer: for (let i = 0; i < MAX_ITERATIONS; i++, w++) {
      const monday = addDays(firstMonday, w * interval * 7);
      for (const wd of weekdays) {
        if (!emit(addDays(monday, wd - 1))) break outer;
      }
    }
    return out;
  }

  // MONTHLY
  const start = DateTime.fromISO(rule.startDate, { zone: 'utc' });
  const day = rule.byMonthDay ?? start.day;
  const fromDt = DateTime.fromISO(from, { zone: 'utc' });
  const monthsToFrom = (fromDt.year - start.year) * 12 + (fromDt.month - start.month);
  let m = canSkip ? Math.max(0, Math.floor(monthsToFrom / interval) - 1) : 0;
  for (let i = 0; i < MAX_ITERATIONS; i++, m++) {
    const month = start.startOf('month').plus({ months: m * interval });
    const clamped = Math.min(Math.max(1, day), month.daysInMonth ?? 28);
    if (!emit(month.set({ day: clamped }).toISODate() as LocalDate)) break;
  }
  return out;
}

export interface RecurringEventSpec {
  id: string;
  /** Local wall-clock start, minutes from midnight. */
  startMinute: number;
  durationMin: number;
  rule: RecurrenceSpec;
}

export interface Occurrence extends Interval {
  eventId: string;
  /** Local date the occurrence starts on. */
  date: LocalDate;
}

/**
 * Concrete occurrences of a recurring event that intersect an instant range.
 *
 * The start is a local wall-clock time, so a 09:00 stand-up stays at 09:00 local across
 * daylight-saving changes. The duration is real elapsed time. Occurrences that begin on the
 * previous local day and cross midnight into the range are included.
 */
export function expandOccurrences(event: RecurringEventSpec, range: Interval, tz: string): Occurrence[] {
  const fromDate = DateTime.fromMillis(range.start, { zone: tz }).minus({ days: 1 }).toISODate() as LocalDate;
  const toDate = DateTime.fromMillis(range.end, { zone: tz }).toISODate() as LocalDate;
  const out: Occurrence[] = [];
  for (const date of occurrenceDates(event.rule, fromDate, toDate)) {
    const start = localMinuteToInstant(date, event.startMinute, tz);
    const end = start + event.durationMin * MS_PER_MINUTE;
    if (start < range.end && end > range.start) out.push({ eventId: event.id, date, start, end });
  }
  return out;
}
