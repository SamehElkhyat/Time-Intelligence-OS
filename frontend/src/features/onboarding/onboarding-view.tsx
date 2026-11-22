'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { qk } from '@/lib/query-keys';
import { browserTimezone } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { userApi } from '@/services';
import { useTimezones } from '../settings/preferences-form';

const fromTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const schema = z
  .object({
    timezone: z.string().min(1, 'Choose a time zone'),
    dayStart: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time'),
    dayEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time'),
    focusHours: z.string().regex(/^\d+(\.\d)?$/, 'Use hours, e.g. 3 or 2.5').refine((v) => Number(v) >= 0.25 && Number(v) <= 16, '0.25 to 16 hours'),
    weekdaysOnly: z.boolean(),
  })
  .refine((v) => fromTime(v.dayEnd) > fromTime(v.dayStart), { path: ['dayEnd'], message: 'Your day must end after it starts' });
type Values = z.infer<typeof schema>;

const STEPS = ['Your day', 'Your focus', 'Done'];

/** Three quick questions that make availability accurate from the first day. */
export function OnboardingView() {
  const { preference, user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const zones = useTimezones(preference.timezone);
  const detected = browserTimezone();
  const { register, handleSubmit, trigger, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { timezone: preference.timezone, dayStart: '08:00', dayEnd: '22:00', focusHours: '4', weekdaysOnly: false },
  });

  const finish = useApiMutation({
    mutationFn: async (v: Values) => {
      await userApi.updatePreferences({ timezone: v.timezone, dayStartMinute: fromTime(v.dayStart), dayEndMinute: fromTime(v.dayEnd), dailyFocusGoalMinutes: Math.round(Number(v.focusHours) * 60) } as never);
      if (v.weekdaysOnly) {
        await userApi.replaceAvailability([1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: fromTime(v.dayStart), endMinute: fromTime(v.dayEnd), kind: 'AVAILABLE' as const })) as never);
      }
      return userApi.completeOnboarding();
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.session });
      router.replace('/');
    },
  });
  const next = async (fields: (keyof Values)[]) => (await trigger(fields)) && setStep((s) => s + 1);

  return (
    <div className="mx-auto max-w-xl py-6">
      <ol aria-label="Progress" className="mb-8 flex items-center gap-3">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className="flex flex-1 items-center gap-2 text-[13px]">
            <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold', i < step ? 'border-primary bg-primary text-primary-foreground' : i === step ? 'border-primary text-primary' : 'border-border text-fg-muted')}>
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={i === step ? 'font-medium text-fg' : 'text-fg-muted'}>{s}</span>
            {i < STEPS.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>

      <Card>
        <CardContent className="p-7">
          <form onSubmit={handleSubmit((v) => finish.mutate(v))} noValidate>
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-fg">Welcome, {user.displayName.split(' ')[0]}</h1>
                  <p className="mt-1.5 text-sm text-fg-secondary">Two answers now make your availability accurate from the start.</p>
                </div>
                <Field label="Your time zone" hint={detected !== preference.timezone ? `Your browser reports ${detected}.` : 'Detected from your browser.'} error={formState.errors.timezone?.message}>
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="My day starts" error={formState.errors.dayStart?.message}>
                    {(p) => <Input {...p} type="time" {...register('dayStart')} />}
                  </Field>
                  <Field label="My day ends" error={formState.errors.dayEnd?.message}>
                    {(p) => <Input {...p} type="time" {...register('dayEnd')} />}
                  </Field>
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fg-secondary">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...register('weekdaysOnly')} />
                  <span>I am only available Monday to Friday (weekends are treated as unavailable).</span>
                </label>
                <Button type="button" variant="primary" onClick={() => void next(['timezone', 'dayStart', 'dayEnd'])}>
                  Continue <ArrowRight className="size-4" />
                </Button>
              </div>
            )}
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-fg">How much focused work is a good day?</h1>
                  <p className="mt-1.5 text-sm text-fg-secondary">Focus time is uninterrupted productive work of 25+ minutes. This is only the goal your dashboard measures against — you can change it any time.</p>
                </div>
                <Field label="Daily focus goal (hours)" error={formState.errors.focusHours?.message}>
                  {(p) => <Input {...p} inputMode="decimal" className="max-w-40" {...register('focusHours')} />}
                </Field>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setStep(0)}>
                    Back
                  </Button>
                  <Button type="button" variant="primary" onClick={() => void next(['focusHours'])}>
                    Continue <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-fg">You&apos;re set</h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-secondary">
                    Next: plan an activity or add a task, then start the timer when you begin. TimeFlow only reports what it can measure, so your first days will show &quot;unknown&quot; time — that is expected and honest.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button type="submit" variant="primary" loading={finish.isPending}>
                    Go to my dashboard
                  </Button>
                </div>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
      <button type="button" onClick={() => void userApi.completeOnboarding().then(() => qc.invalidateQueries({ queryKey: qk.session })).then(() => router.replace('/'))} className="mx-auto mt-5 block text-[13px] text-fg-muted hover:text-fg">
        Skip for now
      </button>
    </div>
  );
}
