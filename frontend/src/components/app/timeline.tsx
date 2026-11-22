'use client';

import { AlertTriangle, Lock } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtDuration, fmtTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { AvailabilityDay, PlannedBlock } from '@/types';
import { STATE_META } from './day-strip';
import { clampStart, layoutLanes, pixelsToMinutes } from './timeline-layout';

const GUTTER = 56;
const SNAP_MIN = 5;
const HOUR_MS = 3_600_000;
const MIN_BLOCK_PX = 24;

interface Props {
  day: AvailabilityDay;
  tz: string;
  use24h: boolean;
  /** Pixels per hour (zoom). */
  scale: number;
  selectedId?: string | null;
  onSelect: (block: PlannedBlock) => void;
  /** Called after a drag, resize or keyboard move. Never called when nothing changed. */
  onReschedule: (block: PlannedBlock, start: Date, end: Date) => void;
  /** Click on empty time: start of a new activity there. */
  onCreateAt?: (start: Date) => void;
}

interface Drag {
  id: string;
  mode: 'move' | 'resize';
  originY: number;
  deltaMin: number;
  moved: boolean;
}

const isMovable = (b: PlannedBlock): boolean => b.kind === 'ACTIVITY' && !b.done && !b.isFixed;

export function Timeline({ day, tz, use24h, scale, selectedId, onSelect, onReschedule, onCreateAt }: Props) {
  const rangeStart = new Date(day.range.start).getTime();
  const rangeEnd = new Date(day.range.end).getTime();
  const totalMs = rangeEnd - rangeStart;
  const height = (totalMs / HOUR_MS) * scale;
  const nowMs = new Date(day.now).getTime();

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const blocks = useMemo(() => day.blocks.map((b) => ({ ...b, s: new Date(b.start).getTime(), e: new Date(b.end).getTime() })), [day.blocks]);
  const lanes = useMemo(() => new Map(layoutLanes(blocks.map((b) => ({ id: b.id, start: b.s, end: b.e }))).map((l) => [l.id, l])), [blocks]);
  const conflictIds = useMemo(() => new Set(day.conflicts.flatMap((c) => [c.aId, c.bId])), [day.conflicts]);

  const y = useCallback((ms: number) => ((ms - rangeStart) / HOUR_MS) * scale, [rangeStart, scale]);

  const hours = useMemo(() => {
    const out: { y: number; label: string }[] = [];
    for (let t = rangeStart; t < rangeEnd; t += HOUR_MS) out.push({ y: ((t - rangeStart) / HOUR_MS) * scale, label: fmtTime(t, tz, use24h) });
    return out;
  }, [rangeStart, rangeEnd, scale, tz, use24h]);

  // ── pointer drag ───────────────────────────────────────────────────────────
  const begin = (e: PointerEvent, b: PlannedBlock, mode: Drag['mode']) => {
    if (!isMovable(b)) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d: Drag = { id: b.id, mode, originY: e.clientY, deltaMin: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  };
  const move = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const px = e.clientY - d.originY;
    const next = { ...d, deltaMin: pixelsToMinutes(px, scale, SNAP_MIN), moved: d.moved || Math.abs(px) > 3 };
    dragRef.current = next;
    setDrag(next);
  };
  const end = (e: PointerEvent, b: (typeof blocks)[number]) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!d.moved) {
      onSelect(b);
      return;
    }
    if (d.deltaMin === 0) return;
    commit(b, d.mode, d.deltaMin);
  };

  const commit = (b: (typeof blocks)[number], mode: Drag['mode'], deltaMin: number) => {
    const length = b.e - b.s;
    if (mode === 'move') {
      const start = clampStart(b.s + deltaMin * 60_000, length, rangeStart, rangeEnd);
      if (start !== b.s) onReschedule(b, new Date(start), new Date(start + length));
    } else {
      const newEnd = Math.min(rangeEnd, Math.max(b.s + SNAP_MIN * 60_000, b.e + deltaMin * 60_000));
      if (newEnd !== b.e) onReschedule(b, new Date(b.s), new Date(newEnd));
    }
  };

  // Keyboard alternative to dragging: Alt+↑/↓ moves by 15 min (Shift: 5), Alt+Shift… resize with Ctrl.
  const onKey = (e: KeyboardEvent, b: (typeof blocks)[number]) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(b);
      return;
    }
    if (!isMovable(b) || !(e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) return;
    e.preventDefault();
    const step = (e.shiftKey ? 5 : 15) * (e.key === 'ArrowUp' ? -1 : 1);
    commit(b, e.ctrlKey ? 'resize' : 'move', step);
  };

  const clickEmpty = (e: React.MouseEvent) => {
    if (!onCreateAt || e.target !== e.currentTarget) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const min = pixelsToMinutes(e.clientY - rect.top, scale, 15);
    onCreateAt(new Date(Math.min(rangeEnd - 15 * 60_000, rangeStart + min * 60_000)));
  };

  const activeOverlay = day.activeHours.map((h) => ({ top: y(new Date(h.start).getTime()), bottom: y(new Date(h.end).getTime()) }));

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div className="relative min-w-[420px]" style={{ height }}>
        {/* hour grid + labels */}
        {hours.map((h, i) => (
          <div key={h.y} aria-hidden className="absolute inset-x-0 border-t border-[var(--chart-grid)]" style={{ top: h.y }}>
            <span className={cn('tabular absolute left-3 bg-surface px-1 text-[11px] text-fg-muted', i === 0 ? 'top-0.5' : '-top-2')}>{h.label}</span>
          </div>
        ))}

        <div ref={surface} onClick={clickEmpty} className="absolute inset-y-0 right-0 cursor-cell" style={{ left: GUTTER }}>
          {/* outside active hours */}
          {activeOverlay.length > 0 && (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-black/30" style={{ height: Math.max(0, activeOverlay[0]!.top) }} />
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/30" style={{ height: Math.max(0, height - activeOverlay[activeOverlay.length - 1]!.bottom) }} />
            </>
          )}

          {/* bookable free windows */}
          {day.windows.map((w) => {
            const top = y(new Date(w.start).getTime());
            const h = y(new Date(w.end).getTime()) - top;
            return (
              <div key={w.start} className="pointer-events-none absolute inset-x-1 rounded-md border border-dashed border-success/40 bg-success-soft" style={{ top, height: h }}>
                {h > 30 && (
                  <span className="absolute right-2 top-1 text-[11px] font-medium text-success">
                    {fmtDuration(w.durationSec)} free · {w.confidence.toLowerCase()}
                  </span>
                )}
              </div>
            );
          })}

          {/* actual-time gutter: what the data says really happened (right edge) */}
          <div aria-hidden className="pointer-events-none absolute right-0 top-0 w-1.5" style={{ height }}>
            {day.strip
              .filter((s) => s.state === 'TRACKED' || s.state === 'PLANNED_UNTRACKED')
              .map((s, i) => (
                <div key={i} className="absolute w-full rounded-sm" style={{ top: y(new Date(s.start).getTime()), height: y(new Date(s.end).getTime()) - y(new Date(s.start).getTime()), background: STATE_META[s.state]!.color, opacity: s.state === 'TRACKED' ? 1 : 0.35 }} />
              ))}
          </div>

          {/* planned blocks */}
          {blocks.map((b) => {
            const lane = lanes.get(b.id) ?? { lane: 0, lanes: 1 };
            const dragging = drag?.id === b.id ? drag : null;
            const shiftMs = dragging && dragging.mode === 'move' ? dragging.deltaMin * 60_000 : 0;
            const endShiftMs = dragging && dragging.mode === 'resize' ? dragging.deltaMin * 60_000 : 0;
            const s = clampStart(b.s + shiftMs, b.e - b.s, rangeStart, rangeEnd);
            const e = dragging?.mode === 'resize' ? Math.max(b.s + SNAP_MIN * 60_000, b.e + endShiftMs) : s + (b.e - b.s);
            const top = y(s);
            const h = Math.max(MIN_BLOCK_PX, y(e) - top);
            const movable = isMovable(b);
            const conflict = conflictIds.has(b.id);
            const widthPct = 100 / lane.lanes;
            return (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                aria-label={`${b.title}, ${fmtTime(s, tz, use24h)} to ${fmtTime(e, tz, use24h)}${conflict ? ', conflicts with another commitment' : ''}${movable ? '. Alt plus arrow keys to move.' : ''}`}
                aria-pressed={selectedId === b.id}
                onPointerDown={(ev) => begin(ev, b, 'move')}
                onPointerMove={move}
                onPointerUp={(ev) => (movable ? end(ev, b) : onSelect(b))}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setDrag(null);
                }}
                onKeyDown={(ev) => onKey(ev, b)}
                className={cn(
                  'absolute overflow-hidden rounded-lg border-l-[3px] px-2.5 py-1.5 text-left transition-shadow',
                  movable ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer',
                  b.done && 'opacity-55',
                  conflict ? 'ring-1 ring-danger' : selectedId === b.id ? 'ring-1 ring-primary' : 'hover:ring-1 hover:ring-border-strong',
                  dragging?.moved && 'z-20 shadow-[var(--shadow-lg)]',
                )}
                style={{
                  top,
                  height: h,
                  left: `calc(${lane.lane * widthPct}% + 4px)`,
                  width: `calc(${widthPct}% - 8px - 8px)`,
                  borderLeftColor: b.color,
                  background: `color-mix(in oklab, ${b.color} 16%, var(--surface-2))`,
                }}
              >
                <div className="flex items-center gap-1.5">
                  {conflict && <AlertTriangle className="size-3 shrink-0 text-danger" aria-hidden />}
                  {b.isFixed && <Lock className="size-3 shrink-0 text-fg-muted" aria-hidden />}
                  <span className={cn('truncate text-[13px] font-medium text-fg', b.done && 'line-through')}>{b.title}</span>
                </div>
                {h >= 40 && (
                  <div className="tabular mt-0.5 truncate text-[11px] text-fg-secondary">
                    {fmtTime(s, tz, use24h)} – {fmtTime(e, tz, use24h)}
                    {b.actualDurationSec > 0 && <span className="text-primary"> · tracked {fmtDuration(b.actualDurationSec)}</span>}
                  </div>
                )}
                {movable && (
                  <div
                    onPointerDown={(ev) => begin(ev, b, 'resize')}
                    onPointerMove={move}
                    onPointerUp={(ev) => end(ev, b)}
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none"
                  >
                    <div className="mx-auto mt-1 h-0.5 w-6 rounded-full bg-fg-muted/60" />
                  </div>
                )}
              </div>
            );
          })}

          {/* current time */}
          {day.isToday && nowMs >= rangeStart && nowMs <= rangeEnd && (
            <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: y(nowMs) }}>
              <span className="-ml-1 size-2.5 rounded-full bg-danger" />
              <span className="h-px flex-1 bg-danger" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
