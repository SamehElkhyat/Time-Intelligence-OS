'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, DialogContent } from '@/components/ui/overlay';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { fromLocalInput, toLocalInput } from '@/lib/time';
import { activityApi } from '@/services';
import { LEVELS, PRIORITIES, type Activity } from '@/types';
import { levelLabel, useCategories } from '../shared/hooks';

export const activitySchema = z
  .object({
    title: z.string().trim().min(1, 'Give the activity a title').max(160, 'Use 160 characters or fewer'),
    categoryId: z.string().min(1, 'Choose a category'),
    description: z.string().max(4000).optional(),
    plannedStart: z.string().optional(),
    plannedEnd: z.string().optional(),
    estimatedMin: z
      .string()
      .optional()
      .refine((v) => !v || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 1440), 'Enter 1 to 1440 minutes'),
    priority: z.enum(PRIORITIES),
    energyRequired: z.enum(LEVELS),
    focusRequired: z.enum(LEVELS),
    isFixed: z.boolean(),
    tags: z.string().optional(),
    notes: z.string().max(8000).optional(),
  })
  .refine((v) => !!v.plannedStart === !!v.plannedEnd, { path: ['plannedEnd'], message: 'Set both a start and an end, or neither' })
  .refine((v) => !v.plannedStart || !v.plannedEnd || v.plannedEnd > v.plannedStart, { path: ['plannedEnd'], message: 'The end must be after the start' })
  .refine((v) => !v.plannedStart || !v.plannedEnd || new Date(v.plannedEnd).getTime() - new Date(v.plannedStart).getTime() <= 24 * 3_600_000, { path: ['plannedEnd'], message: 'An activity can be at most 24 hours long' });

export type ActivityFormValues = z.infer<typeof activitySchema>;

const parseTags = (s?: string): string[] => (s ?? '').split(',').map((t) => t.trim()).filter(Boolean);

export function ActivityFormDialog({
  open,
  onOpenChange,
  tz,
  activity,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tz: string;
  activity?: Activity;
  /** Prefill when creating (e.g. from a click on the timeline). */
  defaults?: { plannedStart?: Date; durationMin?: number };
}) {
  const categories = useCategories();
  const editing = Boolean(activity);
  const { register, handleSubmit, reset, formState } = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: blank(),
  });

  function blank(): ActivityFormValues {
    return { title: '', categoryId: '', description: '', plannedStart: '', plannedEnd: '', estimatedMin: '', priority: 'MEDIUM', energyRequired: 'MODERATE', focusRequired: 'MODERATE', isFixed: false, tags: '', notes: '' };
  }

  useEffect(() => {
    if (!open) return;
    if (activity) {
      reset({
        title: activity.title,
        categoryId: activity.category.id,
        description: activity.description ?? '',
        plannedStart: activity.plannedStart ? toLocalInput(activity.plannedStart, tz) : '',
        plannedEnd: activity.plannedEnd ? toLocalInput(activity.plannedEnd, tz) : '',
        estimatedMin: activity.estimatedDurationSec ? String(Math.round(activity.estimatedDurationSec / 60)) : '',
        priority: activity.priority,
        energyRequired: activity.energyRequired,
        focusRequired: activity.focusRequired,
        isFixed: activity.isFixed,
        tags: activity.tags.join(', '),
        notes: activity.notes ?? '',
      });
    } else {
      const start = defaults?.plannedStart;
      reset({
        ...blank(),
        plannedStart: start ? toLocalInput(start, tz) : '',
        plannedEnd: start ? toLocalInput(new Date(start.getTime() + (defaults?.durationMin ?? 60) * 60_000), tz) : '',
      });
    }
  }, [open, activity, defaults, tz, reset]);

  const save = useApiMutation({
    mutationFn: (v: ActivityFormValues) => {
      const body = {
        title: v.title,
        categoryId: v.categoryId,
        description: v.description || (editing ? null : undefined),
        notes: v.notes || (editing ? null : undefined),
        plannedStart: v.plannedStart ? fromLocalInput(v.plannedStart, tz) : editing ? null : undefined,
        plannedEnd: v.plannedEnd ? fromLocalInput(v.plannedEnd, tz) : editing ? null : undefined,
        estimatedDurationSec: v.estimatedMin ? Number(v.estimatedMin) * 60 : editing ? null : undefined,
        priority: v.priority,
        energyRequired: v.energyRequired,
        focusRequired: v.focusRequired,
        isFixed: v.isFixed,
        tags: parseTags(v.tags),
      };
      return editing ? activityApi.update(activity!.id, body) : activityApi.create(body as never);
    },
    successMessage: editing ? 'Activity updated' : 'Activity created',
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? 'Edit activity' : 'New activity'} description="Planned time is what you intend; tracked time is what actually happened." className="max-w-xl">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
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
            <Field label="Priority">
              {(p) => (
                <Select {...p} {...register('priority')}>
                  {PRIORITIES.map((x) => (
                    <option key={x} value={x}>
                      {x.charAt(0) + x.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" hint={`Time zone: ${tz}`} error={formState.errors.plannedStart?.message}>
              {(p) => <Input {...p} type="datetime-local" {...register('plannedStart')} />}
            </Field>
            <Field label="Ends" error={formState.errors.plannedEnd?.message}>
              {(p) => <Input {...p} type="datetime-local" {...register('plannedEnd')} />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Estimate (min)" error={formState.errors.estimatedMin?.message}>
              {(p) => <Input {...p} inputMode="numeric" placeholder="optional" {...register('estimatedMin')} />}
            </Field>
            <Field label="Energy needed">
              {(p) => (
                <Select {...p} {...register('energyRequired')}>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {levelLabel(l)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Focus needed">
              {(p) => (
                <Select {...p} {...register('focusRequired')}>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {levelLabel(l)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Tags" hint="Comma separated">
            {(p) => <Input {...p} placeholder="focus, writing" {...register('tags')} />}
          </Field>
          <Field label="Description">{(p) => <Textarea {...p} rows={2} {...register('description')} />}</Field>
          <Field label="Notes">{(p) => <Textarea {...p} rows={2} {...register('notes')} />}</Field>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fg-secondary">
            <Checkbox className="mt-0.5" {...register('isFixed')} />
            <span>
              <span className="font-medium text-fg">Fixed commitment</span> — cannot be moved by the scheduler; buffers are kept around it.
            </span>
          </label>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {editing ? 'Save changes' : 'Create activity'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
