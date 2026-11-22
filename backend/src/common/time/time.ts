import { DateTime, IANAZone } from 'luxon';

/**
 * Timezone-safe calendar helpers.
 *
 * Rules used across the backend:
 *  - Instants are `Date` objects / epoch milliseconds in UTC.
 *  - A "local date" is an ISO string `YYYY-MM-DD` interpreted in an IANA zone.
 *  - A local day is the half-open instant range [00:00 local, next 00:00 local).
 *    It is 23h or 25h long on daylight-saving transition days — never assume 24h.
 */

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;

export type LocalDate = string; // YYYY-MM-DD

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimezone(tz: string): boolean {
  return typeof tz === 'string' && tz.length > 0 && IANAZone.isValidZone(tz);
}

export function isLocalDate(value: string): value is LocalDate {
  return LOCAL_DATE_RE.test(value) && DateTime.fromISO(value, { zone: 'utc' }).isValid;
}

/** Local calendar date of an instant in a zone. */
export function toLocalDate(instant: Date | number, tz: string): LocalDate {
  const ms = typeof instant === 'number' ? instant : instant.getTime();
  return DateTime.fromMillis(ms, { zone: tz }).toISODate() as LocalDate;
}

/** Instant at which a local day starts. Handles zones whose midnight does not exist. */
export function startOfLocalDay(date: LocalDate, tz: string): number {
  return DateTime.fromISO(date, { zone: tz }).startOf('day').toMillis();
}

/** Half-open instant range of a local day. */
export function localDayRange(date: LocalDate, tz: string): { start: number; end: number } {
  const start = DateTime.fromISO(date, { zone: tz }).startOf('day');
  const end = start.plus({ days: 1 }).startOf('day');
  return { start: start.toMillis(), end: end.toMillis() };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate() as LocalDate;
}

export function diffDays(from: LocalDate, to: LocalDate): number {
  const a = DateTime.fromISO(from, { zone: 'utc' });
  const b = DateTime.fromISO(to, { zone: 'utc' });
  return Math.round(b.diff(a, 'days').days);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a local date. */
export function isoWeekday(date: LocalDate): number {
  return DateTime.fromISO(date, { zone: 'utc' }).weekday;
}

/** Inclusive list of local dates. */
export function eachLocalDate(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  const n = diffDays(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/**
 * Instant for a wall-clock minute of a local day.
 * - Non-existent local times (spring-forward gap) resolve to the first valid instant after the gap.
 * - Ambiguous local times (fall-back overlap) resolve to the earlier occurrence.
 * - `minute` may be >= 1440 to address the following day(s).
 */
export function localMinuteToInstant(date: LocalDate, minute: number, tz: string): number {
  const dayOffset = Math.floor(minute / 1440);
  const m = minute - dayOffset * 1440;
  const base = DateTime.fromISO(dayOffset === 0 ? date : addDays(date, dayOffset), { zone: tz });
  const dt = DateTime.fromObject(
    { year: base.year, month: base.month, day: base.day, hour: Math.floor(m / 60), minute: m % 60 },
    { zone: tz },
  );
  const instant = dt.toMillis();
  // Luxon resolves an ambiguous wall-clock time (the repeated hour when clocks fall back) to the
  // later occurrence. We pin it to the earlier one so behaviour is documented and deterministic.
  const recent = DateTime.fromMillis(instant - 3 * 3_600_000, { zone: tz });
  if (recent.offset > dt.offset) {
    const earlier = instant - (recent.offset - dt.offset) * 60_000;
    const e = DateTime.fromMillis(earlier, { zone: tz });
    if (e.day === dt.day && e.hour === dt.hour && e.minute === dt.minute) return earlier;
  }
  return instant;
}

/** Local minute-of-day (0..1439) of an instant. */
export function minuteOfLocalDay(instant: number, tz: string): number {
  const dt = DateTime.fromMillis(instant, { zone: tz });
  return dt.hour * 60 + dt.minute;
}

export function localHour(instant: number, tz: string): number {
  return DateTime.fromMillis(instant, { zone: tz }).hour;
}

/** First local date of the week containing `date`, for a configurable week start (ISO weekday). */
export function startOfWeek(date: LocalDate, weekStartsOn: number): LocalDate {
  const wd = isoWeekday(date);
  const back = (wd - weekStartsOn + 7) % 7;
  return addDays(date, -back);
}

/** Whole seconds between two instants (floor). Never uses floating point durations. */
export function wholeSeconds(ms: number): number {
  return Math.floor(ms / MS_PER_SECOND);
}

/** Prisma maps DATE columns to a JS Date at 00:00 UTC. */
export function dateColumnToLocalDate(value: Date): LocalDate {
  return value.toISOString().slice(0, 10);
}

export function localDateToDateColumn(date: LocalDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Distinct local dates touched by a set of instants (used to scope derived-data recalculation). */
export function localDatesOf(tz: string, ...instants: (Date | number | null | undefined)[]): LocalDate[] {
  const out = new Set<LocalDate>();
  for (const i of instants) {
    if (i === null || i === undefined) continue;
    out.add(toLocalDate(i, tz));
  }
  return [...out];
}

/** Every local date an instant range overlaps (capped to keep event payloads small). */
export function localDatesInRange(tz: string, start: Date | number, end: Date | number, cap = 14): LocalDate[] {
  const first = toLocalDate(start, tz);
  const endMs = typeof end === 'number' ? end : end.getTime();
  const last = toLocalDate(Math.max(endMs - 1, typeof start === 'number' ? start : start.getTime()), tz);
  return eachLocalDate(first, last).slice(0, cap);
}

export function formatClock(instant: number, tz: string): string {
  return DateTime.fromMillis(instant, { zone: tz }).toFormat('HH:mm');
}

export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  if (m === 60) return `${h + 1}h`;
  return `${h}h ${m}m`;
}
