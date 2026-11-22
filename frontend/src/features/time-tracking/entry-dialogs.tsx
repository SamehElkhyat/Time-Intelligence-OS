'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, DialogContent } from '@/components/ui/overlay';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { fromLocalInput, toLocalInput } from '@/lib/time';
import { timerApi } from '@/services';
import type { TimeSession } from '@/types';

const range = z
  .object({ startedAt: z.string().min(1, 'Choose a start'), endedAt: z.string().min(1, 'Choose an end') })
  .refine((v) => !v.startedAt || !v.endedAt || v.endedAt > v.startedAt, { path: ['endedAt'], message: 'The end must be after the start' });

export const manualSchema = z
  .object({ activityId: z.string().min(1, 'Choose an activity'), note: z.string().max(2000).optional(), startedAt: z.string().min(1, 'Choose a start'), endedAt: z.string().min(1, 'Choose an end') })
  .refine((v) => v.endedAt > v.startedAt, { path: ['endedAt'], message: 'The end must be after the start' })
  .refine((v) => new Date(v.endedAt).getTime() - new Date(v.startedAt).getTime() <= 24 * 3_600_000, { path: ['endedAt'], message: 'An entry can be at most 24 hours' });
export type ManualValues = z.infer<typeof manualSchema>;

export const correctionSchema = range.extend({ reason: z.string().trim().min(3, 'Say briefly why (at least 3 characters)').max(300) });
export type CorrectionValues = z.infer<typeof correctionSchema>;

export function ManualEntryDialog({ open, onOpenChange, tz, activities }: { open: boolean; onOpenChange: (o: boolean) => void; tz: string; activities: { id: string; title: string }[] }) {
  const { register, handleSubmit, reset, formState } = useForm<ManualValues>({ resolver: zodResolver(manualSchema), defaultValues: { activityId: '', startedAt: '', endedAt: '', note: '' } });
  useEffect(() => {
    if (open) reset({ activityId: '', startedAt: '', endedAt: '', note: '' });
  }, [open, reset]);
  const save = useApiMutation({
    mutationFn: (v: ManualValues) => timerApi.manual({ activityId: v.activityId, startedAt: fromLocalInput(v.startedAt, tz), endedAt: fromLocalInput(v.endedAt, tz), note: v.note || undefined }),
    successMessage: 'Time entry added',
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add time entry" description="Record time you tracked elsewhere. Entries cannot overlap tracked time or end in the future.">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
          <Field label="Activity" error={formState.errors.activityId?.message}>
            {(p) => (
              <Select {...p} {...register('activityId')}>
                <option value="">Select…</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Started" hint={`Time zone: ${tz}`} error={formState.errors.startedAt?.message}>
              {(p) => <Input {...p} type="datetime-local" {...register('startedAt')} />}
            </Field>
            <Field label="Ended" error={formState.errors.endedAt?.message}>
              {(p) => <Input {...p} type="datetime-local" {...register('endedAt')} />}
            </Field>
          </div>
          <Field label="Note">{(p) => <Textarea {...p} rows={2} {...register('note')} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Add entry
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CorrectEntryDialog({ session, onOpenChange, tz }: { session: TimeSession | null; onOpenChange: (o: boolean) => void; tz: string }) {
  const { register, handleSubmit, reset, formState } = useForm<CorrectionValues>({ resolver: zodResolver(correctionSchema), defaultValues: { startedAt: '', endedAt: '', reason: '' } });
  useEffect(() => {
    if (session?.endedAt) reset({ startedAt: toLocalInput(session.startedAt, tz), endedAt: toLocalInput(session.endedAt, tz), reason: '' });
  }, [session, tz, reset]);
  const save = useApiMutation({
    mutationFn: (v: CorrectionValues) => timerApi.correct(session!.id, { startedAt: fromLocalInput(v.startedAt, tz), endedAt: fromLocalInput(v.endedAt, tz), reason: v.reason }),
    successMessage: 'Entry corrected — the previous values are kept in its history',
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={Boolean(session)} onOpenChange={onOpenChange}>
      <DialogContent title="Correct time entry" description="The original values are preserved in the entry's audit trail.">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Started" error={formState.errors.startedAt?.message}>
              {(p) => <Input {...p} type="datetime-local" {...register('startedAt')} />}
            </Field>
            <Field label="Ended" error={formState.errors.endedAt?.message}>
              {(p) => <Input {...p} type="datetime-local" {...register('endedAt')} />}
            </Field>
          </div>
          <Field label="Reason for the correction" error={formState.errors.reason?.message}>
            {(p) => <Input {...p} placeholder="e.g. forgot to stop the timer" {...register('reason')} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Save correction
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
