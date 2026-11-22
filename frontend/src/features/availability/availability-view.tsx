'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarSearch, Plus, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AvailabilityWindowCard } from '@/components/app/cards';
import { DayStrip, STATE_META, StripLegend } from '@/components/app/day-strip';
import { DateNavigator, MetricCard, PageHeader } from '@/components/app/primitives';
import { ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { qk } from '@/lib/query-keys';
import { fmtDateShort, fmtDuration, fmtTime, todayIn, type LocalDate } from '@/lib/time';
import { useAuth } from '@/providers/auth-provider';
import { availabilityApi, userApi } from '@/services';
import type { AvailabilityRule } from '@/types';
import { ConfidenceBadge } from '@/components/app/cards';

export function AvailabilityView() {
  const { tz, use24h } = useAuth();
  const [date, setDate] = useState<LocalDate>(() => todayIn(tz));
  const day = useQuery({ queryKey: qk.availabilityDay(date), queryFn: () => availabilityApi.day(date), refetchInterval: 60_000 });

  return (
    <>
      <PageHeader
        title="Availability"
        description="When you are genuinely free — and how sure we are. Time with no plan and no tracking is unknown, never assumed free."
        actions={<DateNavigator date={date} onChange={setDate} tz={tz} />}
      />
      {day.isLoading ? (
        <LoadingState />
      ) : day.isError || !day.data ? (
        <ErrorState error={day.error} onRetry={() => void day.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Bookable" value={fmtDuration(day.data.summary.freeSec)} accent hint={`${fmtDuration(day.data.summary.highConfidenceFreeSec)} high confidence`} />
            <MetricCard label="Committed (future)" value={fmtDuration(day.data.summary.busyFutureSec)} hint="plans and timers" />
            <MetricCard label="Buffers" value={fmtDuration(day.data.summary.bufferSec)} hint="kept around fixed items" />
            <MetricCard label="Tracked" value={fmtDuration(day.data.summary.trackedSec)} hint="measured" />
            <MetricCard label="Unknown" value={fmtDuration(day.data.summary.unknownSec)} hint="no plan, no tracking" />
            <MetricCard label="Conflicts" value={day.data.summary.conflictCount} hint={day.data.summary.conflictCount ? <span className="text-danger">needs attention</span> : 'none'} />
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>The whole day, classified</CardTitle>
                <CardDescription>
                  {day.data.hasExplicitAvailability ? 'Using the weekly availability you declared.' : 'Using your default active hours — declare your weekly availability below for higher confidence.'}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <DayStrip day={day.data} tz={tz} use24h={use24h} height={36} />
              <StripLegend states={['TRACKED', 'PLANNED_UNTRACKED', 'UNKNOWN', 'BUSY', 'BUFFER', 'BLOCKED', 'FREE', 'FRAGMENT']} />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="windows-h">
              <h2 id="windows-h" className="mb-3 text-lg font-semibold text-fg">
                Free windows
              </h2>
              {day.data.windows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center text-sm text-fg-secondary">
                  No bookable window on this day.
                  {day.data.summary.fragmentSec > 0 && ` ${fmtDuration(day.data.summary.fragmentSec)} of gaps are shorter than your minimum slot.`}
                </p>
              ) : (
                <div className="space-y-3">
                  {day.data.windows.map((w) => (
                    <div key={w.start}>
                      <AvailabilityWindowCard
                        window={w}
                        tz={tz}
                        use24h={use24h}
                        action={
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/recommendations?minutes=${Math.min(240, Math.floor(w.durationSec / 60))}`}>What fits?</Link>
                          </Button>
                        }
                      />
                      {w.factors.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 pl-4 text-xs text-fg-muted">
                          {w.factors.map((f) => (
                            <li key={f.code} className="list-disc">
                              {f.message} <span className="text-fg-muted/70">(−{f.penalty})</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="conflicts-h">
              <h2 id="conflicts-h" className="mb-3 text-lg font-semibold text-fg">
                Conflicts
              </h2>
              {day.data.conflicts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center text-sm text-fg-secondary">No overlapping commitments on this day.</p>
              ) : (
                <ul className="space-y-3">
                  {day.data.conflicts.map((c) => (
                    <li key={`${c.aId}${c.bId}`} className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm">
                      <div className="flex items-center gap-2 font-medium text-danger">
                        <AlertTriangle className="size-4" aria-hidden /> {c.severity === 'HARD' ? 'Two fixed commitments overlap' : 'Overlap'}
                      </div>
                      <p className="mt-1.5 text-fg-secondary">
                        “{c.aTitle}” and “{c.bTitle}” overlap for {fmtDuration(c.overlapSec)} ({fmtTime(c.start, tz, use24h)}–{fmtTime(c.end, tz, use24h)}).
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <SlotFinder date={date} />
          <WeeklyRules />
        </div>
      )}
    </>
  );
}

function SlotFinder({ date }: { date: LocalDate }) {
  const { tz, use24h } = useAuth();
  const [minutes, setMinutes] = useState('90');
  const [asked, setAsked] = useState<number | null>(null);
  const slots = useQuery({ queryKey: qk.slots({ minutes: asked, date }), queryFn: () => availabilityApi.slots({ durationMin: asked!, from: date, days: 7 }), enabled: asked !== null });
  const valid = /^\d+$/.test(minutes) && Number(minutes) >= 5 && Number(minutes) <= 720;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarSearch className="size-4 text-primary" aria-hidden /> Find time for…
          </CardTitle>
          <CardDescription>For example a deep-work session. Searches the next 7 days from the selected date.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) setAsked(Number(minutes));
          }}
        >
          <Field label="Minutes needed" error={minutes && !valid ? 'Enter 5 to 720 minutes' : undefined}>
            {(p) => <Input {...p} className="w-36" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" disabled={!valid}>
            Find slots
          </Button>
        </form>
        {asked !== null && (
          <div className="mt-5">
            {slots.isLoading ? (
              <LoadingState />
            ) : slots.isError ? (
              <ErrorState error={slots.error} />
            ) : !slots.data?.length ? (
              <p className="text-sm text-fg-secondary">No free window of {fmtDuration(asked * 60)} in the next 7 days.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {slots.data.slice(0, 8).map((s) => (
                  <li key={s.start} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5 text-sm">
                    <span className="tabular text-fg">
                      {fmtDateShort(s.date)} · {fmtTime(s.start, tz, use24h)}–{fmtTime(s.end, tz, use24h)}
                    </span>
                    <ConfidenceBadge confidence={s.confidence} score={s.confidenceScore} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
type Rule = Omit<AvailabilityRule, 'id' | 'label'> & { label?: string | null };

function WeeklyRules() {
  const rules = useQuery({ queryKey: qk.availabilityRules, queryFn: userApi.availabilityRules });
  const [draft, setDraft] = useState<Rule[]>([]);
  useEffect(() => {
    if (rules.data) setDraft(rules.data.map(({ weekday, startMinute, endMinute, kind, label }) => ({ weekday, startMinute, endMinute, kind, label })));
  }, [rules.data]);

  const save = useApiMutation({
    mutationFn: () => userApi.replaceAvailability(draft.map((r) => ({ ...r, label: r.label || undefined })) as never),
    successMessage: 'Weekly availability saved',
  });
  const update = (i: number, patch: Partial<Rule>) => setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const invalid = draft.some((r) => r.endMinute <= r.startMinute);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Weekly availability</CardTitle>
          <CardDescription>Declare when you can be scheduled (available) and when you cannot (blocked, e.g. lunch). Without any rule, your default active hours are used.</CardDescription>
        </div>
        <Button variant="primary" size="sm" disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>
          <Save className="size-3.5" /> Save
        </Button>
      </CardHeader>
      <CardContent>
        {rules.isLoading ? (
          <LoadingState />
        ) : (
          <div className="space-y-2">
            {draft.length === 0 && <p className="text-sm text-fg-secondary">No rules yet — default active hours apply.</p>}
            {draft.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select aria-label="Weekday" className="w-40" value={r.weekday} onChange={(e) => update(i, { weekday: Number(e.target.value) })}>
                  {DAYS.map((d, k) => (
                    <option key={d} value={k + 1}>
                      {d}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Type" className="w-36" value={r.kind} onChange={(e) => update(i, { kind: e.target.value as Rule['kind'] })}>
                  <option value="AVAILABLE">Available</option>
                  <option value="BLOCKED">Blocked</option>
                </Select>
                <Input aria-label="From" className="w-36" type="time" value={toTime(r.startMinute)} onChange={(e) => update(i, { startMinute: fromTime(e.target.value) })} />
                <Input aria-label="To" className="w-36" type="time" value={toTime(r.endMinute)} onChange={(e) => update(i, { endMinute: fromTime(e.target.value) })} aria-invalid={r.endMinute <= r.startMinute} />
                <Button variant="ghost" size="icon" aria-label="Remove rule" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {invalid && <p role="alert" className="text-xs text-danger">Every rule must end after it starts.</p>}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDraft((d) => [...d, { weekday: 1, startMinute: 540, endMinute: 1020, kind: 'AVAILABLE' }])}>
                <Plus className="size-3.5" /> Add rule
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft([1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020, kind: 'AVAILABLE' as const })))}
              >
                Use 09:00–17:00 on weekdays
              </Button>
            </div>
          </div>
        )}
        <p className="mt-4 flex items-center gap-2 text-xs text-fg-muted">
          <Badge>{STATE_META.UNKNOWN!.label}</Badge> time stays unknown until you plan or track something — declaring availability never marks past time as free.
        </p>
      </CardContent>
    </Card>
  );
}
