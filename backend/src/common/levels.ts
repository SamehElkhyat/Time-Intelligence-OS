import { Level, Priority, TimeOfDay } from '@prisma/client';

/** Numeric views of ordinal enums. Kept in one place so scoring stays consistent. */
export const LEVEL_VALUE: Record<Level, number> = {
  VERY_LOW: 1,
  LOW: 2,
  MODERATE: 3,
  HIGH: 4,
  VERY_HIGH: 5,
};

export const LEVEL_LABEL: Record<Level, string> = {
  VERY_LOW: 'very low',
  LOW: 'low',
  MODERATE: 'moderate',
  HIGH: 'high',
  VERY_HIGH: 'very high',
};

const LEVELS: Level[] = ['VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'];

export function levelFromValue(value: number): Level {
  const idx = Math.min(5, Math.max(1, Math.round(value))) - 1;
  return LEVELS[idx]!;
}

export const PRIORITY_VALUE: Record<Priority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 };

/** Local-hour ranges [startHour, endHour) for each named part of the day. */
export const TIME_OF_DAY_HOURS: Record<Exclude<TimeOfDay, 'ANY'>, [number, number]> = {
  MORNING: [5, 12],
  AFTERNOON: [12, 17],
  EVENING: [17, 22],
  NIGHT: [22, 29], // wraps past midnight to 05:00
};

export function timeOfDayForHour(hour: number): Exclude<TimeOfDay, 'ANY'> {
  if (hour >= 5 && hour < 12) return 'MORNING';
  if (hour >= 12 && hour < 17) return 'AFTERNOON';
  if (hour >= 17 && hour < 22) return 'EVENING';
  return 'NIGHT';
}
