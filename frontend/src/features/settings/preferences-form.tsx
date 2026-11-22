'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { userApi } from '@/services';
import type { Preference } from '@/types';

const toTime = (m: number | null) => (m === null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const fromTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const intRange = (label: string, min: number, max: number) => z.string().regex(/^\d+$/, 'Whole number').refine((v) => Number(v) >= min && Number(v) <= max, `${label}: ${min} to ${max}`);

export const preferencesSchema = z
  .object({
    timezone: z.string().min(1, 'Choose a time zone'),
    locale: z.string().min(2).max(16),
    weekStartsOn: z.string(),
    use24HourClock: z.boolean(),
    dayStart: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time'),
    dayEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time'),
    bufferMinutes: intRange('Buffer', 0, 60),
    minSlotMinutes: intRange('Minimum slot', 5, 120),
    deepWorkMinMinutes: intRange('Deep work', 20, 240),
    dailyFocusGoalHours: z.string().regex(/^\d+(\.\d)?$/, 'Use hours, e.g. 4 or 3.5').refine((v) => Number(v) >= 0.25 && Number(v) <= 16, '0.25 to 16 hours'),
    breakAfterMinutes: intRange('Break interval', 25, 360),
    focusStart: z.string().optional(),
    focusEnd: z.string().optional(),
    notifyActivityReminders: z.boolean(),
    notifyDeadlines: z.boolean(),
    notifyWeeklyReport: z.boolean(),
    reminderLeadMinutes: intRange('Reminder lead', 0, 120),
  })
  .refine((v) => fromTime(v.dayEnd) > fromTime(v.dayStart), { path: ['dayEnd'], message: 'Your day must end after it starts' })
  .refine((v) => !!v.focusStart === !!v.focusEnd, { path: ['focusEnd'], message: 'Set both ends of the focus window, or neither' })
  .refine((v) => !v.focusStart || !v.focusEnd || fromTime(v.focusEnd) > fromTime(v.focusStart), { path: ['focusEnd'], message: 'The focus window must end after it starts' });
export type PreferencesValues = z.infer<typeof preferencesSchema>;

export const toFormValues = (p: Preference): PreferencesValues => ({
  timezone: p.timezone,
  locale: p.locale,
  weekStartsOn: String(p.weekStartsOn),
  use24HourClock: p.use24HourClock,
  dayStart: toTime(p.dayStartMinute),
  dayEnd: toTime(p.dayEndMinute),
  bufferMinutes: String(p.bufferMinutes),
  minSlotMinutes: String(p.minSlotMinutes),
  deepWorkMinMinutes: String(p.deepWorkMinMinutes),
  dailyFocusGoalHours: String(p.dailyFocusGoalMinutes / 60),
  breakAfterMinutes: String(p.breakAfterMinutes),
  focusStart: toTime(p.focusPeakStartMinute),
  focusEnd: toTime(p.focusPeakEndMinute),
  notifyActivityReminders: p.notifyActivityReminders,
  notifyDeadlines: p.notifyDeadlines,
  notifyWeeklyReport: p.notifyWeeklyReport,
  reminderLeadMinutes: String(p.reminderLeadMinutes),
});

export const toPayload = (v: PreferencesValues) => ({
  timezone: v.timezone,
  locale: v.locale,
  weekStartsOn: Number(v.weekStartsOn),
  use24HourClock: v.use24HourClock,
  dayStartMinute: fromTime(v.dayStart),
  dayEndMinute: fromTime(v.dayEnd),
  bufferMinutes: Number(v.bufferMinutes),
  minSlotMinutes: Number(v.minSlotMinutes),
  deepWorkMinMinutes: Number(v.deepWorkMinMinutes),
  dailyFocusGoalMinutes: Math.round(Number(v.dailyFocusGoalHours) * 60),
  breakAfterMinutes: Number(v.breakAfterMinutes),
  focusPeakStartMinute: v.focusStart ? fromTime(v.focusStart) : null,
  focusPeakEndMinute: v.focusEnd ? fromTime(v.focusEnd) : null,
  notifyActivityReminders: v.notifyActivityReminders,
  notifyDeadlines: v.notifyDeadlines,
  notifyWeeklyReport: v.notifyWeeklyReport,
  reminderLeadMinutes: Number(v.reminderLeadMinutes),
});

export function useTimezones(current: string): string[] {
  return useMemo(() => {
    let zones: string[] = [];
    try {
      zones = Intl.supportedValuesOf('timeZone');
    } catch {
      zones = [];
    }
    if (!zones.includes('UTC')) zones.unshift('UTC');
    return zones.includes(current) ? zones : [current, ...zones];
  }, [current]);
}

/** The time zone decides what a "day" is for every calculation, so changing it is called out explicitly. */
export function PreferencesForm({ preference }: { preference: Preference }) {
  const qc = useQueryClient();
  const zones = useTimezones(preference.timezone);
  const { register, handleSubmit, reset, formState } = useForm<PreferencesValues>({ resolver: zodResolver(preferencesSchema), defaultValues: toFormValues(preference) });
  useEffect(() => {
    reset(toFormValues(preference));
  }, [preference, reset]);

  const save = useApiMutation({
    mutationFn: (v: PreferencesValues) => userApi.updatePreferences(toPayload(v) as never),
    successMessage: 'Preferences saved',
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.session });
    },
  });
  const e = formState.errors;

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-8">
      <section aria-labelledby="p-time" className="space-y-4">
        <h2 id="p-time" className="text-base font-semibold text-fg">
          Time and region
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time zone" hint="Defines what a day means for every calculation." error={e.timezone?.message}>
            {(p) => (
              <Select {...p} {...register('timezone')}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Language / region" error={e.locale?.message}>
            {(p) => (
              <Select {...p} {...register('locale')}>
                {['en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-ES', 'ar-EG'].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Week starts on">
            {(p) => (
              <Select {...p} {...register('weekStartsOn')}>
                <option value="1">Monday</option>
                <option value="6">Saturday</option>
                <option value="7">Sunday</option>
              </Select>
            )}
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 self-end pb-2.5 text-sm text-fg-secondary">
            <Checkbox {...register('use24HourClock')} /> Use 24-hour clock
          </label>
        </div>
      </section>

      <section aria-labelledby="p-sched" className="space-y-4">
        <h2 id="p-sched" className="text-base font-semibold text-fg">
          Scheduling
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Day starts" error={e.dayStart?.message}>
            {(p) => <Input {...p} type="time" {...register('dayStart')} />}
          </Field>
          <Field label="Day ends" error={e.dayEnd?.message}>
            {(p) => <Input {...p} type="time" {...register('dayEnd')} />}
          </Field>
          <Field label="Buffer around fixed items (min)" error={e.bufferMinutes?.message}>
            {(p) => <Input {...p} inputMode="numeric" {...register('bufferMinutes')} />}
          </Field>
          <Field label="Shortest free slot to offer (min)" error={e.minSlotMinutes?.message}>
            {(p) => <Input {...p} inputMode="numeric" {...register('minSlotMinutes')} />}
          </Field>
          <Field label="Deep-work block from (min)" error={e.deepWorkMinMinutes?.message}>
            {(p) => <Input {...p} inputMode="numeric" {...register('deepWorkMinMinutes')} />}
          </Field>
          <Field label="Suggest a break after (min)" error={e.breakAfterMinutes?.message}>
            {(p) => <Input {...p} inputMode="numeric" {...register('breakAfterMinutes')} />}
          </Field>
          <Field label="Daily focus goal (hours)" error={e.dailyFocusGoalHours?.message}>
            {(p) => <Input {...p} inputMode="decimal" {...register('dailyFocusGoalHours')} />}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-fg-secondary">My best focus window (optional)</legend>
          <p className="mb-3 text-xs text-fg-muted">Only if you know it. Without it, TimeFlow learns your rhythm from your own energy check-ins instead of assuming a typical one.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" error={e.focusStart?.message}>
              {(p) => <Input {...p} type="time" {...register('focusStart')} />}
            </Field>
            <Field label="To" error={e.focusEnd?.message}>
              {(p) => <Input {...p} type="time" {...register('focusEnd')} />}
            </Field>
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="p-notif" className="space-y-3">
        <h2 id="p-notif" className="text-base font-semibold text-fg">
          Notifications
        </h2>
        {(
          [
            ['notifyActivityReminders', 'Remind me before planned activities'],
            ['notifyDeadlines', 'Warn me when a task deadline is approaching'],
            ['notifyWeeklyReport', 'Tell me when my weekly report is ready'],
          ] as const
        ).map(([name, label]) => (
          <label key={name} className="flex cursor-pointer items-center gap-2.5 text-sm text-fg-secondary">
            <Checkbox {...register(name)} /> {label}
          </label>
        ))}
        <div className="max-w-xs pt-1">
          <Field label="Reminder lead time (min)" error={e.reminderLeadMinutes?.message}>
            {(p) => <Input {...p} inputMode="numeric" {...register('reminderLeadMinutes')} />}
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-3 border-t border-border pt-5">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!formState.isDirty}>
          Save preferences
        </Button>
        {formState.isDirty && (
          <Button variant="ghost" onClick={() => reset(toFormValues(preference))}>
            Discard changes
          </Button>
        )}
      </div>
    </form>
  );
}
