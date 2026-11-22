'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity as ActivityIcon, Ban, CalendarClock, Copy, Pencil, Plus, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ActivityCard, RowMenu } from '@/components/app/cards';
import { ConfirmationDialog, FilterChips, PageHeader, Pagination, SearchInput } from '@/components/app/primitives';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/overlay';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { useDebounced } from '@/hooks/use-now';
import { useTimerActions } from '@/hooks/use-timer-actions';
import { qk } from '@/lib/query-keys';
import { fromLocalInput, toLocalInput } from '@/lib/time';
import { useAuth } from '@/providers/auth-provider';
import { activityApi } from '@/services';
import type { Activity } from '@/types';
import { useCategories } from '../shared/hooks';
import { ActivityFormDialog } from './activity-form';

const STATUS_OPTIONS = [
  { value: 'PLANNED', label: 'Planned' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'SKIPPED', label: 'Skipped' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

export function ActivitiesView() {
  const { tz, use24h } = useAuth();
  const categories = useCategories();
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [status, setStatus] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState('plannedStart');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Activity | undefined>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [rescheduling, setRescheduling] = useState<Activity | null>(null);

  const params = { q: q || undefined, status, categoryId: categoryId || undefined, sort, order: sort === 'title' ? 'asc' : 'desc', page, pageSize: 12 };
  const list = useQuery({ queryKey: qk.activities(params), queryFn: () => activityApi.list(params), placeholderData: (prev) => prev });
  const { start } = useTimerActions();

  const complete = useApiMutation({ mutationFn: (id: string) => activityApi.complete(id), successMessage: 'Marked completed' });
  const skip = useApiMutation({ mutationFn: (id: string) => activityApi.skip(id), successMessage: 'Skipped' });
  const cancel = useApiMutation({ mutationFn: (id: string) => activityApi.cancel(id), successMessage: 'Cancelled' });
  const reopen = useApiMutation({ mutationFn: (id: string) => activityApi.reopen(id), successMessage: 'Reopened' });
  const duplicate = useApiMutation({ mutationFn: (id: string) => activityApi.duplicate(id), successMessage: 'Duplicated — tracked time is not copied' });
  const remove = useApiMutation({ mutationFn: (id: string) => activityApi.remove(id), successMessage: 'Removed from your plan', onSuccess: () => setDeleting(null) });

  const filtered = Boolean(q || status.length || categoryId);
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Activities"
        description="What you plan to do, and how long it really took. Scheduled time is a plan — only tracked time counts as done."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New activity
          </Button>
        }
      />

      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap gap-3">
          <SearchInput value={search} onChange={(v) => (setSearch(v), reset())} placeholder="Search title, notes, tags…" className="w-full sm:w-80" />
          <Select aria-label="Filter by category" value={categoryId} onChange={(e) => (setCategoryId(e.target.value), reset())} className="w-full sm:w-48">
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Sort" value={sort} onChange={(e) => (setSort(e.target.value), reset())} className="w-full sm:w-44">
            <option value="plannedStart">Planned time</option>
            <option value="updatedAt">Recently updated</option>
            <option value="createdAt">Recently created</option>
            <option value="title">Title</option>
          </Select>
        </div>
        <FilterChips label="Status" options={[...STATUS_OPTIONS]} value={status} onChange={(v) => (setStatus(v), reset())} multiple />
      </div>

      {list.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : list.isError || !list.data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title={filtered ? 'No activities match these filters' : 'No activities yet'}
          description={filtered ? 'Try removing a filter or searching for something else.' : 'Plan what you intend to do. Start a timer on it later to record how long it actually took.'}
          action={
            filtered ? (
              <Button variant="outline" onClick={() => (setSearch(''), setStatus([]), setCategoryId(''))}>
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> Plan your first activity
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {list.data.items.map((a) => (
              <ActivityCard
                key={a.id}
                activity={a}
                tz={tz}
                use24h={use24h}
                onStart={() => start.mutate({ activityId: a.id })}
                onComplete={() => complete.mutate(a.id)}
                menu={
                  <RowMenu label={`Actions for ${a.title}`}>
                    <DropdownMenuItem onSelect={() => setEditing(a)}>
                      <Pencil className="size-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setRescheduling(a)}>
                      <CalendarClock className="size-4" /> Reschedule
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => duplicate.mutate(a.id)}>
                      <Copy className="size-4" /> Duplicate
                    </DropdownMenuItem>
                    {a.status === 'COMPLETED' || a.status === 'SKIPPED' || a.status === 'CANCELLED' ? (
                      <DropdownMenuItem onSelect={() => reopen.mutate(a.id)}>
                        <RotateCcw className="size-4" /> Reopen
                      </DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuItem onSelect={() => skip.mutate(a.id)}>
                          <SkipForward className="size-4" /> Skip
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => cancel.mutate(a.id)}>
                          <Ban className="size-4" /> Cancel
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={() => setDeleting(a)}>
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

      <ActivityFormDialog open={creating} onOpenChange={setCreating} tz={tz} />
      <ActivityFormDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(undefined)} tz={tz} activity={editing} />
      <RescheduleDialog activity={rescheduling} tz={tz} onClose={() => setRescheduling(null)} />
      <ConfirmationDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this activity?"
        description={`"${deleting?.title ?? ''}" will leave your plan. Time you already tracked on it is kept in your history and analytics.`}
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

function RescheduleDialog({ activity, tz, onClose }: { activity: Activity | null; tz: string; onClose: () => void }) {
  const [start, setStart] = useState('');
  const [prev, setPrev] = useState<string | null>(null);
  // Re-seed the field each time a different activity is opened.
  if (activity && prev !== activity.id) {
    setPrev(activity.id);
    setStart(activity.plannedStart ? toLocalInput(activity.plannedStart, tz) : '');
  }
  const move = useApiMutation({
    mutationFn: () => {
      const length = activity?.plannedStart && activity.plannedEnd ? new Date(activity.plannedEnd).getTime() - new Date(activity.plannedStart).getTime() : (activity?.estimatedDurationSec ?? 3600) * 1000;
      const s = new Date(fromLocalInput(start, tz));
      return activityApi.reschedule(activity!.id, { plannedStart: s.toISOString(), plannedEnd: new Date(s.getTime() + length).toISOString() });
    },
    successMessage: 'Rescheduled',
    onSuccess: onClose,
  });
  return (
    <ConfirmationDialog
      open={Boolean(activity)}
      onOpenChange={(o) => !o && onClose()}
      title="Reschedule activity"
      description="Pick the new start. The length stays the same."
      confirmLabel="Move"
      tone="primary"
      loading={move.isPending}
      onConfirm={() => start && move.mutate()}
    >
      <input type="datetime-local" aria-label="New start" value={start} onChange={(e) => setStart(e.target.value)} className="mb-4 h-10 w-full rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-fg" />
    </ConfirmationDialog>
  );
}
