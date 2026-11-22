'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Pencil, Play } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ActivityStatusBadge } from '@/components/app/cards';
import { CategoryDot, PageHeader, PriorityBadge } from '@/components/app/primitives';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Progress } from '@/components/ui/card';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { useTimerActions } from '@/hooks/use-timer-actions';
import { qk } from '@/lib/query-keys';
import { fmtDateTime, fmtDuration, fmtTime } from '@/lib/time';
import { humanize } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { activityApi, timerApi } from '@/services';
import { ActivityFormDialog } from './activity-form';

export function ActivityDetail({ id }: { id: string }) {
  const { tz, use24h } = useAuth();
  const [editing, setEditing] = useState(false);
  const activity = useQuery({ queryKey: qk.activity(id), queryFn: () => activityApi.get(id) });
  const sessions = useQuery({ queryKey: qk.sessions({ activityId: id }), queryFn: () => timerApi.sessions({ activityId: id, pageSize: 50 }) });
  const { start } = useTimerActions();
  const complete = useApiMutation({ mutationFn: () => activityApi.complete(id), successMessage: 'Marked completed' });

  if (activity.isLoading) return <LoadingState />;
  if (activity.isError || !activity.data) return <ErrorState title="Activity not found" error={activity.error} onRetry={() => void activity.refetch()} />;
  const a = activity.data;
  const planned = a.plannedDurationSec ?? a.estimatedDurationSec;
  const done = ['COMPLETED', 'SKIPPED', 'CANCELLED'].includes(a.status);

  return (
    <>
      <Link href="/activities" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-secondary hover:text-fg">
        <ArrowLeft className="size-4" /> Activities
      </Link>
      <PageHeader
        title={a.title}
        eyebrow={
          <span className="flex flex-wrap items-center gap-3">
            <CategoryDot color={a.category.color} name={a.category.name} />
            <ActivityStatusBadge status={a.status} />
            <PriorityBadge priority={a.priority} />
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
            {!done && (
              <>
                <Button variant="secondary" loading={complete.isPending} onClick={() => complete.mutate()}>
                  <Check className="size-4" /> Complete
                </Button>
                <Button variant="primary" loading={start.isPending} onClick={() => start.mutate({ activityId: id })}>
                  <Play className="size-4" /> {a.actualDurationSec > 0 ? 'Continue' : 'Start'}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Planned vs. tracked</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Stat label="Planned" value={fmtDuration(planned)} />
                <Stat label="Tracked" value={fmtDuration(a.actualDurationSec)} accent />
                <Stat label="Estimate" value={fmtDuration(a.estimatedDurationSec)} />
              </div>
              {planned ? <Progress value={(a.actualDurationSec / planned) * 100} tone={a.actualDurationSec > planned * 1.2 ? 'warning' : 'primary'} label="Tracked versus planned" /> : null}
              <p className="text-xs text-fg-muted">Planned time is an intention. Only tracked sessions count as time actually spent.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tracking history</CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.isLoading ? (
                <LoadingState />
              ) : !sessions.data?.items.length ? (
                <EmptyState icon={Play} title="Nothing tracked yet" description="Start the timer on this activity to record how long it takes." />
              ) : (
                <ul className="divide-y divide-border">
                  {sessions.data.items.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                      <div>
                        <div className="tabular text-sm text-fg">
                          {fmtDateTime(s.startedAt, tz, use24h)}
                          {s.endedAt && ` – ${fmtTime(s.endedAt, tz, use24h)}`}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-fg-muted">
                          {s.source === 'MANUAL' && <Badge>Manual entry</Badge>}
                          {s.autoStopped && <Badge tone="warning">Auto-stopped</Badge>}
                          {s.pauseCount > 0 && <span>{s.pauseCount} pause{s.pauseCount === 1 ? '' : 's'}</span>}
                          {s.note && <span>“{s.note}”</span>}
                        </div>
                      </div>
                      <span className="tabular text-sm font-medium text-primary">{fmtDuration(s.durationSec)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-3 text-sm">
              <Row label="When">{a.plannedStart && a.plannedEnd ? `${fmtDateTime(a.plannedStart, tz, use24h)} – ${fmtTime(a.plannedEnd, tz, use24h)}` : 'Not scheduled'}</Row>
              <Row label="Energy needed">{humanize(a.energyRequired)}</Row>
              <Row label="Focus needed">{humanize(a.focusRequired)}</Row>
              <Row label="Fixed">{a.isFixed ? 'Yes — cannot be moved by the scheduler' : 'No'}</Row>
              <Row label="Rescheduled">{a.rescheduleCount} time{a.rescheduleCount === 1 ? '' : 's'}</Row>
              {a.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {a.tags.map((t) => (
                    <Badge key={t}>#{t}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {(a.description || a.notes) && (
            <Card>
              <CardContent className="space-y-4 text-sm leading-relaxed text-fg-secondary">
                {a.description && <p>{a.description}</p>}
                {a.notes && (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Notes</div>
                    <p className="whitespace-pre-wrap">{a.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {a.taskId && (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/tasks/${a.taskId}`}>View linked task</Link>
            </Button>
          )}
        </aside>
      </div>
      <ActivityFormDialog open={editing} onOpenChange={setEditing} tz={tz} activity={a} />
    </>
  );
}

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div>
    <div className="text-xs text-fg-muted">{label}</div>
    <div className={`tabular mt-0.5 text-xl font-semibold ${accent ? 'text-primary' : 'text-fg'}`}>{value}</div>
  </div>
);
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-4">
    <span className="text-fg-muted">{label}</span>
    <span className="text-right text-fg-secondary">{children}</span>
  </div>
);
