'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity as ActivityIcon, ArrowRight, CalendarPlus, CheckCircle2, Clock, ListChecks, Play, Plus, Sparkles, Target } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ActivityFormDialog } from '@/features/activities/activity-form';
import { TaskFormDialog } from '@/features/tasks/task-form';
import { AvailabilityWindowCard, ConfidenceBadge } from '@/components/app/cards';
import { DayStrip, StripLegend } from '@/components/app/day-strip';
import { DateNavigator, MetricCard, PageHeader } from '@/components/app/primitives';
import { ErrorState, SkeletonCard } from '@/components/app/states';
import { ElapsedClock, TimerControls } from '@/components/app/timer-controls';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/overlay';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { useNow } from '@/hooks/use-now';
import { useTimer } from '@/hooks/use-timer';
import { useTimerActions } from '@/hooks/use-timer-actions';
import { qk } from '@/lib/query-keys';
import { fmtDuration, fmtTime, localDateOf, relativeDay, todayIn, type LocalDate } from '@/lib/time';
import { cn, scoreTone } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { analyticsApi, availabilityApi, recommendationApi } from '@/services';
import type { Dashboard } from '@/types';

const hoursLabel = (sec: number): string => {
  const h = sec / 3600;
  return h >= 10 ? String(Math.round(h)) : (Math.round(h * 10) / 10).toString();
};

function greeting(tz: string, now: number): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(now));
  return hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function DashboardView() {
  const { user, tz, use24h } = useAuth();
  const now = useNow(30_000);
  const [date, setDate] = useState<LocalDate>(() => todayIn(tz));
  const [newActivity, setNewActivity] = useState(false);
  const [newTask, setNewTask] = useState(false);

  const dashboard = useQuery({ queryKey: qk.dashboard(date), queryFn: () => analyticsApi.dashboard(date), refetchInterval: 60_000 });
  const day = useQuery({ queryKey: qk.availabilityDay(date), queryFn: () => availabilityApi.day(date), refetchInterval: 60_000 });

  const firstName = user.displayName.split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow={<span>{greeting(tz, now)}</span>}
        title={date === todayIn(tz, now) ? `${firstName}, here is your day` : `${firstName}'s day`}
        description="Everything below is measured from your plans and tracked time."
        actions={
          <>
            <DateNavigator date={date} onChange={setDate} tz={tz} />
            <Button variant="secondary" onClick={() => setNewTask(true)}>
              <ListChecks className="size-4" /> New task
            </Button>
            <Button variant="primary" onClick={() => setNewActivity(true)}>
              <Plus className="size-4" /> New activity
            </Button>
          </>
        }
      />

      {dashboard.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : dashboard.isError || !dashboard.data ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : dashboard.data.isEmptyAccount ? (
        <FirstRun onActivity={() => setNewActivity(true)} onTask={() => setNewTask(true)} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <NowCard data={dashboard.data} tz={tz} use24h={use24h} />
            <NextActionCard />
          </div>

          <AvailabilityPanel data={dashboard.data} day={day.data} dayLoading={day.isLoading} tz={tz} use24h={use24h} />

          <Metrics data={dashboard.data} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Upcoming data={dashboard.data} tz={tz} use24h={use24h} />
            <ScoreCard data={dashboard.data} />
          </div>
        </div>
      )}

      <ActivityFormDialog open={newActivity} onOpenChange={setNewActivity} tz={tz} />
      <TaskFormDialog open={newTask} onOpenChange={setNewTask} tz={tz} />
    </>
  );
}

function FirstRun({ onActivity, onTask }: { onActivity: () => void; onTask: () => void }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="grid gap-8 p-8 md:grid-cols-[1.2fr_1fr] md:p-10">
        <div>
          <Badge tone="primary">Welcome</Badge>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-fg">Your day starts empty — that&apos;s the honest starting point.</h2>
          <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-fg-secondary">TimeFlow measures real time, so it needs something to measure. Add what you plan to do, start a timer when you do it, and the dashboard fills with numbers you can trust.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primary" onClick={onActivity}>
              <CalendarPlus className="size-4" /> Plan an activity
            </Button>
            <Button variant="secondary" onClick={onTask}>
              <ListChecks className="size-4" /> Add a task
            </Button>
          </div>
        </div>
        <ol className="space-y-4 text-sm">
          {[
            ['Plan', 'Schedule an activity or add a task with an estimate.'],
            ['Track', 'Start the timer. Elapsed time is stored, so a refresh never loses it.'],
            ['Decide', 'See real availability and an explained suggestion for what to do next.'],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-primary/40 text-[13px] font-semibold text-primary">{i + 1}</span>
              <div>
                <div className="font-medium text-fg">{t}</div>
                <div className="text-[13px] text-fg-secondary">{d}</div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** "What am I doing now, and how long?" */
function NowCard({ data, tz, use24h }: { data: Dashboard; tz: string; use24h: boolean }) {
  const { session, paused, elapsedSec } = useTimer();
  const { start } = useTimerActions();
  const upcoming = data.upcoming[0];
  return (
    <Card className={cn(session && 'border-primary/30')}>
      <CardHeader>
        <div>
          <CardTitle>Right now</CardTitle>
          <CardDescription>{session ? (paused ? 'Timer paused' : 'Tracking') : 'No timer is running'}</CardDescription>
        </div>
        {session && <TimerControls />}
      </CardHeader>
      <CardContent>
        {session ? (
          <div>
            <p className="text-[15px] text-fg-secondary">{session.activityTitle}</p>
            <ElapsedClock seconds={elapsedSec} className="mt-1 block text-[44px] leading-none text-primary" />
            {data.timer.expectedTotalSec ? (
              <div className="mt-4">
                <Progress value={(elapsedSec / data.timer.expectedTotalSec) * 100} label="Progress against the estimate" />
                <p className="mt-1.5 text-xs text-fg-muted">of an estimated {fmtDuration(data.timer.expectedTotalSec)}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-fg-secondary">{upcoming ? 'Next on your plan' : 'Nothing planned next.'}</p>
              {upcoming && (
                <p className="mt-1 text-lg font-medium text-fg">
                  {upcoming.title} <span className="tabular text-fg-secondary">· {fmtTime(upcoming.start, tz, use24h)}</span>
                </p>
              )}
            </div>
            {upcoming && upcoming.kind === 'ACTIVITY' && (
              <Button variant="primary" loading={start.isPending} onClick={() => start.mutate({ activityId: upcoming.id })}>
                <Play className="size-4" /> Start now
              </Button>
            )}
            {!upcoming && (
              <Button asChild variant="secondary">
                <Link href="/time-tracking">Start a timer</Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NextActionCard() {
  const { tz, use24h } = useAuth();
  const q = useQuery({ queryKey: qk.nextAction, queryFn: recommendationApi.next, refetchInterval: 5 * 60_000 });
  const accept = useApiMutation({ mutationFn: (id: string) => recommendationApi.accept(id), successMessage: 'Scheduled' });
  const rec = q.data?.recommendation;
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden /> Recommended next
          </CardTitle>
          <CardDescription>Best fit for the time you actually have</CardDescription>
        </div>
        {rec && <ConfidenceBadgeNumber value={rec.confidence} />}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        {q.isLoading ? (
          <SkeletonCard lines={2} className="border-0 p-0" />
        ) : rec ? (
          <>
            <div>
              <Link href={`/tasks/${rec.taskId}`} className="text-lg font-semibold text-fg hover:text-primary">
                {rec.title}
              </Link>
              <p className="tabular mt-0.5 text-[13px] text-fg-secondary">
                {fmtDuration(rec.estimatedDurationSec)} · {relativeDay(localDateOf(rec.suitableWindow.start, tz), todayIn(tz))}, {fmtTime(rec.suitableWindow.start, tz, use24h)}
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-fg-secondary">{rec.summary}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={accept.isPending} onClick={() => accept.mutate(rec.id)}>
                <CheckCircle2 className="size-4" /> Schedule it
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/recommendations">
                  See why <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <div className="text-sm text-fg-secondary">
            <p>{q.data?.emptyReason ?? 'No recommendation is available right now.'}</p>
            <Button asChild variant="secondary" size="sm" className="mt-4">
              <Link href="/tasks">Open tasks</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfidenceBadgeNumber({ value }: { value: number }) {
  return (
    <Tooltip content="How well the available information supports this suggestion.">
      <Badge tone={value >= 70 ? 'success' : value >= 45 ? 'warning' : 'danger'} className="cursor-help">
        {value}% confidence
      </Badge>
    </Tooltip>
  );
}

/** The headline feature: how much time is genuinely available, and how sure we are. */
function AvailabilityPanel({ data, day, dayLoading, tz, use24h }: { data: Dashboard; day: Awaited<ReturnType<typeof availabilityApi.day>> | undefined; dayLoading: boolean; tz: string; use24h: boolean }) {
  const m = data.metrics;
  const windows = data.windows.slice(0, 3);
  return (
    <Card className="border-success/20">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-success" aria-hidden /> Smart availability
          </CardTitle>
          <CardDescription>Free time with an explicit confidence level. Time without data is never counted as free.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/availability">
            Details <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[220px_1fr] lg:items-center">
          <div>
            <div className="tabular text-5xl font-semibold leading-none tracking-tight text-primary">{fmtDuration(m.availableSec)}</div>
            <p className="mt-2 text-[13px] text-fg-secondary">bookable today</p>
            {m.availableSec > 0 && (
              <p className="mt-1 text-xs text-fg-muted">
                {fmtDuration(m.highConfidenceAvailableSec)} of it with high confidence
              </p>
            )}
          </div>
          <div className="space-y-2">
            {windows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-sm text-fg-secondary">No free window is left in your active hours{m.unknownSec > 0 ? ' — and earlier untracked time is treated as unknown, not free' : ''}.</p>
            ) : (
              windows.map((w) => (
                <AvailabilityWindowCard
                  key={w.start}
                  window={w}
                  tz={tz}
                  use24h={use24h}
                  compact
                  action={
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/recommendations?minutes=${Math.min(240, Math.floor(w.durationSec / 60))}`}>Use this time</Link>
                    </Button>
                  }
                />
              ))
            )}
          </div>
        </div>
        {dayLoading ? <SkeletonCard lines={1} /> : day ? (
          <div>
            <DayStrip day={day} tz={tz} use24h={use24h} />
            <div className="mt-3">
              <StripLegend />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metrics({ data }: { data: Dashboard }) {
  const m = data.metrics;
  return (
    <section aria-label="Today's metrics" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <MetricCard label="Planned" value={hoursLabel(m.plannedSec)} unit="h" hint={`${m.plannedActivities} activit${m.plannedActivities === 1 ? 'y' : 'ies'}`} />
      <MetricCard label="Tracked" value={hoursLabel(m.trackedSec)} unit="h" hint={m.plannedUntrackedSec > 0 ? `${fmtDuration(m.plannedUntrackedSec)} planned, not tracked` : 'measured'} />
      <MetricCard label="Completed" value={m.completedActivities} hint={`${m.completedTasksToday} task${m.completedTasksToday === 1 ? '' : 's'} done`} icon={<CheckCircle2 className="size-4 text-fg-muted" />} />
      <MetricCard label="Pending tasks" value={m.pendingTasks} hint={m.overdueTasks > 0 ? <span className="text-danger">{m.overdueTasks} overdue</span> : 'none overdue'} icon={<ListChecks className="size-4 text-fg-muted" />} />
      <MetricCard label="Focus time" value={hoursLabel(m.focusSec)} unit="h" hint={`goal ${hoursLabel(m.focusGoalSec)}h · ${m.deepWorkSessions} deep session${m.deepWorkSessions === 1 ? '' : 's'}`} icon={<Target className="size-4 text-fg-muted" />} />
      <MetricCard label="Break time" value={fmtDuration(m.breakSec)} hint={m.leakageSec > 0 ? `${fmtDuration(m.leakageSec)} leaked in gaps` : 'no unplanned gaps'} />
    </section>
  );
}

function Upcoming({ data, tz, use24h }: { data: Dashboard; tz: string; use24h: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/timeline">
            Timeline <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {data.upcoming.length === 0 ? (
          <p className="text-sm text-fg-secondary">Nothing else is planned for the rest of this day.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.upcoming.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span aria-hidden className="h-8 w-1 rounded-full" style={{ background: b.color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">{b.title}</div>
                  <div className="tabular text-xs text-fg-muted">
                    {fmtTime(b.start, tz, use24h)} – {fmtTime(b.end, tz, use24h)} · {b.categoryName}
                  </div>
                </div>
                {b.isFixed && <Badge>Fixed</Badge>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreCard({ data }: { data: Dashboard }) {
  const m = data.metrics;
  const tone = scoreTone(m.productivityScore);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ActivityIcon className="size-4 text-primary" aria-hidden /> Productivity score
          </CardTitle>
          <CardDescription>Built only from what could be measured so far</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {m.productivityScore === null ? (
          <p className="text-sm leading-relaxed text-fg-secondary">No score yet. Nothing has been tracked on this day, and no data is not the same as a score of zero.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-[110px_1fr] sm:items-center">
            <div className="text-center sm:text-left">
              <span className={cn('tabular text-6xl font-semibold leading-none', tone === 'success' ? 'text-primary' : tone === 'warning' ? 'text-warning' : 'text-danger')}>{m.productivityScore}</span>
              <span className="text-sm text-fg-muted"> /100</span>
            </div>
            <ul className="space-y-3">
              {m.scoreBreakdown.map((c) => (
                <li key={c.key}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <Tooltip content={c.explanation}>
                      <span className="cursor-help text-fg-secondary underline decoration-dotted underline-offset-2">{c.label}</span>
                    </Tooltip>
                    <span className="tabular text-fg-muted">{Math.round(c.value * 100)}% · weight {Math.round(c.weight * 100)}%</span>
                  </div>
                  <Progress value={c.value * 100} label={c.label} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {m.unknownSec > 0 && <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-fg-muted">{fmtDuration(m.unknownSec)} of active hours so far has no plan and no tracking. It is unknown — neither free nor wasted.</p>}
      </CardContent>
    </Card>
  );
}

export { ConfidenceBadge };
