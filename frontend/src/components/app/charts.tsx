'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDuration, toHours } from '@/lib/time';
import { cn } from '@/lib/utils';

const AXIS = { fontSize: 12, fill: 'var(--text-muted)' } as const;
const GRID = 'var(--chart-grid)';

interface TipPayload {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

/** Shared tooltip: a labelled list of series values, formatted in hours. */
function HoursTooltip({ active, payload, label, unit = 'h' }: { active?: boolean; payload?: TipPayload[]; label?: string | number; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border-strong bg-elevated px-3 py-2 text-xs shadow-[var(--shadow-md)]">
      <div className="mb-1 font-medium text-fg">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 text-fg-secondary">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular font-medium text-fg">
            {p.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ChartFrame({ height = 260, children, summary }: { height?: number; children: React.ReactNode; summary: string }) {
  return (
    <figure className="m-0">
      <div style={{ height }} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

export interface DayPoint {
  label: string;
  tracked: number;
  productive: number;
  focus?: number;
  planned?: number;
}

export function TrendChart({ data, goalHours }: { data: DayPoint[]; goalHours?: number }) {
  const rows = data.map((d) => ({ label: d.label, Productive: toHours(d.productive), Tracked: toHours(d.tracked) }));
  return (
    <ChartFrame summary={`Productive and tracked hours per day over ${data.length} days.`}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gProductive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gTracked" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="4 6" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="h" allowDecimals={false} />
        <Tooltip content={<HoursTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
        {goalHours ? <ReferenceLine y={goalHours} stroke="var(--text-muted)" strokeDasharray="4 4" label={{ value: 'Focus goal', fill: 'var(--text-muted)', fontSize: 11, position: 'insideTopRight' }} /> : null}
        <Area isAnimationActive={false} type="monotone" dataKey="Tracked" stroke="var(--series-2)" strokeWidth={2} fill="url(#gTracked)" />
        <Area isAnimationActive={false} type="monotone" dataKey="Productive" stroke="var(--series-1)" strokeWidth={2.5} fill="url(#gProductive)" />
      </AreaChart>
    </ChartFrame>
  );
}

export function PlannedActualChart({ data }: { data: DayPoint[] }) {
  const rows = data.map((d) => ({ label: d.label, Planned: toHours(d.planned ?? 0), Tracked: toHours(d.tracked) }));
  return (
    <ChartFrame summary="Planned versus tracked hours per day.">
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={3}>
        <CartesianGrid stroke={GRID} strokeDasharray="4 6" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="h" allowDecimals={false} />
        <Tooltip content={<HoursTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar isAnimationActive={false} dataKey="Planned" fill="var(--series-3)" fillOpacity={0.55} radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar isAnimationActive={false} dataKey="Tracked" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ChartFrame>
  );
}

export function FocusChart({ data, goalHours }: { data: DayPoint[]; goalHours: number }) {
  const rows = data.map((d) => ({ label: d.label, Focus: toHours(d.focus ?? 0) }));
  return (
    <ChartFrame height={220} summary={`Focused hours per day against a goal of ${goalHours} hours.`}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="4 6" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="h" allowDecimals={false} />
        <Tooltip content={<HoursTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
        <ReferenceLine y={goalHours} stroke="var(--primary)" strokeDasharray="4 4" strokeOpacity={0.6} />
        <Bar isAnimationActive={false} dataKey="Focus" radius={[4, 4, 0, 0]} maxBarSize={24}>
          {rows.map((r, i) => (
            <Cell key={i} fill={r.Focus >= goalHours ? 'var(--series-1)' : 'var(--series-4)'} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

export interface DonutDatum {
  name: string;
  color: string;
  value: number; // seconds
}

export function CategoryDonut({ data }: { data: DonutDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const rows = data.filter((d) => d.value > 0);
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[200px_1fr]">
      <div className="relative mx-auto size-[200px]">
        <ChartFrame height={200} summary={`Tracked time by category: ${rows.map((d) => `${d.name} ${fmtDuration(d.value)}`).join(', ')}.`}>
          <PieChart>
            <Pie isAnimationActive={false} data={rows} dataKey="value" nameKey="name" innerRadius={66} outerRadius={94} paddingAngle={2} stroke="none">
              {rows.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-lg border border-border-strong bg-elevated px-3 py-2 text-xs shadow-[var(--shadow-md)]">
                    <span className="font-medium text-fg">{payload[0].name}</span> · <span className="tabular text-fg-secondary">{fmtDuration(Number(payload[0].value))}</span>
                  </div>
                ) : null
              }
            />
          </PieChart>
        </ChartFrame>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="tabular text-2xl font-semibold text-fg">{toHours(total)}h</div>
            <div className="text-xs text-fg-muted">tracked</div>
          </div>
        </div>
      </div>
      <ul className="space-y-2.5">
        {rows.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-2 text-fg-secondary">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: d.color }} />
              {d.name}
            </span>
            <span className="tabular text-fg">
              {fmtDuration(d.value)} <span className="text-fg-muted">· {total ? Math.round((d.value / total) * 100) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HourlyBars({ hourly }: { hourly: { hour: number; trackedSec: number; productiveSec: number }[] }) {
  const rows = hourly.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}`, Productive: Math.round(h.productiveSec / 60), Other: Math.round((h.trackedSec - h.productiveSec) / 60) }));
  return (
    <ChartFrame height={200} summary="Minutes tracked in each hour of the day, productive versus other.">
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="4 6" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={2} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="m" domain={[0, 60]} ticks={[0, 30, 60]} />
        <Tooltip content={<HoursTooltip unit=" min" />} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar isAnimationActive={false} dataKey="Productive" stackId="a" fill="var(--series-1)" radius={[0, 0, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="Other" stackId="a" fill="var(--series-4)" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

/** Weekday × hour utilisation. Intensity is average tracked time in that slot. */
export function UtilisationHeatmap({ cells }: { cells: { weekday: number; hour: number; avgTrackedSec: number; avgProductiveSec: number }[] }) {
  const max = Math.max(1, ...cells.map((c) => c.avgTrackedSec));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const byKey = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c]));
  const any = cells.some((c) => c.avgTrackedSec > 0);
  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label="Time utilisation by weekday and hour" className="min-w-[620px]">
        <div role="row" className="mb-1 grid grid-cols-[36px_repeat(24,1fr)] gap-[3px] text-[10px] text-fg-muted">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} role="columnheader" className="tabular text-center">
              {h % 3 === 0 ? h : ''}
            </span>
          ))}
        </div>
        {days.map((d, i) => (
          <div key={d} role="row" className="mb-[3px] grid grid-cols-[36px_repeat(24,1fr)] gap-[3px]">
            <span role="rowheader" className="self-center text-[11px] text-fg-muted">
              {d}
            </span>
            {Array.from({ length: 24 }, (_, h) => {
              const c = byKey.get(`${i + 1}:${h}`);
              const v = c ? c.avgTrackedSec / max : 0;
              return (
                <div
                  key={h}
                  role="cell"
                  title={`${d} ${String(h).padStart(2, '0')}:00 — ${c ? fmtDuration(c.avgTrackedSec) : 'no data'} on average`}
                  className={cn('aspect-square rounded-[3px]', v === 0 && 'bg-surface-2')}
                  style={v > 0 ? { background: `color-mix(in oklab, var(--series-1) ${Math.round(18 + v * 82)}%, var(--surface-2))` } : undefined}
                />
              );
            })}
          </div>
        ))}
      </div>
      {!any && <p className="mt-2 text-xs text-fg-muted">No tracked time in this period yet.</p>}
    </div>
  );
}

export function EnergyChart({ hours }: { hours: { hour: number; energy: number | null; focus: number | null; samples: number }[] }) {
  const rows = hours.map((h) => ({ label: `${String(h.hour).padStart(2, '0')}:00`, Energy: h.energy, Focus: h.focus }));
  return (
    <ChartFrame height={240} summary="Expected energy and focus by hour of day, from your own check-ins.">
      <LineChart data={rows} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="4 6" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={2} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} />
        <Tooltip content={<HoursTooltip unit="/5" />} cursor={{ stroke: 'var(--border-strong)' }} />
        <Line isAnimationActive={false} type="monotone" dataKey="Energy" stroke="var(--series-1)" strokeWidth={2.5} dot={false} connectNulls={false} />
        <Line isAnimationActive={false} type="monotone" dataKey="Focus" stroke="var(--series-4)" strokeWidth={2} dot={false} strokeDasharray="5 4" connectNulls={false} />
      </LineChart>
    </ChartFrame>
  );
}
