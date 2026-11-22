'use client';

import { useQuery } from '@tanstack/react-query';
import { History, Pencil, Play, Plus, ScrollText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog, DialogContent } from '@/components/ui/overlay';
import { ConfirmationDialog, PageHeader, Pagination } from '@/components/app/primitives';
import { RowMenu } from '@/components/app/cards';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/states';
import { ElapsedClock, TimerControls } from '@/components/app/timer-controls';
import { DropdownMenuItem } from '@/components/ui/overlay';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { useTimer } from '@/hooks/use-timer';
import { useTimerActions } from '@/hooks/use-timer-actions';
import { qk } from '@/lib/query-keys';
import { fmtDateLong, fmtDateTime, fmtDuration, fmtTime, localDateOf, todayIn } from '@/lib/time';
import { useAuth } from '@/providers/auth-provider';
import { activityApi, timerApi } from '@/services';
import type { TimeSession } from '@/types';
import { useCategories } from '../shared/hooks';
import { CorrectEntryDialog, ManualEntryDialog } from './entry-dialogs';

export const quickStartSchema = z.object({ title: z.string().trim().min(1, 'What are you starting?').max(160), categoryId: z.string().min(1, 'Choose a category') });

export function TimeTrackingView() {
  const { tz, use24h } = useAuth();
  const { session, paused, elapsedSec, isLoading, error } = useTimer();
  const [page, setPage] = useState(1);
  const [manual, setManual] = useState(false);
  const [correcting, setCorrecting] = useState<TimeSession | null>(null);
  const [deleting, setDeleting] = useState<TimeSession | null>(null);
  const [trail, setTrail] = useState<TimeSession | null>(null);

  const history = useQuery({ queryKey: qk.sessions({ page }), queryFn: () => timerApi.sessions({ page, pageSize: 20 }), placeholderData: (p) => p });
  const trackable = useQuery({
    queryKey: qk.activities({ trackable: true }),
    queryFn: () => activityApi.list({ status: ['PLANNED', 'IN_PROGRESS', 'PAUSED'], pageSize: 100, sort: 'plannedStart', order: 'asc' }),
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;

  const groups = new Map<string, TimeSession[]>();
  for (const s of history.data?.items ?? []) {
    const d = localDateOf(s.startedAt, tz);
    groups.set(d, [...(groups.get(d) ?? []), s]);
  }

  return (
    <>
      <PageHeader
        title="Time tracking"
        description="Elapsed time is stored on the server from real timestamps. Refresh, close the tab or switch device — it never loses a second."
        actions={
          <Button variant="secondary" onClick={() => setManual(true)}>
            <Plus className="size-4" /> Add time entry
          </Button>
        }
      />

      <Card className={session ? 'border-primary/30' : undefined}>
        <CardContent className="p-6 md:p-8">
          {session ? (
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 text-sm text-fg-secondary">
                  <span aria-hidden className={paused ? 'size-2 rounded-full bg-warning' : 'tf-pulse size-2 rounded-full bg-primary'} />
                  {paused ? 'Paused' : 'Tracking'} · {session.category.name}
                </div>
                <div className="mt-1 text-xl font-semibold text-fg">{session.activityTitle}</div>
                <ElapsedClock seconds={elapsedSec} className="mt-3 block text-[56px] leading-none text-primary md:text-[72px]" />
                <p className="mt-3 text-xs text-fg-muted">
                  Started {fmtDateTime(session.startedAt, tz, use24h)}
                  {session.pauseCount > 0 && ` · paused ${session.pauseCount}×`}
                </p>
              </div>
              <TimerControls />
            </div>
          ) : (
            <StartPanel activities={trackable.data?.items ?? []} />
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="history-h" className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="history-h" className="text-lg font-semibold text-fg">
            History
          </h2>
          {history.data && <span className="tabular text-[13px] text-fg-muted">{fmtDuration(history.data.totalDurationSec)} tracked in total</span>}
        </div>
        {history.isLoading ? (
          <LoadingState />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : !history.data?.items.length ? (
          <EmptyState icon={History} title="No tracked time yet" description="Start a timer above or add an entry for time you tracked elsewhere." />
        ) : (
          <>
            <div className="space-y-6">
              {[...groups.entries()].map(([date, items]) => (
                <div key={date}>
                  <div className="mb-2 flex items-baseline justify-between text-[13px]">
                    <span className="font-medium text-fg-secondary">{date === todayIn(tz) ? 'Today' : fmtDateLong(date)}</span>
                    <span className="tabular text-fg-muted">{fmtDuration(items.reduce((s, x) => s + x.durationSec, 0))}</span>
                  </div>
                  <Card>
                    <ul className="divide-y divide-border">
                      {items.map((s) => (
                        <li key={s.id} className="flex items-center gap-4 px-4 py-3">
                          <span aria-hidden className="h-9 w-1 rounded-full" style={{ background: s.category.color }} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-fg">{s.activityTitle}</div>
                            <div className="tabular mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                              <span>
                                {fmtTime(s.startedAt, tz, use24h)} – {s.endedAt ? fmtTime(s.endedAt, tz, use24h) : 'now'}
                              </span>
                              {s.source === 'MANUAL' && <Badge>Manual</Badge>}
                              {s.autoStopped && <Badge tone="warning">Auto-stopped after 12h — please correct</Badge>}
                              {s.status !== 'STOPPED' && <Badge tone="primary">{s.status.toLowerCase()}</Badge>}
                              {s.note && <span className="truncate">“{s.note}”</span>}
                            </div>
                          </div>
                          <span className="tabular text-sm font-semibold text-fg">{fmtDuration(s.durationSec)}</span>
                          {s.status === 'STOPPED' && (
                            <RowMenu label={`Actions for the ${s.activityTitle} entry`}>
                              <DropdownMenuItem onSelect={() => setCorrecting(s)}>
                                <Pencil className="size-4" /> Correct times
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setTrail(s)}>
                                <ScrollText className="size-4" /> Change history
                              </DropdownMenuItem>
                              <DropdownMenuItem danger onSelect={() => setDeleting(s)}>
                                <Trash2 className="size-4" /> Delete entry
                              </DropdownMenuItem>
                            </RowMenu>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              ))}
            </div>
            <Pagination page={history.data.meta.page} totalPages={history.data.meta.totalPages} onChange={setPage} />
          </>
        )}
      </section>

      <ManualEntryDialog open={manual} onOpenChange={setManual} tz={tz} activities={(trackable.data?.items ?? []).map((a) => ({ id: a.id, title: a.title }))} />
      <CorrectEntryDialog session={correcting} onOpenChange={(o) => !o && setCorrecting(null)} tz={tz} />
      <DeleteEntry session={deleting} onClose={() => setDeleting(null)} />
      <AuditTrail session={trail} onClose={() => setTrail(null)} />
    </>
  );
}

function StartPanel({ activities }: { activities: { id: string; title: string; plannedStart: string | null }[] }) {
  const { start } = useTimerActions();
  const categories = useCategories();
  const [activityId, setActivityId] = useState('');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const quick = quickStartSchema.safeParse({ title, categoryId });
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <h2 className="text-base font-semibold text-fg">Track a planned activity</h2>
        <CardDescription>Pick something from your plan and start the clock.</CardDescription>
        <div className="mt-4 flex gap-2">
          <Select aria-label="Activity to track" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
            <option value="">Choose an activity…</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </Select>
          <Button variant="primary" disabled={!activityId} loading={start.isPending} onClick={() => start.mutate({ activityId })}>
            <Play className="size-4" /> Start
          </Button>
        </div>
      </div>
      <div className="md:border-l md:border-border md:pl-8">
        <h2 className="text-base font-semibold text-fg">Or start something new</h2>
        <CardDescription>Quick-start an unplanned activity.</CardDescription>
        <div className="mt-4 space-y-3">
          <Field label="What are you doing?">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Review pull request" />}</Field>
          <div className="flex gap-2">
            <Select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Category…</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button variant="secondary" disabled={!quick.success} loading={start.isPending} onClick={() => start.mutate({ title: title.trim(), categoryId })}>
              <Play className="size-4" /> Start
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteEntry({ session, onClose }: { session: TimeSession | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const remove = useApiMutation({
    mutationFn: () => timerApi.remove(session!.id, reason.trim()),
    successMessage: 'Entry deleted — kept in its audit trail',
    onSuccess: () => (setReason(''), onClose()),
  });
  return (
    <ConfirmationDialog
      open={Boolean(session)}
      onOpenChange={(o) => !o && onClose()}
      title="Delete this time entry?"
      description={`${session ? fmtDuration(session.durationSec) : ''} on "${session?.activityTitle ?? ''}" will stop counting. The original entry is preserved in the audit trail.`}
      confirmLabel="Delete entry"
      loading={remove.isPending}
      onConfirm={() => reason.trim().length >= 3 && remove.mutate()}
    >
      <Field label="Reason" hint="At least 3 characters." className="mb-4">
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </ConfirmationDialog>
  );
}

function AuditTrail({ session, onClose }: { session: TimeSession | null; onClose: () => void }) {
  const { tz, use24h } = useAuth();
  const q = useQuery({ queryKey: qk.corrections(session?.id ?? ''), queryFn: () => timerApi.corrections(session!.id), enabled: Boolean(session) });
  return (
    <Dialog open={Boolean(session)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Change history" description="Every correction is recorded; nothing is overwritten silently.">
        {q.isLoading ? (
          <LoadingState />
        ) : !q.data?.length ? (
          <p className="text-sm text-fg-secondary">This entry has not been changed.</p>
        ) : (
          <ol className="space-y-4">
            {q.data.map((c) => (
              <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex justify-between gap-3 text-xs text-fg-muted">
                  <span>{c.action.replace('time-entry.', '').replace(/-/g, ' ')}</span>
                  <span>{fmtDateTime(c.createdAt, tz, use24h)}</span>
                </div>
                {c.reason && <p className="mt-1.5 text-fg">“{c.reason}”</p>}
                <div className="tabular mt-2 grid grid-cols-2 gap-3 text-xs text-fg-secondary">
                  <TrailValue label="Before" value={c.before} />
                  <TrailValue label="After" value={c.after} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TrailValue({ label, value }: { label: string; value: unknown }) {
  const v = value as { durationSec?: number } | null;
  return (
    <div>
      <div className="mb-0.5 text-fg-muted">{label}</div>
      <div>{v?.durationSec !== undefined ? fmtDuration(v.durationSec) : '—'}</div>
    </div>
  );
}
