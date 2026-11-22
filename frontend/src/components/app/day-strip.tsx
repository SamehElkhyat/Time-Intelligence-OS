'use client';

import { useMemo } from 'react';
import { fmtDuration, fmtTime } from '@/lib/time';
import type { AvailabilityDay } from '@/types';
import { Tooltip } from '@/components/ui/overlay';

export const STATE_META: Record<string, { label: string; color: string; description: string }> = {
  TRACKED: { label: 'Tracked', color: 'var(--state-tracked)', description: 'Measured: a timer or manual entry covers this time.' },
  PLANNED_UNTRACKED: { label: 'Planned, not tracked', color: 'var(--state-planned)', description: 'Something was planned, but nothing was tracked — it may or may not have happened.' },
  UNKNOWN: { label: 'Unknown', color: 'var(--state-unknown)', description: 'No plan and no tracking. This is not free time and not wasted time — there is simply no data.' },
  BUSY: { label: 'Committed', color: 'var(--series-3)', description: 'Occupied by a plan or an active timer.' },
  BUFFER: { label: 'Buffer', color: 'var(--state-buffer)', description: 'Kept clear around fixed commitments.' },
  BLOCKED: { label: 'Blocked', color: '#5a3a3a', description: 'Time you marked as unavailable.' },
  FREE: { label: 'Available', color: 'var(--state-free)', description: 'Bookable free time.' },
  FRAGMENT: { label: 'Too short', color: '#2f4a38', description: 'Free, but shorter than your minimum slot.' },
  OUTSIDE_HOURS: { label: 'Outside active hours', color: 'transparent', description: 'Outside the hours you are available.' },
};

/**
 * The whole local day as one bar, classified by the availability engine. Width is proportional to
 * real elapsed time, so a daylight-saving day (23 or 25 hours) is drawn truthfully.
 */
export function DayStrip({ day, tz, use24h, height = 28 }: { day: AvailabilityDay; tz: string; use24h: boolean; height?: number }) {
  const total = new Date(day.range.end).getTime() - new Date(day.range.start).getTime();
  const start = new Date(day.range.start).getTime();
  const nowPct = day.isToday ? ((new Date(day.now).getTime() - start) / total) * 100 : null;

  const hourMarks = useMemo(() => {
    const marks: { pct: number; label: string }[] = [];
    // Label every 3rd local hour; derive positions from real instants.
    for (let t = start; t < start + total; t += 3_600_000) {
      const label = fmtTime(t, tz, use24h);
      const hh = Number(label.slice(0, 2));
      if (Number.isNaN(hh) ? label.startsWith('12') : hh % 3 === 0 && label.endsWith(':00')) marks.push({ pct: ((t - start) / total) * 100, label });
    }
    return marks;
  }, [start, total, tz, use24h]);

  return (
    <div>
      <div role="img" aria-label="Day classification: tracked, planned, unknown and available time" className="relative overflow-hidden rounded-md border border-border bg-surface-2" style={{ height }}>
        {day.strip.map((s, i) => {
          const a = new Date(s.start).getTime();
          const b = new Date(s.end).getTime();
          const meta = STATE_META[s.state]!;
          if (s.state === 'OUTSIDE_HOURS') return null;
          return (
            <Tooltip
              key={i}
              content={
                <div>
                  <div className="font-medium">
                    {meta.label} · {fmtTime(a, tz, use24h)}–{fmtTime(b, tz, use24h)} ({fmtDuration((b - a) / 1000)})
                  </div>
                  <div className="mt-0.5 text-fg-secondary">{meta.description}</div>
                </div>
              }
            >
              <div className="absolute top-0 h-full opacity-90 hover:opacity-100" style={{ left: `${((a - start) / total) * 100}%`, width: `${((b - a) / total) * 100}%`, background: meta.color }} />
            </Tooltip>
          );
        })}
        {nowPct !== null && <div aria-hidden className="absolute top-0 z-10 h-full w-0.5 bg-fg" style={{ left: `${nowPct}%` }} />}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-fg-muted" aria-hidden>
        {hourMarks.map((m) => (
          <span key={m.pct} className="tabular absolute -translate-x-1/2" style={{ left: `${m.pct}%` }}>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StripLegend({ states }: { states?: string[] }) {
  const keys = states ?? ['TRACKED', 'PLANNED_UNTRACKED', 'UNKNOWN', 'BUSY', 'FREE'];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-secondary">
      {keys.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: STATE_META[k]!.color }} />
          {STATE_META[k]!.label}
        </li>
      ))}
    </ul>
  );
}
