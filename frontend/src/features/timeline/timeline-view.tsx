'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Minus, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActivityStatusBadge } from '@/components/app/cards';
import { StripLegend } from '@/components/app/day-strip';
import { DateNavigator, PageHeader } from '@/components/app/primitives';
import { ErrorState, LoadingState } from '@/components/app/states';
import { Timeline } from '@/components/app/timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ActivityFormDialog } from '@/features/activities/activity-form';
import { errorMessage, invalidateTimeData } from '@/hooks/use-mutation-toast';
import { useTimerActions } from '@/hooks/use-timer-actions';
import { qk } from '@/lib/query-keys';
import { fmtDuration, fmtTime, todayIn, type LocalDate } from '@/lib/time';
import { useAuth } from '@/providers/auth-provider';
import { activityApi, availabilityApi, scheduleApi } from '@/services';
import { useUiStore } from '@/stores/ui-store';
import type { AvailabilityDay, PlannedBlock } from '@/types';

const SCALES = [40, 56, 72, 96, 128];

export function TimelineView() {
  const { tz, use24h } = useAuth();
  const qc = useQueryClient();
  const scale = useUiStore((s) => s.timelineScale);
  const setScale = useUiStore((s) => s.setTimelineScale);
  const [date, setDate] = useState<LocalDate>(() => todayIn(tz));
  const [selected, setSelected] = useState<PlannedBlock | null>(null);
  const [creating, setCreating] = useState<Date | null>(null);
  const { start } = useTimerActions();

  const key = qk.availabilityDay(date);
  const day = useQuery({ queryKey: key, queryFn: () => availabilityApi.day(date), refetchInterval: 60_000 });

  /**
   * Rescheduling is optimistic: the block moves immediately; if the server refuses (for example the
   * new time hits a fixed commitment) the day is reloaded and the reason is shown.
   */
  const reschedule = async (b: PlannedBlock, s: Date, e: Date) => {
    const previous = qc.getQueryData<AvailabilityDay>(key);
    if (previous) qc.setQueryData<AvailabilityDay>(key, { ...previous, blocks: previous.blocks.map((x) => (x.id === b.id ? { ...x, start: s.toISOString(), end: e.toISOString() } : x)) });
    try {
      await activityApi.reschedule(b.id, { plannedStart: s.toISOString(), plannedEnd: e.toISOString() });
      toast.success(`Moved to ${fmtTime(s, tz, use24h)}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      await invalidateTimeData(qc);
    }
  };

  const materialiseThenStart = async (b: PlannedBlock) => {
    if (b.kind === 'RECURRING' && b.scheduleEventId) {
      const date_ = b.id.split(':')[1]!;
      const activity = await scheduleApi.materialise(b.scheduleEventId, date_);
      start.mutate({ activityId: activity.id });
    } else start.mutate({ activityId: b.id });
  };

  return (
    <>
      <PageHeader
        title="Timeline"
        description="Drag a block to reschedule it, drag its bottom edge to resize, or click empty time to add an activity. Keyboard: focus a block and use Alt + ↑ / ↓."
        actions={
          <>
            <DateNavigator date={date} onChange={(d) => (setDate(d), setSelected(null))} tz={tz} />
            <div role="group" aria-label="Zoom" className="inline-flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="Zoom out" disabled={scale <= SCALES[0]!} onClick={() => setScale(SCALES[Math.max(0, SCALES.indexOf(scale) - 1)] ?? SCALES[0]!)}>
                <Minus className="size-4" />
              </Button>
              <Button variant="outline" size="icon" aria-label="Zoom in" disabled={scale >= SCALES[SCALES.length - 1]!} onClick={() => setScale(SCALES[Math.min(SCALES.length - 1, SCALES.indexOf(scale) + 1)] ?? SCALES[2]!)}>
                <Plus className="size-4" />
              </Button>
            </div>
            <Button variant="primary" onClick={() => setCreating(new Date(Date.now() + 3_600_000))}>
              <Plus className="size-4" /> New activity
            </Button>
          </>
        }
      />

      {day.isLoading ? (
        <LoadingState />
      ) : day.isError || !day.data ? (
        <ErrorState error={day.error} onRetry={() => void day.refetch()} />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <StripLegend states={['FREE']} />
              <div className="flex gap-4 text-xs text-fg-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-1 rounded-full bg-primary" /> tracked (right edge)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="size-3 text-danger" aria-hidden /> conflict
                </span>
              </div>
            </div>
            <Timeline day={day.data} tz={tz} use24h={use24h} scale={scale} selectedId={selected?.id} onSelect={setSelected} onReschedule={reschedule} onCreateAt={(d) => setCreating(d)} />
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24">
            {day.data.conflicts.length > 0 && (
              <Card className="border-danger/30">
                <CardContent className="p-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-danger">
                    <AlertTriangle className="size-4" aria-hidden /> {day.data.conflicts.length} conflict{day.data.conflicts.length === 1 ? '' : 's'}
                  </h2>
                  <ul className="mt-2 space-y-2 text-[13px] text-fg-secondary">
                    {day.data.conflicts.map((c) => (
                      <li key={`${c.aId}${c.bId}`}>
                        “{c.aTitle}” overlaps “{c.bTitle}” by {fmtDuration(c.overlapSec)} {c.severity === 'HARD' ? '(both fixed)' : ''}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="p-4">
                {selected ? (
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-[15px] font-semibold text-fg">{selected.title}</h2>
                      {selected.status && <ActivityStatusBadge status={selected.status} />}
                    </div>
                    <p className="tabular mt-1 text-[13px] text-fg-secondary">
                      {fmtTime(selected.start, tz, use24h)} – {fmtTime(selected.end, tz, use24h)} · {selected.categoryName}
                    </p>
                    {selected.actualDurationSec > 0 && <p className="mt-1 text-[13px] text-primary">Tracked {fmtDuration(selected.actualDurationSec)}</p>}
                    {selected.kind === 'RECURRING' && <p className="mt-2 text-xs text-fg-muted">Recurring commitment. Starting it creates a real activity for today&apos;s occurrence.</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!selected.done && (
                        <Button size="sm" variant="primary" loading={start.isPending} onClick={() => void materialiseThenStart(selected)}>
                          <Play className="size-3.5" /> Start
                        </Button>
                      )}
                      {selected.kind === 'ACTIVITY' && (
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/activities/${selected.id}`}>
                            <ExternalLink className="size-3.5" /> Open
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] leading-relaxed text-fg-secondary">Select a block to see its details. Green dashed areas are free time you can still use.</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      )}

      <ActivityFormDialog open={Boolean(creating)} onOpenChange={(o) => !o && setCreating(null)} tz={tz} defaults={creating ? { plannedStart: creating, durationMin: 60 } : undefined} />
    </>
  );
}
