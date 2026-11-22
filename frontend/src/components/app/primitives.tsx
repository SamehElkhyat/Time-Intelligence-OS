'use client';

import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { addDays, fmtDateLong, relativeDay, todayIn, type LocalDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { Dialog, DialogContent } from '@/components/ui/overlay';
import { Tooltip } from '@/components/ui/overlay';
import { Badge } from '@/components/ui/card';

export function PageHeader({ title, description, actions, eyebrow, className }: { title: string; description?: string; actions?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[13px] text-fg-muted">{eyebrow}</div>}
        <h1 className="truncate text-[26px] font-semibold leading-tight tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[14px] text-fg-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * One measured number with its context. `accent` marks the single most important figure on a
 * screen (lime); `delta` is only passed when there is a real previous value to compare with.
 */
export function MetricCard({
  label,
  value,
  unit,
  hint,
  delta,
  accent,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  delta?: { pct: number | null; inverse?: boolean };
  accent?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const good = delta?.pct === null || delta?.pct === undefined ? null : delta.inverse ? delta.pct <= 0 : delta.pct >= 0;
  return (
    <Card className={cn('flex flex-col justify-between gap-3 p-4', className)}>
      <div className="flex items-center justify-between gap-2 text-[13px] text-fg-secondary">
        <span>{label}</span>
        {icon}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('tabular text-[28px] font-semibold leading-none tracking-tight', accent ? 'text-primary' : 'text-fg')}>{value}</span>
        {unit && <span className="text-sm text-fg-muted">{unit}</span>}
      </div>
      <div className="flex min-h-5 items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{hint}</span>
        {delta && delta.pct !== null && (
          <span className={cn('tabular inline-flex items-center gap-0.5 font-medium', good ? 'text-success' : 'text-danger')}>
            {delta.pct >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
            {Math.abs(delta.pct)}%
          </span>
        )}
      </div>
    </Card>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-9 pr-9" type="search" />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-muted hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Previous / next day with a "Today" jump. The date is a local calendar date in the user's timezone. */
export function DateNavigator({ date, onChange, tz, className }: { date: LocalDate; onChange: (d: LocalDate) => void; tz: string; className?: string }) {
  const today = todayIn(tz);
  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <Tooltip content="Previous day">
        <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => onChange(addDays(date, -1))}>
          <ChevronLeft className="size-4" />
        </Button>
      </Tooltip>
      <div className="min-w-44 px-3 text-center">
        <div className="text-sm font-medium text-fg">{relativeDay(date, today)}</div>
        <div className="text-xs text-fg-muted">{fmtDateLong(date)}</div>
      </div>
      <Tooltip content="Next day">
        <Button variant="outline" size="icon" aria-label="Next day" onClick={() => onChange(addDays(date, 1))}>
          <ChevronRight className="size-4" />
        </Button>
      </Tooltip>
      {date !== today && (
        <Button variant="ghost" size="sm" onClick={() => onChange(today)}>
          Today
        </Button>
      )}
    </div>
  );
}

/** Destructive or hard-to-reverse actions always go through this. */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} className="max-w-md">
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Chip row used as an inline filter panel: toggles are real buttons with pressed state. */
export function FilterChips<T extends string>({ label, options, value, onChange, multiple }: { label: string; options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; multiple?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : multiple ? [...value, o.value] : [o.value])}
            className={cn('h-8 rounded-full border px-3 text-[13px] transition-colors', on ? 'border-primary/40 bg-primary-soft text-primary' : 'border-border text-fg-secondary hover:border-border-strong hover:text-fg')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'right';
}

/** Accessible, responsive table. On narrow screens it scrolls horizontally instead of breaking layout. */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, caption, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void; caption: string; empty?: ReactNode }) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border bg-surface-2/60 text-xs uppercase tracking-wide text-fg-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-4 py-3 font-medium', c.align === 'right' && 'text-right', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(row)) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn('border-b border-border last:border-0', onRowClick && 'cursor-pointer transition-colors hover:bg-surface-2')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 py-3 align-middle', c.align === 'right' && 'text-right', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between pt-4 text-sm text-fg-secondary">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

export const PRIORITY_TONE = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger' } as const;
export function PriorityBadge({ priority }: { priority: keyof typeof PRIORITY_TONE }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{priority.charAt(0) + priority.slice(1).toLowerCase()}</Badge>;
}

export function CategoryDot({ color, name }: { color: string; name?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-secondary">
      <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}
