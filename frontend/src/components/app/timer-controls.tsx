'use client';

import { Check, Pause, Play, Square } from 'lucide-react';
import { useTimer } from '@/hooks/use-timer';
import { useTimerActions } from '@/hooks/use-timer-actions';
import { fmtClock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlay';

/** Pause / resume / stop for the active timer. Renders nothing when no timer is active. */
export function TimerControls({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const { session, paused, running } = useTimer();
  const { pause, resume, stop } = useTimerActions(session?.version);
  if (!session) return null;
  const busy = pause.isPending || resume.isPending || stop.isPending;
  const s = size === 'sm' ? 'icon-sm' : 'icon';
  return (
    <div className={cn('flex items-center gap-1.5', className)} role="group" aria-label="Timer controls">
      {running && (
        <Button variant="secondary" size={s} aria-label="Pause timer" disabled={busy} onClick={() => pause.mutate()}>
          <Pause className="size-4" />
        </Button>
      )}
      {paused && (
        <Button variant="primary" size={s} aria-label="Resume timer" disabled={busy} onClick={() => resume.mutate()}>
          <Play className="size-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="danger" size={s} aria-label="Stop timer options" disabled={busy}>
            <Square className="size-3.5 fill-current" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => stop.mutate({})}>
            <Square className="size-4" /> Stop timer
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => stop.mutate({ complete: true })}>
            <Check className="size-4" /> Stop and mark completed
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The ticking figure. Display only: the value is anchored to the server (see useTimer). */
export function ElapsedClock({ seconds, className }: { seconds: number; className?: string }) {
  return (
    <span className={cn('tabular font-semibold tracking-tight', className)} aria-label={`Elapsed ${fmtClock(seconds)}`}>
      {fmtClock(seconds)}
    </span>
  );
}
