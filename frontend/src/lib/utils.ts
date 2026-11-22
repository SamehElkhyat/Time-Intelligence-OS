import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** "WORK_ITEM" → "Work item". */
export const humanize = (value: string): string => {
  const s = value.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Colour for a 0..100 score, used sparingly: lime only when it is genuinely good. */
export const scoreTone = (score: number | null): 'success' | 'warning' | 'danger' | 'muted' =>
  score === null ? 'muted' : score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger';
