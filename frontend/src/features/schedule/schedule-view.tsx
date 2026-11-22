'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Coffee, Plus, Repeat, SkipForward, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ConfirmationDialog, DateNavigator, PageHeader } from '@/components/app/primitives';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Dialog, DialogContent } from '@/components/ui/overlay';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { qk } from '@/lib/query-keys';
import { fmtDateShort, fmtDuration, fmtTime, todayIn, type LocalDate } from '@/lib/time';
import { humanize } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { scheduleApi } from '@/services';
import type { Plan, ScheduleEvent } from '@/types';
import { useCategories } from '../shared/hooks';

export function ScheduleView() {
  return (
    <>
      <PageHeader title="Schedule" description="Let TimeFlow propose an energy-aware plan for a day, and manage the commitments that repeat." />
      <Tabs defaultValue="plan">
        <TabsList aria-label="Schedule sections">
          <TabsTrigger value="plan">
            <Wand2 className="size-3.5" /> Smart plan
          </TabsTrigger>
          <TabsTrigger value="recurring">
            <Repeat className="size-3.5" /> Recurring
          </TabsTrigger>
        </TabsList>
        <TabsContent value="plan" className="mt-5 outline-none">
          <PlanTab />
        </TabsContent>
        <TabsContent value="recurring" className="mt-5 outline-none">
          <RecurringTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function PlanTab() {
  const { tz, use24h } = useAuth();
  const [date, setDate] = useState<LocalDate>(() => todayIn(tz));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const generate = useApiMutation({
    mutationFn: () => scheduleApi.plan({ date }),
    invalidate: false,
    onSuccess: (p) => (setPlan(p), setPicked(new Set(p.blocks.map((b) => b.taskId)))),
  });
  const apply = useApiMutation({
    mutationFn: () => scheduleApi.apply((plan?.blocks ?? []).filter((b) => picked.has(b.taskId)).map((b) => ({ taskId: b.taskId, start: b.start, end: b.end }))),
    onSuccess: (r) => {
      if (r.failed.length) {
        const failed = new Set(r.failed.map((f) => f.taskId));
        setPicked(failed);
        setPlan((p) => (p ? { ...p, blocks: p.blocks.filter((b) => failed.has(b.taskId)) } : p));
      } else setPlan(null);
    },
    successMessage: (r) => `${r.created.length} block${r.created.length === 1 ? '' : 's'} scheduled${r.failed.length ? ` — ${r.failed.length} could not be placed` : ''}`,
  });
  const failures = apply.data?.failed ?? [];

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <DateNavigator date={date} onChange={(d) => (setDate(d), setPlan(null))} tz={tz} />
          <Button variant="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
            <Wand2 className="size-4" /> Propose a plan
          </Button>
        </CardContent>
      </Card>

      {!plan ? (
        <EmptyState icon={Wand2} title="No plan yet" description="Proposing a plan does not change anything. It places your open tasks into free windows, matching their energy and focus needs to when you tend to have them, and you choose what to apply." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Free time" value={fmtDuration(plan.freeSec)} />
            <Stat label="Proposed work" value={fmtDuration(plan.scheduledSec)} accent />
            <Stat label="Tasks considered" value={String(plan.consideredTasks)} />
          </div>
          {plan.energyUnknown && (
            <p role="status" className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-warning">
              There is no energy data for this plan, so tasks were placed by deadline and preference only. Log your energy for a few days to unlock energy-matched placement.
            </p>
          )}

          {failures.length > 0 && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
              Some blocks could not be applied because the calendar changed:
              <ul className="mt-1 list-disc pl-5">
                {failures.map((f) => (
                  <li key={f.taskId}>{f.message}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.blocks.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="Nothing could be placed" description="Open tasks did not fit any free window on this day — see below." />
          ) : (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Proposed blocks</CardTitle>
                  <CardDescription>Untick anything you do not want. Each block is re-checked against your calendar when applied.</CardDescription>
                </div>
                <Button variant="primary" size="sm" disabled={picked.size === 0} loading={apply.isPending} onClick={() => apply.mutate()}>
                  Apply {picked.size} block{picked.size === 1 ? '' : 's'}
                </Button>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {[...plan.blocks, ...plan.breaks.map((b) => ({ ...b, isBreak: true as const }))]
                    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
                    .map((b) =>
                      'isBreak' in b ? (
                        <li key={`break-${b.start}`} className="flex items-start gap-3 py-3 pl-7 text-[13px] text-fg-muted">
                          <Coffee className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                          <span>
                            <span className="tabular text-fg-secondary">
                              {fmtTime(b.start, tz, use24h)} – {fmtTime(b.end, tz, use24h)}
                            </span>{' '}
                            Suggested break. {b.reason}
                          </span>
                        </li>
                      ) : (
                        <li key={b.taskId} className="flex items-start gap-3 py-3.5">
                          <Checkbox
                            className="mt-1"
                            aria-label={`Include ${b.title}`}
                            checked={picked.has(b.taskId)}
                            onChange={(e) => setPicked((s) => (e.target.checked ? new Set(s).add(b.taskId) : new Set([...s].filter((x) => x !== b.taskId))))}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="text-sm font-medium text-fg">{b.title}</span>
                              <span className="tabular text-[13px] text-fg-secondary">
                                {fmtTime(b.start, tz, use24h)} – {fmtTime(b.end, tz, use24h)}
                              </span>
                              <Badge tone={b.fitScore >= 70 ? 'success' : b.fitScore >= 45 ? 'warning' : 'danger'}>fit {b.fitScore}</Badge>
                              {b.afterDeadline && <Badge tone="danger">After deadline</Badge>}
                            </div>
                            <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
                              {b.reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        </li>
                      ),
                    )}
                </ul>
              </CardContent>
            </Card>
          )}

          {plan.unscheduled.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Could not be placed</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {plan.unscheduled.map((u) => (
                    <li key={u.taskId} className="flex flex-wrap justify-between gap-x-4 text-fg-secondary">
                      <span className="text-fg">{u.title}</span>
                      <span className="text-[13px] text-fg-muted">{u.reason}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
      {generate.isError && <ErrorState error={generate.error} />}
    </div>
  );
}

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <Card className="p-4">
    <div className="text-[13px] text-fg-secondary">{label}</div>
    <div className={`tabular mt-1 text-2xl font-semibold ${accent ? 'text-primary' : 'text-fg'}`}>{value}</div>
  </Card>
);

// ── recurring commitments ────────────────────────────────────────────────────
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const eventSchema = z
  .object({
    title: z.string().trim().min(1, 'Give it a title').max(160),
    categoryId: z.string().min(1, 'Choose a category'),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time'),
    durationMin: z.string().regex(/^\d+$/, 'Whole minutes').refine((v) => Number(v) >= 5 && Number(v) <= 1440, 'Enter 5 to 1440'),
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
    byWeekday: z.array(z.string()),
    isFixed: z.boolean(),
  })
  .refine((v) => v.frequency !== 'WEEKLY' || v.byWeekday.length > 0, { path: ['byWeekday'], message: 'Pick at least one weekday' });
type EventValues = z.infer<typeof eventSchema>;

function RecurringTab() {
  const { tz, use24h } = useAuth();
  const events = useQuery({ queryKey: qk.scheduleEvents, queryFn: scheduleApi.events });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ScheduleEvent | null>(null);
  const remove = useApiMutation({ mutationFn: (id: string) => scheduleApi.removeEvent(id), successMessage: 'Recurring commitment deleted', onSuccess: () => setDeleting(null) });
  const skip = useApiMutation({ mutationFn: (v: { id: string; date: string }) => scheduleApi.skipOccurrence(v.id, v.date), successMessage: 'That occurrence is skipped' });
  void tz;
  void use24h;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New recurring commitment
        </Button>
      </div>
      {events.isLoading ? (
        <LoadingState />
      ) : events.isError || !events.data ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <EmptyState icon={Repeat} title="No recurring commitments" description="Stand-ups, classes, gym sessions — add what repeats and it appears in your availability on every matching day, at the same local time even across daylight-saving changes." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {events.data.map((e) => (
            <Card key={e.id} className={e.isActive ? '' : 'opacity-60'}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-medium text-fg">{e.title}</div>
                    <div className="tabular mt-0.5 text-[13px] text-fg-secondary">
                      {String(Math.floor(e.startMinute / 60)).padStart(2, '0')}:{String(e.startMinute % 60).padStart(2, '0')} · {fmtDuration(e.durationMin * 60)} · {e.category.name}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${e.title}`} onClick={() => setDeleting(e)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge>{humanize(e.recurrence.frequency)}</Badge>
                  {e.recurrence.byWeekday.map((d) => (
                    <Badge key={d}>{WEEKDAYS[d - 1]}</Badge>
                  ))}
                  {e.isFixed && <Badge tone="primary">Fixed</Badge>}
                </div>
                {e.nextOccurrences.length > 0 && (
                  <div className="mt-3 border-t border-border pt-3 text-xs text-fg-muted">
                    Next:{' '}
                    {e.nextOccurrences.slice(0, 3).map((d, i) => (
                      <span key={d}>
                        {i > 0 && ', '}
                        {fmtDateShort(d)}
                        <button type="button" onClick={() => skip.mutate({ id: e.id, date: d })} className="ml-1 inline-flex align-middle text-fg-muted hover:text-warning" aria-label={`Skip ${fmtDateShort(d)}`} title="Skip this occurrence">
                          <SkipForward className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <EventDialog open={creating} onOpenChange={setCreating} />
      <ConfirmationDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this recurring commitment?"
        description={`Future occurrences of "${deleting?.title ?? ''}" disappear from your plan. Past tracked occurrences stay in your history.`}
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

function EventDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const categories = useCategories();
  const { register, handleSubmit, watch, reset, formState } = useForm<EventValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: { title: '', categoryId: '', time: '09:00', durationMin: '30', frequency: 'WEEKLY', byWeekday: ['1', '2', '3', '4', '5'], isFixed: true },
  });
  const frequency = watch('frequency');
  const create = useApiMutation({
    mutationFn: (v: EventValues) => {
      const [h, m] = v.time.split(':').map(Number);
      return scheduleApi.createEvent({
        title: v.title,
        categoryId: v.categoryId,
        startMinute: (h ?? 0) * 60 + (m ?? 0),
        durationMin: Number(v.durationMin),
        isFixed: v.isFixed,
        recurrence: { frequency: v.frequency, ...(v.frequency === 'WEEKLY' ? { byWeekday: v.byWeekday.map(Number) } : {}) },
      });
    },
    successMessage: 'Recurring commitment added',
    onSuccess: () => (onOpenChange(false), reset()),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New recurring commitment" description="Defined in your local time, so it stays at the same wall-clock time all year.">
        <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="space-y-4">
          <Field label="Title" error={formState.errors.title?.message}>
            {(p) => <Input {...p} autoFocus {...register('title')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" error={formState.errors.categoryId?.message}>
              {(p) => (
                <Select {...p} {...register('categoryId')}>
                  <option value="">Select…</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Repeats">
              {(p) => (
                <Select {...p} {...register('frequency')}>
                  <option value="DAILY">Every day</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts at" error={formState.errors.time?.message}>
              {(p) => <Input {...p} type="time" {...register('time')} />}
            </Field>
            <Field label="Duration (minutes)" error={formState.errors.durationMin?.message}>
              {(p) => <Input {...p} inputMode="numeric" {...register('durationMin')} />}
            </Field>
          </div>
          {frequency === 'WEEKLY' && (
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-fg-secondary">On</legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d, i) => (
                  <label key={d} className="cursor-pointer">
                    <input type="checkbox" value={String(i + 1)} className="peer sr-only" {...register('byWeekday')} />
                    <span className="inline-block rounded-md border border-border px-3 py-1.5 text-[13px] text-fg-secondary transition-colors peer-checked:border-primary/40 peer-checked:bg-primary-soft peer-checked:text-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-primary">{d}</span>
                  </label>
                ))}
              </div>
              {formState.errors.byWeekday && <p role="alert" className="mt-1.5 text-xs text-danger">{formState.errors.byWeekday.message}</p>}
            </fieldset>
          )}
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-fg-secondary">
            <Checkbox {...register('isFixed')} /> Fixed commitment (gets buffers; cannot be moved by the planner)
          </label>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Add commitment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
