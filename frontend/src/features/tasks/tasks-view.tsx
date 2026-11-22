'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckSquare, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { RowMenu, TaskCard } from '@/components/app/cards';
import { ConfirmationDialog, FilterChips, PageHeader, Pagination, SearchInput } from '@/components/app/primitives';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Segmented } from '@/components/ui/tabs';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { useDebounced, useNow } from '@/hooks/use-now';
import { qk } from '@/lib/query-keys';
import { fromLocalInput } from '@/lib/time';
import { useAuth } from '@/providers/auth-provider';
import { taskApi } from '@/services';
import type { Task } from '@/types';
import { TaskFormDialog } from './task-form';

type View = 'open' | 'backlog' | 'completed' | 'all';
const VIEW_STATUS: Record<View, string[]> = { open: ['TODO', 'IN_PROGRESS'], backlog: ['BACKLOG'], completed: ['COMPLETED'], all: [] };

export function TasksView() {
  const { tz, use24h } = useAuth();
  const now = useNow(60_000);
  const [view, setView] = useState<View>('open');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [priority, setPriority] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [sort, setSort] = useState('deadline');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Task | undefined>();
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);

  const params = { status: VIEW_STATUS[view], priority, q: q || undefined, due: due || undefined, sort, page, pageSize: 15 };
  const list = useQuery({ queryKey: qk.tasks(params), queryFn: () => taskApi.list(params), placeholderData: (p) => p });
  const complete = useApiMutation({ mutationFn: (id: string) => taskApi.complete(id), successMessage: 'Task completed' });
  const reopen = useApiMutation({ mutationFn: (id: string) => taskApi.reopen(id), successMessage: 'Task reopened' });
  const remove = useApiMutation({ mutationFn: (id: string) => taskApi.remove(id), successMessage: 'Task deleted', onSuccess: () => setDeleting(null) });
  const reset = () => setPage(1);
  const filtered = Boolean(q || priority.length || due);

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Work with an estimate, a deadline and the energy it needs. Recommendations match them to the time you really have."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New task
          </Button>
        }
      />
      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Task view"
            value={view}
            onChange={(v) => (setView(v), reset())}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'backlog', label: 'Backlog' },
              { value: 'completed', label: 'Completed' },
              { value: 'all', label: 'All' },
            ]}
          />
          <SearchInput value={search} onChange={(v) => (setSearch(v), reset())} placeholder="Search tasks…" className="w-full sm:w-72" />
          <Select aria-label="Due" value={due} onChange={(e) => (setDue(e.target.value), reset())} className="w-full sm:w-40">
            <option value="">Any deadline</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Next 7 days</option>
            <option value="none">No deadline</option>
          </Select>
          <Select aria-label="Sort" value={sort} onChange={(e) => (setSort(e.target.value), reset())} className="w-full sm:w-40">
            <option value="deadline">Deadline</option>
            <option value="priority">Priority</option>
            <option value="createdAt">Newest</option>
            <option value="title">Title</option>
          </Select>
        </div>
        <FilterChips label="Priority" multiple value={priority as never[]} onChange={(v) => (setPriority(v), reset())} options={['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() })) as never} />
      </div>

      {list.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : list.isError || !list.data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={filtered ? 'No tasks match these filters' : view === 'completed' ? 'Nothing completed yet' : 'No tasks here'}
          description={filtered ? 'Try clearing a filter.' : 'Add a task with an estimate and a deadline — TimeFlow will tell you when it fits.'}
          action={
            filtered ? (
              <Button variant="outline" onClick={() => (setSearch(''), setPriority([]), setDue(''))}>
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> Add a task
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {list.data.items.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                tz={tz}
                use24h={use24h}
                now={now}
                onComplete={() => complete.mutate(t.id)}
                onToggleBusy={complete.isPending}
                onSchedule={() => setScheduling(t)}
                menu={
                  <RowMenu label={`Actions for ${t.title}`}>
                    <DropdownMenuItem onSelect={() => setEditing(t)}>
                      <Pencil className="size-4" /> Edit
                    </DropdownMenuItem>
                    {t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && (
                      <DropdownMenuItem onSelect={() => setScheduling(t)}>
                        <CalendarClock className="size-4" /> Schedule work block
                      </DropdownMenuItem>
                    )}
                    {(t.status === 'COMPLETED' || t.status === 'CANCELLED') && (
                      <DropdownMenuItem onSelect={() => reopen.mutate(t.id)}>
                        <RotateCcw className="size-4" /> Reopen
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={() => setDeleting(t)}>
                      <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                  </RowMenu>
                }
              />
            ))}
          </div>
          <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} onChange={setPage} />
        </>
      )}

      <TaskFormDialog open={creating} onOpenChange={setCreating} tz={tz} />
      <TaskFormDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(undefined)} tz={tz} task={editing} />
      <ScheduleTaskDialog task={scheduling} onClose={() => setScheduling(null)} tz={tz} />
      <ConfirmationDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this task?"
        description={`"${deleting?.title ?? ''}" will be removed, and tasks that were waiting on it become unblocked. Its change history is kept.`}
        confirmLabel="Delete task"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

export function ScheduleTaskDialog({ task, onClose, tz }: { task: Task | null; onClose: () => void; tz: string }) {
  const [start, setStart] = useState('');
  const schedule = useApiMutation({
    mutationFn: () => taskApi.schedule(task!.id, { start: fromLocalInput(start, tz) }),
    successMessage: 'Work block scheduled',
    onSuccess: () => (setStart(''), onClose()),
  });
  return (
    <ConfirmationDialog
      open={Boolean(task)}
      onOpenChange={(o) => !o && onClose()}
      title="Schedule a work block"
      description={task ? `A block as long as the estimate will be added to your calendar for "${task.title}". It is rejected if it overlaps a fixed commitment.` : ''}
      confirmLabel="Schedule"
      tone="primary"
      loading={schedule.isPending}
      onConfirm={() => start && schedule.mutate()}
    >
      <Field label="Starts" hint={`Time zone: ${tz}`} className="mb-4">
        {(p) => <Input {...p} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}
      </Field>
    </ConfirmationDialog>
  );
}
