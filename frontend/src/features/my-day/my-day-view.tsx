'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ListChecks, Play, Sun } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AvailabilityWindowCard, TaskCard } from '@/components/app/cards';
import { DayStrip, StripLegend } from '@/components/app/day-strip';
import { DateNavigator, PageHeader } from '@/components/app/primitives';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { useNow } from '@/hooks/use-now';
import { useTimerActions } from '@/hooks/use-timer-actions';
import { qk } from '@/lib/query-keys';
import { fmtDuration, fmtTime, todayIn, type LocalDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { availabilityApi, scheduleApi, taskApi } from '@/services';
import type { PlannedBlock } from '@/types';

/** A single-column agenda for one day: what is happening, what is next, what is done, and what is free. */
export function MyDayView() {
  const { tz, use24h } = useAuth();
  const now = useNow(30_000);
  const [date, setDate] = useState<LocalDate>(() => todayIn(tz));
  const day = useQuery({ queryKey: qk.availabilityDay(date), queryFn: () => availabilityApi.day(date), refetchInterval: 60_000 });
  const due = useQuery({ queryKey: qk.tasks({ due: 'today' }), queryFn: () => taskApi.list({ due: 'today', pageSize: 20 }) });
  const { start } = useTimerActions();
  const completeTask = useApiMutation({ mutationFn: (id: string) => taskApi.complete(id), successMessage: 'Task completed' });

  const startBlock = async (b: PlannedBlock) => {
    if (b.kind === 'RECURRING' && b.scheduleEventId) start.mutate({ activityId: (await scheduleApi.materialise(b.scheduleEventId, b.id.split(':')[1]!)).id });
    else start.mutate({ activityId: b.id });
  };

  if (day.isLoading) return <LoadingState />;
  if (day.isError || !day.data) return <ErrorState error={day.error} onRetry={() => void day.refetch()} />;
  const d = day.data;
  const nowMs = d.isToday ? now : -1;
  const blocks = d.blocks;
  const current = blocks.filter((b) => !b.done && new Date(b.start).getTime() <= nowMs && new Date(b.end).getTime() > nowMs);
  const upcoming = blocks.filter((b) => !b.done && new Date(b.start).getTime() > nowMs);
  const earlier = blocks.filter((b) => b.done || (nowMs > 0 && new Date(b.end).getTime() <= nowMs && !current.includes(b)));

  const Block = ({ b, tone }: { b: PlannedBlock; tone?: 'now' | 'done' }) => (
    <li className={cn('flex items-center gap-3 rounded-xl border bg-surface p-3.5', tone === 'now' ? 'border-primary/40' : 'border-border', tone === 'done' && 'opacity-60')}>
      <span aria-hidden className="h-10 w-1 shrink-0 rounded-full" style={{ background: b.color }} />
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm font-medium text-fg', tone === 'done' && b.done && 'line-through')}>{b.title}</div>
        <div className="tabular mt-0.5 text-xs text-fg-muted">
          {fmtTime(b.start, tz, use24h)} – {fmtTime(b.end, tz, use24h)} · {b.categoryName}
          {b.actualDurationSec > 0 && <span className="text-primary"> · tracked {fmtDuration(b.actualDurationSec)}</span>}
        </div>
      </div>
      {b.isFixed && <Badge>Fixed</Badge>}
      {!b.done && tone !== 'done' && (
        <Button size="sm" variant={tone === 'now' ? 'primary' : 'secondary'} onClick={() => void startBlock(b)}>
          <Play className="size-3.5" /> {tone === 'now' ? 'Start' : 'Start early'}
        </Button>
      )}
    </li>
  );

  return (
    <>
      <PageHeader title="My day" description="Your agenda, free windows and the tasks due today." actions={<DateNavigator date={date} onChange={setDate} tz={tz} />} />
      <Card className="mb-6">
        <CardContent className="p-5">
          <DayStrip day={d} tz={tz} use24h={use24h} />
          <div className="mt-3">
            <StripLegend />
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {blocks.length === 0 ? (
            <EmptyState icon={Sun} title="Nothing planned for this day" description="Add an activity, or let Smart Recommendations suggest what fits the free time." action={<Button asChild variant="primary"><Link href="/recommendations">See recommendations</Link></Button>} />
          ) : (
            <>
              {current.length > 0 && (
                <section aria-label="Happening now">
                  <h2 className="mb-2 text-sm font-semibold text-primary">Now</h2>
                  <ul className="space-y-2">{current.map((b) => <Block key={b.id} b={b} tone="now" />)}</ul>
                </section>
              )}
              {upcoming.length > 0 && (
                <section aria-label="Upcoming">
                  <h2 className="mb-2 text-sm font-semibold text-fg-secondary">{d.isToday ? 'Up next' : 'Planned'}</h2>
                  <ul className="space-y-2">{upcoming.map((b) => <Block key={b.id} b={b} />)}</ul>
                </section>
              )}
              {earlier.length > 0 && (
                <section aria-label="Earlier">
                  <h2 className="mb-2 text-sm font-semibold text-fg-muted">Earlier</h2>
                  <ul className="space-y-2">{earlier.map((b) => <Block key={b.id} b={b} tone="done" />)}</ul>
                </section>
              )}
            </>
          )}
        </div>

        <div className="space-y-6">
          <section aria-label="Free windows">
            <h2 className="mb-2 text-sm font-semibold text-fg-secondary">Free windows</h2>
            {d.windows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong px-4 py-4 text-[13px] text-fg-secondary">No free window {d.isToday ? 'left today' : 'on this day'}.</p>
            ) : (
              <div className="space-y-2">{d.windows.map((w) => <AvailabilityWindowCard key={w.start} window={w} tz={tz} use24h={use24h} compact />)}</div>
            )}
          </section>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="size-4 text-primary" aria-hidden /> Due today
              </CardTitle>
            </CardHeader>
            <CardContent>
              {due.isLoading ? <LoadingState /> : !due.data?.items.length ? (
                <p className="flex items-center gap-2 text-sm text-fg-secondary">
                  <CheckCircle2 className="size-4 text-success" aria-hidden /> No tasks are due today.
                </p>
              ) : (
                <div className="space-y-2.5">{due.data.items.map((t) => <TaskCard key={t.id} task={t} tz={tz} use24h={use24h} now={now} onComplete={() => completeTask.mutate(t.id)} />)}</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
