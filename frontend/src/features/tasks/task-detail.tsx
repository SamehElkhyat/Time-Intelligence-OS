'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Check, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CategoryDot, ConfirmationDialog, PageHeader, PriorityBadge } from '@/components/app/primitives';
import { ActivityStatusBadge, TaskStatusBadge } from '@/components/app/cards';
import { ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input } from '@/components/ui/form';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { qk } from '@/lib/query-keys';
import { fmtDateTime, fmtDuration, fromNow } from '@/lib/time';
import { humanize } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { taskApi } from '@/services';
import { useOpenTasks } from '../shared/hooks';
import { ScheduleTaskDialog } from './tasks-view';
import { TaskFormDialog } from './task-form';

export function TaskDetail({ id }: { id: string }) {
  const { tz, use24h } = useAuth();
  const router = useRouter();
  const task = useQuery({ queryKey: qk.task(id), queryFn: () => taskApi.get(id) });
  const history = useQuery({ queryKey: qk.taskHistory(id), queryFn: () => taskApi.history(id) });
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newSub, setNewSub] = useState('');

  const complete = useApiMutation({ mutationFn: () => taskApi.complete(id), successMessage: 'Task completed' });
  const reopen = useApiMutation({ mutationFn: () => taskApi.reopen(id), successMessage: 'Task reopened' });
  const remove = useApiMutation({ mutationFn: () => taskApi.remove(id), successMessage: 'Task deleted', onSuccess: () => router.replace('/tasks') });
  const addSub = useApiMutation({ mutationFn: (t: string) => taskApi.addSubtask(id, t), onSuccess: () => setNewSub('') });
  const toggleSub = useApiMutation({ mutationFn: (v: { id: string; isDone: boolean }) => taskApi.updateSubtask(id, v.id, { isDone: v.isDone }) });
  const removeSub = useApiMutation({ mutationFn: (sid: string) => taskApi.removeSubtask(id, sid) });

  if (task.isLoading) return <LoadingState />;
  if (task.isError || !task.data) return <ErrorState title="Task not found" error={task.error} onRetry={() => void task.refetch()} />;
  const t = task.data;
  const closed = t.status === 'COMPLETED' || t.status === 'CANCELLED';

  return (
    <>
      <Link href="/tasks" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-secondary hover:text-fg">
        <ArrowLeft className="size-4" /> Tasks
      </Link>
      <PageHeader
        title={t.title}
        eyebrow={
          <span className="flex flex-wrap items-center gap-3">
            <TaskStatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            {t.category && <CategoryDot color={t.category.color} name={t.category.name} />}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
            {!closed && (
              <Button variant="secondary" onClick={() => setScheduling(true)}>
                <CalendarClock className="size-4" /> Schedule
              </Button>
            )}
            {closed ? (
              <Button variant="secondary" loading={reopen.isPending} onClick={() => reopen.mutate()}>
                <RotateCcw className="size-4" /> Reopen
              </Button>
            ) : (
              <Button variant="primary" loading={complete.isPending} disabled={t.isBlocked} title={t.isBlocked ? 'Complete its dependencies first' : undefined} onClick={() => complete.mutate()}>
                <Check className="size-4" /> Complete
              </Button>
            )}
            <Button variant="danger" size="icon" aria-label="Delete task" onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" />
            </Button>
          </>
        }
      />

      {t.isBlocked && (
        <p role="status" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Blocked: waiting on {t.dependsOn.filter((d) => d.status !== 'COMPLETED').map((d) => `“${d.title}”`).join(', ')}.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {t.description && (
            <Card>
              <CardContent className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">{t.description}</CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Subtasks</CardTitle>
                <CardDescription>
                  {t.subtasks.filter((s) => s.isDone).length} of {t.subtasks.length} done
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {t.subtasks.map((s) => (
                <div key={s.id} className="group flex items-center gap-3">
                  <Checkbox checked={s.isDone} aria-label={s.title} onChange={(e) => toggleSub.mutate({ id: s.id, isDone: e.target.checked })} />
                  <span className={s.isDone ? 'flex-1 text-sm text-fg-muted line-through' : 'flex-1 text-sm text-fg'}>{s.title}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${s.title}`} className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" onClick={() => removeSub.mutate(s.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <form
                className="flex gap-2 pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newSub.trim()) addSub.mutate(newSub.trim());
                }}
              >
                <Input aria-label="New subtask" placeholder="Add a subtask…" value={newSub} onChange={(e) => setNewSub(e.target.value)} />
                <Button type="submit" variant="secondary" disabled={!newSub.trim()} loading={addSub.isPending}>
                  <Plus className="size-4" /> Add
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scheduled work blocks</CardTitle>
            </CardHeader>
            <CardContent>
              {t.scheduledBlocks.length === 0 ? (
                <p className="text-sm text-fg-secondary">No work block on the calendar yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {t.scheduledBlocks.map((b) => (
                    <li key={b.activityId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <Link href={`/activities/${b.activityId}`} className="tabular text-sm text-fg hover:text-primary">
                        {b.plannedStart ? fmtDateTime(b.plannedStart, tz, use24h) : 'Unscheduled'}
                      </Link>
                      <span className="flex items-center gap-3 text-xs text-fg-muted">
                        {b.actualDurationSec > 0 && <span className="text-primary">tracked {fmtDuration(b.actualDurationSec)}</span>}
                        <ActivityStatusBadge status={b.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {history.isLoading ? (
                <LoadingState />
              ) : (
                <ol className="space-y-2.5 text-[13px]">
                  {history.data?.map((h) => (
                    <li key={h.id} className="flex items-baseline justify-between gap-3">
                      <span className="text-fg-secondary">{humanize(h.action.replace('task.', '').replace(/-/g, ' '))}</span>
                      <span className="tabular text-fg-muted">{fmtDateTime(h.createdAt, tz, use24h)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-3 text-sm">
              <Row label="Estimate">{fmtDuration(t.estimatedDurationSec)}</Row>
              <Row label="Tracked">{fmtDuration(t.trackedSec)}</Row>
              <Row label="Deadline">{t.deadline ? `${fmtDateTime(t.deadline, tz, use24h)} (${fromNow(t.deadline)})` : 'None'}</Row>
              <Row label="Energy needed">{humanize(t.energyRequired)}</Row>
              <Row label="Focus needed">{humanize(t.focusRequired)}</Row>
              <Row label="Complexity">{t.complexity} / 5</Row>
              <Row label="Best time">{t.preferredTimeOfDay === 'ANY' ? 'Any' : humanize(t.preferredTimeOfDay)}</Row>
              {t.recurrence && <Row label="Repeats">{humanize(t.recurrence.frequency)}</Row>}
              {t.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {t.tags.map((x) => (
                    <Badge key={x}>#{x}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Dependencies taskId={id} dependsOn={t.dependsOn.map((d) => d.id)} blocks={t.blocks} />
        </aside>
      </div>

      <TaskFormDialog open={editing} onOpenChange={setEditing} tz={tz} task={t} />
      <ScheduleTaskDialog task={scheduling ? t : null} onClose={() => setScheduling(false)} tz={tz} />
      <ConfirmationDialog open={deleting} onOpenChange={setDeleting} title="Delete this task?" description="Tasks waiting on it become unblocked. Its change history is kept." confirmLabel="Delete task" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </>
  );
}

function Dependencies({ taskId, dependsOn, blocks }: { taskId: string; dependsOn: string[]; blocks: { id: string; title: string; status: string }[] }) {
  const open = useOpenTasks();
  const [draft, setDraft] = useState<string[] | null>(null);
  const selected = draft ?? dependsOn;
  const save = useApiMutation({ mutationFn: () => taskApi.setDependencies(taskId, selected), successMessage: 'Dependencies updated', onSuccess: () => setDraft(null) });
  const candidates = open.data?.items.filter((x) => x.id !== taskId) ?? [];
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Depends on</CardTitle>
          <CardDescription>This task cannot start until these are completed. Loops are rejected.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {candidates.length === 0 && <p className="text-[13px] text-fg-muted">No other open tasks.</p>}
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {candidates.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-fg-secondary">
              <Checkbox checked={selected.includes(c.id)} onChange={(e) => setDraft(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))} /> {c.title}
            </label>
          ))}
        </div>
        {draft && (
          <Button variant="primary" size="sm" className="mt-2" loading={save.isPending} onClick={() => save.mutate()}>
            Save dependencies
          </Button>
        )}
        {blocks.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="mb-1.5 text-xs text-fg-muted">Waiting on this task</div>
            <ul className="space-y-1 text-[13px]">
              {blocks.map((b) => (
                <li key={b.id}>
                  <Link href={`/tasks/${b.id}`} className="text-fg-secondary hover:text-primary">
                    {b.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex justify-between gap-4">
    <span className="text-fg-muted">{label}</span>
    <span className="text-right text-fg-secondary">{children}</span>
  </div>
);
