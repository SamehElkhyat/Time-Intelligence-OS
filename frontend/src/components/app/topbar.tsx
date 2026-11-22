'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, Menu } from 'lucide-react';
import Link from 'next/link';
import { useTimer } from '@/hooks/use-timer';
import { qk } from '@/lib/query-keys';
import { notificationApi } from '@/services';
import { useUiStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { Logo } from './logo';
import { ElapsedClock, TimerControls } from './timer-controls';

/** Always-visible answer to "what am I doing right now?". */
function CurrentActivity() {
  const { session, paused, elapsedSec } = useTimer();
  if (!session) {
    return (
      <Link href="/time-tracking" className="hidden items-center gap-2 rounded-full border border-border px-3.5 py-1.5 text-[13px] text-fg-secondary transition-colors hover:border-border-strong hover:text-fg sm:inline-flex">
        <span aria-hidden className="size-2 rounded-full bg-[var(--text-disabled)]" /> No active timer — start tracking
      </Link>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-full border border-primary/30 bg-primary-soft py-1 pl-4 pr-1.5" role="status" aria-live="off">
      <span aria-hidden className={paused ? 'size-2 shrink-0 rounded-full bg-warning' : 'tf-pulse size-2 shrink-0 rounded-full bg-primary'} />
      <Link href="/time-tracking" className="min-w-0 truncate text-[13px] font-medium text-fg hover:underline" title={session.activityTitle}>
        {session.activityTitle}
      </Link>
      <ElapsedClock seconds={elapsedSec} className="text-[13px] text-primary" />
      {paused && <span className="text-xs text-warning">paused</span>}
      <TimerControls size="sm" />
    </div>
  );
}

function NotificationBell() {
  const { data } = useQuery({ queryKey: qk.unreadCount, queryFn: notificationApi.unreadCount, refetchInterval: 60_000 });
  const count = data?.count ?? 0;
  return (
    <Button asChild variant="ghost" size="icon" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}>
      <Link href="/notifications" className="relative">
        <Bell className="size-[18px]" />
        {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">{count > 9 ? '9+' : count}</span>}
      </Link>
    </Button>
  );
}

export function Topbar() {
  const open = useUiStore((s) => s.setMobileNav);
  return (
    <div className="sticky top-0 z-30 flex h-[var(--topbar-height)] items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => open(true)}>
        <Menu className="size-5" />
      </Button>
      <Link href="/" className="lg:hidden" aria-label="TimeFlow home">
        <Logo collapsed />
      </Link>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <CurrentActivity />
        <NotificationBell />
      </div>
    </div>
  );
}
