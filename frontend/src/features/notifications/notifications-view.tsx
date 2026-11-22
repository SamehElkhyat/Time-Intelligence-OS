'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, BellRing, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader, Pagination } from '@/components/app/primitives';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/tabs';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { qk } from '@/lib/query-keys';
import { fmtDateTime, fromNow } from '@/lib/time';
import { cn, humanize } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { notificationApi } from '@/services';
import { useQueryClient } from '@tanstack/react-query';

export function NotificationsView() {
  const { tz, use24h } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: qk.notifications(filter === 'unread'), queryFn: () => notificationApi.list(filter === 'unread') });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['notifications'] }), qc.invalidateQueries({ queryKey: qk.unreadCount })]);
  const read = useApiMutation({ mutationFn: (id: string) => notificationApi.read(id), invalidate: false, onSuccess: refresh, silentError: true });
  const readAll = useApiMutation({ mutationFn: () => notificationApi.readAll(), invalidate: false, onSuccess: refresh, successMessage: 'All caught up' });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Reminders, deadlines and reports. Choose what you get in Preferences."
        actions={
          <>
            <Segmented label="Filter" value={filter} onChange={(v) => (setFilter(v), setPage(1))} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} />
            <Button variant="secondary" disabled={!list.data?.unreadCount} loading={readAll.isPending} onClick={() => readAll.mutate()}>
              <CheckCheck className="size-4" /> Mark all read
            </Button>
          </>
        }
      />
      {list.isLoading ? (
        <LoadingState />
      ) : list.isError || !list.data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={Bell} title={filter === 'unread' ? 'You are all caught up' : 'No notifications yet'} description="Reminders for upcoming activities, approaching deadlines, forgotten timers and weekly reports will appear here." />
      ) : (
        <>
          <Card>
            <ul className="divide-y divide-border">
              {list.data.items.slice((page - 1) * 15, page * 15).map((n) => {
                const body = (
                  <div className="flex items-start gap-3 px-5 py-4">
                    <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-full', n.readAt ? 'bg-surface-2 text-fg-muted' : 'bg-primary-soft text-primary')}>
                      <BellRing className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className={cn('text-sm', n.readAt ? 'text-fg-secondary' : 'font-semibold text-fg')}>{n.title}</span>
                        <span title={fmtDateTime(n.createdAt, tz, use24h)} className="text-xs text-fg-muted">
                          {fromNow(n.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[13px] text-fg-secondary">{n.body}</p>
                      <span className="mt-1 inline-block text-[11px] text-fg-muted">{humanize(n.type)}</span>
                    </div>
                    {!n.readAt && <span aria-label="Unread" className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link href={n.href} onClick={() => !n.readAt && read.mutate(n.id)} className="block transition-colors hover:bg-surface-2">
                        {body}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => !n.readAt && read.mutate(n.id)} className="block w-full text-left transition-colors hover:bg-surface-2">
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(list.data.items.length / 15))} onChange={setPage} />
        </>
      )}
    </>
  );
}
