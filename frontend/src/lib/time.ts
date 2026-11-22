import { DateTime } from 'luxon';

/**
 * Time helpers. The backend stores instants (UTC) and interprets calendar days in the user's IANA
 * timezone; the UI must do the same. Nothing here uses the browser's own timezone.
 */
export type LocalDate = string; // YYYY-MM-DD

const dt = (iso: string | number | Date, tz: string): DateTime =>
  typeof iso === 'string' ? DateTime.fromISO(iso, { zone: tz }) : DateTime.fromMillis(iso instanceof Date ? iso.getTime() : iso, { zone: tz });

export const todayIn = (tz: string, now = Date.now()): LocalDate => DateTime.fromMillis(now, { zone: tz }).toISODate() as LocalDate;

export const addDays = (date: LocalDate, days: number): LocalDate =>
  DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate() as LocalDate;

export function startOfWeek(date: LocalDate, weekStartsOn: number): LocalDate {
  const wd = DateTime.fromISO(date, { zone: 'utc' }).weekday;
  return addDays(date, -((wd - weekStartsOn + 7) % 7));
}

export const weekdayOf = (date: LocalDate): number => DateTime.fromISO(date, { zone: 'utc' }).weekday;

export function fmtTime(iso: string | number | Date, tz: string, use24h = true): string {
  return dt(iso, tz).toFormat(use24h ? 'HH:mm' : 'h:mm a');
}

export function fmtDateShort(date: LocalDate, locale = 'en'): string {
  return DateTime.fromISO(date, { zone: 'utc' }).setLocale(locale).toFormat('ccc d LLL');
}

export function fmtDateLong(date: LocalDate, locale = 'en'): string {
  return DateTime.fromISO(date, { zone: 'utc' }).setLocale(locale).toFormat('cccc, d LLLL yyyy');
}

export function fmtDateTime(iso: string | Date, tz: string, use24h = true): string {
  return dt(iso, tz).toFormat(use24h ? 'ccc d LLL, HH:mm' : 'ccc d LLL, h:mm a');
}

export const fmtMonth = (month: string): string => DateTime.fromISO(`${month}-01`, { zone: 'utc' }).toFormat('LLLL yyyy');

/** 3725 → "1h 2m". Rounds to whole minutes; sub-minute values read "<1 min". */
export function fmtDuration(totalSec: number | null | undefined): string {
  if (totalSec === null || totalSec === undefined) return '—';
  const sec = Math.max(0, Math.round(totalSec));
  if (sec > 0 && sec < 60) return '<1 min';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (m === 60) return `${h + 1}h`;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Stopwatch style 3725 → "01:02:05". */
export function fmtClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

/** Hours with one decimal for charts: 5400 → 1.5. */
export const toHours = (sec: number): number => Math.round((sec / 3600) * 10) / 10;

/** Local calendar date of an instant in a timezone. */
export const localDateOf = (iso: string | Date, tz: string): LocalDate => dt(iso, tz).toISODate() as LocalDate;

/** `<input type="datetime-local">` value for an instant, in the user's timezone. */
export const toLocalInput = (iso: string | Date, tz: string): string => dt(iso, tz).toFormat("yyyy-LL-dd'T'HH:mm");

/** Instant (ISO, UTC) for a `datetime-local` value interpreted in the user's timezone. */
export function fromLocalInput(value: string, tz: string): string {
  const parsed = DateTime.fromFormat(value, "yyyy-LL-dd'T'HH:mm", { zone: tz });
  if (!parsed.isValid) throw new Error('Invalid date and time');
  return parsed.toUTC().toISO() as string;
}

/** Minutes between two instants. */
export const minutesBetween = (a: string | Date, b: string | Date): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

export const minuteOfDay = (iso: string | Date, tz: string): number => {
  const d = dt(iso, tz);
  return d.hour * 60 + d.minute;
};

export function relativeDay(date: LocalDate, today: LocalDate): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  return fmtDateShort(date);
}

/** "in 20 minutes" / "2 hours ago" style, for deadlines and notifications. */
export function fromNow(iso: string | Date, now = Date.now()): string {
  const diffMin = Math.round((new Date(iso).getTime() - now) / 60_000);
  const abs = Math.abs(diffMin);
  const unit = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`;
  if (abs < 1) return 'now';
  return diffMin > 0 ? `in ${unit}` : `${unit} ago`;
}

export const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
