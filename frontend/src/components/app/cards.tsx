'use client';

import { AlertTriangle, CalendarClock, Check, ChevronDown, Clock, Link2, Lock, MoreHorizontal, Play, Timer } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { fmtDateTime, fmtDuration, fmtTime, fromNow } from '@/lib/time';
import { cn, humanize } from '@/lib/utils';
import type { Activity, FreeWindow, Recommendation, Task } from '@/types';
import { Badge, Progress } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Tooltip } from '@/components/ui/overlay';
import { CategoryDot, PriorityBadge } from './primitives';

// ── status vocabulary ────────────────────────────────────────────────────────
const ACTIVITY_STATUS: Record<string, { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' }> = {
  PLANNED: { label: 'Planned', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'primary' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  SKIPPED: { label: 'Skipped', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};
export function ActivityStatusBadge({ status }: { status: string }) {
  const s = ACTIVITY_STATUS[status] ?? { label: humanize(status), tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const TASK_STATUS: Record<string, { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' }> = {
  BACKLOG: { label: 'Backlog', tone: 'neutral' },
  TODO: { label: 'To do', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'primary' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};
export function TaskStatusBadge({ status }: { status: string }) {
  const s = TASK_STATUS[status] ?? { label: humanize(status), tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const CONFIDENCE = {
  HIGH: { label: 'High confidence', tone: 'success' as const },
  MEDIUM: { label: 'Medium confidence', tone: 'warning' as const },
  LOW: { label: 'Low confidence', tone: 'danger' as const },
};

/** Explicit confidence: the reasons it is not 100% are one hover (or focus) away. */
export function ConfidenceBadge({ confidence, score, factors }: { confidence: keyof typeof CONFIDENCE; score?: number; factors?: { message: string }[] }) {
  const c = CONFIDENCE[confidence];
  const badge = (
    <Badge tone={c.tone} tabIndex={factors?.length ? 0 : undefined} className={factors?.length ? 'cursor-help' : undefined}>
      {c.label}
      {score !== undefined && <span className="tabular opacity-70">· {score}</span>}
    </Badge>
  );
  if (!factors?.length) return badge;
  return (
    <Tooltip
      content={
        <ul className="space-y-1.5">
          {factors.map((f) => (
            <li key={f.message}>{f.message}</li>
          ))}
        </ul>
      }
    >
      {badge}
    </Tooltip>
  );
}

// ── availability ─────────────────────────────────────────────────────────────
export function AvailabilityWindowCard({ window: w, tz, use24h, action, compact }: { window: FreeWindow; tz: string; use24h: boolean; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/25 bg-success-soft/60 px-4', compact ? 'py-2.5' : 'py-3.5')}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tabular text-[15px] font-semibold text-fg">
            {fmtTime(w.start, tz, use24h)} – {fmtTime(w.end, tz, use24h)}
          </span>
          <span className="text-[13px] font-medium text-success">{fmtDuration(w.durationSec)} free</span>
          <ConfidenceBadge confidence={w.confidence} score={w.confidenceScore} factors={w.factors} />
        </div>
        {!compact && (w.precededBy || w.followedBy) && (
          <p className="mt-1 text-xs text-fg-muted">
            {w.precededBy && <>After “{w.precededBy}”</>}
            {w.precededBy && w.followedBy && ' · '}
            {w.followedBy && <>before “{w.followedBy}”</>}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

// ── activities ───────────────────────────────────────────────────────────────
export function ActivityCard({
  activity: a,
  tz,
  use24h,
  onStart,
  onComplete,
  menu,
  className,
}: {
  activity: Activity;
  tz: string;
  use24h: boolean;
  onStart?: () => void;
  onComplete?: () => void;
  menu?: ReactNode;
  className?: string;
}) {
  const planned = a.plannedDurationSec ?? a.estimatedDurationSec;
  const done = a.status === 'COMPLETED' || a.status === 'SKIPPED' || a.status === 'CANCELLED';
  return (
    <div className={cn('group rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/activities/${a.id}`} className="block truncate text-[15px] font-medium text-fg hover:text-primary">
            {a.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <CategoryDot color={a.category.color} name={a.category.name} />
            {a.plannedStart && a.plannedEnd ? (
              <span className="tabular text-[13px] text-fg-secondary">
                {fmtTime(a.plannedStart, tz, use24h)} – {fmtTime(a.plannedEnd, tz, use24h)}
              </span>
            ) : (
              <span className="text-[13px] text-fg-muted">Not scheduled</span>
            )}
            {a.isFixed && (
              <Tooltip content="Fixed commitment: it cannot be moved by the scheduler and gets buffers.">
                <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                  <Lock className="size-3" aria-hidden /> Fixed
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ActivityStatusBadge status={a.status} />
          {menu}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-[13px]">
          <span className="text-fg-muted">
            Planned <span className="tabular text-fg-secondary">{fmtDuration(planned)}</span>
          </span>
          <span className="text-fg-muted">
            Tracked <span className={cn('tabular', a.actualDurationSec > 0 ? 'text-primary' : 'text-fg-secondary')}>{fmtDuration(a.actualDurationSec)}</span>
          </span>
        </div>
        {!done && (onStart || onComplete) && (
          <div className="flex gap-1.5">
            {onStart && (
              <Button size="sm" variant="secondary" onClick={onStart}>
                <Play className="size-3.5" /> {a.actualDurationSec > 0 ? 'Continue' : 'Start'}
              </Button>
            )}
            {onComplete && (
              <Button size="sm" variant="ghost" onClick={onComplete} aria-label={`Mark ${a.title} completed`}>
                <Check className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>
      {planned && a.actualDurationSec > 0 && <Progress className="mt-3" value={(a.actualDurationSec / planned) * 100} tone={a.actualDurationSec > planned * 1.2 ? 'warning' : 'primary'} label="Tracked versus planned" />}
    </div>
  );
}

export function RowMenu({ children, label = 'More actions' }: { children: ReactNode; label?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── tasks ────────────────────────────────────────────────────────────────────
export function TaskCard({ task: t, tz, use24h, now, onComplete, onToggleBusy, menu, onSchedule }: { task: Task; tz: string; use24h: boolean; now: number; onComplete?: () => void; onToggleBusy?: boolean; menu?: ReactNode; onSchedule?: () => void }) {
  const done = t.status === 'COMPLETED' || t.status === 'CANCELLED';
  const overdue = !done && t.deadline !== null && new Date(t.deadline).getTime() < now;
  const subDone = t.subtasks.filter((s) => s.isDone).length;
  const nextBlock = t.scheduledBlocks.find((b) => b.plannedStart && new Date(b.plannedStart).getTime() > now && b.status !== 'COMPLETED');
  return (
    <div className={cn('flex gap-3 rounded-xl border bg-surface p-4 transition-colors hover:border-border-strong', overdue ? 'border-danger/30' : 'border-border', done && 'opacity-70')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={t.status === 'COMPLETED'}
        aria-label={t.status === 'COMPLETED' ? `${t.title} is completed` : `Complete ${t.title}`}
        disabled={done || t.isBlocked || onToggleBusy || !onComplete}
        onClick={onComplete}
        className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors', t.status === 'COMPLETED' ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong hover:border-primary disabled:hover:border-border-strong', t.isBlocked && 'opacity-50')}
      >
        {t.status === 'COMPLETED' && <Check className="size-3" strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/tasks/${t.id}`} className={cn('truncate text-[15px] font-medium hover:text-primary', t.status === 'COMPLETED' ? 'text-fg-secondary line-through' : 'text-fg')}>
            {t.title}
          </Link>
          <div className="flex shrink-0 items-center gap-1.5">
            <PriorityBadge priority={t.priority} />
            {menu}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-fg-muted">
          {t.category && <CategoryDot color={t.category.color} name={t.category.name} />}
          <span className="inline-flex items-center gap-1">
            <Timer className="size-3.5" aria-hidden /> {fmtDuration(t.estimatedDurationSec)}
          </span>
          {t.deadline && (
            <Tooltip content={fmtDateTime(t.deadline, tz, use24h)}>
              <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-danger')}>
                {overdue ? <AlertTriangle className="size-3.5" aria-hidden /> : <Clock className="size-3.5" aria-hidden />}
                {overdue ? 'Overdue' : 'Due'} {fromNow(t.deadline, now)}
              </span>
            </Tooltip>
          )}
          {t.isBlocked && (
            <Tooltip content={`Waiting on: ${t.dependsOn.filter((d) => d.status !== 'COMPLETED').map((d) => d.title).join(', ')}`}>
              <span className="inline-flex items-center gap-1 text-warning">
                <Link2 className="size-3.5" aria-hidden /> Blocked
              </span>
            </Tooltip>
          )}
          {nextBlock?.plannedStart && (
            <span className="inline-flex items-center gap-1 text-info">
              <CalendarClock className="size-3.5" aria-hidden /> {fmtDateTime(nextBlock.plannedStart, tz, use24h)}
            </span>
          )}
          {t.subtasks.length > 0 && (
            <span className="tabular">
              {subDone}/{t.subtasks.length} subtasks
            </span>
          )}
          <TaskStatusBadge status={t.status} />
        </div>
        {onSchedule && !done && !nextBlock && (
          <Button size="sm" variant="ghost" className="mt-2 -ml-2 h-7 text-fg-secondary" onClick={onSchedule}>
            <CalendarClock className="size-3.5" /> Schedule
          </Button>
        )}
      </div>
    </div>
  );
}

// ── recommendations ──────────────────────────────────────────────────────────
const FACTOR_LABEL: Record<string, string> = {
  urgency: 'Deadline urgency',
  priority: 'Priority',
  fit: 'Fit to free time',
  energy: 'Energy match',
  focus: 'Focus match',
  timeOfDay: 'Time of day',
  history: 'Your history',
  momentum: 'Momentum',
  leverage: 'Unblocks others',
};

export function RecommendationCard({
  rec,
  tz,
  use24h,
  actions,
  rank,
  defaultOpen,
}: {
  rec: Recommendation;
  tz: string;
  use24h: boolean;
  actions?: ReactNode;
  rank?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-soft">
            <span className="tabular text-lg font-semibold text-primary" aria-label={`Score ${rec.score} out of 100`}>
              {rec.score}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {rank !== undefined && <span className="text-xs font-medium text-fg-muted">#{rank}</span>}
              <Link href={`/tasks/${rec.taskId}`} className="truncate text-base font-semibold text-fg hover:text-primary">
                {rec.title}
              </Link>
              <PriorityBadge priority={rec.priority} />
            </div>
            <p className="mt-1 text-[13px] text-fg-secondary">
              About <span className="tabular font-medium text-fg">{fmtDuration(rec.estimatedDurationSec)}</span> · {fmtTime(rec.suitableWindow.start, tz, use24h)} – {fmtTime(rec.suitableWindow.end, tz, use24h)} ·{' '}
              <Tooltip content="How well the available information supports this suggestion — separate from how good the task is.">
                <span className="cursor-help underline decoration-dotted underline-offset-2">{rec.confidence}% confidence</span>
              </Tooltip>
            </p>
          </div>
        </div>
        {actions}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-fg-secondary">{rec.summary}</p>

      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg">
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden /> How this score was calculated
      </button>
      {open && (
        <ul className="mt-3 space-y-2.5 border-t border-border pt-4">
          {[...rec.breakdown]
            .sort((a, b) => b.points - a.points)
            .map((f) => (
              <li key={f.factor} className="grid grid-cols-[132px_1fr_44px] items-center gap-3 text-[13px]">
                <span className="text-fg-secondary">{FACTOR_LABEL[f.factor] ?? humanize(f.factor)}</span>
                <div>
                  <Progress value={f.value * 100} tone={f.value >= 0.66 ? 'primary' : f.value >= 0.33 ? 'info' : 'warning'} label={FACTOR_LABEL[f.factor]} />
                  <span className="mt-1 block text-xs text-fg-muted">{f.note}</span>
                </div>
                <span className="tabular text-right text-fg-muted">+{f.points.toFixed(1)}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
